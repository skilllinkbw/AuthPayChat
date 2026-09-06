import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { Errors } from '@paychat/shared';
import { authService } from '../security/auth.js';
import { audit } from '../security/audit.js';
import * as repo from '../repositories.js';
import { verifyPassword } from '../security/passwords.js';
import { issueAccessToken } from '../security/jwt.js';
import { config } from '../config.js';
import { rateLimit } from '../security/rateLimit.js';
import { requireAuth, STEP_UP_WINDOW_SECONDS } from '../security/context.js';

const registerSchema = z.object({
  phone: z.string().min(8).max(20),
  password: z.string().min(1),
  displayName: z.string().min(2).max(60),
  language: z.enum(['en', 'tn']).optional(),
  deviceLabel: z.string().max(80).optional(),
  platform: z.string().max(40).optional(),
});

const loginSchema = z.object({
  phone: z.string().min(8).max(20),
  password: z.string().min(1),
  deviceLabel: z.string().max(80).optional(),
  platform: z.string().max(40).optional(),
});

const refreshSchema = z.object({ refreshToken: z.string().min(10) });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const result = await authService.register({
      ...body,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    return reply.code(201).send(result);
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await authService.login({
      ...body,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    return reply.send(result);
  });

  app.post('/api/auth/refresh', async (request, reply) => {
    const body = refreshSchema.parse(request.body);
    return reply.send(authService.refresh(body.refreshToken, request.ip));
  });

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (request, reply) => {
    authService.logout(request.auth!.sessionId, request.auth!.userId);
    return reply.send({ ok: true });
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (request) => {
    const user = repo.users.findById(request.auth!.userId)!;
    return {
      id: user.id,
      displayName: user.display_name,
      phone: user.phone_e164,
      language: user.language,
      currency: user.default_currency,
      hideBalances: user.hide_balances === 1,
      isMerchant: user.is_merchant === 1,
    };
  });

  app.patch('/api/auth/me', { preHandler: requireAuth }, async (request) => {
    const body = z.object({
      language: z.enum(['en', 'tn']).optional(),
      hideBalances: z.boolean().optional(),
      defaultCurrency: z.string().length(3).optional(),
    }).parse(request.body);
    const user = repo.users.updatePreferences(request.auth!.userId, body);
    audit('auth.profile_updated', { type: 'user', id: user.id, metadata: body }, { actorUserId: user.id });
    return {
      id: user.id,
      displayName: user.display_name,
      phone: user.phone_e164,
      language: user.language,
      currency: user.default_currency,
      hideBalances: user.hide_balances === 1,
      isMerchant: user.is_merchant === 1,
    };
  });

  /** Fallback step-up for devices without biometrics: re-enter the password. */
  app.post('/api/auth/step-up', { preHandler: requireAuth }, async (request, reply) => {
    const limit = await rateLimit(`stepup:${request.auth!.userId}`, 5, 600);
    if (!limit.allowed) throw Errors.rateLimited();
    const body = z.object({ password: z.string().min(1) }).parse(request.body);
    const user = repo.users.findById(request.auth!.userId)!;
    if (!(await verifyPassword(body.password, user.password_hash))) {
      audit('auth.step_up', { type: 'user', id: user.id, metadata: { result: 'failed' } }, { actorUserId: user.id, ip: request.ip });
      throw Errors.invalidCredentials();
    }
    const { token, expiresAt } = issueAccessToken(user.id, request.auth!.sessionId, { stepUp: true });
    audit('auth.step_up', { type: 'user', id: user.id, metadata: { result: 'password' } }, { actorUserId: user.id, ip: request.ip });
    return reply.send({ accessToken: token, expiresAt, stepUpWindowSeconds: STEP_UP_WINDOW_SECONDS });
  });

  app.get('/api/auth/sessions', { preHandler: requireAuth }, async (request) => {
    return { sessions: repo.sessions.listForUser(request.auth!.userId) };
  });

  app.post('/api/auth/sessions/revoke', { preHandler: requireAuth }, async (request, reply) => {
    const body = z.object({ sessionId: z.string().min(1) }).parse(request.body);
    const sessions = repo.sessions.listForUser(request.auth!.userId) as Array<{ id: string }>;
    if (!sessions.some((s) => s.id === body.sessionId)) throw Errors.notFound('Session');
    repo.sessions.revoke(body.sessionId);
    audit('auth.session_revoked', { type: 'session', id: body.sessionId }, { actorUserId: request.auth!.userId });
    return reply.send({ ok: true });
  });

  app.get('/api/auth/devices', { preHandler: requireAuth }, async (request) => {
    return { devices: repo.devices.listForUser(request.auth!.userId) };
  });

  app.delete('/api/auth/devices/:id', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    repo.devices.revoke(request.auth!.userId, id);
    audit('auth.session_revoked', { type: 'device', id }, { actorUserId: request.auth!.userId });
    return reply.send({ ok: true });
  });

  app.get('/api/auth/config', async () => ({
    environment: config.env,
    currencies: ['BWP', 'ZAR', 'USD'],
    languages: ['en', 'tn'],
    biometricAvailable: true,
  }));
}

export type AuthedRequest = FastifyRequest & { auth?: { userId: string; sessionId: string } };
