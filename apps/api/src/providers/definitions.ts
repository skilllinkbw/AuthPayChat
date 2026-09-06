/**
 * Built-in provider DEFAULTS. This file is DATA ONLY — it contains no business logic and
 * no provider-specific code paths. Delete or replace it and PayChat still boots; providers
 * then come purely from PAYCHAT_PROVIDERS (env) and the payment_providers table.
 *
 * A provider is only usable when it is enabled AND its credentials exist. Shipping a
 * definition here is not a claim that we are integrated with that provider.
 */

import type { ProviderDefinition } from './types.js';

const rest = (
  id: string,
  displayName: string,
  kind: ProviderDefinition['kind'],
  prefix: string,
  paths: { token?: string; pay: string; status: string; cancel?: string; refund?: string; balance?: string },
  statusMap: Record<string, string>,
  aliases: string[],
  currency = 'BWP',
): ProviderDefinition => ({
  id,
  displayName,
  kind,
  country: 'BW',
  currencies: [currency],
  enabled: false, // enabled automatically once the credentials below are present
  transport: { type: 'rest', baseUrlEnv: `${prefix}_BASE_URL`, paths, statusMap },
  auth: {
    type: 'oauth2_client_credentials',
    clientIdEnv: `${prefix}_CLIENT_ID`,
    clientSecretEnv: `${prefix}_CLIENT_SECRET`,
    webhookSecretEnv: `${prefix}_WEBHOOK_SECRET`,
    credentialKeys: { clientId: 'client_id', clientSecret: 'client_secret', webhookSecret: 'webhook_secret' },
  },
  aliases,
});

export const BUILT_IN_PROVIDERS: ProviderDefinition[] = [
  // ── Mobile money ────────────────────────────────────────────────────────────
  rest('orange_money_bw', 'Orange Money', 'mobile_money', 'ORANGE_MONEY',
    { token: '/oauth/token', pay: '/v1/payments', status: '/v1/payments/{ref}', cancel: '/v1/payments/{ref}/cancel', refund: '/v1/payments/{ref}/refunds', balance: '/v1/accounts/{ref}/balance' },
    { PENDING: 'PENDING', INITIATED: 'PENDING', ACCEPTED: 'PROCESSING', PROCESSING: 'PROCESSING', SUCCESSFUL: 'SUCCESSFUL', SUCCESS: 'SUCCESSFUL', COMPLETED: 'SUCCESSFUL', FAILED: 'FAILED', REJECTED: 'FAILED', DECLINED: 'FAILED', CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED', REVERSED: 'REVERSED', REFUNDED: 'REFUNDED' },
    ['orange money', 'orange', 'omascom'], 'BWP'),

  rest('myzaka_bw', 'MyZaka', 'mobile_money', 'MYZAKA',
    { token: '/oauth/token', pay: '/v1/transfers', status: '/v1/transfers/{ref}', cancel: '/v1/transfers/{ref}/cancel', refund: '/v1/transfers/{ref}/refund', balance: '/v1/wallets/{ref}' },
    { NEW: 'PENDING', PENDING: 'PENDING', IN_PROGRESS: 'PROCESSING', SETTLED: 'SUCCESSFUL', SUCCESS: 'SUCCESSFUL', FAILED: 'FAILED', CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED', REFUNDED: 'REFUNDED' },
    ['myzaka', 'my zaka', 'zaka'], 'BWP'),

  rest('smega_bw', 'Smega', 'mobile_money', 'SMEGA',
    { token: '/auth/token', pay: '/api/v1/payments', status: '/api/v1/payments/{ref}', cancel: '/api/v1/payments/{ref}/cancel', refund: '/api/v1/payments/{ref}/refund', balance: '/api/v1/accounts/{ref}/balance' },
    { QUEUED: 'PENDING', PROCESSING: 'PROCESSING', PAID: 'SUCCESSFUL', SUCCESS: 'SUCCESSFUL', FAILED: 'FAILED', CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED', REVERSED: 'REVERSED', REFUNDED: 'REFUNDED' },
    ['smega'], 'BWP'),

  // ── Fintech / aggregator rail (external integration, replaceable) ───────────
  rest('authepay_bw', 'AuthePay', 'other', 'AUTHEPAY',
    { token: '/oauth/token', pay: '/v1/payments', status: '/v1/payments/{ref}', cancel: '/v1/payments/{ref}/cancel', refund: '/v1/payments/{ref}/refund', balance: '/v1/accounts/{ref}/balance' },
    { CREATED: 'PENDING', PENDING: 'PENDING', PROCESSING: 'PROCESSING', AUTHORIZED: 'PROCESSING', COMPLETED: 'SUCCESSFUL', SUCCESSFUL: 'SUCCESSFUL', FAILED: 'FAILED', DECLINED: 'FAILED', CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED', REVERSED: 'REVERSED', REFUNDED: 'REFUNDED' },
    ['authepay', 'auth pay', 'authe pay'], 'BWP'),

  // ── Banks: one definition per bank INSTANCE, all identical to the core engine ─
  rest('bank_a_bw', 'Bank A', 'bank', 'BANK_A',
    { token: '/oauth2/token', pay: '/v1/payments', status: '/v1/payments/{ref}', cancel: '/v1/payments/{ref}/cancel', refund: '/v1/payments/{ref}/refund', balance: '/v1/accounts/{ref}/balance' },
    { PENDING: 'PENDING', ACCEPTED: 'PROCESSING', SETTLED: 'SUCCESSFUL', SUCCESSFUL: 'SUCCESSFUL', FAILED: 'FAILED', REJECTED: 'FAILED', CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED', REVERSED: 'REVERSED', REFUNDED: 'REFUNDED' },
    ['bank a', 'banka'], 'BWP'),

  rest('bank_b_bw', 'Bank B', 'bank', 'BANK_B',
    { token: '/oauth2/token', pay: '/v1/payments', status: '/v1/payments/{ref}', cancel: '/v1/payments/{ref}/cancel', refund: '/v1/payments/{ref}/refund', balance: '/v1/accounts/{ref}/balance' },
    { PENDING: 'PENDING', ACCEPTED: 'PROCESSING', SETTLED: 'SUCCESSFUL', SUCCESSFUL: 'SUCCESSFUL', FAILED: 'FAILED', REJECTED: 'FAILED', CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED', REVERSED: 'REVERSED', REFUNDED: 'REFUNDED' },
    ['bank b', 'bankb'], 'BWP'),

  rest('bank_c_bw', 'Bank C', 'bank', 'BANK_C',
    { token: '/oauth2/token', pay: '/v1/payments', status: '/v1/payments/{ref}', cancel: '/v1/payments/{ref}/cancel', refund: '/v1/payments/{ref}/refund', balance: '/v1/accounts/{ref}/balance' },
    { PENDING: 'PENDING', ACCEPTED: 'PROCESSING', SETTLED: 'SUCCESSFUL', SUCCESSFUL: 'SUCCESSFUL', FAILED: 'FAILED', REJECTED: 'FAILED', CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED', REVERSED: 'REVERSED', REFUNDED: 'REFUNDED' },
    ['bank c', 'bankc'], 'BWP'),

  // ── Generic bank rail (any bank via configuration) ──────────────────────────
  rest('bank_generic_bw', 'Bank Account', 'bank', 'BANK_API',
    { token: '/oauth2/token', pay: '/v1/payments', status: '/v1/payments/{ref}', cancel: '/v1/payments/{ref}/cancel', refund: '/v1/payments/{ref}/refund', balance: '/v1/accounts/{ref}/balance' },
    { PENDING: 'PENDING', ACCEPTED: 'PROCESSING', SETTLED: 'SUCCESSFUL', SUCCESSFUL: 'SUCCESSFUL', FAILED: 'FAILED', REJECTED: 'FAILED', CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED', REVERSED: 'REVERSED', REFUNDED: 'REFUNDED' },
    ['bank', 'bank account', 'account', 'banka'], 'BWP'),

  // ── Cards ──────────────────────────────────────────────────────────────────
  rest('card_generic_bw', 'Card', 'card', 'CARD_API',
    { token: '/oauth/token', pay: '/v1/charges', status: '/v1/charges/{ref}', cancel: '/v1/charges/{ref}/void', refund: '/v1/charges/{ref}/refund', balance: '/v1/balance/{ref}' },
    { AUTHORIZED: 'PENDING', CAPTURED: 'SUCCESSFUL', SUCCEEDED: 'SUCCESSFUL', FAILED: 'FAILED', DECLINED: 'FAILED', VOIDED: 'CANCELLED', REFUNDED: 'REFUNDED', EXPIRED: 'EXPIRED' },
    ['card', 'debit card', 'credit card', 'karete'], 'BWP'),

  // ── Internal QR / payment-link rail (no external provider required) ─────────
  {
    id: 'paychat_qr',
    displayName: 'PayChat QR',
    kind: 'qr',
    country: 'BW',
    currencies: ['BWP'],
    enabled: true,
    transport: { type: 'disabled', reason: 'QR rail settles through the payer’s selected account' },
    aliases: ['qr', 'qr code', 'scan'],
    metadata: { internal: true },
  },
];

/** Development/test only — never enabled in production (SandboxProvider enforces this too). */
export const SANDBOX_PROVIDER: ProviderDefinition = {
  id: 'sandbox',
  displayName: 'Sandbox Rail (test only)',
  kind: 'mobile_money',
  country: 'BW',
  currencies: ['BWP'],
  enabled: true,
  transport: { type: 'sandbox' },
  aliases: ['sandbox', 'test rail'],
  metadata: { simulated: true },
};
