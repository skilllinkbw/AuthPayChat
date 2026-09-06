/**
 * Disabled provider — the honest default.
 *
 * A provider that is switched off, unconfigured, or removed still resolves to an adapter,
 * but it reports every money-moving capability as false and throws if called. This is what
 * makes "remove a provider without rewriting core" true: nothing in the codebase needs to
 * know the provider ever existed.
 */

import {
  ProviderError,
  type Capability, type CapabilitySet, type InitiatePaymentRequest, type PayChatWebhookEvent,
  type PaymentProvider, type ProviderAccountRef, type ProviderBalance, type ProviderInitiateResult,
  type ProviderKind, type ProviderRecipient, type ProviderStatusResult, type WebhookVerificationInput,
} from '@paychat/shared';
import type { ProviderDefinition } from './types.js';

export class DisabledProvider implements PaymentProvider {
  readonly id: string;
  readonly displayName: string;
  readonly kind: ProviderKind;
  readonly countries: readonly string[];
  readonly capabilities: CapabilitySet = {
    initiatePayment: false, getPaymentStatus: false, verifyPayment: false, cancelPayment: false,
    refundPayment: false, getBalance: false, processWebhook: false, validateRecipient: false,
    getSupportedCurrencies: true, getSupportedPaymentMethods: true,
  };

  constructor(definition: ProviderDefinition, private readonly reason = 'provider is not available') {
    this.id = definition.id;
    this.displayName = definition.displayName;
    this.kind = definition.kind;
    this.countries = [definition.country];
  }

  supports(capability: Capability): boolean { return this.capabilities[capability] === true; }
  get currencies(): readonly string[] { return []; }

  private unavailable(): never {
    throw new ProviderError('provider_unavailable', `${this.displayName} ${this.reason}`, this.id);
  }

  // Async so callers always receive a rejected promise, never a synchronous throw.
  async initiatePayment(_req: InitiatePaymentRequest): Promise<ProviderInitiateResult> { this.unavailable(); }
  async getPaymentStatus(_ref: string): Promise<ProviderStatusResult> { this.unavailable(); }
  async verifyPayment(_ref: string): Promise<ProviderStatusResult> { this.unavailable(); }
  async cancelPayment(_ref: string): Promise<ProviderStatusResult> { this.unavailable(); }
  async refundPayment(_ref: string, _amount?: { minor: number; currency: string }): Promise<ProviderStatusResult> { this.unavailable(); }
  async getBalance(_account: ProviderAccountRef): Promise<ProviderBalance> { this.unavailable(); }
  async validateRecipient(_recipient: ProviderRecipient): Promise<{ valid: boolean; displayName?: string; reason?: string }> { this.unavailable(); }
  async processWebhook(_input: WebhookVerificationInput): Promise<PayChatWebhookEvent> { this.unavailable(); }
  getSupportedCurrencies(): readonly string[] { return []; }
  getSupportedPaymentMethods(): readonly ProviderKind[] { return [this.kind]; }
}
