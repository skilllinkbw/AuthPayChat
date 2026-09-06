/**
 * Minimal, dependency-free JWT (HS256) with strict claim validation.
 * Access tokens are short-lived; refresh tokens are opaque, hashed at rest and rotated.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  typ: 'access';
  iat: number;
  exp: number;
  iss: string;
  aud: string;
  jti: string;
  /** Set when the user passed a biometric / step-up challenge in this session. */
  aal?: number;
  /** Unix seconds of the last verified step-up (biometric or password). */
  su?: number;
}

interface StepUpClaims extends AccessTokenClaims {
  su?: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: object): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = createHmac('sha256', config.jwt.secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function issueAccessToken(userId: string, sessionId: string, options: { stepUp?: boolean } = {}): { token: string; expiresAt: number; claims: AccessTokenClaims } {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + (options.stepUp ? config.jwt.stepUpTtlSeconds : config.jwt.accessTtlSeconds);
  const claims: StepUpClaims = {
    sub: userId,
    sid: sessionId,
    typ: 'access',
    iat,
    exp,
    iss: config.jwt.issuer,
    aud: config.jwt.audience,
    jti: randomBytes(12).toString('base64url'),
    aal: 1,
    ...(options.stepUp ? { su: Math.floor(Date.now() / 1000) } : {}),
  };
  return { token: sign(claims), expiresAt: exp * 1000, claims };
}

export function verifyAccessToken(token: string): AccessTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts as [string, string, string];
  const expected = createHmac('sha256', config.jwt.secret).update(`${header}.${body}`).digest('base64url');
  if (!safeEqual(signature, expected)) return null;

  let claims: AccessTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AccessTokenClaims;
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (claims.typ !== 'access') return null;
  if (claims.iss !== config.jwt.issuer || claims.aud !== config.jwt.audience) return null;
  if (typeof claims.exp !== 'number' || claims.exp <= now) return null;   // expired token
  if (claims.iat > now + 60) return null;                                  // issued in the future
  if (!claims.sub || !claims.sid) return null;
  return claims;
}

/** Opaque refresh token: returned once to the client, only its hash is stored. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function sha256(value: string): string {
  return createHmac('sha256', config.jwt.secret).update(value).digest('hex');
}
