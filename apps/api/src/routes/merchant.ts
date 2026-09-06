/**
 * Merchant console API (brief §17).
 *
 * Every merchant route is owner-scoped: a merchant sees only their own transactions,
 * refunds, settlement summary and audit trail. There is no "list all merchants" endpoint
 * and no way to pass another merchant's id — isolation is enforced in the SQL, the same
 * way it is enforced for consumers.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors } from '@paychat/shared';
import type { PaymentOrchestrator } from '../payments/orchestrator.js';
import { requireAuth } from '../security/context.js';
import { audit } from '../security/audit.js';
import * as repo from '../repositories.js';
import { getDb } from '../db/index.js';

export function merchantRoutes(app: FastifyInstance, orchestrator: PaymentOrchestrator): void {
  /** Onboarding: turn a normal account into a merchant account. Audited and reversible. */
  app.post('/api/merchant/onboard', { preHandler: requireAuth }, async (request, reply) => {
    const body = z.object({
      businessName: z.string().min(2).max(80),
      category: z.string().min(2).max(40).optional(),
      settlementCurrency: z.string().length(3).default('BWP'),
    }).parse(request.body);

    getDb().prepare('UPDATE users SET is_merchant = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), request.auth!.userId);
    repo.profiles.update(request.auth!.userId, {
      businessName: body.businessName,
      merchantCategory: body.category ?? null,
      settlementCurrency: body.settlementCurrency,
    });

    audit('merchant.onboarded', { type: 'user', id: request.auth!.userId, metadata: { businessName: body.businessName, category: body.category ?? null } }, { actorUserId: request.auth!.userId, ip: request.ip });
    const me = repo.users.findById(request.auth!.userId)!;
    const profile = repo.profiles.find(request.auth!.userId);
    return reply.code(201).send({
      id: me.id,
      businessName: profile?.business_name ?? body.businessName,
      category: profile?.merchant_category ?? null,
      settlementCurrency: profile?.settlement_currency ?? 'BWP',
      isMerchant: me.is_merchant === 1,
    });
  });

  /** Merchant transaction history — scoped to the caller, paginated by cursor. */
  app.get('/api/merchant/transactions', { preHandler: requireAuth }, async (request) => {
    const me = repo.users.findById(request.auth!.userId);
    if (!me || me.is_merchant !== 1) throw Errors.forbidden();
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).safeParse(request.query);
    const limit = query.success ? query.data.limit : 30;

    const rows = getDb().prepare(
      `SELECT t.id, t.reference, t.amount_minor, t.currency, t.status, t.customer_label, t.intent_id, t.created_at
         FROM merchant_transactions t
        WHERE t.merchant_id = ?
        ORDER BY t.created_at DESC, t.id DESC LIMIT ?`,
    ).all(request.auth!.userId, limit) as Array<Record<string, unknown>>;
    return { transactions: rows };
  });

  /** Settlement summary: what has actually settled, what is still in flight, what failed. */
  app.get('/api/merchant/summary', { preHandler: requireAuth }, async (request) => {
    const me = repo.users.findById(request.auth!.userId);
    if (!me || me.is_merchant !== 1) throw Errors.forbidden();

    const row = getDb().prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'SUCCESSFUL' THEN amount_minor END), 0) AS settled_minor,
         COALESCE(SUM(CASE WHEN status IN ('PENDING','PROCESSING') THEN amount_minor END), 0) AS pending_minor,
         COALESCE(SUM(CASE WHEN status IN ('FAILED','CANCELLED','EXPIRED') THEN amount_minor END), 0) AS failed_minor,
         COALESCE(SUM(CASE WHEN status IN ('REFUNDED','REVERSED') THEN amount_minor END), 0) AS refunded_minor,
         COUNT(*) AS txn_count
       FROM merchant_transactions WHERE merchant_id = ?`,
    ).get(request.auth!.userId) as Record<string, number>;

    const profile = repo.profiles.find(request.auth!.userId);
    return {
      businessName: profile?.business_name ?? me.display_name,
      settlementCurrency: profile?.settlement_currency ?? 'BWP',
      settledMinor: row.settled_minor ?? 0,
      pendingMinor: row.pending_minor ?? 0,
      failedMinor: row.failed_minor ?? 0,
      refundedMinor: row.refunded_minor ?? 0,
      transactionCount: row.txn_count ?? 0,
    };
  });

  /**
   * Reconciliation for a merchant: every payment made to them that has no ledger row yet
   * (or whose ledger row is stale) is re-checked against the intent's real status.
   */
  app.post('/api/merchant/reconcile', { preHandler: requireAuth }, async (request) => {
    const me = repo.users.findById(request.auth!.userId);
    if (!me || me.is_merchant !== 1) throw Errors.forbidden();

    const intents = getDb().prepare(
      `SELECT pi.id, pi.status, pi.amount_minor, pi.currency, pi.updated_at, u.display_name AS payer_name
         FROM payment_intents pi
         JOIN users u ON u.id = pi.user_id
        WHERE pi.recipient_user_id = ?`,
    ).all(request.auth!.userId) as Array<{ id: string; status: string; amount_minor: number; currency: string; updated_at: string; payer_name: string }>;

    let inserted = 0;
    let updated = 0;
    for (const intent of intents) {
      const existing = getDb().prepare('SELECT id, status FROM merchant_transactions WHERE intent_id = ? AND merchant_id = ?').get(intent.id, request.auth!.userId) as { id: string; status: string } | undefined;
      if (!existing) {
        getDb().prepare(
          `INSERT INTO merchant_transactions (id, merchant_id, intent_id, reference, amount_minor, currency, status, customer_label, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(`mtx_${intent.id}`, request.auth!.userId, intent.id, intent.id, intent.amount_minor, intent.currency, intent.status, intent.payer_name, intent.updated_at, new Date().toISOString());
        inserted++;
      } else if (existing.status !== intent.status) {
        getDb().prepare('UPDATE merchant_transactions SET status = ?, updated_at = ? WHERE id = ?').run(intent.status, new Date().toISOString(), existing.id);
        updated++;
      }
    }

    audit('payment.reconciled', { type: 'merchant', id: request.auth!.userId, metadata: { inserted, updated, checked: intents.length } }, { actorUserId: request.auth!.userId, ip: request.ip });
    return { checked: intents.length, inserted, updated };
  });

  /** Merchant refunds a payment they received. Goes through the provider, never a local fiction. */
  app.post('/api/merchant/transactions/:id/refund', { preHandler: requireAuth }, async (request, reply) => {
    const me = repo.users.findById(request.auth!.userId);
    if (!me || me.is_merchant !== 1) throw Errors.forbidden();
    const { id } = request.params as { id: string };
    const body = z.object({ amountMinor: z.number().int().positive().optional() }).parse(request.body ?? {});

    // Ownership is checked in SQL — another merchant's id simply does not resolve.
    const row = getDb().prepare('SELECT * FROM merchant_transactions WHERE id = ? AND merchant_id = ?').get(id, request.auth!.userId) as { intent_id: string | null; status: string } | undefined;
    if (!row || !row.intent_id) throw Errors.notFound('Transaction');
    if (row.status !== 'SUCCESSFUL') throw Errors.conflict('Only settled payments can be refunded');

    const intent = repo.intents.findById(row.intent_id);
    if (!intent) throw Errors.notFound('Transaction');
    const payer = intent.user_id;           // the customer who paid this merchant

    const status = await orchestrator.refundPayment(payer, intent.id, body.amountMinor);
    getDb().prepare('UPDATE merchant_transactions SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), id);
    audit('merchant.refunded', { type: 'merchant_transaction', id, metadata: { intentId: intent.id, status } }, { actorUserId: request.auth!.userId, ip: request.ip });
    return reply.send({ id, status });
  });

  /** Merchant audit trail — only their own entries. */
  app.get('/api/merchant/audit', { preHandler: requireAuth }, async (request) => {
    const me = repo.users.findById(request.auth!.userId);
    if (!me || me.is_merchant !== 1) throw Errors.forbidden();
    const query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).safeParse(request.query);
    const limit = query.success ? query.data.limit : 50;
    const rows = getDb().prepare(
      'SELECT id, action, target_type, target_id, metadata_json, created_at FROM audit_logs WHERE actor_user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    ).all(request.auth!.userId, limit) as Array<Record<string, unknown>>;
    return { entries: rows };
  });
}
