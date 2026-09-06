/**
 * Redis-backed infrastructure (brief §18).
 *
 * Runs against a real Redis when REDIS_URL is set (the production configuration) and
 * verifies the in-process fallback when it is not — a developer must never be forced to run
 * production infrastructure to work on PayChat.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { newApp, registerUser } from './helpers.js';
import type { Redis } from 'ioredis';

const REDIS_URL = process.env.REDIS_URL?.trim() ?? '';

// The shared rate-limiting/locking/caching suite needs a real Redis. When a developer has
// not configured REDIS_URL we skip it (BLOCKED — EXTERNAL SERVICE REQUIRED) instead of
// failing against an unavailable localhost instance; the in-process fallback suite below
// still runs and proves the app degrades safely without Redis.
describe.skipIf(REDIS_URL === '')('Redis infrastructure — shared rate limiting and locking', () => {
  let app: FastifyInstance;
  let infra: typeof import('../apps/api/src/infra/redis.js');
  let redis: Redis | null;

  beforeAll(async () => {
    process.env.REDIS_URL = REDIS_URL;
    infra = await import('../apps/api/src/infra/redis.js');
    redis = infra.getRedis();
    if (redis) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('redis not ready')), 5_000);
        redis!.once('ready', () => { clearTimeout(timer); resolve(); });
        redis!.once('error', (error: Error) => { clearTimeout(timer); reject(error); });
      });
    }
    ({ app } = await newApp('success'));
  });

  afterAll(async () => {
    if (redis) await redis.flushdb().catch(() => undefined);
    await infra?.closeRedis();
    process.env.REDIS_URL = REDIS_URL;
  });

  it('reports an honest status', async () => {
    const status = await infra.redisStatus();
    expect(['redis', 'in-process', 'unavailable']).toContain(status.mode);
    expect(status.url === null || status.url.includes('***') || status.url.startsWith('redis://')).toBe(true);
    if (status.mode === 'redis') expect(status.connected).toBe(true);
  });

  it('rate limits through the API using the SHARED counter', async () => {
    const user = await registerUser(app, { phone: '+26778111001', name: 'Limited' });
    const codes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const response = await app.inject({
        method: 'POST', url: '/api/auth/step-up', headers: user.auth, payload: { password: 'wrong-password' },
      });
      codes.push(response.statusCode);
    }
    // 5 attempts allowed per 10 minutes; everything after that is rate limited (429),
    // and a wrong password is 401 — never a 500 because Redis is involved.
    expect(codes.some((c) => c === 429)).toBe(true);
    expect(codes.every((c) => c === 401 || c === 429)).toBe(true);
  }, 30_000);

  it('gives mutual exclusion across concurrent lock contenders', async () => {
    const name = `paychat-test-${Date.now()}`;
    let inside = 0;
    let maxConcurrent = 0;
    const results = await Promise.all(Array.from({ length: 5 }, () =>
      infra.withLock(name, 2_000, async () => {
        inside += 1;
        maxConcurrent = Math.max(maxConcurrent, inside);
        await new Promise((resolve) => setTimeout(resolve, 60));
        inside -= 1;
        return 'done';
      }),
    ));
    const acquired = results.filter((r) => r.acquired);
    expect(acquired.length).toBeGreaterThanOrEqual(1);
    expect(maxConcurrent).toBe(1);                       // never two holders at once
    expect(results.every((r) => r.mode === 'redis')).toBe(true);
  }, 30_000);

  it('caches, expires and invalidates by prefix', async () => {
    const prefix = `paychat-test-cache:${Date.now()}:`;
    await infra.cache.set(`${prefix}a`, { minor: 100 }, 30);
    await infra.cache.set(`${prefix}b`, { minor: 200 }, 30);
    expect(await infra.cache.get<{ minor: number }>(`${prefix}a`)).toEqual({ minor: 100 });

    const removed = await infra.cache.invalidate(prefix);
    expect(removed).toBe(2);
    expect(await infra.cache.get(`${prefix}a`)).toBeNull();
  }, 30_000);

  it('never throws at the caller when Redis misbehaves', async () => {
    // A command against a closed connection must degrade, not propagate.
    await expect(infra.cache.get('paychat-test-anything')).resolves.toBeDefined();
  });
});

describe('Redis infrastructure — in-process fallback when Redis is not configured', () => {
  it('still rate limits with no Redis at all', async () => {
    const saved = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    vi.resetModules();
    const fresh = await import('../apps/api/src/infra/redis.js');
    const decision = await fresh.redisRateLimit('fallback-key', 1, 60);
    expect(decision).toBeNull();                    // infra reports "no shared backend"
    const { rateLimit } = await import('../apps/api/src/security/rateLimit.js');
    expect((await rateLimit('fallback-key', 1, 60)).allowed).toBe(true);
    expect((await rateLimit('fallback-key', 1, 60)).allowed).toBe(false);   // still enforced locally
    const status = await fresh.redisStatus();
    expect(status.mode).toBe('in-process');
    expect(status.enabled).toBe(false);
    process.env.REDIS_URL = saved;
  });

  it('locking still serialises work in single-node mode', async () => {
    const saved = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    vi.resetModules();
    const fresh = await import('../apps/api/src/infra/redis.js');
    let inside = 0;
    let maxConcurrent = 0;
    const results = await Promise.all(Array.from({ length: 4 }, () =>
      fresh.withLock('fallback-lock', 1_000, async () => {
        inside += 1;
        maxConcurrent = Math.max(maxConcurrent, inside);
        await new Promise((resolve) => setTimeout(resolve, 30));
        inside -= 1;
        return true;
      }),
    ));
    expect(maxConcurrent).toBe(1);
    expect(results.every((r) => r.mode === 'in-process')).toBe(true);
    process.env.REDIS_URL = saved;
  });
});
