/**
 * Request-level security context: bearer authentication and step-up (biometric) enforcement.
 * Nothing in the request body is trusted for identity, amount, recipient or balance.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Errors } from '@paychat/shared';
import { authService } from './auth.js';
import { audit } from './audit.js';
import type { AccessTokenClaims } from './jwt.js';

export const STEP_UP_WINDOW_SECONDS = 300;

declare module 'fastify' {
  interface FastifyRequest {
    auth?: { userId: string; sessionId: string; claims: AccessTokenClaims };
    /** Exact bytes of the request body — required for webhook signature verification. */
    rawBody?: string;
  }
}

export async function requireAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const context = authService.verify(request.headers.authorization);
  if (!context) throw Errors.unauthenticated();
  request.auth = { userId: context.userId, sessionId: context.sessionId, claims: context.claims };
}

/** True when the caller proved possession of a platform biometric (or password) recently. */
export function hasRecentStepUp(claims: AccessTokenClaims | undefined, windowSeconds = STEP_UP_WINDOW_SECONDS): boolean {
  const su = claims?.su;
  if (typeof su !== 'number') return false;
  return Math.floor(Date.now() / 1000) - su <= windowSeconds && su <= Math.floor(Date.now() / 1000);
}

export async function requireStepUp(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (!request.auth) throw Errors.unauthenticated();
  if (!hasRecentStepUp(request.auth.claims)) {
    audit('security.authorization_denied', { type: 'step_up', metadata: { path: request.url } }, { actorUserId: request.auth.userId, ip: request.ip });
    throw Errors.stepUpRequired('step-up token missing or expired', 'Please confirm it is you to continue.');
  }
}

export function registerAuthContext(app: FastifyInstance): void {
  app.decorateRequest('auth', undefined);
}

/**
 * Internal job authorisation (reconciliation / outbox inspection).
 *
 * The token is compared with a constant-time comparison over fixed-length
 * digests. A plain `!==` would leak the secret prefix through response timing on
 * a hot endpoint, which is enough to recover a token byte by byte. Digesting
 * both sides first also removes the length as an oracle.
 *
 * Denials are audit-logged without ever recording the presented value.
 */
export function verifyInternalJobToken(presented: string | string[] | undefined): boolean {
  const expected = process.env.INTERNAL_JOB_TOKEN;
  if (!expected || typeof presented !== 'string' || presented.length === 0) return false;
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  const presentedDigest = createHash('sha256').update(presented, 'utf8').digest();
  return timingSafeEqual(expectedDigest, presentedDigest);
}

export async function requireInternalJob(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (verifyInternalJobToken(request.headers['x-paychat-internal'])) return;
  audit('security.authorization_denied', { type: 'internal_job', metadata: { path: request.url } }, { ip: request.ip });
  await reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Unauthorized.' } });
}
