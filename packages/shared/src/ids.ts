import { randomBytes, randomUUID } from 'node:crypto';

/** Human-friendly, unguessable-enough public references, e.g. PC-7F3K9Q2M. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — avoids transcription errors

export function reference(prefix = 'PC'): string {
  const bytes = randomBytes(8);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}-${out}`;
}

export function newId(): string {
  return randomUUID();
}

/** Provider-safe idempotency key material (stable, opaque, no PII). */
export function idempotencyKey(scope: string, subject: string): string {
  return `pc_${scope}_${subject}`.slice(0, 120);
}
