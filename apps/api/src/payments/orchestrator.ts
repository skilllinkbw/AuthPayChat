/**
 * Payment orchestrator — the only component allowed to move money.
 *
 * Guarantees:
 *  - Amount, recipient and currency come from the stored intent, never from the client at confirm time.
 *  - Idempotency: the same idempotency key (or a repeated confirm) can never create a second payment.
 *  - Only the provider + verified webhook decide SUCCESSFUL; the frontend never does.
 *  - Every state change goes through the normalised state machine.
 *  - Provider failures are surfaced honestly: unknown outcomes stay PENDING and are reconciled.
 */

import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { Errors, AppError, reference } from '@paychat/shared';
import { canTransition, isTerminal, money, type PaymentProvider, type PaymentStatus } from '@paychat/shared';
import * as repo from '../repositories.js';
import { audit, logEvent } from '../security/audit.js';
import { evaluateRisk, type RiskDecision } from './risk.js';

export interface ProviderResolver {
  get(providerId: string): PaymentProvider;
}

export interface CreateIntentInput {
  userId: string;
  recipientContactId?: string | null;
  recipientUserId?: string | null;
  recipientHandle?: string | null;
  recipientLabel: string;
  amountMinor: number;
  currency: string;
  narration?: string | null;
  idempotencyKey?: string | null;
  conversationId?: string | null;
  deviceId?: string | null;
}

export interface IntentWithRisk {
  id: string;
  reference: string;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  recipientLabel: string;
  expiresAt: string;
  risk: RiskDecision;
  duplicate: boolean;
}

export class PaymentOrchestrator {
  constructor(readonly providers: ProviderResolver) {}

  /** Step 1 — create the intent. No money moves here. */
  createIntent(input: CreateIntentInput): IntentWithRisk {
    if (!Number.isInteger(input.amountMinor) || input.amountMinor < config.limits.minPaymentMinor) {
      throw Errors.validation({ amount: 'Amount must be a positive amount in minor units' }, 'invalid amount');
    }
    if (input.amountMinor > config.limits.maxPaymentMinor) {
      throw Errors.validation({ amount: 'Amount exceeds the maximum payment limit' }, 'amount too large');
    }
    if (input.amountMinor <= 0) {
      throw Errors.validation({ amount: 'Amount must be greater than zero' }, 'invalid amount');
    }

    // Idempotency: a replayed create returns the original intent instead of a second one.
    if (input.idempotencyKey) {
      const existing = repo.intents.findByIdempotencyKey(input.userId, input.idempotencyKey);
      if (existing) return this.toView(existing, true);
    }

    // Recipient must belong to this user's contact book (or be an explicitly resolved user).
    let recipientUserId: string | null = null;
    let handle = input.recipientHandle ?? null;
    let label = input.recipientLabel;
    if (input.recipientContactId) {
      const contact = repo.contacts.findOwned(input.userId, input.recipientContactId);
      if (!contact) throw Errors.validation({ recipient: 'Unknown recipient' }, 'recipient not found');
      recipientUserId = contact.contact_user_id ?? null;
      handle = contact.phone_e164;
      label = contact.display_name;
    }
    if (!handle) throw Errors.validation({ recipient: 'Recipient is required' }, 'recipient required');

    const risk = evaluateRisk({
      userId: input.userId,
      deviceId: input.deviceId ?? null,
      amountMinor: input.amountMinor,
      recipientContactId: input.recipientContactId ?? null,
      recipientUserId,
    });

    const id = `pin_${randomUUID()}`;
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const row = repo.intents.insert({
      id,
      reference: reference('PC'),
      userId: input.userId,
      recipientContactId: input.recipientContactId ?? null,
      recipientUserId,
      recipientHandle: handle,
      recipientLabel: label,
      amountMinor: input.amountMinor,
      currency: input.currency,
      narration: input.narration ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      expiresAt,
      conversationId: input.conversationId ?? null,
    });
    repo.intents.updateStatus(id, row.status, {
      risk_score: risk.score,
      risk_reasons: JSON.stringify(risk.reasons),
    });

    audit('payment.intent_created', {
      type: 'payment_intent',
      id,
      metadata: { amountMinor: input.amountMinor, currency: input.currency, risk: risk.reasons },
    }, { actorUserId: input.userId });

    return this.toView(repo.intents.findById(id)!, false, risk);
  }

  /**
   * Step 2 — authorise and initiate.
   * The client supplies ONLY the funding account and proof of step-up. Amount/recipient are server-side.
   */
  async authoriseAndInitiate(input: {
    intentId: string;
    userId: string;
    accountId: string;
    authMethod: 'password' | 'biometric' | 'pin';
    stepUpVerified: boolean;
    ip?: string | null;
  }): Promise<{ intentId: string; status: PaymentStatus; providerRef?: string | null; message?: string }> {
    const intent = repo.intents.findOwned(input.userId, input.intentId);
    if (!intent) throw Errors.notFound('Payment');

    // Duplicate confirm protection: an intent that already left CREATED is never re-sent.
    if (intent.status !== 'CREATED') {
      audit('payment.duplicate_blocked', { type: 'payment_intent', id: intent.id, metadata: { status: intent.status } }, { actorUserId: input.userId });
      return { intentId: intent.id, status: intent.status, providerRef: intent.provider_ref };
    }

    if (Date.parse(intent.expires_at) < Date.now()) {
      repo.intents.updateStatus(intent.id, 'EXPIRED');
      return { intentId: intent.id, status: 'EXPIRED', message: 'This payment request expired. Please start again.' };
    }

    const riskReasons = JSON.parse(intent.risk_reasons || '[]') as string[];
    if (riskReasons.length > 0 && !input.stepUpVerified) {
      throw Errors.stepUpRequired(
        `step-up required: ${riskReasons.join(',')}`,
        'Please confirm it is you before we send this payment.',
      );
    }

    // Account ownership: a client-supplied account id for another user is rejected here.
    const account = repo.accounts.findOwned(input.userId, input.accountId);
    if (!account) throw Errors.validation({ accountId: 'Unknown payment account' }, 'payment method not available');
    if (account.currency !== intent.currency) {
      throw Errors.validation({ accountId: 'This account cannot pay in the requested currency' }, 'currency mismatch');
    }

    let provider: PaymentProvider;
    try {
      provider = this.providers.get(account.provider_id);
    } catch (error) {
      logEvent('error', 'provider.resolve_failed', { providerId: account.provider_id, error: String(error) });
      throw Errors.providerUnavailable();
    }

    await repo.intents.updateStatus(intent.id, intent.status, {
      provider_id: account.provider_id,
      account_id: account.id,
      auth_method: input.authMethod,
      authorized_at: new Date().toISOString(),
    });
    audit('payment.authorized', { type: 'payment_intent', id: intent.id, metadata: { authMethod: input.authMethod, providerId: account.provider_id } }, { actorUserId: input.userId, ip: input.ip ?? null });

    const attempt = repo.transactions.countForIntent(intent.id) + 1;
    let result;
    try {
      result = await provider.initiatePayment({
        intentId: intent.id,
        idempotencyKey: `pc_${intent.id}_${attempt}`,
        amount: money(intent.amount_minor, intent.currency),
        recipient: { handle: intent.recipient_handle, displayName: intent.recipient_label },
        source: { accountId: account.id, providerAccountRef: account.provider_account_ref },
        narration: intent.narration ?? undefined,
        callbackUrl: `${config.webhookBaseUrl}/${account.provider_id}`,
      });
    } catch (error) {
      // Unknown outcome: keep PENDING, let reconciliation resolve it. Never claim failure or success.
      logEvent('error', 'payment.initiate_error', { intentId: intent.id, providerId: account.provider_id, error: String(error) });
      // The outcome is UNKNOWN (timeout / network / 5xx). Record the attempt and leave the
      // payment where reconciliation can find it — atomically, so a crash cannot leave an
      // intent with no ledger row. Never claim success or failure we cannot prove.
      repo.intents.applyOutcome({
        intentId: intent.id,
        from: ['CREATED', 'PENDING'],
        to: 'PENDING',
        transaction: {
          intentId: intent.id, providerId: account.provider_id, attempt, status: 'PENDING',
          amountMinor: intent.amount_minor, currency: intent.currency, errorReason: 'initiate_error',
        },
      });
      throw Errors.providerUnavailable();
    }

    if (result.outcome === 'rejected') {
      const applied = repo.intents.applyOutcome({
        intentId: intent.id,
        from: ['CREATED', 'PENDING', 'PROCESSING'],
        to: result.status,
        transaction: {
          intentId: intent.id, providerId: account.provider_id, providerRef: result.providerRef ?? null,
          attempt, status: result.status, amountMinor: intent.amount_minor, currency: intent.currency,
          errorReason: result.reason,
        },
      });
      if (!applied.applied) logEvent('warn', 'payment.outcome_not_applied', { intentId: intent.id, reason: applied.reason });
      audit('payment.failed', { type: 'payment_intent', id: intent.id, metadata: { reason: result.reason } }, { actorUserId: input.userId });
      const userMessage =
        result.reason === 'insufficient_funds'
          ? 'Your payment was not sent because there is not enough money in that account.'
          : result.reason === 'invalid_recipient'
            ? 'Your payment was not sent. We could not find that recipient.'
            : 'Your payment was not sent. No money has left your account. Please check your transaction history before trying again.';
      throw Errors.paymentFailed(userMessage);
    }

    const applied = repo.intents.applyOutcome({
      intentId: intent.id,
      from: ['CREATED', 'PENDING', 'PROCESSING'],
      to: result.status,
      extra: { provider_ref: result.providerRef, provider_id: account.provider_id },
      transaction: {
        intentId: intent.id, providerId: account.provider_id, providerRef: result.providerRef,
        attempt, status: result.status, amountMinor: intent.amount_minor, currency: intent.currency,
      },
    });
    if (!applied.applied) logEvent('warn', 'payment.outcome_not_applied', { intentId: intent.id, reason: applied.reason });
    audit('payment.initiated', { type: 'payment_intent', id: intent.id, metadata: { providerRef: result.providerRef, status: result.status } }, { actorUserId: input.userId });
    logEvent('info', 'payment.initiated', { intentId: intent.id, providerRef: result.providerRef, status: result.status });

    return { intentId: intent.id, status: result.status, providerRef: result.providerRef };
  }

  /** Applies a status change through the state machine, ignoring illegal (out-of-order) transitions. */
  private transition(intentId: string, to: PaymentStatus, from: PaymentStatus, extra: Record<string, unknown> = {}): boolean {
    const result = repo.intents.applyOutcome({ intentId, from: [from], to, extra });
    if (!result.applied) {
      logEvent('warn', 'payment.illegal_transition_ignored', { intentId, from, to, reason: result.reason });
      return false;
    }
    return true;
  }

  /**
   * Step 3 — provider callback. Signature must verify, the event id must be new,
   * and the amount must match the intent before any status change.
   */
  async handleWebhook(providerId: string, rawBody: string | Buffer, headers: Record<string, string | string[] | undefined>): Promise<{ ok: true; status: PaymentStatus } | { ok: false; reason: string }> {
    const bodyText = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    let provider: PaymentProvider;
    try {
      provider = this.providers.get(providerId);
    } catch {
      return { ok: false, reason: 'unknown_provider' };
    }

    let event;
    try {
      event = await provider.processWebhook({ rawBody, headers });
    } catch (error) {
      audit('webhook.rejected', { type: 'provider', id: providerId, metadata: { reason: String(error) } }, { actorType: 'provider' });
      logEvent('warn', 'webhook.rejected', { providerId, reason: String(error) });
      return { ok: false, reason: 'signature_invalid' };
    }

    // Replay protection: the same provider event id can never be processed twice.
    const { createHash } = await import('node:crypto');
    const payloadHash = createHash('sha256').update(bodyText).digest('hex');
    const isNewEvent = repo.webhookEvents.record({
      eventId: event.eventId, providerId, providerRef: event.providerRef, payloadHash, signatureOk: true,
    });
    if (!isNewEvent) {
      audit('webhook.replay_blocked', { type: 'provider', id: providerId, metadata: { eventId: event.eventId } }, { actorType: 'provider' });
      return { ok: false, reason: 'duplicate_event' };
    }

    const intent = repo.intents.findByProviderRef(event.providerRef);
    if (!intent) {
      repo.webhookEvents.markProcessed(event.eventId, 'unknown_reference');
      return { ok: false, reason: 'unknown_reference' };
    }

    // Amount must match what the user confirmed — a provider cannot silently change it.
    if (event.amount && (event.amount.minor !== intent.amount_minor || event.amount.currency !== intent.currency)) {
      repo.webhookEvents.markProcessed(event.eventId, 'amount_mismatch');
      audit('webhook.rejected', { type: 'payment_intent', id: intent.id, metadata: { reason: 'amount_mismatch' } }, { actorType: 'provider' });
      logEvent('error', 'webhook.amount_mismatch', { intentId: intent.id, expected: intent.amount_minor, got: event.amount.minor });
      return { ok: false, reason: 'amount_mismatch' };
    }

    const changed = this.applyProviderStatus(intent.id, intent.status, event.status);
    repo.webhookEvents.markProcessed(event.eventId, changed ? `applied:${event.status}` : `ignored:${intent.status}->${event.status}`);
    audit('webhook.received', { type: 'payment_intent', id: intent.id, metadata: { status: event.status, applied: changed } }, { actorType: 'provider' });

    return { ok: true, status: event.status };
  }

  /** Applies a verified provider status and fans out receipts / chat messages / notifications. */
  applyProviderStatus(intentId: string, from: PaymentStatus, to: PaymentStatus): boolean {
    const intent = repo.intents.findById(intentId);
    if (!intent) return false;
    if (!canTransition(from, to)) {
      logEvent('warn', 'payment.illegal_transition_ignored', { intentId, from, to });
      return false;
    }
    // Conditional write: if another writer (a second callback, or reconciliation) has moved
    // the intent since we read it, this returns applied=false instead of overwriting.
    const outcome = repo.intents.applyOutcome({ intentId, from: [from], to });
    if (!outcome.applied) {
      logEvent('warn', 'payment.transition_not_applied', { intentId, from, to, reason: outcome.reason, currentStatus: outcome.status });
      return false;
    }

    if (to === 'SUCCESSFUL') {
      this.onSuccessful(intent.id);
    } else if (to === 'FAILED' || to === 'CANCELLED' || to === 'EXPIRED') {
      audit('payment.failed', { type: 'payment_intent', id: intent.id, metadata: { status: to } }, { actorUserId: intent.user_id });
      // The payer must hear about a non-completion from us, not discover it later.
      // Never claimed as "money lost" — the message states the payment did not go through.
      repo.notifications.create({
        userId: intent.user_id,
        type: `payment.${to.toLowerCase()}`,
        title: 'Payment not completed',
        body: `Your payment to ${intent.recipient_label} was ${to.toLowerCase()}. No money has left your account for this payment.`,
        data: { intentId: intent.id },
      });
    } else if (to === 'REVERSED' || to === 'REFUNDED') {
      audit('payment.reversed', { type: 'payment_intent', id: intent.id, metadata: { status: to } }, { actorUserId: intent.user_id });
      repo.notifications.create({
        userId: intent.user_id,
        type: `payment.${to.toLowerCase()}`,
        title: to === 'REVERSED' ? 'Payment reversed' : 'Refund received',
        body: `Your payment of ${intent.currency} ${(intent.amount_minor / 100).toFixed(2)} to ${intent.recipient_label} was ${to.toLowerCase()}.`,
        data: { intentId: intent.id },
      });
    }
    return true;
  }

  private onSuccessful(intentId: string): void {
    const intent = repo.intents.findById(intentId)!;
    const user = repo.users.findById(intent.user_id);
    const account = intent.account_id ? repo.accounts.findOwned(intent.user_id, intent.account_id) : undefined;
    const providerLabel = account?.label ?? 'PayChat';

    repo.receipts.create({
      paymentIntentId: intent.id,
      userId: intent.user_id,
      amountMinor: intent.amount_minor,
      currency: intent.currency,
      providerLabel,
      methodLabel: account?.kind ?? 'mobile_money',
      senderLabel: user?.display_name ?? 'PayChat user',
      recipientLabel: intent.recipient_label,
      status: 'SUCCESSFUL',
    });

    if (intent.conversation_id) {
      repo.conversations.addMessage({
        conversationId: intent.conversation_id,
        senderId: intent.user_id,
        kind: 'payment',
        body: `Payment of ${intent.currency} ${(intent.amount_minor / 100).toFixed(2)} to ${intent.recipient_label}`,
        paymentIntentId: intent.id,
      });
    }

    repo.notifications.create({
      userId: intent.user_id,
      type: 'payment.successful',
      title: 'Payment sent',
      body: `${providerLabel}: payment to ${intent.recipient_label} was successful.`,
      data: { intentId: intent.id },
    });
    // Money in. When the recipient is a PayChat user they get their own notification —
    // this covers every incoming rail (chat payment, payment link, QR) because they all
    // settle through onSuccessful. No notification is invented for external recipients.
    if (intent.recipient_user_id && intent.recipient_user_id !== intent.user_id) {
      repo.notifications.create({
        userId: intent.recipient_user_id,
        type: 'payment.received',
        title: 'Money received',
        body: `${intent.currency} ${(intent.amount_minor / 100).toFixed(2)} received from ${user?.display_name ?? intent.recipient_handle}.`,
        data: { intentId: intent.id },
      });
    }
    repo.outbox.publish('payment.succeeded', { intentId: intent.id, userId: intent.user_id });

    if (intent.account_id) {
      // The cached figure no longer reflects reality — keep it visible but flag it stale
      // so the UI refreshes from the provider instead of showing a confident wrong number.
      const cached = repo.balances.getCached(intent.account_id);
      repo.balances.upsert({
        accountId: intent.account_id,
        availableMinor: cached?.available_minor ?? null,
        pendingMinor: cached?.pending_minor ?? null,
        unavailableMinor: cached?.unavailable_minor ?? null,
        currency: intent.currency,
        providerStatus: 'stale',
        asOf: cached?.as_of ?? new Date().toISOString(),
      });
    }

    audit('payment.succeeded', { type: 'payment_intent', id: intent.id, metadata: { amountMinor: intent.amount_minor, currency: intent.currency } }, { actorUserId: intent.user_id });
    logEvent('info', 'payment.succeeded', { intentId: intent.id, reference: intent.reference });
  }

  async cancelPayment(userId: string, intentId: string): Promise<PaymentStatus> {
    const intent = repo.intents.findOwned(userId, intentId);
    if (!intent) throw Errors.notFound('Payment');
    if (isTerminal(intent.status)) throw Errors.conflict('Payment can no longer be cancelled', `This payment is already ${intent.status.toLowerCase()}.`);
    if (intent.provider_ref && intent.provider_id) {
      const provider = this.providers.get(intent.provider_id);
      try {
        const result = await provider.cancelPayment(intent.provider_ref);
        this.applyProviderStatus(intent.id, intent.status, result.status);
        return result.status;
      } catch (error) {
        logEvent('warn', 'payment.cancel_failed', { intentId, error: String(error) });
        throw Errors.providerUnavailable();
      }
    }
    this.applyProviderStatus(intent.id, intent.status, 'CANCELLED');
    return 'CANCELLED';
  }

  async refundPayment(userId: string, intentId: string, amountMinor?: number): Promise<PaymentStatus> {
    const intent = repo.intents.findOwned(userId, intentId);
    if (!intent) throw Errors.notFound('Payment');
    if (intent.status !== 'SUCCESSFUL') throw Errors.conflict('Only successful payments can be refunded');
    if (!intent.provider_id || !intent.provider_ref) throw Errors.conflict('This payment cannot be refunded');
    const provider = this.providers.get(intent.provider_id);
    if (!provider.supports('refundPayment')) throw Errors.conflict('This payment method does not support refunds');
    const result = await provider.refundPayment(intent.provider_ref, amountMinor !== undefined ? money(amountMinor, intent.currency) : undefined);
    this.applyProviderStatus(intent.id, intent.status, result.status);
    audit('payment.refunded', { type: 'payment_intent', id: intent.id }, { actorUserId: userId });
    return result.status;
  }

  /**
   * Reconciliation: for every non-terminal payment whose provider has not confirmed,
   * ask the provider. Handles delayed callbacks, provider downtime and partial failures.
   */
  async reconcile(limit = 50): Promise<{ checked: number; updated: number; stillPending: number }> {
    const cutoff = new Date(Date.now() - config.reconciliation.staleAfterSeconds * 1000).toISOString();
    const stale = repo.intents.listStale(['CREATED', 'PENDING', 'PROCESSING'], cutoff, limit);
    let updated = 0;
    let stillPending = 0;

    for (const intent of stale) {
      if (intent.status === 'CREATED') {
        // Never authorised — this is an abandoned confirmation, not an unknown outcome.
        const age = Date.now() - Date.parse(intent.created_at);
        if (age > 15 * 60_000) {
          if (repo.intents.applyOutcome({ intentId: intent.id, from: ['CREATED'], to: 'EXPIRED' }).applied) updated++;
        }
        continue;
      }
      if (!intent.provider_id || !intent.provider_ref) {
        const attempts = repo.transactions.countForIntent(intent.id);
        if (attempts >= config.reconciliation.maxAttempts) {
          if (repo.intents.applyOutcome({ intentId: intent.id, from: ['PENDING', 'PROCESSING'], to: 'EXPIRED' }).applied) updated++;
        } else {
          stillPending++;
        }
        continue;
      }
      try {
        const provider = this.providers.get(intent.provider_id);
        const status = await provider.getPaymentStatus(intent.provider_ref);
        if (status.status !== intent.status) {
          const changed = this.applyProviderStatus(intent.id, intent.status, status.status);
          if (changed) updated++;
          else stillPending++;
        } else {
          stillPending++;
          const attempts = repo.transactions.countForIntent(intent.id);
          if (attempts >= config.reconciliation.maxAttempts && !isTerminal(intent.status)) {
            if (repo.intents.applyOutcome({ intentId: intent.id, from: ['PENDING', 'PROCESSING'], to: 'EXPIRED' }).applied) updated++;
          }
        }
        audit('payment.reconciled', { type: 'payment_intent', id: intent.id, metadata: { status: status.status } }, { actorType: 'system' });
      } catch (error) {
        logEvent('warn', 'payment.reconcile_failed', { intentId: intent.id, error: String(error) });
        stillPending++;
      }
    }
    return { checked: stale.length, updated, stillPending };
  }

  private toView(intent: repo.IntentRow, duplicate: boolean, risk?: RiskDecision): IntentWithRisk {
    return {
      id: intent.id,
      reference: intent.reference,
      status: intent.status,
      amountMinor: intent.amount_minor,
      currency: intent.currency,
      recipientLabel: intent.recipient_label,
      expiresAt: intent.expires_at,
      risk: risk ?? { score: intent.risk_score, requiresStepUp: (JSON.parse(intent.risk_reasons || '[]') as string[]).length > 0, reasons: JSON.parse(intent.risk_reasons || '[]') as string[] },
      duplicate,
    };
  }
}

export class OrchestratorError extends AppError {}
