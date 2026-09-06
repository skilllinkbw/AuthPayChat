import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  newApp, registerUser, addContact, addAccount, createIntent, confirmPayment, sendWebhook,
  intentRow, stepUp, repo,
} from './helpers.js';
import type { SandboxProvider } from '../apps/api/src/providers/sandbox.js';
import { getDb } from '../apps/api/src/db/index.js';

describe('Payments — orchestrator lifecycle', () => {
  let app: FastifyInstance;
  let sandbox: SandboxProvider;

  beforeEach(async () => {
    ({ app, sandbox } = await newApp('success'));
  });

  async function standardSetup(balanceMinor = 18540) {
    const user = await registerUser(app, { phone: '+26771000001', name: 'Payer' });
    const contact = repo.users.create({
      phone: '+26772000002', passwordHash: 'scrypt$x$y', displayName: 'Motakase',
    });
    const contactId = addContact(user.userId, 'Motakase', '+26772000002', contact.id);
    const conversationId = repo.conversations.ensureDirect(user.userId, contact.id);
    const accountId = addAccount(user.userId, { label: 'Orange Money', providerAccountRef: 'wallet-1', isDefault: true });
    sandbox.setBalance('wallet-1', balanceMinor);
    return { user: await stepUp(app, user), contactId, conversationId, accountId, contact };
  }

  it('does not move money when the command is merely typed (intent only, CREATED)', async () => {
    const { user, contactId } = await standardSetup();
    const { status, body } = await createIntent(app, user, { recipientContactId: contactId });
    expect(status).toBe(201);
    expect(body.status).toBe('CREATED');
    expect(repo.transactions.countForIntent(String(body.id))).toBe(0);
    // The account is untouched until an explicit, authenticated confirm.
    expect(intentRow(String(body.id)).account_id).toBeNull();
  });

  it('completes a payment only after a verified provider callback', async () => {
    const { user, contactId, conversationId, accountId } = await standardSetup();
    const created = await createIntent(app, user, { recipientContactId: contactId, conversationId, amountMinor: 5000 });
    const intentId = String(created.body.id);

    const confirmed = await confirmPayment(app, user, intentId, accountId);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('PROCESSING');
    const providerRef = String(confirmed.body.providerRef);
    expect(providerRef).toMatch(/^sbx_/);
    // Not yet successful — no receipt exists at this point.
    expect(repo.receipts.findByIntent(intentId)).toBeUndefined();

    const webhook = await sendWebhook(app, sandbox, providerRef, 'SUCCESSFUL', 5000);
    expect(webhook.status).toBe(200);
    expect(intentRow(intentId).status).toBe('SUCCESSFUL');

    const receipt = repo.receipts.findByIntent(intentId);
    expect(receipt).toBeDefined();
    expect(receipt!.amount_minor).toBe(5000);

    const messages = repo.conversations.messages(conversationId);
    expect(messages.some((m) => m.kind === 'payment')).toBe(true);
  });

  it('never creates a second payment when Confirm is pressed twice', async () => {
    const { user, contactId, accountId } = await standardSetup();
    const created = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 5000 });
    const intentId = String(created.body.id);
    void accountId;

    const first = await confirmPayment(app, user, intentId, accountId);
    const second = await confirmPayment(app, user, intentId, accountId);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe(first.body.status);
    expect(repo.transactions.countForIntent(intentId)).toBe(1);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM payment_intents').get()).toMatchObject({ n: 1 });
  });

  it('honours an idempotency key on intent creation', async () => {
    const { user, contactId } = await standardSetup();
    const a = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 5000, idempotencyKey: 'key-abc' });
    const b = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 5000, idempotencyKey: 'key-abc' });
    expect(a.body.id).toBe(b.body.id);
    expect(b.body.duplicate).toBe(true);
    const count = getDb().prepare('SELECT COUNT(*) AS n FROM payment_intents').get() as { n: number };
    expect(count.n).toBe(1);
  });

  it('reports insufficient funds honestly and does not send', async () => {
    const { user, contactId, accountId } = await standardSetup(1000); // P10.00 for a P50 payment
    const created = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 5000 });
    const intentId = String(created.body.id);

    const confirmed = await confirmPayment(app, user, intentId, accountId);
    expect(confirmed.status).toBe(402);
    const error = confirmed.body.error as { code: string; message: string };
    expect(error.code).toBe('PAYMENT_FAILED');
    expect(error.message).toMatch(/not enough money/i);
    expect(error.message).not.toMatch(/lost/i);   // never tell the user money is lost
    expect(intentRow(intentId).status).toBe('FAILED');
    expect(repo.receipts.findByIntent(intentId)).toBeUndefined();
  });

  it('keeps a payment PENDING when the provider times out (no false failure)', async () => {
    ({ app, sandbox } = await newApp('timeout'));
    const user = await registerUser(app, { phone: '+26771000011' });
    const contactId = addContact(user.userId, 'Motakase', '+26772000002');
    const accountId = addAccount(user.userId, { label: 'MyZaka', providerAccountRef: 'wallet-2' });
    const created = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 5000 });

    const confirmed = await confirmPayment(app, (await stepUp(app, user)), String(created.body.id), accountId);
    expect(confirmed.status).toBe(503);
    expect(intentRow(String(created.body.id)).status).toBe('PENDING');
  });

  it('surfaces provider unavailability without inventing an outcome', async () => {
    ({ app, sandbox } = await newApp('unavailable'));
    const user = await registerUser(app, { phone: '+26771000012' });
    const contactId = addContact(user.userId, 'Motakase', '+26772000002');
    const accountId = addAccount(user.userId, { label: 'Smega', providerAccountRef: 'wallet-3' });
    const created = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 3000 });
    const confirmed = await confirmPayment(app, (await stepUp(app, user)), String(created.body.id), accountId);
    expect(confirmed.status).toBe(503);
    expect(intentRow(String(created.body.id)).status).toBe('PENDING');
  });

  it('cancels an unconfirmed payment', async () => {
    const { user, contactId } = await standardSetup();
    const created = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 5000 });
    const response = await app.inject({
      method: 'POST', url: `/api/payments/intents/${created.body.id}/cancel`, headers: user.auth,
    });
    expect(response.statusCode).toBe(200);
    expect(intentRow(String(created.body.id)).status).toBe('CANCELLED');
  });

  it('ignores an expired intent', async () => {
    const { user, contactId, accountId } = await standardSetup();
    const created = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 5000 });
    const intentId = String(created.body.id);
    getDb().prepare('UPDATE payment_intents SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), intentId);

    const confirmed = await confirmPayment(app, user, intentId, accountId);
    expect(confirmed.body.status).toBe('EXPIRED');
    expect(intentRow(intentId).status).toBe('EXPIRED');
  });

  it('requires step-up authentication for a high-value payment', async () => {
    const { user, contactId, accountId } = await standardSetup(500000);
    const created = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 60000 }); // P600
    const intentId = String(created.body.id);

    // A fresh user has no verified step-up claim on their token.
    const blocked = await app.inject({
      method: 'POST', url: `/api/payments/intents/${intentId}/confirm`,
      headers: { authorization: `Bearer ${(await stepUp(app, user)).accessToken}` },
      payload: { accountId },
    });
    expect(blocked.statusCode).toBe(200);

    // A token without a step-up claim is rejected outright.
    const fresh = await registerUser(app, { phone: '+26771000098' });
    const otherContact = addContact(fresh.userId, 'Neo', '+26773000003');
    const otherAccount = addAccount(fresh.userId, { label: 'Bank', providerAccountRef: 'bank-1', kind: 'bank' });
    sandbox.setBalance('bank-1', 900000);
    const otherIntent = await createIntent(app, fresh, { recipientContactId: otherContact, amountMinor: 60000 });
    const rejected = await confirmPayment(app, fresh, String(otherIntent.body.id), otherAccount);
    expect(rejected.status).toBe(403);
    expect((rejected.body.error as { requiresStepUp?: boolean })?.requiresStepUp).toBe(true);
    expect(intentRow(String(otherIntent.body.id)).status).toBe('CREATED');
  });

  it('refunds a successful payment when the provider supports it', async () => {
    const { user, contactId, accountId } = await standardSetup();
    const created = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 5000 });
    const intentId = String(created.body.id);
    const confirmed = await confirmPayment(app, user, intentId, accountId);
    await sendWebhook(app, sandbox, String(confirmed.body.providerRef), 'SUCCESSFUL', 5000);

    const refund = await app.inject({ method: 'POST', url: `/api/payments/${intentId}/refund`, headers: user.auth, payload: {} });
    expect(refund.statusCode).toBe(200);
    expect(intentRow(intentId).status).toBe('REFUNDED');
  });
});

describe('Payments — reconciliation', () => {
  let app: FastifyInstance;
  let sandbox: SandboxProvider;

  beforeEach(async () => {
    ({ app, sandbox } = await newApp('success'));
  });

  it('resolves a payment the provider confirmed but never called back about', async () => {
    const user = await stepUp(app, await registerUser(app, { phone: '+26771000020' }));
    const contactId = addContact(user.userId, 'Motakase', '+26772000002');
    const accountId = addAccount(user.userId, { label: 'Orange Money', providerAccountRef: 'w-rec' });
    sandbox.setBalance('w-rec', 50000);

    const created = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 5000 });
    const confirmed = await confirmPayment(app, user, String(created.body.id), accountId);
    expect(confirmed.body.status).toBe('PROCESSING');

    // Make it stale, then let the reconciler ask the provider directly.
    getDb().prepare('UPDATE payment_intents SET updated_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 120_000).toISOString(), String(created.body.id));

    const result = await app.inject({
      method: 'POST', url: '/api/internal/reconcile',
      headers: { 'x-paychat-internal': process.env.INTERNAL_JOB_TOKEN ?? '' },
    });
    expect(result.statusCode).toBe(200);
    expect(intentRow(String(created.body.id)).status).toBe('SUCCESSFUL');
  });

  it('expires an intent that was created but never confirmed', async () => {
    const user = await registerUser(app, { phone: '+26771000021' });
    const contactId = addContact(user.userId, 'Motakase', '+26772000002');
    const created = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 5000 });
    getDb().prepare('UPDATE payment_intents SET created_at = ?, updated_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 20 * 60_000).toISOString(), new Date(Date.now() - 20 * 60_000).toISOString(), String(created.body.id));

    const result = await app.inject({
      method: 'POST', url: '/api/internal/reconcile',
      headers: { 'x-paychat-internal': process.env.INTERNAL_JOB_TOKEN ?? '' },
    });
    expect(result.statusCode).toBe(200);
    expect(intentRow(String(created.body.id)).status).toBe('EXPIRED');
  });

  it('refuses reconciliation without the internal token', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/internal/reconcile', payload: {} });
    expect(response.statusCode).toBe(401);
  });
});
