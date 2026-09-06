/**
 * Cursor pagination (brief §11).
 *
 * Covers: identical timestamps (the defect: a timestamp-only cursor skips and repeats rows),
 * ascending/descending order, empty result, first/middle/final page, paging while new records
 * are being inserted, malformed cursors, limit clamping, and cross-user isolation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { newApp, registerUser, addContact, conversationBetween, repo } from './helpers.js';
import { getDb } from '../apps/api/src/db/index.js';
import { decodeCursor, encodeCursor } from '../apps/api/src/db/cursor.js';

interface MessageRow { id: string; body: string | null; created_at: string; }

describe('Cursor pagination — messages', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await newApp('success'));
  });

  /** Inserts messages with explicit timestamps so we can create exact ties. */
  function seed(conversationId: string, senderId: string, count: number, opts: { tieAll?: boolean; startMs?: number } = {}) {
    const start = opts.startMs ?? Date.parse('2026-01-01T09:00:00.000Z');
    const insert = getDb().prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, kind, body, created_at)
       VALUES (?, ?, ?, 'text', ?, ?)`,
    );
    for (let i = 0; i < count; i++) {
      const at = new Date(start + (opts.tieAll ? 0 : i * 1000)).toISOString();
      insert.run(`msg_seed_${i}`, conversationId, senderId, `m${i}`, at);
    }
  }

  async function page(conversationId: string, query: string, auth: Record<string, string>) {
    const response = await app.inject({ method: 'GET', url: `/api/conversations/${conversationId}/messages${query}`, headers: auth });
    return {
      status: response.statusCode,
      body: response.json<{ messages: MessageRow[]; nextCursor: string | null }>(),
    };
  }

  it('returns newest last with a nextCursor, and the oldest page returns none', async () => {
    const user = await registerUser(app, { phone: '+26774111001', name: 'Pager' });
    const peer = repo.users.create({ phone: '+26774222002', passwordHash: 'scrypt$x$y', displayName: 'Peer' });
    addContact(user.userId, 'Peer', '+26774222002', peer.id);
    const conversationId = conversationBetween(user.userId, peer.id);
    seed(conversationId, user.userId, 10);

    const first = await page(conversationId, '?limit=4', user.auth);
    expect(first.status).toBe(200);
    expect(first.body.messages.map((m) => m.body)).toEqual(['m6', 'm7', 'm8', 'm9']);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await page(conversationId, `?limit=4&cursor=${encodeURIComponent(first.body.nextCursor!)}`, user.auth);
    expect(second.body.messages.map((m) => m.body)).toEqual(['m2', 'm3', 'm4', 'm5']);

    const third = await page(conversationId, `?limit=4&cursor=${encodeURIComponent(second.body.nextCursor!)}`, user.auth);
    expect(third.body.messages.map((m) => m.body)).toEqual(['m0', 'm1']);
    expect(third.body.nextCursor).toBeNull();     // final page: no cursor, never an empty page
  });

  it('paginates correctly when every message shares the SAME timestamp', async () => {
    const user = await registerUser(app, { phone: '+26774111002', name: 'TiePager' });
    const peer = repo.users.create({ phone: '+26774222003', passwordHash: 'scrypt$x$y', displayName: 'Peer' });
    const conversationId = conversationBetween(user.userId, peer.id);
    seed(conversationId, user.userId, 25, { tieAll: true });   // all identical created_at

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const current = await page(conversationId, `?limit=7${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, user.auth);
      expect(current.status).toBe(200);
      for (const message of current.body.messages) seen.push(String(message.body));
      cursor = current.body.nextCursor;
      pages++;
      expect(pages).toBeLessThan(10);
    } while (cursor);

    // No skips, no duplicates, every one of the 25 tied messages returned exactly once.
    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });

  it('does not skip or repeat rows when new messages arrive while paging', async () => {
    const user = await registerUser(app, { phone: '+26774111003', name: 'LivePager' });
    const peer = repo.users.create({ phone: '+26774222004', passwordHash: 'scrypt$x$y', displayName: 'Peer' });
    const conversationId = conversationBetween(user.userId, peer.id);
    seed(conversationId, user.userId, 6);

    const first = await page(conversationId, '?limit=3', user.auth);
    const firstIds = first.body.messages.map((m) => m.id);

    // Three brand-new messages arrive (newer than everything we already read).
    const insert = getDb().prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, kind, body, created_at)
       VALUES (?, ?, ?, 'text', ?, ?)`,
    );
    for (let i = 0; i < 3; i++) {
      insert.run(`msg_live_${i}`, conversationId, user.userId, `live${i}`, new Date(Date.parse('2026-01-01T09:10:00.000Z') + i * 1000).toISOString());
    }

    const second = await page(conversationId, `?limit=3&cursor=${encodeURIComponent(first.body.nextCursor!)}`, user.auth);
    const secondIds = second.body.messages.map((m) => m.id);
    // Walking backwards in time, new arrivals at the head cannot displace or duplicate rows.
    expect(secondIds.some((id) => firstIds.includes(id))).toBe(false);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(6);
  });

  it('handles an empty conversation and a single message', async () => {
    const user = await registerUser(app, { phone: '+26774111004', name: 'EmptyPager' });
    const peer = repo.users.create({ phone: '+26774222005', passwordHash: 'scrypt$x$y', displayName: 'Peer' });
    const conversationId = conversationBetween(user.userId, peer.id);

    const empty = await page(conversationId, '?limit=10', user.auth);
    expect(empty.body.messages).toEqual([]);
    expect(empty.body.nextCursor).toBeNull();

    seed(conversationId, user.userId, 1);
    const one = await page(conversationId, '?limit=10', user.auth);
    expect(one.body.messages).toHaveLength(1);
    expect(one.body.nextCursor).toBeNull();
  });

  it('accepts the legacy before/beforeId pair and still ties correctly', async () => {
    const user = await registerUser(app, { phone: '+26774111005', name: 'LegacyPager' });
    const peer = repo.users.create({ phone: '+26774222006', passwordHash: 'scrypt$x$y', displayName: 'Peer' });
    const conversationId = conversationBetween(user.userId, peer.id);
    seed(conversationId, user.userId, 6, { tieAll: true });

    const first = await page(conversationId, '?limit=3', user.auth);
    const boundary = first.body.messages[0]!;   // oldest of the newest page
    const legacy = await page(conversationId, `?limit=3&before=${encodeURIComponent(boundary.created_at)}&beforeId=${boundary.id}`, user.auth);
    expect(legacy.status).toBe(200);
    expect(legacy.body.messages.some((m) => m.id === boundary.id)).toBe(false);
    expect(legacy.body.messages).toHaveLength(3);
  });

  it('rejects a malformed cursor instead of returning a wrong page', async () => {
    const user = await registerUser(app, { phone: '+26774111006', name: 'BadPager' });
    const peer = repo.users.create({ phone: '+26774222007', passwordHash: 'scrypt$x$y', displayName: 'Peer' });
    const conversationId = conversationBetween(user.userId, peer.id);
    seed(conversationId, user.userId, 5);

    const bad = await app.inject({
      method: 'GET', url: `/api/conversations/${conversationId}/messages?cursor=${encodeURIComponent('not-a-cursor!!')}`, headers: user.auth,
    });
    expect(bad.statusCode).toBe(400);
  });

  it('clamps an absurd limit rather than dumping the table', async () => {
    const user = await registerUser(app, { phone: '+26774111007', name: 'ClampPager' });
    const peer = repo.users.create({ phone: '+26774222008', passwordHash: 'scrypt$x$y', displayName: 'Peer' });
    const conversationId = conversationBetween(user.userId, peer.id);
    seed(conversationId, user.userId, 150);

    const huge = await app.inject({ method: 'GET', url: `/api/conversations/${conversationId}/messages?limit=5000`, headers: user.auth });
    expect(huge.statusCode).toBe(400);

    const zero = await app.inject({ method: 'GET', url: `/api/conversations/${conversationId}/messages?limit=0`, headers: user.auth });
    expect(zero.statusCode).toBe(400);
  });

  it('never leaks messages from a conversation the caller is not in', async () => {
    const owner = await registerUser(app, { phone: '+26774111008', name: 'Owner' });
    const stranger = await registerUser(app, { phone: '+26774111009', name: 'Stranger' });
    const peer = repo.users.create({ phone: '+26774222009', passwordHash: 'scrypt$x$y', displayName: 'Peer' });
    const conversationId = conversationBetween(owner.userId, peer.id);
    seed(conversationId, owner.userId, 4);

    const response = await app.inject({ method: 'GET', url: `/api/conversations/${conversationId}/messages`, headers: stranger.auth });
    expect(response.statusCode).toBe(404);
  });
});

describe('Cursor pagination — conversations', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await newApp('success'));
  });

  it('pages conversations that share an identical last_message_at without repeats or gaps', async () => {
    const user = await registerUser(app, { phone: '+26774111010', name: 'ConvPager' });
    const tie = new Date('2026-02-02T10:00:00.000Z').toISOString();
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const peer = repo.users.create({ phone: `+26775000${100 + i}`, passwordHash: 'scrypt$x$y', displayName: `Peer ${i}` });
      const conversationId = conversationBetween(user.userId, peer.id);
      getDb().prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(tie, conversationId);
      ids.push(conversationId);
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const response: { json<T>(): T } = await app.inject({
        method: 'GET',
        url: `/api/conversations?limit=5${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        headers: user.auth,
      });
      const body = response.json<{ conversations: Array<{ id: string }>; nextCursor: string | null }>();
      for (const conversation of body.conversations) seen.push(conversation.id);
      cursor = body.nextCursor;
    } while (cursor);

    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    expect([...seen].sort()).toEqual([...ids].sort());
  });
});

describe('Cursor encoding', () => {
  it('round-trips and rejects junk', () => {
    const cursor = { ts: '2026-01-01T00:00:00.000Z', id: 'msg_1' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('%%%')).toBeNull();
    expect(decodeCursor(Buffer.from('{"t":1}').toString('base64url'))).toBeNull();
  });
});
