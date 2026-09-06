/**
 * Provider credential storage.
 *
 * Rules enforced here:
 *  - credentials are stored encrypted (AES-256-GCM) with a key derived from
 *    TOKEN_ENCRYPTION_KEY (a secret from the environment / secret manager)
 *  - the plaintext never leaves this module except to build a provider request
 *  - values are redacted from every log line and error body
 *  - the app-facing database role has no access to provider_credentials at all (see RLS)
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { getDb, nowIso } from '../db/index.js';

const ALGORITHM = 'aes-256-gcm';

function keyForVersion(): Buffer {
  // v1: sha256 of the configured key material. A KMS-backed deployment adds versions here.
  return createHash('sha256').update(config.tokenEncryptionKey).digest();
}

export interface StoredCredential {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

export function encryptCredential(plaintext: string): StoredCredential {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyForVersion(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: 1,
  };
}

export function decryptCredential(stored: StoredCredential): string {
  const decipher = createDecipheriv(ALGORITHM, keyForVersion(), Buffer.from(stored.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(stored.authTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(stored.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export const credentials = {
  put(providerId: string, keyName: string, plaintext: string): void {
    const stored = encryptCredential(plaintext);
    getDb().prepare(
      `INSERT INTO provider_credentials (id, provider_id, key_name, ciphertext, iv, auth_tag, key_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (provider_id, key_name) DO UPDATE SET
         ciphertext = excluded.ciphertext, iv = excluded.iv, auth_tag = excluded.auth_tag,
         key_version = excluded.key_version, updated_at = excluded.updated_at`,
    ).run(`pcr_${providerId}_${keyName}`, providerId, keyName, stored.ciphertext, stored.iv, stored.authTag, stored.keyVersion, nowIso(), nowIso());
  },
  get(providerId: string, keyName: string): string | null {
    let row: { ciphertext: string; iv: string; auth_tag: string; key_version: number } | undefined;
    try {
      row = getDb().prepare(
        'SELECT ciphertext, iv, auth_tag, key_version FROM provider_credentials WHERE provider_id = ? AND key_name = ?',
      ).get(providerId, keyName) as { ciphertext: string; iv: string; auth_tag: string; key_version: number } | undefined;
    } catch {
      return null; // no database yet (bootstrap) — fall through to the environment
    }
    if (!row) return null;
    try {
      return decryptCredential({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, keyVersion: row.key_version });
    } catch {
      // Tampered or re-keyed material must fail closed, never fall back to plaintext.
      throw new Error(`credential decryption failed for ${providerId}/${keyName}`);
    }
  },
  remove(providerId: string, keyName: string): void {
    getDb().prepare('DELETE FROM provider_credentials WHERE provider_id = ? AND key_name = ?').run(providerId, keyName);
  },
  listKeyNames(providerId: string): string[] {
    return (getDb().prepare('SELECT key_name FROM provider_credentials WHERE provider_id = ?').all(providerId) as Array<{ key_name: string }>).map((r) => r.key_name);
  },
};

/** Redacts known secret values from any string before it is logged or returned. */
const SECRET_VALUES = new Set<string>();

export function registerSecretValue(value: string | undefined | null): void {
  if (value && value.length > 6) SECRET_VALUES.add(value);
}

export function redactSecrets(text: string): string {
  let out = text;
  for (const secret of SECRET_VALUES) out = out.split(secret).join('[redacted]');
  return out
    .replace(/(client_secret|api[_-]?key|password|authorization|webhook_secret)["'\s:=]+[^\s"',}]+/gi, '$1=[redacted]');
}

/**
 * Resolves a credential by name for a provider:
 *   1. encrypted store (preferred, rotatable without a deploy)
 *   2. environment variable (bootstrap / local development)
 * Falls back to null — callers must then disable the capability, never fake it.
 */
export function resolveCredential(providerId: string, keyName: string, envName?: string): string | null {
  const stored = credentials.get(providerId, keyName);
  if (stored !== null) return stored;
  const fromEnv = envName ? process.env[envName] : undefined;
  if (fromEnv) {
    registerSecretValue(fromEnv);
    return fromEnv;
  }
  return null;
}
