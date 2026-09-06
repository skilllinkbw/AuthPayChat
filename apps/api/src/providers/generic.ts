/**
 * Generic REST provider adapter — ONE implementation for every external rail.
 *
 * There is no per-provider subclass and no provider name in this file. Everything that
 * differs between rails (URLs, paths, auth style, status vocabulary, webhook field names,
 * capabilities, currencies) comes from the ProviderDefinition that the registry supplies.
 *
 * It performs no simulation: with no credentials every money-moving capability reports
 * false, and any transport failure surfaces as ProviderError — never as a fake success.
 */

import { createQrToken, verifyQrToken } from '../payments/qr.js';
import {
  ProviderError, WebhookVerificationError, assertTransition, canTransition,
  type Capability, type CapabilitySet, type InitiatePaymentRequest, type PayChatWebhookEvent,
  type PaymentProvider, type PaymentStatus, type ProviderAccountRef, type ProviderBalance,
  type ProviderFailureReason, type ProviderInitiateResult, type ProviderKind,
  type ProviderRecipient, type ProviderStatusResult, type WebhookVerificationInput,
} from '@paychat/shared';
import { money } from '@paychat/shared';
import { verifyWebhookSignature } from './signature.js';
import { capabilitiesFor, type ProviderDefinition, type RestTransportConfig } from './types.js';
import { registerSecretValue, resolveCredential } from '../security/credentials.js';

const DEFAULT_TIMEOUT_MS = 12_000;

export class GenericRestProvider implements PaymentProvider {
  readonly id: string;
  readonly displayName: string;
  readonly kind: ProviderKind;
  readonly countries: readonly string[];
  readonly capabilities: CapabilitySet;

  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly definition: ProviderDefinition,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.id = definition.id;
    this.displayName = definition.displayName;
    this.kind = definition.kind;
    this.countries = [definition.country];
    const caps = capabilitiesFor(definition);
    // A rail with no transport or no credentials must not advertise that it can move money.
    const gated = this.transport === null || !this.hasCredentials();
    this.capabilities = {
      initiatePayment: gated ? false : caps.initiatePayment,
      getPaymentStatus: gated ? false : caps.getPaymentStatus,
      verifyPayment: gated ? false : caps.verifyPayment,
      cancelPayment: gated ? false : caps.cancelPayment,
      refundPayment: gated ? false : caps.refundPayment,
      getBalance: gated ? false : caps.getBalance,
      processWebhook: gated ? false : caps.processWebhook,
      validateRecipient: caps.validateRecipient,
      getSupportedCurrencies: caps.getSupportedCurrencies,
      getSupportedPaymentMethods: caps.getSupportedPaymentMethods,
    };
  }

  private get transport(): RestTransportConfig | null {
    return this.definition.transport.type === 'rest' ? this.definition.transport : null;
  }

  /** True when the credentials this rail needs are present (encrypted store or env). */
  hasCredentials(): boolean {
    const transport = this.transport;
    const auth = this.definition.auth;
    if (!transport || !auth || auth.type === 'none') return Boolean(transport);
    if (auth.type === 'oauth2_client_credentials') {
      return Boolean(
        resolveCredential(this.id, auth.credentialKeys?.clientId ?? 'client_id', auth.clientIdEnv) &&
        resolveCredential(this.id, auth.credentialKeys?.clientSecret ?? 'client_secret', auth.clientSecretEnv),
      );
    }
    if (auth.type === 'api_key' || auth.type === 'hmac') {
      return Boolean(resolveCredential(this.id, 'api_key', auth.apiKeyEnv));
    }
    return false;
  }

  private get webhookSecret(): string | null {
    const auth = this.definition.auth;
    return resolveCredential(this.id, auth?.credentialKeys?.webhookSecret ?? 'webhook_secret', auth?.webhookSecretEnv);
  }

  supports(capability: Capability): boolean { return this.capabilities[capability] === true; }
  get currencies(): readonly string[] { return this.definition.currencies; }

  private get baseUrl(): string {
    const transport = this.transport;
    const url = (transport?.baseUrl ?? (transport?.baseUrlEnv ? process.env[transport.baseUrlEnv] : undefined))?.replace(/\/+$/, '');
    if (!url) throw new ProviderError('authentication', `${this.id} is not configured (base URL missing)`, this.id);
    return url;
  }

  private paths(): RestTransportConfig['paths'] {
    const transport = this.transport;
    if (!transport) throw new ProviderError('unknown', `${this.id} has no REST transport`, this.id);
    return transport.paths;
  }

  private async request(path: string, init: RequestInit = {}, retryAuth = true): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'TimeoutError';
      // Network failure: we do NOT know the outcome — the caller keeps the payment PENDING
      // and reconciliation resolves it. Never report success or failure we cannot prove.
      throw new ProviderError(aborted ? 'timeout' : 'provider_unavailable', `${this.id} unreachable`, this.id, true);
    }

    if (response.status === 401 && retryAuth) {
      this.token = null;
      return this.request(path, init, false);
    }
    return response;
  }

  private async accessToken(): Promise<string | null> {
    const auth = this.definition.auth;
    const transport = this.transport;
    if (!auth || auth.type === 'none') return null;
    if (auth.type === 'api_key' || auth.type === 'hmac') {
      const key = resolveCredential(this.id, 'api_key', auth.apiKeyEnv);
      if (!key) throw new ProviderError('authentication', `${this.id} credentials missing`, this.id);
      return null; // sent via the configured header instead of a bearer token
    }
    if (!transport?.paths.token) return null;
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;

    const clientId = resolveCredential(this.id, auth.credentialKeys?.clientId ?? 'client_id', auth.clientIdEnv);
    const clientSecret = resolveCredential(this.id, auth.credentialKeys?.clientSecret ?? 'client_secret', auth.clientSecretEnv);
    if (!clientId || !clientSecret) throw new ProviderError('authentication', `${this.id} credentials missing`, this.id);
    registerSecretValue(clientSecret);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${transport.paths.token}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });
      if (!response.ok) throw new ProviderError('authentication', `${this.id} token request failed (${response.status})`, this.id);
      const json = (await response.json()) as { access_token?: string; expires_in?: number };
      if (!json.access_token) throw new ProviderError('authentication', `${this.id} token response malformed`, this.id);
      registerSecretValue(json.access_token);
      this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
      return this.token.value;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError('provider_unavailable', `${this.id} token request error`, this.id, true);
    }
  }

  private mapStatus(raw: string | undefined): PaymentStatus {
    if (!raw) return 'PENDING';
    const map = this.transport?.statusMap ?? {};
    return (map[raw.toUpperCase()] ?? map[raw] ?? 'PENDING') as PaymentStatus;
  }

  async initiatePayment(req: InitiatePaymentRequest): Promise<ProviderInitiateResult> {
    const transport = this.transport;
    const auth = this.definition.auth;
    if (!transport) throw new ProviderError('unknown', `${this.id} is not configured`, this.id);
    const headers: Record<string, string> = { 'idempotency-key': req.idempotencyKey };
    if (auth?.type === 'api_key' || auth?.type === 'hmac') {
      const key = resolveCredential(this.id, 'api_key', auth.apiKeyEnv);
      if (!key) throw new ProviderError('authentication', `${this.id} credentials missing`, this.id);
      headers[auth.headerName ?? 'x-api-key'] = key;
    }
    const response = await this.request(transport.paths.pay, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        amount: { value: req.amount.minor, currency: req.amount.currency },
        source: req.source.providerAccountRef,
        destination: req.recipient.handle,
        narration: req.narration ?? '',
        callback_url: req.callbackUrl,
        reference: req.intentId,
      }),
    });

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (response.status >= 500) {
      throw new ProviderError('provider_unavailable', `${this.id} returned ${response.status}`, this.id, true);
    }
    if (response.status >= 400) {
      const reason = this.failureReason(response.status, body);
      return {
        outcome: 'rejected',
        status: 'FAILED',
        reason,
        message: String(body.message ?? 'The payment was rejected by your provider.'),
      };
    }

    const providerRef = String(body.reference ?? body.id ?? '');
    if (!providerRef) {
      // A 2xx without a reference is not proof of anything — stay pending, let reconciliation decide.
      return { outcome: 'initiated', providerRef: '', status: 'PENDING', message: 'Provider accepted the request without a reference; awaiting confirmation.' };
    }
    return { outcome: 'initiated', providerRef, status: this.mapStatus(String(body.status ?? 'PENDING')) };
  }

  private failureReason(status: number, body: Record<string, unknown>): ProviderFailureReason {
    const code = String(body.code ?? '').toLowerCase();
    if (code.includes('insufficient') || code.includes('balance')) return 'insufficient_funds';
    if (code.includes('recipient') || code.includes('payee') || code.includes('msisdn')) return 'invalid_recipient';
    if (code.includes('limit')) return 'limit_exceeded';
    if (code.includes('duplicate')) return 'duplicate';
    if (status === 401 || status === 403) return 'authentication';
    return 'unknown';
  }

  private async statusRequest(path: string, providerRef: string): Promise<ProviderStatusResult> {
    const response = await this.request(path.replace('{ref}', encodeURIComponent(providerRef)));
    if (response.status === 404) throw new ProviderError('unknown', `${this.id} has no payment matching this reference`, this.id);
    if (response.status >= 500) throw new ProviderError('provider_unavailable', `${this.id} status check failed`, this.id, true);
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const raw = String(body.status ?? '');
    return { providerRef, status: this.mapStatus(raw), providerRawStatus: raw, asOf: new Date().toISOString() };
  }

  async getPaymentStatus(providerRef: string): Promise<ProviderStatusResult> {
    return this.statusRequest(this.paths().status, providerRef);
  }

  async verifyPayment(providerRef: string): Promise<ProviderStatusResult> {
    return this.getPaymentStatus(providerRef);
  }

  async cancelPayment(providerRef: string): Promise<ProviderStatusResult> {
    const path = this.paths().cancel;
    if (!path) throw new ProviderError('unknown', `${this.id} does not support cancellation`, this.id);
    const response = await this.request(path.replace('{ref}', encodeURIComponent(providerRef)), { method: 'POST' });
    if (response.status >= 500) throw new ProviderError('provider_unavailable', `${this.id} cancel failed`, this.id, true);
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { providerRef, status: this.mapStatus(String(body.status ?? 'CANCELLED')), providerRawStatus: String(body.status ?? ''), asOf: new Date().toISOString() };
  }

  async refundPayment(providerRef: string, amount?: { minor: number; currency: string }): Promise<ProviderStatusResult> {
    const path = this.paths().refund;
    if (!path) throw new ProviderError('unknown', `${this.id} does not support refunds`, this.id);
    const response = await this.request(path.replace('{ref}', encodeURIComponent(providerRef)), {
      method: 'POST',
      body: JSON.stringify(amount ? { amount: { value: amount.minor, currency: amount.currency } } : {}),
    });
    if (response.status >= 500) throw new ProviderError('provider_unavailable', `${this.id} refund failed`, this.id, true);
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { providerRef, status: this.mapStatus(String(body.status ?? 'REFUNDED')), providerRawStatus: String(body.status ?? ''), asOf: new Date().toISOString() };
  }

  async getBalance(account: ProviderAccountRef): Promise<ProviderBalance> {
    const path = this.paths().balance;
    if (!path) throw new ProviderError('unknown', `${this.id} does not expose balances`, this.id);
    const response = await this.request(path.replace('{ref}', encodeURIComponent(account.providerAccountRef)));
    if (response.status >= 500) throw new ProviderError('provider_unavailable', `${this.id} balance lookup failed`, this.id, true);
    if (response.status >= 400) throw new ProviderError('unknown', `${this.id} balance unavailable`, this.id);
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const available = Number(body.available ?? body.balance ?? 0);
    const currency = String(body.currency ?? this.definition.currencies[0]);
    const pending = body.pending !== undefined ? Number(body.pending) : undefined;
    return {
      available: money(Number.isFinite(available) ? Math.round(available) : 0, currency),
      pending: pending !== undefined ? money(Math.round(pending), currency) : undefined,
      asOf: new Date().toISOString(),
    };
  }

  async validateRecipient(recipient: ProviderRecipient): Promise<{ valid: boolean; displayName?: string; reason?: string }> {
    const handle = recipient.handle.replace(/\s+/g, '');
    if (!/^\+?\d{7,15}$/.test(handle) && !/^[\w.+-]+@[\w-]+\.[\w.]+$/.test(handle)) {
      return { valid: false, reason: 'invalid_recipient' };
    }
    return { valid: true, displayName: recipient.displayName };
  }

  async processWebhook(input: WebhookVerificationInput): Promise<PayChatWebhookEvent> {
    const secret = this.webhookSecret;
    if (!secret) throw new WebhookVerificationError(`${this.id} has no webhook secret configured`);
    const fields = this.transport?.webhook ?? {};
    const { eventId } = verifyWebhookSignature(input.rawBody, input.headers, secret, {
      signatureHeader: fields.signatureHeader,
      eventIdHeader: fields.eventIdHeader,
    });
    const body = JSON.parse(typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8')) as Record<string, unknown>;
    const providerRef = String(body[fields.referenceField ?? 'reference'] ?? body.provider_ref ?? '');
    if (!providerRef) throw new WebhookVerificationError('webhook missing payment reference');
    const rawStatus = String(body[fields.statusField ?? 'status'] ?? '');
    const amountRaw = body[fields.amountField ?? 'amount'];
    const amountRecord = amountRaw && typeof amountRaw === 'object' ? (amountRaw as Record<string, unknown>) : undefined;
    return {
      eventId,
      providerRef,
      status: this.mapStatus(rawStatus),
      amount: amountRaw !== undefined
        ? money(Number(amountRecord ? (amountRecord.value ?? 0) : amountRaw), String(amountRecord?.currency ?? this.definition.currencies[0]))
        : undefined,
      occurredAt: String(body.occurred_at ?? new Date().toISOString()),
      raw: body,
    };
  }

  getSupportedCurrencies(): readonly string[] { return this.definition.currencies; }
  getSupportedPaymentMethods(): readonly ProviderKind[] { return [this.kind]; }
}

/**
 * Signed, expiring payment-link token (no secrets inside).
 *
 * Payment links and QR codes are the same thing as of v2: one signed envelope
 * (see payments/qr.ts) so a link printed as a QR and a QR shared as a link behave
 * identically, including expiry, single use and amount integrity.
 */
export function signPaymentLinkToken(payload: Record<string, unknown>, ttlSeconds = 900): string {
  return createQrToken({
    kind: 'payment_link',
    creatorUserId: String(payload.creatorUserId),
    amountMinor: payload.amountMinor === undefined || payload.amountMinor === null ? null : Number(payload.amountMinor),
    currency: String(payload.currency ?? 'BWP'),
    description: payload.description === undefined ? null : String(payload.description),
    ...(payload.jti ? { jti: String(payload.jti) } : {}),
    ttlSeconds,
  }).token;
}

export function verifyPaymentLinkToken(token: string): Record<string, unknown> | null {
  const payload = verifyQrToken(token);
  return payload ? ({ ...payload } as unknown as Record<string, unknown>) : null;
}

export { assertTransition, canTransition };
