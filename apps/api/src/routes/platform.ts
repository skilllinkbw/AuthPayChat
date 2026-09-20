import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
  type VerifiedAuthenticationResponse, type VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import { config } from '../config.js';
import { Errors } from '@paychat/shared';
import { requireAuth, requireInternalJob } from '../security/context.js';
import * as repo from '../repositories.js';
import { audit, logEvent } from '../security/audit.js';
import { issueAccessToken } from '../security/jwt.js';
import { PaymentOrchestrator } from '../payments/orchestrator.js';
import { rateLimit } from '../security/rateLimit.js';

const rpName = config.webauthn.rpName;
const rpID = config.webauthn.rpId;
const origin = config.webauthn.origin;

function toBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

export function platformRoutes(app: FastifyInstance, orchestrator: PaymentOrchestrator): void {
  app.get('/api/health', async () => ({
    status: 'ok',
    environment: config.env,
    time: new Date().toISOString(),
  }));

  /** WebAuthn registration — the platform authenticator (fingerprint / face) is the only thing that can use this. */
  app.post('/api/webauthn/register/options', { preHandler: requireAuth }, async (request) => {
    const user = repo.users.findById(request.auth!.userId)!;
    const existing = repo.webauthnCredentials.listForUser(user.id);
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new TextEncoder().encode(user.id),
      userName: user.phone_e164,
      userDisplayName: user.display_name,
      attestationType: 'none',
      excludeCredentials: existing.map((c) => ({ id: String(c.credential_id), type: 'public-key' as const })),
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',      // fingerprint / face, not just presence
      },
    });
    await app.storeChallenge(user.id, options.challenge);
    return options;
  });

  app.post('/api/webauthn/register/verify', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.auth!.userId;
    const challenge = await app.takeChallenge(userId);
    if (!challenge) throw Errors.validation({ challenge: 'Start the biometric setup again' });

    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response: request.body as never,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch (error) {
      audit('auth.biometric_failed', { type: 'webauthn', metadata: { stage: 'register', reason: String(error) } }, { actorUserId: userId, ip: request.ip });
      throw Errors.validation({ biometric: 'We could not verify your biometric setup.' });
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw Errors.validation({ biometric: 'We could not verify your biometric setup.' });
    }
    const info = verification.registrationInfo;
    const credential = info.credential;

    repo.webauthnCredentials.add({
      userId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports?.join(',') ?? null,
      deviceLabel: (request.body as { deviceLabel?: string })?.deviceLabel ?? 'This device',
    });
    audit('auth.biometric_enrolled', { type: 'webauthn', metadata: { credentialId: credential.id } }, { actorUserId: userId, ip: request.ip });
    return reply.send({ ok: true });
  });

  /** Step-up: issues a short-lived access token carrying a verified-biometric claim. */
  app.post('/api/webauthn/authenticate/options', { preHandler: requireAuth }, async (request) => {
    const credentials = repo.webauthnCredentials.listForUser(request.auth!.userId);
    if (!credentials.length) throw Errors.validation({ biometric: 'No biometric is set up on this account yet.' });
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: credentials.map((c) => ({ id: String(c.credential_id), type: 'public-key' as const, transports: (String(c.transports ?? '').split(',').filter(Boolean) as AuthenticatorTransport[]) })),
      userVerification: 'required',
    });
    await app.storeChallenge(request.auth!.userId, options.challenge);
    return options;
  });

  app.post('/api/webauthn/authenticate/verify', { preHandler: requireAuth }, async (request, reply) => {
    const userId = request.auth!.userId;
    const limit = await rateLimit(`webauthn:${userId}`, 10, 300);
    if (!limit.allowed) throw Errors.rateLimited();

    const challenge = await app.takeChallenge(userId);
    if (!challenge) throw Errors.validation({ challenge: 'Please try confirming again' });

    const body = request.body as { id?: string; rawId?: string };
    const credentialId = body?.id ?? '';
    const credential = repo.webauthnCredentials.findForUser(userId, credentialId) as (NonNullable<ReturnType<typeof repo.webauthnCredentials.findForUser>> & { transports?: string | null }) | undefined;
    if (!credential) {
      audit('auth.biometric_failed', { type: 'webauthn', metadata: { reason: 'unknown_credential' } }, { actorUserId: userId, ip: request.ip });
      throw Errors.validation({ biometric: 'We could not verify your identity.' });
    }

    let verification: VerifiedAuthenticationResponse;
    try {
      verification = await verifyAuthenticationResponse({
        response: request.body as never,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        credential: {
          id: credentialId,
          publicKey: new Uint8Array(Buffer.from(credential.public_key, 'base64url')),
          counter: credential.counter,
          transports: (String(credential.transports ?? '').split(',').filter(Boolean) as AuthenticatorTransport[]),
        },
      });
    } catch (error) {
      audit('auth.biometric_failed', { type: 'webauthn', metadata: { reason: String(error) } }, { actorUserId: userId, ip: request.ip });
      throw Errors.validation({ biometric: 'We could not verify your identity. No payment was sent.' });
    }

    if (!verification.verified) {
      throw Errors.validation({ biometric: 'We could not verify your identity. No payment was sent.' });
    }
    repo.webauthnCredentials.updateCounter(credential.id, verification.authenticationInfo.newCounter);

    const { token, expiresAt } = issueAccessToken(userId, request.auth!.sessionId, { stepUp: true });
    audit('auth.biometric_verified', { type: 'webauthn', metadata: { credentialId } }, { actorUserId: userId, ip: request.ip });
    return reply.send({ verified: true, accessToken: token, expiresAt });
  });

  app.get('/api/webauthn/credentials', { preHandler: requireAuth }, async (request) => {
    return { credentials: repo.webauthnCredentials.listForUser(request.auth!.userId).map((c) => ({ id: c.credential_id, label: c.device_label, createdAt: c.created_at, lastUsedAt: c.last_used_at })) };
  });

  app.delete('/api/webauthn/credentials/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    repo.webauthnCredentials.remove(request.auth!.userId, id);
    return reply.send({ ok: true });
  });

  /**
   * Provider callbacks. The orchestrator verifies the signature, rejects replays and
   * cross-checks the amount before any status change.
   */
  app.post('/api/webhooks/:providerId', {
    config: { rawBody: true },
  }, async (request, reply) => {
    const { providerId } = request.params as { providerId: string };
    const rawBody = typeof request.rawBody === 'string' ? request.rawBody : request.body ? JSON.stringify(request.body) : '';
    const result = await orchestrator.handleWebhook(providerId, rawBody, request.headers as Record<string, string | string[] | undefined>);
    if (!result.ok) {
      // 400 with a generic message: never leak provider internals, never confirm anything.
      logEvent('warn', 'webhook.rejected_response', { providerId, reason: result.reason });
      return reply.code(400).send({ error: { code: 'WEBHOOK_REJECTED', message: 'Callback rejected.' } });
    }
    return reply.send({ received: true, status: result.status });
  });

  /** Manual reconciliation trigger (also runs on an interval). Internal token required. */
  app.post('/api/internal/reconcile', { preHandler: requireInternalJob }, async () => {
    const result = await orchestrator.reconcile();
    return result;
  });

  app.get('/api/internal/outbox', { preHandler: requireInternalJob }, async () => {
    return { pending: repo.outbox.pending().map((o) => ({ id: o.id, type: o.event_type })) };
  });
}

export type AuthenticatorTransport = 'internal' | 'hybrid' | 'usb' | 'ble' | 'nfc';
export { toBase64url };
export const webhookSchema = z.object({ providerId: z.string() });
