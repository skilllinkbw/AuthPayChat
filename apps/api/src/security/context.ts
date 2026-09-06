/**
 * Request-level security context: bearer authentication and step-up (biometric) enforcement.
 * Nothing in the request body is trusted for identity, amount, recipient or balance.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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
