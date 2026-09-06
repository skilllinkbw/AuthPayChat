import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { newApp, registerUser, conversationBetween, repo } from './helpers.js';

describe('Messaging', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await newApp());
  });

  it('delivers a message to the other participant', async () => {
    const alice = await registerUser(app, { phone: '+26771111000', name: 'Alice' });
    const bob = await registerUser(app, { phone: '+26772222000', name: 'Bob' });
    const conversationId = conversationBetween(alice.userId, bob.userId);

    const sent = await app.inject({
      method: 'POST', url: `/api/conversations/${conversationId}/messages`,
      headers: alice.auth, payload: { body: 'Duela Motakase P50' },
    });
    expect(sent.statusCode).toBe(201);

    const listed = await app.inject({ method: 'GET', url: `/api/conversations/${conversationId}/messages`, headers: bob.auth });
    const messages = listed.json<{ messages: Array<{ body: string }> }>().messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toBe('Duela Motakase P50');
  });

  it('paginates instead of loading entire histories', async () => {
    const alice = await registerUser(app, { phone: '+26771111001' });
    const bob = await registerUser(app, { phone: '+26772222001' });
    const conversationId = conversationBetween(alice.userId, bob.userId);
    for (let i = 0; i < 12; i++) {
      repo.conversations.addMessage({ conversationId, senderId: alice.userId, body: `msg-${i}` });
    }

    const page1 = await app.inject({ method: 'GET', url: `/api/conversations/${conversationId}/messages?limit=5`, headers: alice.auth });
    const first = page1.json<{ messages: Array<{ id: string; created_at: string; body: string }> }>().messages;
    expect(first).toHaveLength(5);

    const page2 = await app.inject({
      method: 'GET',
      url: `/api/conversations/${conversationId}/messages?limit=5&before=${encodeURIComponent(first[0]!.created_at)}&beforeId=${encodeURIComponent(first[0]!.id)}`,
      headers: alice.auth,
    });
    const second = page2.json<{ messages: Array<{ id: string }> }>().messages;
    expect(second).toHaveLength(5);
    expect(second.map((m) => m.id)).not.toEqual(first.map((m) => m.id));
  });

  it('de-duplicates retries that reuse a client message id (safe on bad networks)', async () => {
    const alice = await registerUser(app, { phone: '+26771111002' });
    const bob = await registerUser(app, { phone: '+26772222002' });
    const conversationId = conversationBetween(alice.userId, bob.userId);

    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST', url: `/api/conversations/${conversationId}/messages`,
        headers: alice.auth, payload: { body: 'Pay P50 Motakase', clientMsgId: 'retry-key-1' },
      });
    }
    const listed = await app.inject({ method: 'GET', url: `/api/conversations/${conversationId}/messages`, headers: alice.auth });
    expect(listed.json<{ messages: unknown[] }>().messages).toHaveLength(1);
  });

  it('lists conversations for the signed-in user only', async () => {
    const alice = await registerUser(app, { phone: '+26771111003' });
    const bob = await registerUser(app, { phone: '+26772222003' });
    const carol = await registerUser(app, { phone: '+26773333003' });
    conversationBetween(alice.userId, bob.userId);
    conversationBetween(bob.userId, carol.userId);

    const aliceList = await app.inject({ method: 'GET', url: '/api/conversations', headers: alice.auth });
    expect(aliceList.json<{ conversations: unknown[] }>().conversations).toHaveLength(1);

    const bobList = await app.inject({ method: 'GET', url: '/api/conversations', headers: bob.auth });
    expect(bobList.json<{ conversations: unknown[] }>().conversations).toHaveLength(2);
  });

  it('marks messages read for the reader, not for the peer', async () => {
    const alice = await registerUser(app, { phone: '+26771111004' });
    const bob = await registerUser(app, { phone: '+26772222004' });
    const conversationId = conversationBetween(alice.userId, bob.userId);
    repo.conversations.addMessage({ conversationId, senderId: alice.userId, body: 'hello' });

    await app.inject({ method: 'GET', url: `/api/conversations/${conversationId}/messages`, headers: bob.auth });
    const afterRead = await app.inject({ method: 'GET', url: '/api/conversations', headers: bob.auth });
    const unread = (afterRead.json<{ conversations: Array<{ unread: number }> }>().conversations)[0]!.unread;
    expect(unread).toBe(0);

    const aliceView = await app.inject({ method: 'GET', url: '/api/conversations', headers: alice.auth });
    expect((aliceView.json<{ conversations: Array<{ unread: number }> }>().conversations)[0]!.unread).toBe(1);
  });
});
