/**
 * Sliding-window rate limiter.
 *
 * Two backends, one behaviour:
 *  - Redis (when REDIS_URL is configured): the counter is shared by every API node, so
 *    raising the node count does not raise the request limit.
 *  - In-process: the historical behaviour, correct for a single node.
 *
 * Redis being unreachable downgrades to in-process and is logged; it never disables
 * rate limiting and never turns into a 500.
 */

import { redisRateLimit } from '../infra/redis.js';

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  mode: 'redis' | 'in-process';
}

export function rateLimitSync(key: string, limit: number, windowSeconds: number): RateLimitDecision {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowSeconds * 1000);
  if (bucket.hits.length >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowSeconds * 1000 - (now - bucket.hits[0]!)) / 1000));
    buckets.set(key, bucket);
    return { allowed: false, retryAfterSeconds, mode: 'in-process' };
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { allowed: true, retryAfterSeconds: 0, mode: 'in-process' };
}

/** Async: uses the shared Redis counter when it is available, otherwise the local window. */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
  const shared = await redisRateLimit(key, limit, windowSeconds);
  if (shared) return { allowed: shared.allowed, retryAfterSeconds: shared.retryAfterSeconds, mode: 'redis' };
  return rateLimitSync(key, limit, windowSeconds);
}

/** Synchronous wrapper for hot paths that cannot await; prefer `rateLimit` in new code. */
export function rateLimitNow(key: string, limit: number, windowSeconds: number): RateLimitDecision {
  return rateLimitSync(key, limit, windowSeconds);
}

export function resetRateLimits(): void {
  buckets.clear();
}

/** Simple cleanup so long-running processes do not leak memory. */
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < 3600_000);
    if (!bucket.hits.length) buckets.delete(key);
  }
}, 300_000).unref?.();
