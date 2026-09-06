import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { newApp, registerUser, forgeAccessToken } from './helpers.js';
import * as repo from '../apps/api/src/repositories.js';
import { config } from '../apps/api/src/config.js';
import { resetRateLimits } from '../apps/api/src/security/rateLimit.js';

describe('Authentication', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    ({ app } = await newApp());
  });

  it('registers a user and returns tokens bound to a session', async () => {
    const user = await registerUser(app, { phone: '+26771000001', name: 'Motakase' });
    expect(user.userId).toMatch(/^usr_/);
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: user.auth });
    expect(me.statusCode).toBe(200);
    expect(me.json<{ displayName: string }>().displayName).toBe('Motakase');
  });

  it('rejects weak passwords', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { phone: '+26771000002', password: 'short', displayName: 'Test' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('VALIDATION_ERROR');
  });

  it('logs in with the right password and rejects the wrong one with the same message', async () => {
    await registerUser(app, { phone: '+26771000003' });
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { phone: '+26771000003', password: 'CorrectHorse99!' } });
    expect(ok.statusCode).toBe(200);

    const wrongPassword = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { phone: '+26771000003', password: 'wrong-password' } });
    const unknownUser = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { phone: '+26779999999', password: 'wrong-password' } });
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    // No account enumeration: identical error payloads.
    expect(wrongPassword.json()).toEqual(unknownUser.json());
  });

  it('rejects an expired access token', async () => {
    const user = await registerUser(app, { phone: '+26771000004' });
    const expired = forgeAccessToken({
      sub: user.userId, sid: 'ses_any', typ: 'access',
      iat: Math.floor(Date.now() / 1000) - 7200, exp: Math.floor(Date.now() / 1000) - 3600,
      iss: config.jwt.issuer, aud: config.jwt.audience, jti: 'x',
    });
    const response = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${expired}` } });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const user = await registerUser(app, { phone: '+26771000005' });
    const forged = forgeAccessToken({
      sub: user.userId, sid: 'ses_any', typ: 'access',
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600,
      iss: config.jwt.issuer, aud: config.jwt.audience, jti: 'x',
    }).slice(0, -3) + 'aaa';
    const response = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${forged}` } });
    expect(response.statusCode).toBe(401);
  });

  it('rotates refresh tokens and refuses reuse of the old token', async () => {
    const user = await registerUser(app, { phone: '+26771000006' });
    const first = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: user.refreshToken } });
    expect(first.statusCode).toBe(200);
    const rotated = first.json<{ refreshToken: string; accessToken: string }>();
    expect(rotated.refreshToken).not.toBe(user.refreshToken);

    // Replaying the previous refresh token must fail (rotation + single use).
    const replay = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: user.refreshToken } });
    expect(replay.statusCode).toBe(401);

    // The stolen-token case revokes every session for that user.
    const afterReuse = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${rotated.accessToken}` } });
    expect(afterReuse.statusCode).toBe(401);
  });

  it('invalidates the session on logout', async () => {
    const user = await registerUser(app, { phone: '+26771000007' });
    await app.inject({ method: 'POST', url: '/api/auth/logout', headers: user.auth });
    const after = await app.inject({ method: 'GET', url: '/api/auth/me', headers: user.auth });
    expect(after.statusCode).toBe(401);
  });

  it('lists and revokes sessions, and only ever shows the owner’s sessions', async () => {
    const a = await registerUser(app, { phone: '+26771000008' });
    const b = await registerUser(app, { phone: '+26771000009' });
    const aSessions = await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: a.auth });
    const sessions = aSessions.json<{ sessions: Array<{ id: string }> }>().sessions;
    expect(sessions.length).toBe(1);

    const revoke = await app.inject({ method: 'POST', url: '/api/auth/sessions/revoke', headers: b.auth, payload: { sessionId: sessions[0]!.id } });
    expect(revoke.statusCode).toBe(404);   // B cannot revoke A's session
  });

  it('rate-limits repeated login attempts', async () => {
    resetRateLimits();
    await registerUser(app, { phone: '+26771000010' });
    let lastStatus = 0;
    for (let i = 0; i < 12; i++) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { phone: '+26771000010', password: 'nope-nope-nope' } });
      lastStatus = response.statusCode;
    }
    expect(lastStatus).toBe(429);
  });

  it('never returns a password hash in any response', async () => {
    const user = await registerUser(app, { phone: '+26771000011' });
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: user.auth });
    expect(me.body.toLowerCase()).not.toContain('scrypt');
    const row = repo.users.findById(user.userId)!;
    expect(row.password_hash).toContain('scrypt$');   // stored hashed, never plain
  });
});
