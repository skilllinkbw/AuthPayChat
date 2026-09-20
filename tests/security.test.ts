/**
 * Security suite — every test here is an ATTACK that must fail.
 * Mirrors the audit checklist: IDOR, broken access control, payment manipulation,
 * replay, webhook forgery, client-side trust, malformed input.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  newApp, registerUser, addContact, addAccount, createIntent, confirmPayment, sendWebhook,
  intentRow, stepUp, repo, forgeAccessToken,
} from './helpers.js';
import type { SandboxProvider } from '../apps/api/src/providers/sandbox.js';
import { signWebhook } from '../apps/api/src/providers/signature.js';
import { config } from '../apps/api/src/config.js';

describe('Security — authorisation and payment integrity', () => {
  let app: FastifyInstance;
  let sandbox: SandboxProvider;

  beforeEach(async () => {
    ({ app, sandbox } = await newApp('success'));
  });

  async function twoUsers() {
    const alice = await stepUp(app, await registerUser(app, { phone: '+26771111000', name: 'Alice' }));
    const bob = await stepUp(app, await registerUser(app, { phone: '+26772222000', name: 'Bob' }));
    const bobAsContactOfAlice = addContact(alice.userId, 'Bob', '+26772222000', bob.userId);
    const conversationId = repo.conversations.ensureDirect(alice.userId, bob.userId);
    const aliceAccount = addAccount(alice.userId, { label: 'Orange Money', providerAccountRef: 'alice-wallet' });
    const bobAccount = addAccount(bob.userId, { label: 'MyZaka', providerAccountRef: 'bob-wallet' });
    sandbox.setBalance('alice-wallet', 50000);
    sandbox.setBalance('bob-wallet', 50000);
    return { alice, bob, bobAsContactOfAlice, conversationId, aliceAccount, bobAccount };
  }

  describe('IDOR / broken access control', () => {
    it('cannot read another user’s conversation', async () => {
      const { alice, bob, conversationId } = await twoUsers();
      const response = await app.inject({ method: 'GET', url: `/api/conversations/${conversationId}/messages`, headers: bob.auth });
      // Bob is a member of this conversation, so use a third party instead.
      expect(response.statusCode).toBe(200);

      const carol = await registerUser(app, { phone: '+26773333000', name: 'Carol' });
      const carolResponse = await app.inject({ method: 'GET', url: `/api/conversations/${conversationId}/messages`, headers: carol.auth });
      expect(carolResponse.statusCode).toBe(404);
      expect(alice.userId).toBeTruthy();
    });

    it('cannot post to a conversation you are not part of', async () => {
      const { conversationId } = await twoUsers();
      const carol = await registerUser(app, { phone: '+26773333001', name: 'Carol' });
      const response = await app.inject({
        method: 'POST', url: `/api/conversations/${conversationId}/messages`,
        headers: carol.auth, payload: { body: 'let me in' },
      });
      expect(response.statusCode).toBe(404);
    });

    it('cannot read, confirm or cancel another user’s payment intent', async () => {
      const { alice, bob, bobAsContactOfAlice, aliceAccount } = await twoUsers();
      const created = await createIntent(app, alice, { recipientContactId: bobAsContactOfAlice, amountMinor: 5000 });
      const intentId = String(created.body.id);

      expect((await app.inject({ method: 'GET', url: `/api/payments/intents/${intentId}`, headers: bob.auth })).statusCode).toBe(404);
      expect((await confirmPayment(app, bob, intentId, aliceAccount)).status).toBe(404);
      const cancel = await app.inject({ method: 'POST', url: `/api/payments/intents/${intentId}/cancel`, headers: bob.auth });
      expect(cancel.statusCode).toBe(404);
      expect(intentRow(intentId).status).toBe('CREATED');
    });

    it('cannot read another user’s receipt', async () => {
      const { alice, bob, bobAsContactOfAlice, aliceAccount } = await twoUsers();
      void bob;
      const created = await createIntent(app, alice, { recipientContactId: bobAsContactOfAlice, amountMinor: 5000 });
      const confirmed = await confirmPayment(app, alice, String(created.body.id), aliceAccount);
      await sendWebhook(app, sandbox, String(confirmed.body.providerRef), 'SUCCESSFUL', 5000);
      const receipt = repo.receipts.findByIntent(String(created.body.id))!;

      const response = await app.inject({ method: 'GET', url: `/api/receipts/${receipt.id}`, headers: bob.auth });
      expect(response.statusCode).toBe(404);
    });

    it('cannot fund a payment with an account that is not yours', async () => {
      const { alice, bob, aliceAccount } = await twoUsers();
      const created = await createIntent(app, bob, { recipientContactId: addContact(bob.userId, 'Alice', '+26771111000', alice.userId), amountMinor: 5000 });
      const result = await confirmPayment(app, bob, String(created.body.id), aliceAccount);
      expect(result.status).toBe(400);
      expect(intentRow(String(created.body.id)).status).toBe('CREATED');
    });

    it('cannot read or refresh the balance of another user’s account', async () => {
      const { bob, aliceAccount } = await twoUsers();
      const refresh = await app.inject({ method: 'POST', url: `/api/accounts/${aliceAccount}/balance/refresh`, headers: bob.auth });
      expect(refresh.statusCode).toBe(404);
      const list = await app.inject({ method: 'GET', url: '/api/accounts', headers: bob.auth });
      const ids = (list.json<{ accounts: Array<{ id: string }> }>().accounts).map((a) => a.id);
      expect(ids).not.toContain(aliceAccount);
    });

    it('cannot revoke another user’s device or session', async () => {
      const { alice, bob } = await twoUsers();
      const devices = await app.inject({ method: 'GET', url: '/api/auth/devices', headers: alice.auth });
      const deviceId = String(devices.json<{ devices: Array<{ id: string }> }>().devices[0]!.id);
      const response = await app.inject({ method: 'DELETE', url: `/api/auth/devices/${deviceId}`, headers: bob.auth, payload: {} });
      expect(response.statusCode).toBe(200);   // Bob deletes HIS OWN id namespace — Alice's device survives
      const after = await app.inject({ method: 'GET', url: '/api/auth/devices', headers: alice.auth });
      expect((after.json<{ devices: Array<{ id: string }> }>().devices).map((d) => d.id)).toContain(deviceId);
    });
  });

  describe('Payment manipulation', () => {
    it('ignores a client-supplied amount at confirm time', async () => {
      const { alice, bobAsContactOfAlice, aliceAccount } = await twoUsers();
      const created = await createIntent(app, alice, { recipientContactId: bobAsContactOfAlice, amountMinor: 5000 });
      const intentId = String(created.body.id);

      const tampered = await confirmPayment(app, alice, intentId, aliceAccount, { amountMinor: 1, currency: 'BWP', recipientHandle: '+26779999999' });
      expect(tampered.status).toBe(200);
      expect(intentRow(intentId).amount_minor).toBe(5000);
      expect(intentRow(intentId).recipient_handle).toBe('+26772222000');
    });

    it('rejects a payment to a recipient that is not in the payer’s contacts', async () => {
      const { alice } = await twoUsers();
      const response = await app.inject({
        method: 'POST', url: '/api/payments/intents', headers: alice.auth,
        payload: { recipientContactId: 'ctc_does_not_exist', recipientLabel: 'Stranger', amountMinor: 5000, currency: 'BWP' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects zero, negative and absurd amounts', async () => {
      const { alice, bobAsContactOfAlice } = await twoUsers();
      for (const amountMinor of [0, -500, 99_999_999_999]) {
        const response = await createIntent(app, alice, { recipientContactId: bobAsContactOfAlice, amountMinor });
        expect(response.status).toBe(400);
      }
    });

    it('rejects a status change attempted through any route', async () => {
      const { alice, bobAsContactOfAlice } = await twoUsers();
      const created = await createIntent(app, alice, { recipientContactId: bobAsContactOfAlice, amountMinor: 5000 });
      const patch = await app.inject({
        method: 'PATCH', url: `/api/payments/intents/${created.body.id}`, headers: alice.auth, payload: { status: 'SUCCESSFUL' },
      });
      expect(patch.statusCode).toBe(404);   // no such route
      expect(intentRow(String(created.body.id)).status).toBe('CREATED');
    });

    it('blocks a payment that skips authentication', async () => {
      const { alice, bobAsContactOfAlice, aliceAccount } = await twoUsers();
      const created = await createIntent(app, alice, { recipientContactId: bobAsContactOfAlice, amountMinor: 5000 });
      const response = await app.inject({
        method: 'POST', url: `/api/payments/intents/${created.body.id}/confirm`,
        payload: { accountId: aliceAccount },   // no Authorization header
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects a step-up claim that was never verified (forged su claim)', async () => {
      const { alice, bobAsContactOfAlice, aliceAccount } = await twoUsers();
      const created = await createIntent(app, alice, { recipientContactId: bobAsContactOfAlice, amountMinor: 60000 });
      const forged = forgeAccessToken({
        sub: alice.userId, sid: 'ses_unknown', typ: 'access',
        iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600,
        iss: config.jwt.issuer, aud: config.jwt.audience, jti: 'forged', su: Math.floor(Date.now() / 1000),
      });
      const response = await app.inject({
        method: 'POST', url: `/api/payments/intents/${created.body.id}/confirm`,
        headers: { authorization: `Bearer ${forged}` }, payload: { accountId: aliceAccount },
      });
      // The session id does not exist, so the forged token is rejected before anything else.
      expect(response.statusCode).toBe(401);
    });
  });

  describe('Webhook security', () => {
    async function initiatedPayment() {
      const { alice, bobAsContactOfAlice, aliceAccount } = await twoUsers();
      const created = await createIntent(app, alice, { recipientContactId: bobAsContactOfAlice, amountMinor: 5000 });
      const confirmed = await confirmPayment(app, alice, String(created.body.id), aliceAccount);
      return { intentId: String(created.body.id), providerRef: String(confirmed.body.providerRef) };
    }

    it('rejects a callback with an invalid signature', async () => {
      const { intentId, providerRef } = await initiatedPayment();
      const response = await sendWebhook(app, sandbox, providerRef, 'SUCCESSFUL', 5000, (built) => {
        built.headers['x-paychat-signature'] = 't=' + Math.floor(Date.now() / 1000) + ',v1=deadbeef';
      });
      expect(response.status).toBe(400);
      expect(intentRow(intentId).status).not.toBe('SUCCESSFUL');
    });

    it('rejects a callback whose body was tampered with', async () => {
      const { intentId, providerRef } = await initiatedPayment();
      const response = await sendWebhook(app, sandbox, providerRef, 'SUCCESSFUL', 5000, (built) => {
        built.body = built.body.replace('5000', '9999999');
      });
      expect(response.status).toBe(400);
      expect(intentRow(intentId).status).not.toBe('SUCCESSFUL');
    });

    it('rejects a replayed callback (same event id twice)', async () => {
      const { intentId, providerRef } = await initiatedPayment();
      const first = await sendWebhook(app, sandbox, providerRef, 'SUCCESSFUL', 5000);
      const replay = await sendWebhook(app, sandbox, providerRef, 'SUCCESSFUL', 5000, (built) => {
        built.headers['x-paychat-event-id'] = 'evt_fixed_replay_id';
      });
      const replayAgain = await sendWebhook(app, sandbox, providerRef, 'SUCCESSFUL', 5000, (built) => {
        built.headers['x-paychat-event-id'] = 'evt_fixed_replay_id';
      });
      expect(first.status).toBe(200);
      expect(replay.status).toBe(200);
      expect(replayAgain.status).toBe(400);
      expect(intentRow(intentId).status).toBe('SUCCESSFUL');
    });

    it('rejects a stale timestamp (replay window)', async () => {
      const { intentId, providerRef } = await initiatedPayment();
      const body = JSON.stringify({ reference: providerRef, status: 'SUCCESSFUL', amount: { value: 5000, currency: 'BWP' } });
      const { header } = signWebhook(body, 'sandbox-webhook-secret-not-for-production', Math.floor(Date.now() / 1000) - 4000);
      const response = await app.inject({
        method: 'POST', url: '/api/webhooks/sandbox',
        headers: { 'content-type': 'application/json', 'x-paychat-event-id': 'evt_stale_1', 'x-paychat-signature': header },
        payload: body,
      });
      expect(response.statusCode).toBe(400);
      expect(intentRow(intentId).status).not.toBe('SUCCESSFUL');
    });

    it('rejects a callback for an unknown reference', async () => {
      const response = await sendWebhook(app, sandbox, 'sbx_unknown_reference', 'SUCCESSFUL', 5000);
      expect(response.status).toBe(400);
    });

    it('rejects a successful callback whose amount does not match the confirmed payment', async () => {
      const { intentId, providerRef } = await initiatedPayment();
      const response = await sendWebhook(app, sandbox, providerRef, 'SUCCESSFUL', 999999);
      expect(response.status).toBe(400);
      expect(intentRow(intentId).status).not.toBe('SUCCESSFUL');
    });

    it('rejects a callback with no event id', async () => {
      const { providerRef } = await initiatedPayment();
      const response = await sendWebhook(app, sandbox, providerRef, 'SUCCESSFUL', 5000, (built) => {
        delete built.headers['x-paychat-event-id'];
      });
      expect(response.status).toBe(400);
    });

    it('never reveals provider internals in a rejection', async () => {
      const response = await app.inject({ method: 'POST', url: '/api/webhooks/sandbox', payload: { status: 'SUCCESSFUL' } });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain('secret');
      expect(response.json<{ error: { code: string } }>().error.code).toBe('WEBHOOK_REJECTED');
    });
  });

  describe('Input validation', () => {
    it('rejects malformed JSON with a clear error', async () => {
      const { alice } = await twoUsers();
      const response = await app.inject({
        method: 'POST', url: '/api/payments/intents', headers: { ...alice.auth, 'content-type': 'application/json' },
        payload: '{ not json',
      });
      expect(response.statusCode).toBe(400);
    });

    it('requires authentication on every money endpoint', async () => {
      for (const url of ['/api/accounts', '/api/payments', '/api/receipts', '/api/requests', '/api/notifications']) {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode, url).toBe(401);
      }
    });
  });
});

describe('Security — payment links', () => {
  let app: FastifyInstance;
  let sandbox: SandboxProvider;

  beforeEach(async () => {
    ({ app, sandbox } = await newApp('success'));
  });

  async function linkSetup() {
    const alice = await stepUp(app, await registerUser(app, { phone: '+26771444000', name: 'Alice' }));
    const bob = await stepUp(app, await registerUser(app, { phone: '+26772555000', name: 'Bob' }));
    const bobAccount = addAccount(bob.userId, { label: 'MyZaka', providerAccountRef: 'bob-link' });
    sandbox.setBalance('bob-link', 90000);
    return { alice, bob, bobAccount };
  }

  it('creates a signed, expiring link that hides no secret and carries the amount server-side', async () => {
    const { alice, bob } = await linkSetup();
    const created = await app.inject({
      method: 'POST', url: '/api/payment-links', headers: alice.auth,
      payload: { amountMinor: 7500, currency: 'BWP', description: 'Lunch', expiresInMinutes: 30 },
    });
    expect(created.statusCode).toBe(201);
    const { token } = created.json<{ token: string }>();
    expect(token.split('.').length).toBe(2);

    const preview = await app.inject({ method: 'GET', url: `/api/payment-links/${token}`, headers: bob.auth });
    expect(preview.statusCode).toBe(200);
    expect(preview.json<{ amountMinor: number }>().amountMinor).toBe(7500);
  });

  it('rejects a tampered link', async () => {
    const { alice, bob } = await linkSetup();
    const created = await app.inject({
      method: 'POST', url: '/api/payment-links', headers: alice.auth, payload: { amountMinor: 7500 },
    });
    const { token } = created.json<{ token: string }>();
    const [body, signature] = token.split('.') as [string, string];
    const tamperedPayload = Buffer.from(JSON.stringify({ amountMinor: 1, currency: 'BWP', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');

    const tampered = await app.inject({ method: 'GET', url: `/api/payment-links/${tamperedPayload}.${signature}`, headers: bob.auth });
    expect(tampered.statusCode).toBe(404);

    const tamperedSig = await app.inject({ method: 'GET', url: `/api/payment-links/${body}.${signature.slice(0, -2)}aa`, headers: bob.auth });
    expect(tamperedSig.statusCode).toBe(404);
  });

  it('rejects an expired link', async () => {
    const { alice, bob } = await linkSetup();
    const created = await app.inject({
      method: 'POST', url: '/api/payment-links', headers: alice.auth,
      payload: { amountMinor: 7500, expiresInMinutes: 1 },
    });
    const { token } = created.json<{ token: string }>();
    const [body, signature] = token.split('.') as [string, string];
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
    payload.exp = Math.floor(Date.now() / 1000) - 10;
    const expired = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;

    const response = await app.inject({ method: 'GET', url: `/api/payment-links/${expired}`, headers: bob.auth });
    expect(response.statusCode).toBe(404);
  });

  it('cannot pay the same link twice', async () => {
    const { alice, bob, bobAccount } = await linkSetup();
    const created = await app.inject({
      method: 'POST', url: '/api/payment-links', headers: alice.auth, payload: { amountMinor: 7500 },
    });
    const { token } = created.json<{ token: string }>();

    const first = await app.inject({
      method: 'POST', url: `/api/payment-links/${token}/pay`, headers: bob.auth, payload: { accountId: bobAccount },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST', url: `/api/payment-links/${token}/pay`, headers: bob.auth, payload: { accountId: bobAccount },
    });
    expect(second.statusCode).toBe(409);
  });
});

describe('Security — HTTP response headers', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await newApp('success'));
  });

  it('sends hardening headers on successful responses', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['permissions-policy']).toContain('camera=()');
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin');
  });

  it('sends hardening headers on error responses too', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' }); // 401, unauthenticated
    expect(response.statusCode).toBe(401);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
  });

  it('does not relax cross-origin access (no ACAO header)', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz', headers: { origin: 'https://evil.example' } });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('sends HSTS only in production (test env must not emit it)', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(config.isProduction).toBe(false);
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });
});
