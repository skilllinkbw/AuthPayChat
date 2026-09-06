import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createServer, seedProviders } from '../apps/api/src/server.js';
import { closeDb } from '../apps/api/src/db/index.js';
import { SandboxProvider, type SandboxScenario } from '../apps/api/src/providers/sandbox.js';
import type { PaymentStatus } from '@paychat/shared';
import * as repo from '../apps/api/src/repositories.js';
import { resetRateLimits } from '../apps/api/src/security/rateLimit.js';
import { clearChallenges } from '../apps/api/src/security/challenges.js';
import { config } from '../apps/api/src/config.js';

process.env.PAYCHAT_ENV = 'test';

export interface TestUser {
  userId: string;
  accessToken: string;
  refreshToken: string;
  phone: string;
  auth: Record<string, string>;
}

export async function newApp(scenario: SandboxScenario = 'success'): Promise<{ app: FastifyInstance; sandbox: SandboxProvider }> {
  resetRateLimits();
  clearChallenges();
  closeDb();
  const sandbox = new SandboxProvider({ metadata: { scenario } });
  const app = createServer({ databasePath: ':memory:', sandbox });
  seedProviders();
  return { app, sandbox };
}

export async function registerUser(app: FastifyInstance, input: { phone: string; password?: string; name?: string }): Promise<TestUser> {
  const password = input.password ?? 'CorrectHorse99!';
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { phone: input.phone, password, displayName: input.name ?? input.phone.slice(-4), language: 'en' },
  });
  if (response.statusCode !== 201) throw new Error(`register failed ${response.statusCode}: ${response.body}`);
  const body = response.json<{ userId: string; accessToken: string; refreshToken: string }>();
  return {
    userId: body.userId,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    phone: input.phone,
    auth: { authorization: `Bearer ${body.accessToken}` },
  };
}

export function addContact(ownerId: string, displayName: string, phone: string, contactUserId?: string | null): string {
  return repo.contacts.add(ownerId, { contactUserId: contactUserId ?? null, displayName, phone });
}

export function addAccount(
  userId: string,
  input: { label: string; providerAccountRef: string; kind?: string; currency?: string; isDefault?: boolean } ,
  providerId = 'sandbox',
): string {
  return repo.accounts.add({
    userId,
    providerId,
    kind: input.kind ?? 'mobile_money',
    label: input.label,
    providerAccountRef: input.providerAccountRef,
    currency: input.currency ?? 'BWP',
    isDefault: input.isDefault ?? false,
  });
}

export function conversationBetween(a: string, b: string): string {
  return repo.conversations.ensureDirect(a, b);
}

/** Crafts a JWT signed with the app secret — used to test tampering and expiry. */
export function forgeAccessToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', config.jwt.secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export async function createIntent(app: FastifyInstance, user: TestUser, input: {
  recipientContactId?: string; recipientLabel?: string; recipientHandle?: string;
  amountMinor?: number; currency?: string; conversationId?: string; idempotencyKey?: string;
}) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/payments/intents',
    headers: { ...user.auth, ...(input.idempotencyKey ? { 'idempotency-key': input.idempotencyKey } : {}) },
    payload: {
      recipientContactId: input.recipientContactId,
      recipientLabel: input.recipientLabel ?? 'Motakase',
      recipientHandle: input.recipientHandle ?? '+26771000001',
      amountMinor: input.amountMinor ?? 5000,
      currency: input.currency ?? 'BWP',
      conversationId: input.conversationId,
    },
  });
  return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
}

export async function confirmPayment(app: FastifyInstance, user: TestUser, intentId: string, accountId: string, extra: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: 'POST',
    url: `/api/payments/intents/${intentId}/confirm`,
    headers: user.auth,
    payload: { accountId, authMethod: 'password', ...extra },
  });
  return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
}

export async function sendWebhook(
  app: FastifyInstance,
  sandbox: SandboxProvider,
  providerRef: string,
  status: PaymentStatus,
  amountMinor = 0,
  mutate?: (built: { headers: Record<string, string>; body: string }) => void,
) {
  const built = sandbox.buildWebhook(providerRef, status, amountMinor);
  mutate?.(built);
  const response = await app.inject({
    method: 'POST',
    url: '/api/webhooks/sandbox',
    headers: built.headers,
    payload: built.body,
  });
  return { status: response.statusCode, body: response.json<Record<string, unknown>>() };
}

export function intentRow(id: string) {
  return repo.intents.findById(id)!;
}

export { repo };

/** Step-up (password fallback or biometric in the browser) returns a token with a verified claim. */
export async function stepUp(app: FastifyInstance, user: TestUser, password = 'CorrectHorse99!'): Promise<TestUser> {
  const response = await app.inject({
    method: 'POST', url: '/api/auth/step-up', headers: user.auth, payload: { password },
  });
  if (response.statusCode !== 200) throw new Error(`step-up failed ${response.statusCode}: ${response.body}`);
  const body = response.json<{ accessToken: string }>();
  return { ...user, accessToken: body.accessToken, auth: { authorization: `Bearer ${body.accessToken}` } };
}

/** Decodes (without verifying) a JWT payload — for asserting on claims in tests. */
export function decodeJwtClaims(token: string): Record<string, any> {
  const [, body] = token.split('.');
  return JSON.parse(Buffer.from(body ?? '', 'base64url').toString('utf8'));
}
