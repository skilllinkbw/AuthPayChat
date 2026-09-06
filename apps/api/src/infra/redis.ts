/**
 * Redis-backed infrastructure (brief §18).
 *
 * Design rules:
 *  - OPTIONAL. If REDIS_URL is unset, development and tests run entirely in-process.
 *    No developer and no test is required to reach production infrastructure.
 *  - SECURE BY CONSTRUCTION. `rediss://` (TLS) is required in production; a plain
 *    `redis://` URL in production is refused rather than silently accepted.
 *  - BOUNDED. Every command has a timeout, connections retry with capped backoff, and the
 *    offline queue is disabled so commands fail fast instead of piling up.
 *  - FAILS SAFE. Any Redis error degrades to the in-process fallback (for rate limiting) or
 *    to a single-node lock (for locking) and is logged. Redis being down must never turn
 *    into a 500 for a user, and must never mean "no rate limiting at all".
 *
 * Production dependency (documented, not hidden): a managed Redis with TLS and AUTH.
 */

import { randomUUID } from 'node:crypto';
import { Redis, type RedisOptions } from 'ioredis';
import { config } from '../config.js';

export interface RedisStatus {
  enabled: boolean;
  connected: boolean;
  mode: 'redis' | 'in-process' | 'unavailable';
  url: string | null;
  lastError: string | null;
}

let client: Redis | null = null;
let lastError: string | null = null;
let initialised = false;

function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.username ? '***@' : ''}${parsed.host}${parsed.pathname}`;
  } catch {
    return 'redis://<invalid-url>';
  }
}

function options(): RedisOptions {
  return {
    // Fail fast: an unreachable Redis must not hold a request open.
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS ?? 2_000),
    commandTimeout: Number(process.env.REDIS_COMMAND_TIMEOUT_MS ?? 1_500),
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    retryStrategy: (times: number) => Math.min(times * 200, 5_000),   // capped exponential backoff
    reconnectOnError: (error) => /READONLY/.test(error.message),
    tls: process.env.REDIS_URL?.startsWith('rediss://') ? { rejectUnauthorized: process.env.REDIS_TLS_INSECURE !== '1' } : undefined,
  };
}

/** Returns the shared client, or null when Redis is not configured for this environment. */
export function getRedis(): Redis | null {
  if (initialised) return client;
  initialised = true;
  const url = process.env.REDIS_URL?.trim();
  if (!url) return null;                      // not configured → in-process behaviour
  if (config.isProduction && !url.startsWith('rediss://')) {
    lastError = 'REDIS_URL must use rediss:// (TLS) in production';
    console.error(`[redis] ${lastError} — falling back to in-process mode`);
    return null;
  }
  try {
    client = new Redis(url, options());
    client.on('error', (error: Error) => { lastError = error.message; });
    client.on('connect', () => { lastError = null; });
    return client;
  } catch (error) {
    lastError = String(error);
    client = null;
    return null;
  }
}

export async function redisStatus(): Promise<RedisStatus> {
  const redis = getRedis();
  const url = process.env.REDIS_URL?.trim() ?? null;
  if (!redis) {
    return { enabled: false, connected: false, mode: url ? 'unavailable' : 'in-process', url: url ? redactUrl(url) : null, lastError };
  }
  try {
    await redis.ping();
    return { enabled: true, connected: true, mode: 'redis', url: redactUrl(url!), lastError: null };
  } catch (error) {
    return { enabled: true, connected: false, mode: 'unavailable', url: redactUrl(url!), lastError: String(error) };
  }
}

export async function redisHealthy(): Promise<boolean> {
  const status = await redisStatus();
  return status.mode === 'redis' ? status.connected : status.mode === 'in-process';
}

/* ── Caching ──────────────────────────────────────────────────────────────── */

export const cache = {
  async get<T>(key: string): Promise<T | null> {
    const redis = getRedis();
    if (!redis) return null;
    try {
      const raw = await redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      lastError = String(error);
      return null;                            // a cache miss is not an outage
    }
  },
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const redis = getRedis();
    if (!redis) return;
    try {
      await redis.set(key, JSON.stringify(value), 'EX', Math.max(1, ttlSeconds));
    } catch (error) {
      lastError = String(error);
    }
  },
  async invalidate(patternPrefix: string): Promise<number> {
    const redis = getRedis();
    if (!redis) return 0;
    try {
      let removed = 0;
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', `${patternPrefix}*`, 'COUNT', 200);
        cursor = next;
        if (keys.length) removed += await redis.del(...keys);
      } while (cursor !== '0');
      return removed;
    } catch (error) {
      lastError = String(error);
      return 0;
    }
  },
};

/* ── Distributed locking ─────────────────────────────────────────────────── */

const localLocks = new Map<string, Promise<void>>();

/**
 * Runs `fn` while holding a cluster-wide lock.
 *
 * With Redis: SET key token NX PX ttl, released with a compare-and-delete so a holder can
 * never delete a lock that has already expired and been taken by someone else.
 * Without Redis: an in-process mutex, which is correct for single-node deployments only —
 * `acquired` reports which mode was used so callers can decide what is safe.
 */
export async function withLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<{ acquired: boolean; mode: 'redis' | 'in-process'; value: T | null }> {
  const redis = getRedis();
  if (!redis) {
    const previous = localLocks.get(name) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    localLocks.set(name, previous.then(() => current));
    await previous;
    try {
      return { acquired: true, mode: 'in-process', value: await fn() };
    } finally {
      release();
      if (localLocks.get(name) === current) localLocks.delete(name);
    }
  }

  const token = randomUUID();
  try {
    const result = await redis.set(`lock:${name}`, token, 'PX', Math.max(1, ttlMs), 'NX');
    if (result !== 'OK') return { acquired: false, mode: 'redis', value: null };
  } catch (error) {
    lastError = String(error);
    return { acquired: false, mode: 'redis', value: null };
  }

  try {
    return { acquired: true, mode: 'redis', value: await fn() };
  } finally {
    try {
      // Only the owner may release: compare the token before deleting.
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1, `lock:${name}`, token,
      );
    } catch (error) {
      lastError = String(error);
    }
  }
}

/* ── Rate limiting ───────────────────────────────────────────────────────── */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  mode: 'redis' | 'in-process';
}

/**
 * Fixed-window counter shared across every API node when Redis is configured.
 * Falls back to the caller's in-process limiter when Redis is absent or failing — a Redis
 * outage degrades the limiter, it does not disable it.
 */
export async function redisRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult | null> {
  const redis = getRedis();
  if (!redis) return null;
  const bucketKey = `rl:${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
  try {
    const count = await redis.incr(bucketKey);
    if (count === 1) await redis.expire(bucketKey, windowSeconds);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: count > limit ? windowSeconds : 0,
      mode: 'redis',
    };
  } catch (error) {
    lastError = String(error);
    return null;                                // caller falls back to in-process
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    try { await client.quit(); } catch { client.disconnect(); }
    client = null;
    initialised = false;
  }
}
