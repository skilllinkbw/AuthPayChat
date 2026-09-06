import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@paychat/shared';
import * as repo from '../repositories.js';
import { dbMemberIds } from '../repositories.js';
import { requireAuth } from '../security/context.js';
import { decodeCursor, nextCursorFrom, MAX_ID } from '../db/cursor.js';
import { publish, subscribe } from '../realtime.js';
import { audit } from '../security/audit.js';
import { authService } from '../security/auth.js';

/**
 * Reads a cursor from the request. An unreadable cursor is a client error — silently
 * falling back to page one would look like correct data while skipping everything before it.
 */
function readCursor(raw: string | undefined, before?: string, beforeId?: string) {
  if (raw) {
    const cursor = decodeCursor(raw);
    if (!cursor) throw Errors.validation({ cursor: 'This scroll position is no longer valid. Please refresh.' });
    return cursor;
  }
  return before ? { ts: before, id: beforeId ?? MAX_ID } : null;
}

export function chatRoutes(app: FastifyInstance): void {
  /**
   * Cursor pagination. `cursor` is opaque (returned as `nextCursor`); `before`/`beforeId`
   * remain accepted for older clients and are folded into the same composite cursor.
   */
  app.get('/api/conversations', { preHandler: requireAuth }, async (request) => {
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      cursor: z.string().max(512).optional(),
      before: z.string().max(64).optional(),
    }).safeParse(request.query);
    if (!query.success) throw Errors.validation({ limit: 'Limit must be between 1 and 100' });
    const cursor = readCursor(query.data.cursor, query.data.before);
    const rows = repo.conversations.listForUser(request.auth!.userId, query.data.limit, cursor);
    return {
      conversations: rows,
      nextCursor: nextCursorFrom(rows as Array<{ id: string }>, query.data.limit, (row) => String((row as Record<string, unknown>).last_message_at)),
    };
  });

  /** Membership is checked before any message is returned. */
  app.get('/api/conversations/:id/messages', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(30),
      cursor: z.string().max(512).optional(),
      before: z.string().max(64).optional(),
      beforeId: z.string().max(64).optional(),
    }).safeParse(request.query);
    if (!query.success) throw Errors.validation({ limit: 'Limit must be between 1 and 100' });
    if (!repo.conversations.isMember(id, request.auth!.userId)) throw Errors.notFound('Conversation');
    const cursor = readCursor(query.data.cursor, query.data.before, query.data.beforeId);
    const rows = repo.conversations.messages(id, query.data.limit, cursor);
    repo.conversations.markRead(id, request.auth!.userId);
    return {
      // Oldest → newest for rendering; `nextCursor` still walks backwards in time.
      messages: rows.reverse() as Array<Record<string, unknown>>,
      nextCursor: nextCursorFrom([...rows].reverse() as Array<{ id: string }>, query.data.limit, (row) => String((row as Record<string, unknown>).created_at)),
    };
  });

  app.post('/api/conversations/:id/messages', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      body: z.string().min(1).max(4000),
      clientMsgId: z.string().min(6).max(80).optional(),
    }).parse(request.body);

    if (!repo.conversations.isMember(id, request.auth!.userId)) throw Errors.notFound('Conversation');

    const messageId = repo.conversations.addMessage({
      conversationId: id,
      senderId: request.auth!.userId,
      body: body.body,
      clientMsgId: body.clientMsgId ?? null,
    });

    const members = dbMemberIds(id, request.auth!.userId);
    for (const memberId of members) {
      publish(memberId, { type: 'message', data: { conversationId: id, messageId, body: body.body, senderId: request.auth!.userId } });
    }
    return reply.code(201).send({ id: messageId });
  });

  app.post('/api/conversations/direct', { preHandler: requireAuth }, async (request, reply) => {
    const body = z.object({ userId: z.string().min(1) }).parse(request.body);
    if (body.userId === request.auth!.userId) throw Errors.validation({ userId: 'You cannot message yourself' });
    const target = repo.users.findById(body.userId);
    if (!target) throw Errors.notFound('User');
    const conversationId = repo.conversations.ensureDirect(request.auth!.userId, body.userId);
    return reply.send({ id: conversationId });
  });

  app.get('/api/contacts', { preHandler: requireAuth }, async (request) => {
    return { contacts: repo.contacts.list(request.auth!.userId) };
  });

  app.post('/api/contacts', { preHandler: requireAuth }, async (request, reply) => {
    const body = z.object({
      displayName: z.string().min(2).max(60),
      phone: z.string().min(8).max(20),
    }).parse(request.body);
    const existingUser = repo.users.findByPhone(body.phone);
    const contactId = repo.contacts.add(request.auth!.userId, {
      contactUserId: existingUser?.id ?? null,
      displayName: body.displayName,
      phone: body.phone,
      isMerchant: existingUser?.is_merchant === 1,
    });
    const conversationId = existingUser ? repo.conversations.ensureDirect(request.auth!.userId, existingUser.id) : null;
    return reply.code(201).send({ id: contactId, conversationId });
  });

  app.get('/api/contacts/search', { preHandler: requireAuth }, async (request) => {
    const { q } = request.query as { q?: string };
    if (!q) return { contacts: [], users: [] };
    return {
      contacts: repo.contacts.search(request.auth!.userId, q),
      users: repo.users.search(q, request.auth!.userId),
    };
  });

  /**
   * Realtime stream. EventSource cannot set headers, so the token arrives as a query
   * parameter and is validated exactly like a bearer token.
   */
  app.get('/api/events', async (request, reply) => {
    const { token } = request.query as { token?: string };
    const context = token ? authService.verify(`Bearer ${token}`) : null;
    if (!context) return reply.code(401).send({ error: 'unauthorized' });

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write('event: ready\ndata: {}\n\n');

    const unsubscribe = subscribe(context.userId, (event) => {
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
    });

    const heartbeat = setInterval(() => reply.raw.write(': keep-alive\n\n'), 25_000);
    request.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    audit('auth.session_active', { type: 'session', id: context.sessionId }, { actorUserId: context.userId });
  });
}
