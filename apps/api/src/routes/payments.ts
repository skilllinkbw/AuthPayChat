import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Errors, money } from '@paychat/shared';
import * as repo from '../repositories.js';
import { audit, logEvent } from '../security/audit.js';
import { requireAuth, hasRecentStepUp } from '../security/context.js';
import { PaymentOrchestrator } from '../payments/orchestrator.js';
import { registry } from '../providers/registry.js';
import { parsePaymentCommand, flagUnsupportedMethod, type Clarification } from '@paychat/nlp';
import { rateLimit } from '../security/rateLimit.js';
import { config } from '../config.js';
import { signPaymentLinkToken, verifyPaymentLinkToken } from '../providers/generic.js';
import { createQrToken, verifyQrToken, extractQrToken, renderQrPng, QR_SCHEME } from '../payments/qr.js';

const createIntentSchema = z.object({
  recipientContactId: z.string().min(1).optional(),
  recipientHandle: z.string().min(3).optional(),
  recipientLabel: z.string().min(1).max(80),
  amountMinor: z.number().int().positive(),
  currency: z.string().length(3).default('BWP'),
  narration: z.string().max(140).optional(),
  conversationId: z.string().optional(),
});

export function paymentRoutes(app: FastifyInstance, orchestrator: PaymentOrchestrator): void {
  /** Providers this deployment can actually use (configuration-driven, never hard-coded in the UI). */
  app.get('/api/providers', { preHandler: requireAuth }, async (request) => {
    const query = z.object({ country: z.string().length(2).optional() }).safeParse(request.query);
    const country = query.success ? query.data.country : undefined;
    // Everything the UI needs to render a payment sheet comes from the registry.
    return { providers: registry.list(country) };
  });

  app.get('/api/accounts', { preHandler: requireAuth }, async (request) => {
    const userId = request.auth!.userId;
    const accounts = repo.accounts.listForUser(userId);
    return {
      accounts: accounts.map((account) => {
        const cached = repo.balances.getCached(account.id);
        return {
          id: account.id,
          providerId: account.provider_id,
          kind: account.kind,
          label: account.label,
          currency: account.currency,
          isDefault: account.is_default === 1,
          status: account.status,
          balance: cached
            ? {
                availableMinor: cached.available_minor,
                pendingMinor: cached.pending_minor,
                unavailableMinor: cached.unavailable_minor,
                currency: cached.currency,
                asOf: cached.as_of,
                providerStatus: cached.provider_status,
                stale: cached.provider_status === 'stale' || Date.now() - Date.parse(cached.as_of) > 5 * 60_000,
              }
            : null,
        };
      }),
    };
  });

  /** Balance quote for a proposed amount — powers the payment-method dropdown. */
  app.post('/api/accounts/quote', { preHandler: requireAuth }, async (request) => {
    const body = z.object({ amountMinor: z.number().int().positive(), currency: z.string().length(3).default('BWP') }).parse(request.body);
    const accounts = repo.accounts.listForUser(request.auth!.userId);
    return {
      methods: accounts.map((account) => {
        const cached = repo.balances.getCached(account.id);
        const available = cached?.available_minor ?? null;
        return {
          accountId: account.id,
          label: account.label,
          kind: account.kind,
          providerId: account.provider_id,
          currency: account.currency,
          availableMinor: account.currency === body.currency ? available : null,
          insufficient:
            account.currency !== body.currency
              ? null
              : available === null
                ? null
                : available < body.amountMinor,
          balanceAsOf: cached?.as_of ?? null,
          providerStatus: cached?.provider_status ?? 'unknown',
        };
      }),
    };
  });

  app.post('/api/accounts/connect', { preHandler: requireAuth }, async (request, reply) => {
    const body = z.object({
      providerId: z.string().min(1),
      label: z.string().min(1).max(40),
      providerAccountRef: z.string().min(3).max(80),
      currency: z.string().length(3).default('BWP'),
      makeDefault: z.boolean().default(false),
    }).parse(request.body);

    const definition = registry.list().find((p) => p.id === body.providerId);
    if (!definition) throw Errors.validation({ providerId: 'Unknown provider' });
    if (!definition.enabled) {
      throw Errors.validation({ providerId: 'This payment method is not available yet. Connect it when the provider account is active.' }, 'provider not available');
    }
    if (!registry.hasCapability(body.providerId, 'initiatePayment')) {
      throw Errors.validation({ providerId: 'This payment method cannot send payments in this deployment.' }, 'capability unavailable');
    }
    // Prove the rail is reachable and the account is real before storing anything.
    try {
      const provider = orchestrator.providers.get(body.providerId);
      if (provider.supports('getBalance')) {
        const balance = await provider.getBalance({ accountId: '', providerAccountRef: body.providerAccountRef });
        repo.accounts.add({
          userId: request.auth!.userId,
          providerId: body.providerId,
          kind: definition.kind,
          label: body.label,
          providerAccountRef: body.providerAccountRef,
          currency: balance.available.currency,
          isDefault: body.makeDefault,
        });
      } else {
        repo.accounts.add({
          userId: request.auth!.userId, providerId: body.providerId, kind: definition.kind,
          label: body.label, providerAccountRef: body.providerAccountRef, currency: body.currency,
          isDefault: body.makeDefault,
        });
      }
    } catch (error) {
      logEvent('warn', 'account.connect_failed', { providerId: body.providerId, error: String(error) });
      throw Errors.validation({ providerAccountRef: 'We could not verify this account with the provider.' }, 'could not connect account');
    }

    audit('account.connected', { type: 'payment_account', metadata: { providerId: body.providerId } }, { actorUserId: request.auth!.userId, ip: request.ip });
    return reply.code(201).send({ ok: true });
  });

  app.delete('/api/accounts/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const removed = repo.accounts.disconnect(request.auth!.userId, id);
    if (!removed) throw Errors.notFound('Account');
    audit('account.disconnected', { type: 'payment_account', id }, { actorUserId: request.auth!.userId });
    return reply.send({ ok: true });
  });

  /** Refresh a balance from the provider. Failures are shown as unavailable — never as a guessed number. */
  app.post('/api/accounts/:id/balance/refresh', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const account = repo.accounts.findOwned(request.auth!.userId, id);
    if (!account) throw Errors.notFound('Account');
    const limit = await rateLimit(`balance:${request.auth!.userId}`, 20, 60);
    if (!limit.allowed) throw Errors.rateLimited();

    try {
      const provider = orchestrator.providers.get(account.provider_id);
      if (!provider.supports('getBalance')) {
        repo.balances.upsert({ accountId: account.id, availableMinor: null, currency: account.currency, providerStatus: 'unsupported', asOf: new Date().toISOString() });
        return { availableMinor: null, providerStatus: 'unsupported', message: 'This provider does not expose balances.' };
      }
      const balance = await provider.getBalance({ accountId: account.id, providerAccountRef: account.provider_account_ref });
      repo.balances.upsert({
        accountId: account.id,
        availableMinor: balance.available.minor,
        pendingMinor: balance.pending?.minor ?? null,
        unavailableMinor: balance.unavailable?.minor ?? null,
        currency: balance.available.currency,
        providerStatus: 'ok',
        asOf: balance.asOf,
      });
      repo.accounts.setError(request.auth!.userId, account.id, null);
      audit('account.balance_viewed', { type: 'payment_account', id: account.id }, { actorUserId: request.auth!.userId, ip: request.ip });
      return {
        availableMinor: balance.available.minor,
        pendingMinor: balance.pending?.minor ?? null,
        currency: balance.available.currency,
        asOf: balance.asOf,
        providerStatus: 'ok',
      };
    } catch (error) {
      logEvent('warn', 'balance.refresh_failed', { accountId: account.id, error: String(error) });
      repo.accounts.setError(request.auth!.userId, account.id, String(error));
      const cached = repo.balances.getCached(account.id);
      if (cached) {
        repo.balances.upsert({ accountId: account.id, availableMinor: cached.available_minor, currency: cached.currency, providerStatus: 'unavailable', asOf: cached.as_of });
        return { availableMinor: cached.available_minor, currency: cached.currency, asOf: cached.as_of, providerStatus: 'unavailable', stale: true };
      }
      repo.balances.upsert({ accountId: account.id, availableMinor: null, currency: account.currency, providerStatus: 'unavailable', asOf: new Date().toISOString() });
      return { availableMinor: null, providerStatus: 'unavailable', message: 'We could not reach your provider.' };
    }
  });

  /** Create a payment intent (proposed only — no money moves). */
  app.post('/api/payments/intents', { preHandler: requireAuth }, async (request, reply) => {
    const body = createIntentSchema.parse(request.body);
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    const intent = orchestrator.createIntent({
      userId: request.auth!.userId,
      recipientContactId: body.recipientContactId ?? null,
      recipientHandle: body.recipientHandle ?? null,
      recipientLabel: body.recipientLabel,
      amountMinor: body.amountMinor,
      currency: body.currency,
      narration: body.narration ?? null,
      conversationId: body.conversationId ?? null,
      idempotencyKey: idempotencyKey ?? null,
      deviceId: null,
    });
    return reply.code(201).send(intent);
  });

  app.get('/api/payments/intents/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const intent = repo.intents.findOwned(request.auth!.userId, id);
    if (!intent) throw Errors.notFound('Payment');
    return {
      id: intent.id,
      reference: intent.reference,
      status: intent.status,
      amountMinor: intent.amount_minor,
      currency: intent.currency,
      recipientLabel: intent.recipient_label,
      narration: intent.narration,
      expiresAt: intent.expires_at,
      risk: { score: intent.risk_score, reasons: JSON.parse(intent.risk_reasons || '[]') as string[] },
      accountId: intent.account_id,
      receiptId: repo.receipts.findByIntent(intent.id)?.id ?? null,
    };
  });

  /** Confirm + initiate. The client sends NO amount and NO recipient. */
  app.post('/api/payments/intents/:id/confirm', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({
      accountId: z.string().min(1),
      authMethod: z.enum(['password', 'biometric', 'pin']).default('password'),
    }).parse(request.body);

    const limit = await rateLimit(`confirm:${request.auth!.userId}`, 10, 60);
    if (!limit.allowed) throw Errors.rateLimited();

    const result = await orchestrator.authoriseAndInitiate({
      intentId: id,
      userId: request.auth!.userId,
      accountId: body.accountId,
      authMethod: body.authMethod,
      stepUpVerified: hasRecentStepUp(request.auth!.claims),
      ip: request.ip,
    });
    return reply.send(result);
  });

  app.post('/api/payments/intents/:id/cancel', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const status = await orchestrator.cancelPayment(request.auth!.userId, id);
    return { status };
  });

  app.post('/api/payments/:id/refund', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ amountMinor: z.number().int().positive().optional() }).parse(request.body ?? {});
    const status = await orchestrator.refundPayment(request.auth!.userId, id, body.amountMinor);
    return { status };
  });

  app.get('/api/payments', { preHandler: requireAuth }, async (request) => {
    const intents = repo.intents.listForUser(request.auth!.userId);
    return {
      payments: intents.map((intent) => ({
        id: intent.id,
        reference: intent.reference,
        status: intent.status,
        amountMinor: intent.amount_minor,
        currency: intent.currency,
        recipientLabel: intent.recipient_label,
        createdAt: intent.created_at,
        receiptId: repo.receipts.findByIntent(intent.id)?.id ?? null,
      })),
    };
  });

  app.get('/api/receipts', { preHandler: requireAuth }, async (request) => {
    return { receipts: repo.receipts.listForUser(request.auth!.userId) };
  });

  app.get('/api/receipts/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const receipt = repo.receipts.findOwned(request.auth!.userId, id);
    if (!receipt) throw Errors.notFound('Receipt');
    return receipt;
  });

  /**
   * Natural-language command → proposed intent.
   * This endpoint NEVER creates a payment. It only interprets and validates.
   */
  app.post('/api/nlp/parse', { preHandler: requireAuth }, async (request) => {
    const body = z.object({ text: z.string().min(1).max(280), language: z.enum(['en', 'tn']).optional() }).parse(request.body);
    const userId = request.auth!.userId;

    const resolveRecipient = (query: string) => {
      const matches = repo.contacts.search(userId, query);
      if (matches.length) {
        return matches.map((c) => ({ id: c.id, label: c.display_name, subtitle: c.phone_e164 }));
      }
      const users = repo.users.search(query, userId);
      return users.map((u) => ({ id: u.id, label: u.display_name, subtitle: u.phone_e164, isUserId: true }));
    };

    const intent = parsePaymentCommand(body.text, { resolveRecipient, defaultCurrency: 'BWP' });
    const myAccounts = repo.accounts.listForUser(userId);
    // Methods the user can actually pay from: their connected accounts' provider ids plus
    // the registry's configured names/aliases. Both come from configuration, never from code.
    const availableMethods = [
      ...new Set([
        ...myAccounts.map((a) => a.provider_id),
        ...myAccounts.flatMap((a) => {
          const definition = registry.list().find((p) => p.id === a.provider_id);
          return definition ? [definition.displayName, ...definition.aliases] : [];
        }),
      ]),
    ];
    const resolveMethod = (phrase: string) => registry.resolveMethodPhrase(phrase);
    const withMethodCheck = flagUnsupportedMethod(intent, availableMethods, resolveMethod);

    let clarification: Clarification | undefined = withMethodCheck.clarification;
    if (!clarification && withMethodCheck.amountMinor !== undefined && withMethodCheck.recipientQuery) {
      // Sanity-check liquidity preview is a UI concern, but we do surface a hint server-side.
      const quote = repo.accounts.listForUser(userId);
      if (!quote.length) {
        clarification = {
          field: 'payment_method',
          prompt: {
            en: 'You have no payment method connected yet. Connect an account to send money.',
            tn: 'Ga o ise o golaganye mokgwa ope wa go duela. Golaganya akhaonto go romela madi.',
          },
        };
      }
    }

    return {
      action: withMethodCheck.action,
      amountMinor: withMethodCheck.amountMinor,
      currency: withMethodCheck.currency,
      recipientQuery: withMethodCheck.recipientQuery,
      paymentMethodQuery: withMethodCheck.paymentMethodQuery,
      language: withMethodCheck.language,
      confidence: withMethodCheck.confidence,
      clarification,
      parseNotes: withMethodCheck.parseNotes,
    };
  });

  app.post('/api/requests', { preHandler: requireAuth }, async (request, reply) => {
    const body = z.object({
      payerUserId: z.string().optional(),
      payerLabel: z.string().min(1).max(80),
      conversationId: z.string().optional(),
      amountMinor: z.number().int().positive(),
      currency: z.string().length(3).default('BWP'),
      description: z.string().max(140).optional(),
      expiresInHours: z.number().int().positive().max(720).default(72),
    }).parse(request.body);

    const created = repo.requests.create({
      requesterUserId: request.auth!.userId,
      payerUserId: body.payerUserId ?? null,
      payerLabel: body.payerLabel,
      conversationId: body.conversationId ?? null,
      amountMinor: body.amountMinor,
      currency: body.currency,
      description: body.description ?? null,
      expiresAt: new Date(Date.now() + body.expiresInHours * 3600_000).toISOString(),
    });

    if (body.conversationId) {
      repo.conversations.addMessage({
        conversationId: body.conversationId,
        senderId: request.auth!.userId,
        kind: 'request',
        body: `Requested ${body.currency} ${(body.amountMinor / 100).toFixed(2)}`,
        paymentRequestId: created.id,
      });
    }
    audit('request.created', { type: 'payment_request', id: created.id, metadata: { amountMinor: body.amountMinor } }, { actorUserId: request.auth!.userId });
    return reply.code(201).send({ id: created.id, reference: created.reference, status: 'PENDING' });
  });

  app.get('/api/requests', { preHandler: requireAuth }, async (request) => {
    const expired = repo.requests.expireOverdue();
    if (expired) logEvent('info', 'requests.expired', { count: expired });
    return { requests: repo.requests.listForUser(request.auth!.userId) };
  });

  app.post('/api/requests/:id/decline', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const found = repo.requests.visibleToUser(request.auth!.userId, id);
    if (!found) throw Errors.notFound('Request');
    repo.requests.updateStatus(id, 'DECLINED');
    audit('request.declined', { type: 'payment_request', id }, { actorUserId: request.auth!.userId });
    return { status: 'DECLINED' };
  });

  /** Paying a request creates a normal intent — the same confirmation and security rules apply. */
  app.post('/api/requests/:id/pay', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ accountId: z.string().min(1), authMethod: z.enum(['password', 'biometric', 'pin']).default('password') }).parse(request.body);
    const found = repo.requests.visibleToUser(request.auth!.userId, id) as
      | { id: string; requester_user_id: string; amount_minor: number; currency: string; status: string; payer_label: string } | undefined;
    if (!found) throw Errors.notFound('Request');
    if (found.status !== 'PENDING') throw Errors.conflict('This request is no longer pending');

    const requester = repo.users.findById(found.requester_user_id);
    if (!requester) throw Errors.notFound('Request');

    const intent = orchestrator.createIntent({
      userId: request.auth!.userId,
      recipientUserId: requester.id,
      recipientHandle: requester.phone_e164,
      recipientLabel: requester.display_name,
      amountMinor: found.amount_minor,
      currency: found.currency,
      narration: 'Payment request',
    });

    const result = await orchestrator.authoriseAndInitiate({
      intentId: intent.id,
      userId: request.auth!.userId,
      accountId: body.accountId,
      authMethod: body.authMethod,
      stepUpVerified: hasRecentStepUp(request.auth!.claims),
      ip: request.ip,
    });

    repo.requests.updateStatus(id, result.status === 'SUCCESSFUL' ? 'PAID' : 'PENDING', intent.id);
    audit('request.paid', { type: 'payment_request', id, metadata: { intentId: intent.id, status: result.status } }, { actorUserId: request.auth!.userId });
    return reply.send({ intentId: intent.id, status: result.status });
  });

  /**
   * Payment links / QR payloads (§28).
   * The token is signed, expires, contains no secrets and never carries the amount in a
   * way the client can change: on redemption the amount is read back from the signed payload
   * and re-validated server-side.
   */
  app.post('/api/payment-links', { preHandler: requireAuth }, async (request, reply) => {
    const body = z.object({
      amountMinor: z.number().int().positive(),
      currency: z.string().length(3).default('BWP'),
      description: z.string().max(140).optional(),
      expiresInMinutes: z.number().int().positive().max(60 * 24 * 7).default(60),
    }).parse(request.body);

    const jti = `lnk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const token = signPaymentLinkToken({
      jti,
      creatorUserId: request.auth!.userId,
      amountMinor: body.amountMinor,
      currency: body.currency,
      description: body.description ?? null,
    }, body.expiresInMinutes * 60);

    audit('request.created', { type: 'payment_link', id: jti, metadata: { amountMinor: body.amountMinor, currency: body.currency } }, { actorUserId: request.auth!.userId });
    const url = `${config.webhookBaseUrl.replace('/api/webhooks', '')}/pay/${token}`;
    return reply.code(201).send({
      token,
      url,
      // `qr` is a PNG data URL: the client renders it directly, no CDN or client QR library.
      qr: await renderQrPng(url),
      qrSchemeUri: `${QR_SCHEME}${token}`,
      expiresInMinutes: body.expiresInMinutes,
      amountMinor: body.amountMinor,
      currency: body.currency,
    });
  });

  app.get('/api/payment-links/:token', { preHandler: requireAuth }, async (request) => {
    const { token } = request.params as { token: string };
    const payload = verifyPaymentLinkToken(token);
    if (!payload) throw Errors.notFound('Payment link');
    const creator = repo.users.findById(String(payload.creatorUserId));
    return {
      amountMinor: Number(payload.amountMinor),
      currency: String(payload.currency),
      description: payload.description ?? null,
      creatorName: creator?.display_name ?? 'PayChat user',
      expiresAt: new Date(Number(payload.exp) * 1000).toISOString(),
    };
  });

  app.post('/api/payment-links/:token/pay', { preHandler: requireAuth }, async (request, reply) => {
    const { token } = request.params as { token: string };
    const body = z.object({ accountId: z.string().min(1), authMethod: z.enum(['password', 'biometric', 'pin']).default('password') }).parse(request.body);

    const payload = verifyPaymentLinkToken(token);
    if (!payload) throw Errors.notFound('Payment link');

    const jti = String(payload.jti);
    // Single use: a redeemed link cannot be replayed for a second payment.
    const alreadyUsed = repo.idempotency.get('payment_link', jti);
    if (alreadyUsed?.state === 'completed') throw Errors.conflict('This payment link has already been used.');
    repo.idempotency.create('payment_link', jti, jti);

    const creator = repo.users.findById(String(payload.creatorUserId));
    if (!creator) throw Errors.notFound('Payment link');
    if (creator.id === request.auth!.userId) throw Errors.validation({ token: 'You cannot pay your own payment link' });

    const intent = orchestrator.createIntent({
      userId: request.auth!.userId,
      recipientUserId: creator.id,
      recipientHandle: creator.phone_e164,
      recipientLabel: creator.display_name,
      amountMinor: Number(payload.amountMinor),
      currency: String(payload.currency),
      narration: payload.description ? String(payload.description) : 'Payment link',
    });

    const result = await orchestrator.authoriseAndInitiate({
      intentId: intent.id,
      userId: request.auth!.userId,
      accountId: body.accountId,
      authMethod: body.authMethod,
      stepUpVerified: hasRecentStepUp(request.auth!.claims),
      ip: request.ip,
    });
    repo.idempotency.complete('payment_link', jti, { intentId: intent.id });
    return reply.send({ intentId: intent.id, status: result.status });
  });

  /**
   * QR scanning (brief §16). Scanning ONLY resolves a code to a preview — it never creates
   * or sends a payment. The preview is built from the SIGNED payload, so a QR that has been
   * reprinted with a different amount fails verification instead of charging more.
   */
  app.post('/api/qr/scan', { preHandler: requireAuth }, async (request) => {
    const body = z.object({ code: z.string().min(1).max(4096) }).parse(request.body);
    const token = extractQrToken(body.code);
    if (!token) throw Errors.validation({ code: 'That is not a PayChat code.' });
    const payload = verifyQrToken(token);
    if (!payload) throw Errors.validation({ code: 'This code is not valid or has expired. Ask for a new one.' });

    const creator = repo.users.findById(payload.creatorUserId);
    if (!creator) throw Errors.notFound('Payment code');

    const merchantId = payload.merchantId ?? null;
    const merchant = merchantId ? repo.users.findById(merchantId) : undefined;

    return {
      kind: payload.kind,
      token,
      // Amount comes from the signature — never from the request body.
      amountMinor: payload.amountMinor,
      amountFixed: payload.amountMinor !== null,
      currency: payload.currency,
      description: payload.description ?? null,
      recipient: { id: creator.id, name: creator.display_name, isMerchant: creator.is_merchant === 1 },
      merchant: merchant && merchant.is_merchant === 1
        ? { id: merchant.id, name: merchant.display_name, businessName: (repo.profiles.find(merchant.id) as { business_name?: string } | undefined)?.business_name ?? null }
        : null,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      // The UI must show a confirmation step; the server enforces it regardless.
      requiresConfirmation: true,
    };
  });

  /** Merchants publish a reusable code: no fixed amount, the payer types what they owe. */
  app.post('/api/merchant/qr', { preHandler: requireAuth }, async (request, reply) => {
    const me = repo.users.findById(request.auth!.userId);
    if (!me || me.is_merchant !== 1) throw Errors.forbidden();
    const body = z.object({
      currency: z.string().length(3).default('BWP'),
      description: z.string().max(140).optional(),
      ttlMinutes: z.number().int().positive().max(60 * 24 * 30).default(60 * 24 * 7),
    }).parse(request.body);

    const { token, expiresAt } = createQrToken({
      kind: 'merchant',
      creatorUserId: me.id,
      merchantId: me.id,
      amountMinor: null,
      currency: body.currency,
      description: body.description ?? null,
      ttlSeconds: body.ttlMinutes * 60,
    });

    audit('merchant.qr_created', { type: 'merchant', id: me.id, metadata: { currency: body.currency } }, { actorUserId: me.id });
    return reply.code(201).send({ token, qr: await renderQrPng(`${QR_SCHEME}${token}`), expiresAt, amountFixed: false });
  });

  /**
   * Paying a scanned code. The amount is taken from the signed payload when the code fixes
   * one; for open merchant codes the payer's amount is validated against the platform limits
   * and still requires the normal confirmation + step-up rules.
   */
  app.post('/api/qr/pay', { preHandler: requireAuth }, async (request, reply) => {
    const body = z.object({
      code: z.string().min(1).max(4096),
      accountId: z.string().min(1),
      amountMinor: z.number().int().positive().optional(),
      authMethod: z.enum(['password', 'biometric', 'pin']).default('password'),
      idempotencyKey: z.string().min(8).max(128).optional(),
    }).parse(request.body);

    const token = extractQrToken(body.code);
    if (!token) throw Errors.validation({ code: 'That is not a PayChat code.' });
    const payload = verifyQrToken(token);
    if (!payload) throw Errors.validation({ code: 'This code is not valid or has expired. Ask for a new one.' });

    const creator = repo.users.findById(payload.creatorUserId);
    if (!creator) throw Errors.notFound('Payment code');
    if (creator.id === request.auth!.userId) throw Errors.validation({ code: 'You cannot pay your own code' });

    const amountMinor = payload.amountMinor ?? body.amountMinor;
    if (amountMinor === null || amountMinor === undefined) throw Errors.validation({ amountMinor: 'Enter the amount to pay' });
    if (payload.amountMinor !== null && body.amountMinor !== undefined && body.amountMinor !== payload.amountMinor) {
      // Explicitly refuse a client that tries to override a signed amount.
      throw Errors.validation({ amountMinor: 'The amount on this code is fixed by the merchant' });
    }

    // Single use for fixed-amount codes: replaying the same QR cannot pay twice.
    if (payload.kind === 'payment_link') {
      const existing = repo.idempotency.get('payment_link', payload.jti);
      if (existing?.state === 'completed') throw Errors.conflict('This code has already been paid.');
      repo.idempotency.create('payment_link', payload.jti, payload.jti);
    }
    const idempotencyKey = body.idempotencyKey ?? payload.jti;

    const intent = orchestrator.createIntent({
      userId: request.auth!.userId,
      recipientUserId: creator.id,
      recipientHandle: creator.phone_e164,
      recipientLabel: creator.display_name,
      amountMinor,
      currency: payload.currency,
      narration: payload.description ? String(payload.description) : 'QR payment',
      idempotencyKey,
    });

    const result = await orchestrator.authoriseAndInitiate({
      intentId: intent.id,
      userId: request.auth!.userId,
      accountId: body.accountId,
      authMethod: body.authMethod,
      stepUpVerified: hasRecentStepUp(request.auth!.claims),
      ip: request.ip,
    });
    if (payload.kind === 'payment_link') repo.idempotency.complete('payment_link', payload.jti, { intentId: intent.id });
    return reply.send({ intentId: intent.id, status: result.status });
  });

  app.get('/api/notifications', { preHandler: requireAuth }, async (request) => {
    const notifications = repo.notifications.listForUser(request.auth!.userId).map((n) => {
      // Attach the receipt reference when the notification is tied to a settled payment,
      // so the Inbox can deep-link to the verified receipt without a second lookup.
      const data = JSON.parse(String(n.data_json ?? '{}')) as { intentId?: string };
      const receipt = data.intentId ? repo.receipts.findByIntent(data.intentId) : undefined;
      return { ...n, receiptId: receipt?.id ?? null };
    });
    return { notifications, unreadCount: repo.notifications.unreadCount(request.auth!.userId) };
  });

  app.post('/api/notifications/read-all', { preHandler: requireAuth }, async (request, reply) => {
    repo.notifications.markAllRead(request.auth!.userId);
    return reply.send({ ok: true });
  });

  app.post('/api/notifications/:id/read', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    // Ownership is checked explicitly: a stranger must get a 404, not a silent no-op success.
    const notification = repo.notifications.findById(id);
    if (!notification || notification.user_id !== request.auth!.userId) {
      throw Errors.notFound('Notification');
    }
    repo.notifications.markRead(request.auth!.userId, id);
    return reply.send({ ok: true });
  });
}

export function moneyHelper(minor: number, currency: string) {
  return money(minor, currency);
}
