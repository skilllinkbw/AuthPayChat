/**
 * Provider definition model.
 *
 * A "provider" is DATA, not code. The core (orchestrator, routes, UI) never contains
 * a provider name, a bank list, or a mobile-money list. Providers are declared here and
 * come from, in increasing priority:
 *
 *   1. built-in defaults (providers/definitions.ts — a data file, may be replaced)
 *   2. PAYCHAT_PROVIDERS / PAYCHAT_PROVIDER_* environment configuration
 *   3. the payment_providers table (runtime, admin-managed, no deploy required)
 *
 * Adding, removing, enabling, disabling, configuring or replacing a provider therefore
 * never requires a change to PayChat core code.
 */

import type { CapabilitySet, ProviderKind } from '@paychat/shared';

export type TransportKind = 'rest' | 'sandbox' | 'disabled';

export interface RestTransportConfig {
  type: 'rest';
  /** Absolute base URL; may also be supplied by an env var (baseUrlEnv). */
  baseUrl?: string;
  baseUrlEnv?: string;
  paths: {
    token?: string;
    pay: string;
    status: string;
    cancel?: string;
    refund?: string;
    balance?: string;
  };
  /** Maps provider-side status strings onto the normalised PayChat status model. */
  statusMap?: Record<string, string>;
  /** Where the payment reference is found in the provider's callback payload. */
  webhook?: {
    signatureHeader?: string;
    eventIdHeader?: string;
    referenceField?: string;
    statusField?: string;
    amountField?: string;
  };
}

export interface ProviderAuthConfig {
  type: 'oauth2_client_credentials' | 'api_key' | 'hmac' | 'none';
  /** Env var names — the values themselves never live in code or in this file. */
  clientIdEnv?: string;
  clientSecretEnv?: string;
  apiKeyEnv?: string;
  headerName?: string;
  /** Credentials may also be stored encrypted in provider_credentials, keyed by these names. */
  credentialKeys?: { clientId?: string; clientSecret?: string; webhookSecret?: string };
  webhookSecretEnv?: string;
}

export interface ProviderDefinition {
  id: string;
  displayName: string;
  kind: ProviderKind;
  country: string;
  currencies: string[];
  enabled: boolean;
  transport: RestTransportConfig | { type: 'sandbox' } | { type: 'disabled'; reason?: string };
  capabilities?: CapabilitySet;
  auth?: ProviderAuthConfig;
  /** Natural-language names users may type or speak, e.g. "ka <provider name>". */
  aliases?: string[];
  limits?: { minMinor?: number; maxMinor?: number };
  metadata?: Record<string, unknown>;
}

export const DEFAULT_CAPABILITIES: CapabilitySet = {
  initiatePayment: false,
  getPaymentStatus: false,
  verifyPayment: false,
  cancelPayment: false,
  refundPayment: false,
  getBalance: false,
  processWebhook: false,
  validateRecipient: false,
  getSupportedCurrencies: true,
  getSupportedPaymentMethods: true,
};

export function capabilitiesFor(definition: ProviderDefinition): CapabilitySet {
  if (definition.transport.type === 'sandbox') {
    return {
      initiatePayment: true, getPaymentStatus: true, verifyPayment: true, cancelPayment: true,
      refundPayment: true, getBalance: true, processWebhook: true, validateRecipient: true,
      getSupportedCurrencies: true, getSupportedPaymentMethods: true,
    };
  }
  if (definition.transport.type !== 'rest') return { ...DEFAULT_CAPABILITIES };

  const paths = definition.transport.paths;
  return {
    initiatePayment: true,
    getPaymentStatus: Boolean(paths.status),
    verifyPayment: Boolean(paths.status),
    cancelPayment: Boolean(paths.cancel),
    refundPayment: Boolean(paths.refund),
    getBalance: Boolean(paths.balance),
    processWebhook: true,
    validateRecipient: true,
    getSupportedCurrencies: true,
    getSupportedPaymentMethods: true,
    ...(definition.capabilities ?? {}),
  };
}
