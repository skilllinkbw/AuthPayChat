/**
 * QR payment codes (brief §16).
 *
 * Rules:
 *  - A QR code is DATA FROM A STRANGER. Everything in it is treated as untrusted input:
 *    the payload is only trusted after the HMAC signature verifies, and even then the
 *    amount, currency and recipient are read from the SIGNED payload, never from the
 *    request body.
 *  - A scan never moves money. It resolves to a preview that the user must confirm
 *    (with normal authentication and step-up rules) before any payment is created.
 *  - Codes expire, are single-use for fixed-amount links, and carry no secrets.
 *  - A QR image is generated server-side as a PNG data URL so no client-side QR library
 *    (and therefore no CDN) is required.
 */

import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { config } from '../config.js';
import QRCode from 'qrcode';

export const QR_SCHEME = 'paychat://pay/';
export const DEFAULT_QR_TTL_SECONDS = 15 * 60;

export interface QrPayload {
  /** v1 = signed payment link / merchant code. */
  v: 1;
  kind: 'payment_link' | 'merchant';
  jti: string;
  creatorUserId: string;
  /** Fixed amount, or null for a merchant code where the payer enters the amount. */
  amountMinor: number | null;
  currency: string;
  description?: string | null;
  /** Present for merchant codes: the business receiving the money. */
  merchantId?: string | null;
  exp: number;
}

function sign(body: string): string {
  return createHmac('sha256', config.jwt.secret).update(body).digest('base64url');
}

export function createQrToken(payload: Omit<QrPayload, 'v' | 'jti' | 'exp'> & { jti?: string; ttlSeconds?: number }): { token: string; jti: string; expiresAt: string } {
  const { ttlSeconds, jti: supplied, ...rest } = payload;
  const jti = supplied ?? `qr_${randomUUID()}`;
  const exp = Math.floor(Date.now() / 1000) + (ttlSeconds ?? DEFAULT_QR_TTL_SECONDS);
  const full = { v: 1 as const, jti, ...rest, exp };
  const body = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  return { token: `${body}.${sign(body)}`, jti, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Verifies signature + expiry. Returns null for anything untrusted. */
export function verifyQrToken(token: string): QrPayload | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = sign(body);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(mac, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<QrPayload> & Record<string, unknown>;
    // Accept v1 codes, and legacy payment-link tokens that predate the `v` field.
    const payload = (parsed.v === undefined
      ? { ...parsed, v: 1, kind: 'payment_link', amountMinor: parsed.amountMinor ?? null }
      : parsed) as QrPayload;
    if (payload.v !== 1) return null;
    if (!Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return null;   // expired
    if (!payload.creatorUserId || typeof payload.creatorUserId !== 'string') return null;
    if (payload.amountMinor !== null && typeof payload.amountMinor !== 'number') return null;
    return payload;
  } catch {
    return null;
  }
}

/** Accepts a raw token, a paychat:// URL, or an https://…/pay/<token> link. */
export function extractQrToken(scanned: string): string | null {
  const value = scanned.trim();
  if (!value || value.length > 4096) return null;
  if (value.startsWith(QR_SCHEME)) return value.slice(QR_SCHEME.length) || null;
  const match = /(?:^|\/pay\/)([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(value);
  return match?.[1] ?? null;
}

/** Renders the scannable image. Deterministic for the same content — tests assert on this. */
export async function renderQrPng(content: string): Promise<string> {
  const dataUrl = await QRCode.toDataURL(content, {
    errorCorrectionLevel: 'M',
    type: 'image/png',
    margin: 2,
    scale: 6,
  });
  return dataUrl;
}
