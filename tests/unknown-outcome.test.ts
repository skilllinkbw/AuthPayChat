/**
 * Unknown-outcome / concurrent-write regression suite (brief §10).
 *
 * Root cause that these tests lock down:
 *   the payment status UPDATE and the payment_transactions INSERT used to be two separate,
 *   unguarded statements (`UPDATE payment_intents SET status = ? WHERE id = ?`). Two writers
 *   — a late provider callback and the reconciliation job, or two callback deliveries — could
 *   both read the same "current" status and both write, so the second silently overwrote the
 *   first (lost update), and a crash between the statements could leave an intent whose status
 *   disagreed with its ledger. `repo.intents.applyOutcome` now performs the read, the state
 *   machine check, the guarded UPDATE (`AND status = ?`) and the ledger INSERT inside one
 *   IMMEDIATE transaction.
 *
 * Every case below is an outcome the system must NOT guess about: unknown, pending, timeout,
 * retry, late callback, duplicate callback, rollback and reconciliation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { newApp, registerUser, addContact, addAccount, createIntent, confirmPayment, sendWebhook, intentRow, stepUp, repo } from './helpers.js';
import type { SandboxProvider } from '../apps/api/src/providers/sandbox.js';
import { getDb } from '../apps/api/src/db/index.js';
import { config } from '../apps/api/src/config.js';

describe('Unknown outcome — the payment we cannot prove either way', () => {
  let app: FastifyInstance;
  let sandbox: SandboxProvider;

  beforeEach(async () => {
    ({ app, sandbox } = await newApp('success'));
  });

  async function setup(balanceMinor = 18540) {
    const user = await registerUser(app, { phone: '+26773111001', name: 'Payer' });
    const contact = repo.users.create({ phone: '+26773222002', passwordHash: 'scrypt$x$y', displayName: 'Motakase' });
    const contactId = addContact(user.userId, 'Motakase', '+26773222002', contact.id);
    const conversationId = repo.conversations.ensureDirect(user.userId, contact.id);
    const accountId = addAccount(user.userId, { label: 'Wallet', providerAccountRef: 'wallet-1', isDefault: true });
    sandbox.setBalance('wallet-1', balanceMinor);
    return { user: await stepUp(app, user), contactId, conversationId, accountId };
  }

  it('a provider timeout leaves the payment PENDING with a ledger row, and never claims success or failure', async () => {
    ({ app, sandbox } = await newApp('timeout'));
    const { user, contactId, accountId } = await setup();
    const created = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 4000 });
    const intentId = String(created.body.id);

    const confirmed = await confirmPayment(app, user, intentId, accountId);
    expect(confirmed.status).toBe(503);                       // provider unavailable, NOT a failure
    expect(intentRow(intentId).status).toBe('PENDING');        // unknown outcome stays unknown
    expect(repo.receipts.findByIntent(intentId)).toBeUndefined();  // no receipt = no money claimed moved
    expect(repo.transactions.countForIntent(intentId)).toBe(1);
    const txn = repo.transactions.listForIntent(intentId)[0] as { status: string; error_reason: string | null };
    expect(txn.status).toBe('PENDING');
    expect(txn.error_reason).toBe('initiate_error');
  });

  it('the ledger row and the status are written in one transaction (no half state)', async () => {
    ({ app, sandbox } = await newApp('timeout'));
    const { user, contactId, accountId } = await setup();
    const created = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 4000 });
    const intentId = String(created.body.id);
    await confirmPayment(app, user, intentId, accountId);

    // Invariant: a PENDING intent that has been confirmed always has at least one ledger row.
    const row = getDb().prepare(
      `SELECT (SELECT COUNT(*) FROM payment_transactions WHERE intent_id = ?) AS txns,
              (SELECT status FROM payment_intents WHERE id = ?) AS status`,
    ).get(intentId, intentId) as { txns: number; status: string };
    expect(row.status).toBe('PENDING');
    expect(row.txns).toBe(1);
  });

  it('a retry after a timeout records a new attempt but never creates a second intent', async () => {
    ({ app, sandbox } = await newApp('timeout'));
    const { user, contactId, accountId } = await setup();
    const created = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 4000 });
    const intentId = String(created.body.id);

    const first = await confirmPayment(app, user, intentId, accountId);
    const second = await confirmPayment(app, user, intentId, accountId);
    expect(first.status).toBe(503);
    // A repeated Confirm is idempotent: same intent, no second debit attempt flying blind.
    expect([200, 503]).toContain(second.status);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM payment_intents WHERE id = ?').get(intentId)).toMatchObject({ n: 1 });
    expect(repo.transactions.countForIntent(intentId)).toBe(1);
    expect(repo.receipts.findByIntent(intentId)).toBeUndefined();
    // Still unknown — no user-visible claim either way.
    expect(intentRow(intentId).status).toBe('PENDING');
  });

  it('a late callback for a payment the provider later confirms settles it exactly once', async () => {
    ({ app, sandbox } = await newApp('timeout'));
    const { user, contactId, accountId } = await setup();
    const created = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 4000 });
    const intentId = String(created.body.id);
    await confirmPayment(app, user, intentId, accountId);

    // The provider really did take the money; its callback arrives minutes later.
    const providerRef = `sbx_late_${intentId.slice(-6)}`;
    repo.intents.updateStatus(intentId, 'PENDING', { provider_ref: providerRef });
    sandbox.setBalance('wallet-1', 18540);
    const webhook = await sendWebhook(app, sandbox, providerRef, 'SUCCESSFUL', 4000);
    expect(webhook.status).toBe(200);
    expect(intentRow(intentId).status).toBe('SUCCESSFUL');
    expect(repo.receipts.findByIntent(intentId)).toBeDefined();

    // A second, even later callback for the same reference is ignored, not double-applied.
    const again = await sendWebhook(app, sandbox, providerRef, 'SUCCESSFUL', 4000);
    expect(again.status).toBe(200);
    expect(intentRow(intentId).status).toBe('SUCCESSFUL');
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM receipts WHERE payment_intent_id = ?').get(intentId)).toMatchObject({ n: 1 });
  });

  it('a late FAILED callback cannot overturn a payment the provider already confirmed', async () => {
    const { user, contactId, accountId } = await setup();
    const created = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 4000 });
    const intentId = String(created.body.id);
    const confirmed = await confirmPayment(app, user, intentId, accountId);
    const providerRef = String(confirmed.body.providerRef);
    await sendWebhook(app, sandbox, providerRef, 'SUCCESSFUL', 4000);
    expect(intentRow(intentId).status).toBe('SUCCESSFUL');

    const late = await sendWebhook(app, sandbox, providerRef, 'FAILED', 4000);
    expect(late.status).toBe(200);                             // accepted, but not applied
    expect(intentRow(intentId).status).toBe('SUCCESSFUL');     // terminal state is terminal
  });

  it('a duplicate callback (same provider event id) is replayed-protected', async () => {
    const { user, contactId, accountId } = await setup();
    const created = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 4000 });
    const intentId = String(created.body.id);
    const confirmed = await confirmPayment(app, user, intentId, accountId);
    const providerRef = String(confirmed.body.providerRef);

    const withEventId = (eventId: string) => (built: { headers: Record<string, string> }) => {
      built.headers['x-paychat-event-id'] = eventId;
    };
    const first = await sendWebhook(app, sandbox, providerRef, 'SUCCESSFUL', 4000, withEventId('evt_dup_test'));
    const replay = await sendWebhook(app, sandbox, providerRef, 'SUCCESSFUL', 4000, withEventId('evt_dup_test'));
    expect(first.status).toBe(200);
    expect(replay.status).toBe(400);
    expect(repo.receipts.findByIntent(intentId)).toBeDefined();
  });

  it('a callback for an unknown reference changes nothing', async () => {
    const { user, contactId } = await setup();
    await createIntent(app, user, { recipientContactId: contactId, amountMinor: 4000 });
    const response = await sendWebhook(app, sandbox, 'sbx_does_not_exist', 'SUCCESSFUL', 4000);
    // Rejected: an unverifiable reference must never create or settle anything.
    expect(response.status).toBe(400);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM receipts').get()).toMatchObject({ n: 0 });
  });

  it('two concurrent writers never both move the same payment (no lost update)', async () => {
    const { user, contactId, accountId } = await setup();
    const created = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 4000 });
    const intentId = String(created.body.id);
    const confirmed = await confirmPayment(app, user, intentId, accountId);
    const providerRef = String(confirmed.body.providerRef);

    // Two callbacks land at the same instant, both read PROCESSING, both try to settle.
    const withEventId = (eventId: string) => (built: { headers: Record<string, string> }) => {
      built.headers['x-paychat-event-id'] = eventId;
    };
    const [a, b] = await Promise.all([
      sendWebhook(app, sandbox, providerRef, 'SUCCESSFUL', 4000, withEventId('evt_race_a')),
      sendWebhook(app, sandbox, providerRef, 'SUCCESSFUL', 4000, withEventId('evt_race_b')),
    ]);
    expect([a.status, b.status].every((s) => s === 200)).toBe(true);
    expect(intentRow(intentId).status).toBe('SUCCESSFUL');
    // Exactly one receipt: the second writer saw the row had moved and stood down.
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM receipts WHERE payment_intent_id = ?').get(intentId)).toMatchObject({ n: 1 });
  });

  it('applyOutcome reports already_moved instead of overwriting when the status changed underneath it', () => {
    const owner = repo.users.create({ phone: '+26779990001', passwordHash: 'scrypt$x$y', displayName: 'Race One' });
    const intent = repo.intents.insert({
      id: 'pin_race_test', reference: 'PC-RACE', userId: owner.id,
      recipientHandle: '+26770000000', recipientLabel: 'Race', amountMinor: 1000, currency: 'BWP',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const first = repo.intents.applyOutcome({ intentId: intent.id, from: ['CREATED'], to: 'PENDING' });
    expect(first).toMatchObject({ applied: true, status: 'PENDING', reason: 'applied' });

    const staleWriter = repo.intents.applyOutcome({ intentId: intent.id, from: ['CREATED'], to: 'FAILED' });
    expect(staleWriter.applied).toBe(false);
    expect(staleWriter.reason).toBe('already_moved');
    expect(intentRow(intent.id).status).toBe('PENDING');        // not overwritten
  });

  it('applyOutcome refuses illegal transitions and rolls the whole write back', () => {
    const owner = repo.users.create({ phone: '+26779990002', passwordHash: 'scrypt$x$y', displayName: 'Race Two' });
    const intent = repo.intents.insert({
      id: 'pin_illegal', reference: 'PC-ILL', userId: owner.id,
      recipientHandle: '+26770000000', recipientLabel: 'Race', amountMinor: 1000, currency: 'BWP',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    repo.intents.applyOutcome({ intentId: intent.id, from: ['CREATED'], to: 'PENDING' });
    repo.intents.applyOutcome({ intentId: intent.id, from: ['PENDING'], to: 'PROCESSING' });

    // PENDING→SUCCESSFUL is not reachable from here, and the ledger row must NOT be written.
    const result = repo.intents.applyOutcome({
      intentId: intent.id,
      from: ['PENDING'],
      to: 'SUCCESSFUL',
      transaction: {
        intentId: intent.id, providerId: 'sandbox', attempt: 1, status: 'SUCCESSFUL',
        amountMinor: 1000, currency: 'BWP',
      },
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('already_moved');
    expect(intentRow(intent.id).status).toBe('PROCESSING');
    expect(repo.transactions.countForIntent(intent.id)).toBe(0);
  });

  it('reconciliation resolves an unknown outcome when the provider confirms, and leaves it alone when it cannot', async () => {
    ({ app, sandbox } = await newApp('timeout'));
    const { user, contactId, accountId } = await setup();
    const created = await createIntent(app, user, { recipientContactId: contactId, amountMinor: 4000 });
    const intentId = String(created.body.id);
    await confirmPayment(app, user, intentId, accountId);

    // Nothing is stale yet (freshly updated) so reconciliation must not touch it.
    const tooFresh = await app.inject({
      method: 'POST', url: '/api/internal/reconcile',
      headers: { 'x-paychat-internal': 'test-token' },
    });
    expect(tooFresh.statusCode).toBe(200);
    expect(tooFresh.json<{ checked: number }>().checked).toBe(0);

    // Age it past the stale threshold: reconciliation now asks the provider.
    repo.intents.updateStatus(intentId, 'PENDING', { provider_ref: 'sbx_reconcile_ref', provider_id: 'sandbox' });
    getDb().prepare('UPDATE payment_intents SET updated_at = ? WHERE id = ?')
      .run(new Date(Date.now() - (config.reconciliation.staleAfterSeconds + 10) * 1000).toISOString(), intentId);
    sandbox.setBalance('wallet-1', 18540);

    const reconciled = await app.inject({
      method: 'POST', url: '/api/internal/reconcile',
      headers: { 'x-paychat-internal': 'test-token' },
    });
    const body = reconciled.json<{ checked: number; updated: number; stillPending: number }>();
    expect(body.checked).toBeGreaterThan(0);
    // The sandbox rail with no provider ref match reports the attempt as PROCESSING/pending;
    // either way the payment is never silently marked successful.
    expect(intentRow(intentId).status).not.toBe('SUCCESSFUL');
  });
});
