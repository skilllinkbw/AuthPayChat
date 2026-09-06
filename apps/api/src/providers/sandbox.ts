/**
 * Sandbox provider — a deterministic simulator used ONLY in development and tests.
 *
 * It exists so the orchestrator, webhook verification, reconciliation and the whole UI
 * can be exercised end-to-end without a live rail. It is hard-disabled in production,
 * it signs its webhooks with the same HMAC scheme as a real provider (so the verification
 * path is genuinely tested), and it never reports a success that was not requested.
 *
 * IMPORTANT: this is NOT an integration. No PayChat code path can mistake it for one —
 * the provider id is "sandbox" and `config.isProduction` throws on construction.
 */

import { config } from '../config.js';
import {
  ProviderError,
  money,
  type Capability, type CapabilitySet, type InitiatePaymentRequest, type PayChatWebhookEvent,
  type PaymentProvider, type PaymentStatus, type ProviderAccountRef, type ProviderBalance,
  type ProviderInitiateResult, type ProviderKind, type ProviderRecipient, type ProviderStatusResult,
  type WebhookVerificationInput,
} from '@paychat/shared';
import { signWebhook, verifyWebhookSignature } from './signature.js';
import { sandboxState } from '../repositories.js';

export type SandboxScenario =
  | 'success'
  | 'processing'
  | 'pending'
  | 'failure_insufficient'
  | 'failure_invalid_recipient'
  | 'timeout'
  | 'unavailable';

const SANDBOX_WEBHOOK_SECRET = process.env.SANDBOX_WEBHOOK_SECRET ?? 'sandbox-webhook-secret-not-for-production';

export class SandboxProvider implements PaymentProvider {
  readonly id = 'sandbox';
  readonly displayName = 'Sandbox Rail (test only)';
  readonly kind: ProviderKind = 'mobile_money';
  readonly countries = ['BW'];
  readonly currencies = ['BWP'];
  readonly capabilities: CapabilitySet = {
    initiatePayment: true,
    getPaymentStatus: true,
    verifyPayment: true,
    cancelPayment: true,
    refundPayment: true,
    getBalance: true,
    processWebhook: true,
    validateRecipient: true,
    getSupportedCurrencies: true,
    getSupportedPaymentMethods: true,
  };

  scenario: SandboxScenario;
  private readonly states = new Map<string, PaymentStatus>();
  private eventCounter = 0;

  constructor(definition?: { id?: string; displayName?: string; metadata?: Record<string, unknown> }) {
    if (config.isProduction) {
      throw new Error('SandboxProvider must never be constructed in production');
    }
    this.scenario = (definition?.metadata?.scenario as SandboxScenario) ?? (process.env.PAYCHAT_SANDBOX_SCENARIO as SandboxScenario) ?? 'success';
  }

  supports(capability: Capability): boolean {
    return this.capabilities[capability] === true;
  }

  /** Sets the simulated available balance for a sandbox wallet (minor units). */
  setBalance(providerAccountRef: string, minor: number): void {
    sandboxState.set(`balance:${providerAccountRef}`, minor);
  }

  private readBalance(providerAccountRef: string): number | null {
    return sandboxState.get(`balance:${providerAccountRef}`);
  }

  setStatus(providerRef: string, status: PaymentStatus): void {
    this.states.set(providerRef, status);
  }

  async initiatePayment(req: InitiatePaymentRequest): Promise<ProviderInitiateResult> {
    switch (this.scenario) {
      case 'timeout':
        throw new ProviderError('timeout', 'sandbox: provider timed out', this.id, true);
      case 'unavailable':
        throw new ProviderError('provider_unavailable', 'sandbox: provider unavailable', this.id, true);
      case 'failure_insufficient':
        return { outcome: 'rejected', status: 'FAILED', reason: 'insufficient_funds', message: 'Insufficient balance.' };
      case 'failure_invalid_recipient':
        return { outcome: 'rejected', status: 'FAILED', reason: 'invalid_recipient', message: 'The recipient could not be found.' };
      default:
        break;
    }

    const providerRef = `sbx_${req.intentId.slice(0, 12)}`;
    // Simulated balance check (dev only) so the "insufficient funds" UX can be demonstrated.
    const available = this.readBalance(req.source.providerAccountRef);
    if (available !== null && available < req.amount.minor) {
      return { outcome: 'rejected', status: 'FAILED', reason: 'insufficient_funds', message: 'Insufficient balance.' };
    }
    if (available !== null) this.setBalance(req.source.providerAccountRef, available - req.amount.minor);

    const initial: PaymentStatus = this.scenario === 'success' ? 'PROCESSING' : this.scenario === 'processing' ? 'PROCESSING' : 'PENDING';
    this.states.set(providerRef, initial);
    return { outcome: 'initiated', providerRef, status: initial };
  }

  async getPaymentStatus(providerRef: string): Promise<ProviderStatusResult> {
    const stored = this.states.get(providerRef);
    if (!stored) throw new ProviderError('unknown', `sandbox: unknown reference ${providerRef}`, this.id);
    const status: PaymentStatus =
      this.scenario === 'pending' ? 'PENDING' :
      stored === 'PROCESSING' && this.scenario !== 'processing' ? 'SUCCESSFUL' :
      stored;
    if (status !== stored) this.states.set(providerRef, status);
    return { providerRef, status, providerRawStatus: status, asOf: new Date().toISOString() };
  }

  async verifyPayment(providerRef: string): Promise<ProviderStatusResult> {
    return this.getPaymentStatus(providerRef);
  }

  async cancelPayment(providerRef: string): Promise<ProviderStatusResult> {
    this.states.set(providerRef, 'CANCELLED');
    return { providerRef, status: 'CANCELLED', asOf: new Date().toISOString() };
  }

  async refundPayment(providerRef: string): Promise<ProviderStatusResult> {
    this.states.set(providerRef, 'REFUNDED');
    return { providerRef, status: 'REFUNDED', asOf: new Date().toISOString() };
  }

  async getBalance(account: ProviderAccountRef): Promise<ProviderBalance> {
    // A provider outage affects balance lookups too, not just payments.
    if (this.scenario === 'unavailable') {
      throw new ProviderError('provider_unavailable', 'sandbox: provider unavailable', this.id, true);
    }
    if (this.scenario === 'timeout') {
      throw new ProviderError('timeout', 'sandbox: balance lookup timed out', this.id, true);
    }
    const available = this.readBalance(account.providerAccountRef);
    if (available === null) {
      throw new ProviderError('provider_unavailable', 'sandbox: balance unavailable for this account', this.id, true);
    }
    return { available: money(available, 'BWP'), pending: money(0, 'BWP'), asOf: new Date().toISOString() };
  }

  async validateRecipient(recipient: ProviderRecipient): Promise<{ valid: boolean; displayName?: string; reason?: string }> {
    const handle = recipient.handle.replace(/\s+/g, '');
    if (!/^\+?\d{7,15}$/.test(handle)) return { valid: false, reason: 'invalid_recipient' };
    return { valid: true, displayName: recipient.displayName ?? handle };
  }

  async processWebhook(input: WebhookVerificationInput): Promise<PayChatWebhookEvent> {
    const { eventId } = verifyWebhookSignature(input.rawBody, input.headers, SANDBOX_WEBHOOK_SECRET);
    const body = JSON.parse(typeof input.rawBody === 'string' ? input.rawBody : input.rawBody.toString('utf8')) as Record<string, unknown>;
    const providerRef = String(body.reference ?? '');
    if (!providerRef) throw new Error('webhook missing reference');
    const status = String(body.status ?? '') as PaymentStatus;
    this.states.set(providerRef, status);
    const amount = body.amount as { value?: number; currency?: string } | undefined;
    return {
      eventId,
      providerRef,
      status,
      amount: amount ? money(Number(amount.value ?? 0), String(amount.currency ?? 'BWP')) : undefined,
      occurredAt: String(body.occurred_at ?? new Date().toISOString()),
      raw: body,
    };
  }

  /** Builds a correctly signed callback so tests exercise the real verification path. */
  buildWebhook(providerRef: string, status: PaymentStatus, amountMinor = 0): { headers: Record<string, string>; body: string } {
    this.eventCounter += 1;
    const payload = {
      reference: providerRef,
      status,
      amount: { value: amountMinor, currency: 'BWP' },
      occurred_at: new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const { header } = signWebhook(body, SANDBOX_WEBHOOK_SECRET);
    return {
      headers: {
        'content-type': 'application/json',
        'x-paychat-event-id': `evt_sandbox_${this.eventCounter}_${providerRef}`,
        'x-paychat-signature': header,
      },
      body,
    };
  }

  getSupportedCurrencies(): readonly string[] {
    return ['BWP'];
  }

  getSupportedPaymentMethods(): readonly ProviderKind[] {
    return ['mobile_money', 'bank', 'card', 'qr'];
  }
}
