/**
 * Configuration. Secrets are never defaulted and never shipped to the client.
 * In production the process refuses to start without real secrets.
 */

import { createHash } from 'node:crypto';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

const envName = optional('PAYCHAT_ENV', 'development') as 'development' | 'test' | 'production';
const isProduction = envName === 'production';

export const config = {
  env: envName,
  isProduction,
  isTest: envName === 'test',
  port: Number(optional('PORT', '4000')),
  databasePath: optional('DATABASE_PATH', isProduction ? required('DATABASE_PATH') : '.data/paychat.db'),
  webhookBaseUrl: optional('PAYCHAT_WEBHOOK_BASE_URL', 'http://localhost:4000/api/webhooks'),

  jwt: {
    // In production this MUST come from a secret manager, not from a default.
    secret: isProduction ? required('JWT_SECRET') : optional('JWT_SECRET', 'dev-only-insecure-secret-change-me'),
    issuer: 'paychat',
    audience: 'paychat-app',
    accessTtlSeconds: Number(optional('ACCESS_TOKEN_TTL', '900')),
    /** Step-up tokens (biometric/password confirmation) are deliberately short-lived. */
    stepUpTtlSeconds: Number(optional('STEP_UP_TOKEN_TTL', '300')),
    refreshTtlSeconds: Number(optional('REFRESH_TOKEN_TTL', '1209600')),
  },

  /** 32-byte key (base64) used to encrypt provider tokens at rest. */
  tokenEncryptionKey: (() => {
    const raw = isProduction ? required('TOKEN_ENCRYPTION_KEY') : optional('TOKEN_ENCRYPTION_KEY', 'dev-only-key-' + '0'.repeat(19));
    const key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      // Derive a stable 32-byte key from the passphrase instead of silently using a short one.
      return createHash('sha256').update(raw).digest();
    }
    return key;
  })(),

  risk: {
    stepUpAmountMinor: Number(optional('RISK_STEP_UP_AMOUNT_MINOR', '50000')), // P500.00
    velocityWindowMinutes: Number(optional('RISK_VELOCITY_WINDOW_MINUTES', '60')),
    velocityMaxPayments: Number(optional('RISK_VELOCITY_MAX', '5')),
    newDeviceHours: Number(optional('RISK_NEW_DEVICE_HOURS', '24')),
  },

  limits: {
    minPaymentMinor: 1,
    maxPaymentMinor: Number(optional('MAX_PAYMENT_MINOR', '50000000')), // P500,000.00
  },

  webhooks: {
    /** Reject callbacks whose timestamp is older than this (replay protection). */
    toleranceSeconds: Number(optional('WEBHOOK_TOLERANCE_SECONDS', '300')),
  },

  reconciliation: {
    /** A non-terminal payment older than this is re-checked against the provider. */
    staleAfterSeconds: Number(optional('RECONCILE_AFTER_SECONDS', '60')),
    maxAttempts: Number(optional('RECONCILE_MAX_ATTEMPTS', '8')),
  },

  security: {
    /** Set to 1 to skip the standard security response headers (never do this in production). */
    disableHeaders: optional('PAYCHAT_DISABLE_SECURITY_HEADERS', '') === '1',
    /** HSTS is only meaningful over HTTPS; enabled automatically in production. */
    hstsMaxAgeSeconds: Number(optional('HSTS_MAX_AGE_SECONDS', '31536000')),
  },

  webauthn: {
    rpName: optional('WEBAUTHN_RP_NAME', 'PayChat'),
    rpId: optional('WEBAUTHN_RP_ID', 'localhost'),
    origin: optional('WEBAUTHN_ORIGIN', 'http://localhost:5173'),
  },
} as const;

export type Config = typeof config;
