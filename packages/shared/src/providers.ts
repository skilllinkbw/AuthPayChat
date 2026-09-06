/**
 * Provider-agnostic payment contract.
 *
 * Principle: one common interface, many independent providers.
 * Nothing in the PayChat frontend or core payment workflow knows which rail it is talking to.
 * Capability discovery means not every provider must implement every method.
 */

import type { Money } from './money';
import type { PaymentStatus } from './paymentStatus';

export type ProviderKind = 'mobile_money' | 'bank' | 'card' | 'qr' | 'voucher' | 'other';

export type Capability =
  | 'initiatePayment'
  | 'getPaymentStatus'
  | 'verifyPayment'
  | 'cancelPayment'
  | 'refundPayment'
  | 'getBalance'
  | 'processWebhook'
  | 'validateRecipient'
  | 'getSupportedCurrencies'
  | 'getSupportedPaymentMethods';

export type CapabilitySet = Readonly<Partial<Record<Capability, boolean>>>;

export interface ProviderRecipient {
  /** Provider-native handle: MSISDN for mobile money, account number for banks, handle for QR. */
  handle: string;
  /** Optional display name resolved by the provider. */
  displayName?: string;
  /** Provider-specific metadata (never trusted for authorisation decisions). */
  metadata?: Record<string, unknown>;
}

export interface ProviderAccountRef {
  /** PayChat-side id of the connected account (a PaymentAccount row). */
  accountId: string;
  /** Provider-side reference/token handle for the account. */
  providerAccountRef: string;
}

export interface InitiatePaymentRequest {
  /** PayChat payment intent id — also used as the provider idempotency key. */
  intentId: string;
  /** Idempotency key derived from the intent; providers must dedupe on it. */
  idempotencyKey: string;
  amount: Money;
  recipient: ProviderRecipient;
  /** Which connected account is funding the payment. */
  source: ProviderAccountRef;
  narration?: string;
  /** Absolute URL the provider should call back to (never trusted without signature verification). */
  callbackUrl: string;
}

export type ProviderInitiateResult =
  | { outcome: 'initiated'; providerRef: string; status: PaymentStatus; message?: string }
  | { outcome: 'rejected'; providerRef?: string; status: Extract<PaymentStatus, 'FAILED' | 'CANCELLED'>; reason: ProviderFailureReason; message: string };

export type ProviderFailureReason =
  | 'insufficient_funds'
  | 'invalid_recipient'
  | 'provider_unavailable'
  | 'timeout'
  | 'authentication'
  | 'limit_exceeded'
  | 'duplicate'
  | 'unknown';

export interface ProviderBalance {
  available: Money;
  pending?: Money;
  unavailable?: Money;
  /** When the provider reported this balance (ISO timestamp). */
  asOf: string;
}

export interface ProviderStatusResult {
  providerRef: string;
  status: PaymentStatus;
  providerRawStatus?: string;
  asOf: string;
}

export interface WebhookVerificationInput {
  /** Raw, unparsed body — signature must be computed over exactly these bytes. */
  rawBody: string | Buffer;
  headers: Record<string, string | string[] | undefined>;
}

export interface PayChatWebhookEvent {
  /** Provider's own event id — used for replay protection. */
  eventId: string;
  providerRef: string;
  status: PaymentStatus;
  amount?: Money;
  occurredAt: string;
  raw: unknown;
}

export interface PaymentProvider {
  readonly id: string;
  readonly displayName: string;
  readonly kind: ProviderKind;
  /** ISO-3166 alpha-2 country codes where this provider operates. */
  readonly countries: readonly string[];
  readonly currencies: readonly string[];
  readonly capabilities: CapabilitySet;

  supports(capability: Capability): boolean;

  initiatePayment(req: InitiatePaymentRequest): Promise<ProviderInitiateResult>;
  getPaymentStatus(providerRef: string): Promise<ProviderStatusResult>;
  verifyPayment(providerRef: string): Promise<ProviderStatusResult>;
  cancelPayment(providerRef: string): Promise<ProviderStatusResult>;
  refundPayment(providerRef: string, amount?: Money): Promise<ProviderStatusResult>;
  getBalance(account: ProviderAccountRef): Promise<ProviderBalance>;
  validateRecipient(recipient: ProviderRecipient): Promise<{ valid: boolean; displayName?: string; reason?: string }>;
  /**
   * Verifies the webhook signature and returns a normalised event.
   * MUST throw on invalid/missing signature, stale timestamp or replayed event id.
   */
  processWebhook(input: WebhookVerificationInput): Promise<PayChatWebhookEvent>;
  getSupportedCurrencies(): readonly string[];
  getSupportedPaymentMethods(): readonly ProviderKind[];
}

export class ProviderError extends Error {
  readonly code = 'PROVIDER_ERROR' as const;
  constructor(
    readonly reason: ProviderFailureReason,
    message: string,
    readonly providerId: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class WebhookVerificationError extends Error {
  readonly code = 'WEBHOOK_VERIFICATION_FAILED' as const;
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

export const ALL_CAPABILITIES: readonly Capability[] = [
  'initiatePayment',
  'getPaymentStatus',
  'verifyPayment',
  'cancelPayment',
  'refundPayment',
  'getBalance',
  'processWebhook',
  'validateRecipient',
  'getSupportedCurrencies',
  'getSupportedPaymentMethods',
];
