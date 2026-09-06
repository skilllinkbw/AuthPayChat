/**
 * Authentication: registration, login, rotating refresh tokens, session/device management.
 * Passwords: scrypt. Access tokens: short-lived HS256 JWT. Refresh tokens: opaque, hashed at rest, rotated.
 */

import { config } from '../config.js';
import { Errors } from '@paychat/shared';
import * as repo from '../repositories.js';
import { audit, logEvent } from './audit.js';
import { hashPassword, validatePasswordStrength, verifyPassword } from './passwords.js';
import { generateRefreshToken, issueAccessToken, sha256, verifyAccessToken, type AccessTokenClaims } from './jwt.js';
import { rateLimit } from './rateLimit.js';

export interface AuthResult {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  sessionId: string;
  user: { id: string; displayName: string; phone: string; language: string; currency: string; hideBalances: boolean; isMerchant: boolean };
}

const E164 = /^\+?[1-9]\d{7,14}$/;

function publicUser(row: repo.UserRow) {
  return {
    id: row.id,
    displayName: row.display_name,
    phone: row.phone_e164,
    language: row.language,
    currency: row.default_currency,
    hideBalances: row.hide_balances === 1,
    isMerchant: row.is_merchant === 1,
  };
}

export const authService = {
  async register(input: {
    phone: string; password: string; displayName: string; language?: string;
    deviceLabel?: string | null; platform?: string | null; ip?: string | null; userAgent?: string | null;
  }): Promise<AuthResult> {
    if (!E164.test(input.phone)) throw Errors.validation({ phone: 'Enter a valid phone number, e.g. +26771234567' });
    if (input.displayName.trim().length < 2) throw Errors.validation({ displayName: 'Please enter your name' });
    const strength = validatePasswordStrength(input.password);
    if (!strength.ok) throw Errors.validation({ password: strength.reasons.join(' ') });

    if (repo.users.findByPhone(input.phone)) {
      throw Errors.conflict('An account with this number already exists', 'An account with this number already exists. Please sign in.');
    }

    const user = repo.users.create({
      phone: input.phone,
      passwordHash: await hashPassword(input.password),
      displayName: input.displayName.trim(),
      language: input.language ?? 'en',
    });
    audit('auth.register', { type: 'user', id: user.id, metadata: { phone: input.phone.slice(-4).padStart(input.phone.length, '*') } }, { ip: input.ip ?? null, userAgent: input.userAgent ?? null });
    return authService.startSession(user.id, input.deviceLabel ?? null, input.platform ?? null, input.ip ?? null, input.userAgent ?? null);
  },

  async login(input: {
    phone: string; password: string;
    deviceLabel?: string | null; platform?: string | null; ip?: string | null; userAgent?: string | null;
  }): Promise<AuthResult> {
    const limitKey = `login:${input.phone}:${input.ip ?? 'unknown'}`;
    const limit = await rateLimit(limitKey, 8, 900);
    if (!limit.allowed) {
      audit('security.rate_limited', { type: 'auth', metadata: { phone: '***' } }, { ip: input.ip ?? null });
      throw Errors.rateLimited();
    }

    const user = repo.users.findByPhone(input.phone);
    // Same response for unknown user and wrong password (no account enumeration).
    if (!user || !(await verifyPassword(input.password, user.password_hash))) {
      audit('auth.login_failed', { type: 'auth', metadata: { phone: '***' } }, { ip: input.ip ?? null, userAgent: input.userAgent ?? null });
      throw Errors.invalidCredentials();
    }
    if (user.status !== 'active') throw Errors.forbidden();

    audit('auth.login', { type: 'user', id: user.id }, { actorUserId: user.id, ip: input.ip ?? null, userAgent: input.userAgent ?? null });
    return authService.startSession(user.id, input.deviceLabel ?? null, input.platform ?? null, input.ip ?? null, input.userAgent ?? null);
  },

  startSession(userId: string, deviceLabel: string | null, platform: string | null, ip: string | null, userAgent: string | null): AuthResult {
    const deviceId = repo.devices.upsert(userId, deviceLabel, platform);
    const { token: refreshToken, hash } = generateRefreshToken();
    const expiresAt = new Date(Date.now() + config.jwt.refreshTtlSeconds * 1000).toISOString();
    const sessionId = repo.sessions.create({ userId, refreshTokenHash: hash, deviceId, deviceLabel, ip, userAgent, expiresAt });
    const { token: accessToken, expiresAt: accessExpiresAt } = issueAccessToken(userId, sessionId);
    const user = repo.users.findById(userId)!;
    return { userId, accessToken, refreshToken, expiresAt: accessExpiresAt, sessionId, user: publicUser(user) };
  },

  /** Rotates the refresh token. Reuse of an old token revokes the whole session family. */
  refresh(refreshToken: string, ip?: string | null): AuthResult {
    const presented = sha256(refreshToken);
    const session = repo.sessions.findByRefreshHash(presented);
    if (!session) {
      audit('auth.refresh_reuse_detected', { type: 'session', metadata: { reason: 'unknown_token' } }, { ip: ip ?? null });
      throw Errors.unauthenticated();
    }
    if (!session.current) {
      // A rotated-out token was replayed: treat it as token theft and revoke everything.
      repo.sessions.revokeAllForUser(session.user_id);
      audit('auth.refresh_reuse_detected', { type: 'user', id: session.user_id }, { ip: ip ?? null });
      logEvent('warn', 'auth.refresh_reuse_detected', { userId: session.user_id });
      throw Errors.unauthenticated();
    }
    if (session.revoked_at) {
      // A revoked token was replayed: kill every session for this user and force re-login.
      repo.sessions.revokeAllForUser(session.user_id);
      audit('auth.refresh_reuse_detected', { type: 'user', id: session.user_id }, { ip: ip ?? null });
      logEvent('warn', 'auth.refresh_reuse_detected', { userId: session.user_id });
      throw Errors.unauthenticated();
    }
    if (Date.parse(session.expires_at) < Date.now()) {
      repo.sessions.revoke(session.id);
      throw Errors.unauthenticated();
    }

    const { token: newRefresh, hash } = generateRefreshToken();
    const expiresAt = new Date(Date.now() + config.jwt.refreshTtlSeconds * 1000).toISOString();
    repo.sessions.touch(session.id, hash, expiresAt);
    const { token: accessToken, expiresAt: accessExpiresAt } = issueAccessToken(session.user_id, session.id);
    const user = repo.users.findById(session.user_id)!;
    audit('auth.refresh', { type: 'user', id: session.user_id }, { actorUserId: session.user_id, ip: ip ?? null });
    return {
      userId: session.user_id,
      accessToken,
      refreshToken: newRefresh,
      expiresAt: accessExpiresAt,
      sessionId: session.id,
      user: publicUser(user),
    };
  },

  logout(sessionId: string, userId: string): void {
    repo.sessions.revoke(sessionId);
    audit('auth.logout', { type: 'session', id: sessionId }, { actorUserId: userId });
  },

  /** Verifies a bearer token AND that the session behind it is still valid. */
  verify(authorization: string | undefined): { userId: string; sessionId: string; claims: AccessTokenClaims } | null {
    if (!authorization?.startsWith('Bearer ')) return null;
    const claims = verifyAccessToken(authorization.slice(7));
    if (!claims) return null;
    const session = repo.sessions.findValid(claims.sid);
    if (!session || session.user_id !== claims.sub) return null;
    return { userId: claims.sub, sessionId: claims.sid, claims };
  },
};

