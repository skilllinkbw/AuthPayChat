/**
 * One-time WebAuthn challenge store (in-memory; move to Redis for multi-node).
 * Challenges are single-use and expire quickly — the core defence against assertion replay.
 */

const CHALLENGE_TTL_MS = 60_000;
const challenges = new Map<string, { value: string; expiresAt: number }>();

export function storeChallenge(userId: string, challenge: string): void {
  challenges.set(userId, { value: challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
}

/** Single-use: reading consumes the challenge. */
export function takeChallenge(userId: string): string | null {
  const entry = challenges.get(userId);
  if (!entry) return null;
  challenges.delete(userId);
  if (entry.expiresAt < Date.now()) return null;
  return entry.value;
}

export function clearChallenges(): void {
  challenges.clear();
}
