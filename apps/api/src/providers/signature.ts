/**
 * Webhook signature scheme (shared by every provider adapter that supports signed callbacks).
 *
 *   X-PayChat-Event-Id: <provider event id>            (used for replay protection)
 *   X-PayChat-Signature: t=<unix seconds>,v1=<hex hmac-sha256("<t>.<rawBody>", secret)>
 *
 * Verification ALWAYS checks: presence, timestamp freshness, HMAC equality in constant time.
 * A "status: successful" field in the body is never trusted on its own.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { WebhookVerificationError } from '@paychat/shared';

export function signWebhook(rawBody: string | Buffer, secret: string, timestamp = Math.floor(Date.now() / 1000)): { header: string; timestamp: number } {
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return { header: `t=${timestamp},v1=${mac}`, timestamp };
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(raw) ? raw[0] : raw;
}

export function verifyWebhookSignature(
  rawBody: string | Buffer,
  headers: Record<string, string | string[] | undefined>,
  secret: string,
  options: { signatureHeader?: string; eventIdHeader?: string } = {},
  toleranceSeconds = config.webhooks.toleranceSeconds,
): { eventId: string } {
  const signatureHeader = headerValue(headers, options.signatureHeader ?? 'x-paychat-signature');
  const eventId = headerValue(headers, options.eventIdHeader ?? 'x-paychat-event-id');
  if (!signatureHeader) throw new WebhookVerificationError('missing signature header');

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => {
      const [k, ...rest] = p.trim().split('=');
      return [k ?? '', rest.join('=')] as const;
    }),
  );
  const timestamp = Number(parts.t);
  const provided = parts.v1;
  if (!Number.isFinite(timestamp) || !provided) throw new WebhookVerificationError('malformed signature header');

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    throw new WebhookVerificationError('signature timestamp outside tolerance (replay protection)');
  }

  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new WebhookVerificationError('signature mismatch');
  }
  if (!eventId) throw new WebhookVerificationError('missing event id');
  return { eventId };
}
