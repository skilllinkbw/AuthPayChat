import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Password policy: length + character variety. Deliberately simple and transparent to the user. */
export function validatePasswordStrength(password: string): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (password.length < 10) reasons.push('Password must be at least 10 characters.');
  if (!/[A-Za-z]/.test(password)) reasons.push('Password must contain a letter.');
  if (!/\d/.test(password)) reasons.push('Password must contain a number.');
  if (password.length > 200) reasons.push('Password is too long.');
  return { ok: reasons.length === 0, reasons };
}
