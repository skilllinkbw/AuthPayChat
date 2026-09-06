/**
 * Structured audit logging.
 * Never logs: passwords, tokens, secrets, raw biometric data, full card/MSISDN detail.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { redactSecrets } from './credentials.js';

export type AuditAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'
  | 'auth.refresh'
  | 'auth.refresh_reuse_detected'
  | 'auth.session_revoked'
  | 'auth.step_up'
  | 'auth.biometric_enrolled'
  | 'auth.biometric_verified'
  | 'auth.biometric_failed'
  | 'auth.profile_updated'
  | 'auth.session_active'
  | 'account.connected'
  | 'account.disconnected'
  | 'account.balance_viewed'
  | 'payment.intent_created'
  | 'payment.authorized'
  | 'payment.initiated'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'payment.cancelled'
  | 'payment.duplicate_blocked'
  | 'payment.reconciled'
  | 'payment.refunded'
  | 'webhook.received'
  | 'webhook.rejected'
  | 'webhook.replay_blocked'
  | 'request.created'
  | 'request.paid'
  | 'request.declined'
  | 'qr.created'
  | 'qr.scanned'
  | 'qr.rejected'
  | 'qr.paid'
  | 'merchant.onboarded'
  | 'merchant.qr_created'
  | 'merchant.refunded'
  | 'security.authorization_denied'
  | 'security.rate_limited';

const REDACT_KEYS = new Set([
  'password', 'token', 'refreshToken', 'accessToken', 'secret', 'authorization',
  'biometric', 'assertion', 'clientDataJSON', 'attestationObject', 'signature',
]);

export function redact(metadata: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (REDACT_KEYS.has(key)) {
      out[key] = '[redacted]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redact(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export interface AuditContext {
  actorUserId?: string | null;
  actorType?: 'user' | 'system' | 'provider';
  ip?: string | null;
  userAgent?: string | null;
}

export function audit(
  action: AuditAction,
  target: { type?: string; id?: string; metadata?: Record<string, unknown> } = {},
  context: AuditContext = {},
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_logs (id, actor_user_id, actor_type, action, target_type, target_id, ip, user_agent, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    context.actorUserId ?? null,
    context.actorType ?? 'user',
    action,
    target.type ?? null,
    target.id ?? null,
    context.ip ?? null,
    context.userAgent ?? null,
    JSON.stringify(redact(target.metadata ?? {})),
    new Date().toISOString(),
  );
}

/**
 * Console structured log for ops. PII-safe by construction (we only pass ids and states),
 * and secret-safe: every line passes through `redactSecrets`, which strips known credential
 * values and anything that looks like a key/token assignment.
 */
export function logEvent(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}): void {
  const line = redactSecrets(JSON.stringify({ ts: new Date().toISOString(), level, event, ...redact(fields) }));
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
