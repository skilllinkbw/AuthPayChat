/**
 * Merchant console (brief §17): authentication, onboarding, transaction history, status,
 * reconciliation/settlement, refunds, audit trail and — most importantly — isolation
 * between merchants.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { newApp, registerUser, addAccount, addContact, stepUp, repo } from './helpers.js';
import type { SandboxProvider } from '../apps/api/src/providers/sandbox.js';
import { getDb } from '../apps/api/src/db/index.js';

describe('Merchant console', () => {
  let app: FastifyInstance;
  let sandbox: SandboxProvider;

  beforeEach(async () => {
    ({ app, sandbox } = await newApp('success'));
  });

  async function onboardMerchant(phone = '+26777111001', businessName = 'Test Cafe') {
    const merchant = await registerUser(app, { phone, name: 'Merchant' });
    const response = await app.inject({
      method: 'POST', url: '/api/merchant/onboard', headers: merchant.auth,
      payload: { businessName, category: 'cafe', settlementCurrency: 'BWP' },
    });
    expect(response.statusCode).toBe(201);
    return merchant;
  }

  let phoneSeq = 0;
  async function customerPays(merchantId: string, merchantName: string, merchantPhone: string, amountMinor: number) {
    phoneSeq += 1;
    const customer = await registerUser(app, { phone: `+267772${String(20000 + phoneSeq)}`, name: 'Customer' });
    const accountId = addAccount(customer.userId, { label: 'Wallet', providerAccountRef: `w-${customer.userId}`, isDefault: true });
    sandbox.setBalance(`w-${customer.userId}`, 200000);
    addContact(customer.userId, merchantName, merchantPhone, merchantId);
    const steppedUp = await stepUp(app, customer);
    const created = await app.inject({
      method: 'POST', url: '/api/payments/intents', headers: steppedUp.auth,
      payload: { recipientContactId: repo.contacts.list(customer.userId)[0]!.id, recipientLabel: merchantName, amountMinor },
    });
    const intentId = String(created.json<{ id: string }>().id);
    const confirmed = await app.inject({
      method: 'POST', url: `/api/payments/intents/${intentId}/confirm`, headers: steppedUp.auth,
      payload: { accountId, authMethod: 'password' },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const providerRef = String(confirmed.json<{ providerRef: string }>().providerRef);
    const built = sandbox.buildWebhook(providerRef, 'SUCCESSFUL', amountMinor);
    const webhook = await app.inject({
      method: 'POST', url: '/api/webhooks/sandbox', headers: built.headers, payload: built.body,
    });
    expect(webhook.statusCode).toBe(200);
    return { customer, intentId };
  }

  it('onboards a merchant and records it in the audit trail', async () => {
    const merchant = await onboardMerchant();
    const me = repo.users.findById(merchant.userId)!;
    expect(me.is_merchant).toBe(1);
    expect(repo.profiles.find(merchant.userId)!.business_name).toBe('Test Cafe');

    const auditResponse = await app.inject({ method: 'GET', url: '/api/merchant/audit', headers: merchant.auth });
    const entries = auditResponse.json<{ entries: Array<{ action: string }> }>().entries;
    expect(entries.some((e) => e.action === 'merchant.onboarded')).toBe(true);
  });

  it('rejects merchant endpoints for a non-merchant account', async () => {
    const plain = await registerUser(app, { phone: '+26777111002', name: 'Plain' });
    for (const url of ['/api/merchant/transactions', '/api/merchant/summary', '/api/merchant/audit']) {
      const response = await app.inject({ method: 'GET', url, headers: plain.auth });
      expect(response.statusCode).toBe(403);
    }
    const reconcile = await app.inject({ method: 'POST', url: '/api/merchant/reconcile', headers: plain.auth });
    expect(reconcile.statusCode).toBe(403);
  });

  it('rejects unauthenticated access to every merchant endpoint', async () => {
    for (const url of ['/api/merchant/transactions', '/api/merchant/summary', '/api/merchant/audit']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(401);
    }
  });

  it('reconciles received payments into the merchant ledger and reports settlement totals', async () => {
    const merchant = await onboardMerchant();
    await customerPays(merchant.userId, 'Merchant', '+26777111001', 12000);
    await customerPays(merchant.userId, 'Merchant', '+26777111001', 8000);

    const reconcile = await app.inject({ method: 'POST', url: '/api/merchant/reconcile', headers: merchant.auth });
    expect(reconcile.statusCode).toBe(200);
    expect(reconcile.json<{ inserted: number }>().inserted).toBe(2);

    const history = await app.inject({ method: 'GET', url: '/api/merchant/transactions', headers: merchant.auth });
    const transactions = history.json<{ transactions: Array<{ amount_minor: number; status: string }> }>().transactions;
    expect(transactions).toHaveLength(2);
    expect(transactions.every((t) => t.status === 'SUCCESSFUL')).toBe(true);

    const summary = await app.inject({ method: 'GET', url: '/api/merchant/summary', headers: merchant.auth });
    const body = summary.json<{ settledMinor: number; transactionCount: number; businessName: string }>();
    expect(body.settledMinor).toBe(20000);
    expect(body.transactionCount).toBe(2);
    expect(body.businessName).toBe('Test Cafe');
  });

  it('reconciliation is idempotent and picks up status changes', async () => {
    const merchant = await onboardMerchant();
    const { intentId } = await customerPays(merchant.userId, 'Merchant', '+26777111001', 5000);

    const first = await app.inject({ method: 'POST', url: '/api/merchant/reconcile', headers: merchant.auth });
    expect(first.json<{ inserted: number }>().inserted).toBe(1);
    const second = await app.inject({ method: 'POST', url: '/api/merchant/reconcile', headers: merchant.auth });
    expect(second.json<{ inserted: number; updated: number }>()).toMatchObject({ inserted: 0, updated: 0 });

    // A later status change is reflected on the next reconciliation.
    getDb().prepare("UPDATE payment_intents SET status = 'REFUNDED' WHERE id = ?").run(intentId);
    const third = await app.inject({ method: 'POST', url: '/api/merchant/reconcile', headers: merchant.auth });
    expect(third.json<{ updated: number }>().updated).toBe(1);
    const summary = await app.inject({ method: 'GET', url: '/api/merchant/summary', headers: merchant.auth });
    expect(summary.json<{ refundedMinor: number }>().refundedMinor).toBe(5000);
  });

  it('isolates one merchant completely from another', async () => {
    const merchantA = await onboardMerchant('+26777111003', 'Merchant A');
    const merchantB = await onboardMerchant('+26777111004', 'Merchant B');
    await customerPays(merchantA.userId, 'Merchant', '+26777111003', 15000);
    await app.inject({ method: 'POST', url: '/api/merchant/reconcile', headers: merchantA.auth });
    await app.inject({ method: 'POST', url: '/api/merchant/reconcile', headers: merchantB.auth });

    const aSummary = await app.inject({ method: 'GET', url: '/api/merchant/summary', headers: merchantA.auth });
    const bSummary = await app.inject({ method: 'GET', url: '/api/merchant/summary', headers: merchantB.auth });
    expect(aSummary.json<{ settledMinor: number }>().settledMinor).toBe(15000);
    expect(bSummary.json<{ settledMinor: number; transactionCount: number }>()).toMatchObject({ settledMinor: 0, transactionCount: 0 });

    const bHistory = await app.inject({ method: 'GET', url: '/api/merchant/transactions', headers: merchantB.auth });
    expect(bHistory.json<{ transactions: unknown[] }>().transactions).toEqual([]);
  });

  it('a merchant cannot refund or even see another merchant’s transaction row', async () => {
    const merchantA = await onboardMerchant('+26777111005', 'Merchant A');
    const merchantB = await onboardMerchant('+26777111006', 'Merchant B');
    await customerPays(merchantA.userId, 'Merchant', '+26777111005', 9000);
    await app.inject({ method: 'POST', url: '/api/merchant/reconcile', headers: merchantA.auth });

    const rowId = getDb().prepare('SELECT id FROM merchant_transactions WHERE merchant_id = ?').get(merchantA.userId) as { id: string };
    const refund = await app.inject({
      method: 'POST', url: `/api/merchant/transactions/${rowId.id}/refund`, headers: merchantB.auth, payload: {},
    });
    expect(refund.statusCode).toBe(404);
  });

  it('refunds a settled payment through the provider and marks the ledger row', async () => {
    const merchant = await onboardMerchant('+26777111007', 'Refund Cafe');
    await customerPays(merchant.userId, 'Merchant', '+26777111007', 3000);
    await app.inject({ method: 'POST', url: '/api/merchant/reconcile', headers: merchant.auth });

    const row = getDb().prepare('SELECT id FROM merchant_transactions WHERE merchant_id = ?').get(merchant.userId) as { id: string };
    const refunded = await app.inject({
      method: 'POST', url: `/api/merchant/transactions/${row.id}/refund`, headers: merchant.auth, payload: {},
    });
    expect(refunded.statusCode, refunded.body).toBe(200);
    expect(refunded.json<{ status: string }>().status).toBe('REFUNDED');

    const after = getDb().prepare('SELECT status FROM merchant_transactions WHERE id = ?').get(row.id) as { status: string };
    expect(after.status).toBe('REFUNDED');
    const auditResponse = await app.inject({ method: 'GET', url: '/api/merchant/audit', headers: merchant.auth });
    expect(auditResponse.json<{ entries: Array<{ action: string }> }>().entries.some((e) => e.action === 'merchant.refunded')).toBe(true);
  });

  it('refuses to refund a payment that has not settled', async () => {
    const merchant = await onboardMerchant('+26777111008', 'Pending Cafe');
    await customerPays(merchant.userId, 'Merchant', '+26777111008', 4000);
    await app.inject({ method: 'POST', url: '/api/merchant/reconcile', headers: merchant.auth });
    getDb().prepare("UPDATE merchant_transactions SET status = 'PENDING' WHERE merchant_id = ?").run(merchant.userId);

    const row = getDb().prepare('SELECT id FROM merchant_transactions WHERE merchant_id = ?').get(merchant.userId) as { id: string };
    const refund = await app.inject({
      method: 'POST', url: `/api/merchant/transactions/${row.id}/refund`, headers: merchant.auth, payload: {},
    });
    expect(refund.statusCode).toBe(409);
  });
});
