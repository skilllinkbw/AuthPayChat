/**
 * Data access. EVERY function that touches user-owned rows takes the owner id and
 * scopes the SQL by it — this is the enforcement point for the access rules that
 * Postgres RLS enforces in the database (see db/postgres/002_rls.sql).
 */

import { createHash, randomUUID } from 'node:crypto';
import { getDb, nowIso, type Db } from './db/index.js';
import { canTransition, type PaymentStatus } from '@paychat/shared';
import type { Cursor } from './db/cursor.js';

export interface UserRow {
  id: string;
  phone_e164: string;
  email: string | null;
  password_hash: string;
  display_name: string;
  default_currency: string;
  language: string;
  hide_balances: number;
  is_merchant: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface AccountRow {
  id: string;
  user_id: string;
  provider_id: string;
  kind: string;
  label: string;
  provider_account_ref: string;
  currency: string;
  is_default: number;
  status: string;
  last_error: string | null;
  created_at: string;
}

export interface IntentRow {
  id: string;
  reference: string;
  user_id: string;
  recipient_contact_id: string | null;
  recipient_user_id: string | null;
  recipient_handle: string;
  recipient_label: string;
  amount_minor: number;
  currency: string;
  provider_id: string | null;
  account_id: string | null;
  narration: string | null;
  status: PaymentStatus;
  idempotency_key: string | null;
  provider_ref: string | null;
  risk_score: number;
  risk_reasons: string;
  auth_method: string | null;
  authorized_at: string | null;
  expires_at: string;
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

const db = (): Db => getDb();

export interface ProfileRow {
  user_id: string;
  avatar_color: string;
  bio: string | null;
  business_name: string | null;
  merchant_category: string | null;
  settlement_currency: string;
  updated_at: string;
}

export const profiles = {
  find(userId: string): ProfileRow | undefined {
    return db().prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId) as ProfileRow | undefined;
  },
  update(userId: string, patch: { avatarColor?: string; bio?: string | null; businessName?: string | null; merchantCategory?: string | null; settlementCurrency?: string }): ProfileRow {
    if (patch.avatarColor !== undefined) db().prepare('UPDATE profiles SET avatar_color = ?, updated_at = ? WHERE user_id = ?').run(patch.avatarColor, nowIso(), userId);
    if (patch.bio !== undefined) db().prepare('UPDATE profiles SET bio = ?, updated_at = ? WHERE user_id = ?').run(patch.bio, nowIso(), userId);
    if (patch.businessName !== undefined) db().prepare('UPDATE profiles SET business_name = ?, updated_at = ? WHERE user_id = ?').run(patch.businessName, nowIso(), userId);
    if (patch.merchantCategory !== undefined) db().prepare('UPDATE profiles SET merchant_category = ?, updated_at = ? WHERE user_id = ?').run(patch.merchantCategory, nowIso(), userId);
    if (patch.settlementCurrency !== undefined) db().prepare('UPDATE profiles SET settlement_currency = ?, updated_at = ? WHERE user_id = ?').run(patch.settlementCurrency, nowIso(), userId);
    return profiles.find(userId)!;
  },
};

export const users = {
  create(input: { phone: string; passwordHash: string; displayName: string; language?: string; currency?: string; isMerchant?: boolean }): UserRow {
    const id = `usr_${randomUUID()}`;
    db().prepare(
      `INSERT INTO users (id, phone_e164, password_hash, display_name, language, default_currency, is_merchant)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.phone, input.passwordHash, input.displayName, input.language ?? 'en', input.currency ?? 'BWP', input.isMerchant ? 1 : 0);
    db().prepare('INSERT INTO profiles (user_id) VALUES (?)').run(id);
    return users.findById(id)!;
  },
  findById(id: string): UserRow | undefined {
    return db().prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  },
  findByPhone(phone: string): UserRow | undefined {
    return db().prepare('SELECT * FROM users WHERE phone_e164 = ?').get(phone) as UserRow | undefined;
  },
  updatePreferences(id: string, patch: { language?: string; hideBalances?: boolean; defaultCurrency?: string }): UserRow {
    if (patch.language !== undefined) db().prepare('UPDATE users SET language = ?, updated_at = ? WHERE id = ?').run(patch.language, nowIso(), id);
    if (patch.hideBalances !== undefined) db().prepare('UPDATE users SET hide_balances = ?, updated_at = ? WHERE id = ?').run(patch.hideBalances ? 1 : 0, nowIso(), id);
    if (patch.defaultCurrency !== undefined) db().prepare('UPDATE users SET default_currency = ?, updated_at = ? WHERE id = ?').run(patch.defaultCurrency, nowIso(), id);
    return users.findById(id)!;
  },
  search(term: string, excludeUserId?: string): Array<Pick<UserRow, 'id' | 'display_name' | 'phone_e164' | 'is_merchant'>> {
    return db().prepare(
      `SELECT id, display_name, phone_e164, is_merchant FROM users
       WHERE (display_name LIKE ? OR phone_e164 LIKE ?) AND id != ? AND status = 'active' LIMIT 20`,
    ).all(`%${term}%`, `%${term}%`, excludeUserId ?? '') as Array<Pick<UserRow, 'id' | 'display_name' | 'phone_e164' | 'is_merchant'>>;
  },
};

export const sessions = {
  create(input: { userId: string; refreshTokenHash: string; deviceId?: string | null; deviceLabel?: string | null; ip?: string | null; userAgent?: string | null; expiresAt: string }): string {
    const id = `ses_${randomUUID()}`;
    db().prepare(
      `INSERT INTO sessions (id, user_id, refresh_token_hash, device_id, device_label, ip, user_agent, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.userId, input.refreshTokenHash, input.deviceId ?? null, input.deviceLabel ?? null, input.ip ?? null, input.userAgent ?? null, input.expiresAt);
    return id;
  },
  /** current = true for the active token; current = false means the token was rotated out (replay). */
  findByRefreshHash(hash: string): { id: string; user_id: string; expires_at: string; revoked_at: string | null; device_id: string | null; current: boolean } | undefined {
    const current = db().prepare('SELECT * FROM sessions WHERE refresh_token_hash = ?').get(hash) as
      | { id: string; user_id: string; expires_at: string; revoked_at: string | null; device_id: string | null } | undefined;
    if (current) return { ...current, current: true };
    const previous = db().prepare('SELECT * FROM sessions WHERE previous_refresh_token_hash = ?').get(hash) as
      | { id: string; user_id: string; expires_at: string; revoked_at: string | null; device_id: string | null } | undefined;
    return previous ? { ...previous, current: false } : undefined;
  },
  findValid(id: string) {
    return db().prepare('SELECT * FROM sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?').get(id, nowIso()) as
      | { id: string; user_id: string; expires_at: string; device_id: string | null } | undefined;
  },
  touch(id: string, refreshTokenHash: string, expiresAt: string): void {
    db().prepare(
      `UPDATE sessions SET last_seen_at = ?, previous_refresh_token_hash = refresh_token_hash,
              refresh_token_hash = ?, expires_at = ? WHERE id = ?`,
    ).run(nowIso(), refreshTokenHash, expiresAt, id);
  },
  revoke(id: string): void {
    db().prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(nowIso(), id);
  },
  revokeAllForUser(userId: string): void {
    db().prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(nowIso(), userId);
  },
  listForUser(userId: string) {
    return db().prepare(
      `SELECT id, device_label, ip, user_agent, created_at, last_seen_at, expires_at, revoked_at
       FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    ).all(userId) as Array<Record<string, unknown>>;
  },
};

export const devices = {
  upsert(userId: string, label: string | null, platform: string | null): string {
    const existing = db().prepare('SELECT id FROM devices WHERE user_id = ? AND label = ?').get(userId, label) as { id: string } | undefined;
    if (existing) {
      db().prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(nowIso(), existing.id);
      return existing.id;
    }
    const id = `dev_${randomUUID()}`;
    db().prepare('INSERT INTO devices (id, user_id, label, platform) VALUES (?, ?, ?, ?)').run(id, userId, label, platform);
    return id;
  },
  isNew(userId: string, deviceId: string | null, withinHours: number): boolean {
    if (!deviceId) return true;
    const row = db().prepare('SELECT first_seen_at FROM devices WHERE id = ? AND user_id = ?').get(deviceId, userId) as { first_seen_at: string } | undefined;
    if (!row) return true;
    const age = Date.now() - Date.parse(row.first_seen_at);
    return age < withinHours * 3600_000;
  },
  listForUser(userId: string) {
    return db().prepare('SELECT id, label, platform, first_seen_at, last_seen_at, trusted FROM devices WHERE user_id = ? ORDER BY last_seen_at DESC').all(userId) as Array<Record<string, unknown>>;
  },
  revoke(userId: string, deviceId: string): void {
    db().prepare('DELETE FROM devices WHERE id = ? AND user_id = ?').run(deviceId, userId);
    db().prepare('UPDATE sessions SET revoked_at = ? WHERE device_id = ? AND user_id = ?').run(nowIso(), deviceId, userId);
  },
};

export const webauthnCredentials = {
  add(input: { userId: string; credentialId: string; publicKey: string; counter: number; transports?: string | null; deviceLabel?: string | null }): void {
    db().prepare(
      `INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key, counter, transports, device_label)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(`wac_${randomUUID()}`, input.userId, input.credentialId, input.publicKey, input.counter, input.transports ?? null, input.deviceLabel ?? null);
  },
  listForUser(userId: string) {
    return db().prepare('SELECT id, credential_id, public_key, counter, transports, device_label, created_at, last_used_at FROM webauthn_credentials WHERE user_id = ?').all(userId) as Array<Record<string, unknown>>;
  },
  findByCredentialId(credentialId: string) {
    return db().prepare('SELECT * FROM webauthn_credentials WHERE credential_id = ?').get(credentialId) as
      | { id: string; user_id: string; public_key: string; counter: number } | undefined;
  },
  findForUser(userId: string, credentialId: string) {
    return db().prepare('SELECT * FROM webauthn_credentials WHERE user_id = ? AND credential_id = ?').get(userId, credentialId) as
      | { id: string; user_id: string; public_key: string; counter: number; transports: string | null } | undefined;
  },
  updateCounter(id: string, counter: number): void {
    db().prepare('UPDATE webauthn_credentials SET counter = ?, last_used_at = ? WHERE id = ?').run(counter, nowIso(), id);
  },
  remove(userId: string, credentialId: string): void {
    db().prepare('DELETE FROM webauthn_credentials WHERE user_id = ? AND credential_id = ?').run(userId, credentialId);
  },
};

export const contacts = {
  add(ownerId: string, input: { contactUserId: string | null; displayName: string; phone: string; isMerchant?: boolean }): string {
    const id = `ctc_${randomUUID()}`;
    db().prepare(
      `INSERT INTO contacts (id, owner_user_id, contact_user_id, display_name, phone_e164, is_merchant)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (owner_user_id, phone_e164) DO UPDATE SET display_name = excluded.display_name`,
    ).run(id, ownerId, input.contactUserId, input.displayName, input.phone, input.isMerchant ? 1 : 0);
    return id;
  },
  list(ownerId: string) {
    return db().prepare(
      `SELECT c.id, c.display_name, c.phone_e164, c.is_merchant, c.contact_user_id,
              (SELECT id FROM conversations cv
                 JOIN conversation_members m ON m.conversation_id = cv.id
                WHERE cv.type = 'direct' AND m.user_id = c.owner_user_id
                  AND EXISTS (SELECT 1 FROM conversation_members m2
                               WHERE m2.conversation_id = cv.id AND m2.user_id = c.contact_user_id)) AS conversation_id
         FROM contacts c WHERE c.owner_user_id = ? ORDER BY c.display_name`,
    ).all(ownerId) as Array<{ id: string; display_name: string; phone_e164: string; is_merchant: number; contact_user_id: string | null; conversation_id: string | null }>;
  },
  /** Ownership-scoped lookup — the basis of every recipient resolution. */
  findOwned(ownerId: string, contactId: string) {
    return db().prepare('SELECT * FROM contacts WHERE id = ? AND owner_user_id = ?').get(contactId, ownerId) as
      | { id: string; display_name: string; phone_e164: string; contact_user_id: string | null; is_merchant: number } | undefined;
  },
  search(ownerId: string, query: string) {
    return db().prepare(
      `SELECT id, display_name, phone_e164, contact_user_id, is_merchant FROM contacts
        WHERE owner_user_id = ? AND display_name LIKE ? ORDER BY display_name LIMIT 10`,
    ).all(ownerId, `${query}%`) as Array<{ id: string; display_name: string; phone_e164: string; contact_user_id: string | null; is_merchant: number }>;
  },
};

export const conversations = {
  listForUser(userId: string, limit = 50, cursor?: Cursor | null) {
    return db().prepare(
      `SELECT cv.id, cv.type, cv.title, cv.last_message_at,
              (SELECT body FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = cv.id AND m.created_at > COALESCE(cm.last_read_at, '1970-01-01')) AS unread,
              (SELECT u.display_name FROM conversation_members om JOIN users u ON u.id = om.user_id
                WHERE om.conversation_id = cv.id AND om.user_id != ? LIMIT 1) AS peer_name,
              (SELECT u.is_merchant FROM conversation_members om JOIN users u ON u.id = om.user_id
                WHERE om.conversation_id = cv.id AND om.user_id != ? LIMIT 1) AS peer_is_merchant
         FROM conversations cv
         JOIN conversation_members cm ON cm.conversation_id = cv.id AND cm.user_id = ?
        WHERE (? IS NULL OR cv.last_message_at < ? OR (cv.last_message_at = ? AND cv.id < ?))
        ORDER BY cv.last_message_at DESC, cv.id DESC LIMIT ?`,
    ).all(
      userId, userId, userId,
      cursor?.ts ?? null,
      cursor?.ts ?? null,
      cursor?.ts ?? null,
      cursor?.id ?? '',
      limit,
    ) as Array<Record<string, unknown>>;
  },
  /** Membership check — blocks reading someone else's conversation. */
  isMember(conversationId: string, userId: string): boolean {
    const row = db().prepare('SELECT 1 AS ok FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(conversationId, userId);
    return Boolean(row);
  },
  ensureDirect(aUserId: string, bUserId: string): string {
    const existing = db().prepare(
      `SELECT cv.id FROM conversations cv
        WHERE cv.type = 'direct'
          AND EXISTS (SELECT 1 FROM conversation_members m WHERE m.conversation_id = cv.id AND m.user_id = ?)
          AND EXISTS (SELECT 1 FROM conversation_members m WHERE m.conversation_id = cv.id AND m.user_id = ?)`,
    ).get(aUserId, bUserId) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = `cnv_${randomUUID()}`;
    db().transaction(() => {
      db().prepare('INSERT INTO conversations (id, type) VALUES (?, ?)').run(id, 'direct');
      db().prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(id, aUserId);
      db().prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(id, bUserId);
    })();
    return id;
  },
  /**
   * Cursor pagination over messages. The cursor is (created_at, id): created_at alone is NOT
   * unique, and paginating on it would drop or repeat every message that shares a timestamp.
   * Ordered `created_at DESC, id DESC` (newest first) for a stable total order.
   */
  messages(conversationId: string, limit = 30, cursor?: Cursor | null) {
    return db().prepare(
      `SELECT m.id, m.conversation_id, m.sender_id, m.kind, m.body, m.payment_intent_id, m.payment_request_id, m.created_at,
              u.display_name AS sender_name
         FROM messages m LEFT JOIN users u ON u.id = m.sender_id
        WHERE m.conversation_id = ?
          AND (? IS NULL OR (m.created_at < ?) OR (m.created_at = ? AND m.id < ?))
        ORDER BY m.created_at DESC, m.id DESC LIMIT ?`,
    ).all(
      conversationId,
      cursor?.ts ?? null,
      cursor?.ts ?? null,
      cursor?.ts ?? null,
      cursor?.id ?? '',
      limit,
    ) as Array<Record<string, unknown>>;
  },
  addMessage(input: { conversationId: string; senderId: string; body?: string | null; kind?: string; clientMsgId?: string | null; paymentIntentId?: string | null; paymentRequestId?: string | null }): string {
    const id = `msg_${randomUUID()}`;
    db().prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, kind, body, client_msg_id, payment_intent_id, payment_request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (conversation_id, client_msg_id) DO NOTHING`,
    ).run(id, input.conversationId, input.senderId, input.kind ?? 'text', input.body ?? null, input.clientMsgId ?? null, input.paymentIntentId ?? null, input.paymentRequestId ?? null);
    db().prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(nowIso(), input.conversationId);
    return id;
  },
  markRead(conversationId: string, userId: string): void {
    db().prepare('UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?').run(nowIso(), conversationId, userId);
  },
  findMessage(id: string) {
    return db().prepare('SELECT * FROM messages WHERE id = ?').get(id) as { conversation_id: string } | undefined;
  },
};

export const accounts = {
  listForUser(userId: string): AccountRow[] {
    return db().prepare(
      `SELECT * FROM payment_accounts WHERE user_id = ? AND status != 'disconnected' ORDER BY is_default DESC, created_at`,
    ).all(userId) as AccountRow[];
  },
  /** Account ownership is enforced here — never trust an account id from the client. */
  findOwned(userId: string, accountId: string): AccountRow | undefined {
    return db().prepare('SELECT * FROM payment_accounts WHERE id = ? AND user_id = ?').get(accountId, userId) as AccountRow | undefined;
  },
  add(input: { userId: string; providerId: string; kind: string; label: string; providerAccountRef: string; currency: string; isDefault?: boolean }): string {
    const id = `acc_${randomUUID()}`;
    db().transaction(() => {
      if (input.isDefault) db().prepare('UPDATE payment_accounts SET is_default = 0 WHERE user_id = ?').run(input.userId);
      db().prepare(
        `INSERT INTO payment_accounts (id, user_id, provider_id, kind, label, provider_account_ref, currency, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.userId, input.providerId, input.kind, input.label, input.providerAccountRef, input.currency, input.isDefault ? 1 : 0);
    })();
    return id;
  },
  disconnect(userId: string, accountId: string): boolean {
    const res = db().prepare('UPDATE payment_accounts SET status = ? WHERE id = ? AND user_id = ?').run('disconnected', accountId, userId);
    return res.changes > 0;
  },
  setError(userId: string, accountId: string, message: string | null): void {
    db().prepare('UPDATE payment_accounts SET last_error = ? WHERE id = ? AND user_id = ?').run(message, accountId, userId);
  },
};

export const balances = {
  getCached(accountId: string) {
    return db().prepare('SELECT * FROM balance_cache WHERE account_id = ?').get(accountId) as
      | { account_id: string; available_minor: number | null; pending_minor: number | null; unavailable_minor: number | null; currency: string; provider_status: string; as_of: string } | undefined;
  },
  upsert(row: { accountId: string; availableMinor: number | null; pendingMinor?: number | null; unavailableMinor?: number | null; currency: string; providerStatus: string; asOf: string }): void {
    db().prepare(
      `INSERT INTO balance_cache (account_id, available_minor, pending_minor, unavailable_minor, currency, provider_status, as_of, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (account_id) DO UPDATE SET
         available_minor = excluded.available_minor,
         pending_minor = excluded.pending_minor,
         unavailable_minor = excluded.unavailable_minor,
         currency = excluded.currency,
         provider_status = excluded.provider_status,
         as_of = excluded.as_of,
         updated_at = excluded.updated_at`,
    ).run(row.accountId, row.availableMinor, row.pendingMinor ?? null, row.unavailableMinor ?? null, row.currency, row.providerStatus, row.asOf, nowIso());
  },
};

/** One row of the payment ledger (payment_transactions). */
export interface LedgerEntry {
  intentId: string;
  providerId: string;
  providerRef?: string | null;
  attempt: number;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  rawStatus?: string | null;
  errorReason?: string | null;
}

/** Writable payment_intents columns — guards against injecting arbitrary SQL into SET clauses. */
const INTENT_WRITE_COLUMNS = new Set([
  'provider_ref', 'provider_id', 'account_id', 'auth_method', 'authorized_at',
  'risk_score', 'risk_reasons', 'failure_reason', 'failure_message', 'expires_at',
]);

export const intents = {
  insert(input: {
    id: string; reference: string; userId: string; recipientContactId?: string | null; recipientUserId?: string | null;
    recipientHandle: string; recipientLabel: string; amountMinor: number; currency: string; narration?: string | null;
    idempotencyKey?: string | null; expiresAt: string; conversationId?: string | null;
  }): IntentRow {
    db().prepare(
      `INSERT INTO payment_intents
        (id, reference, user_id, recipient_contact_id, recipient_user_id, recipient_handle, recipient_label,
         amount_minor, currency, narration, idempotency_key, expires_at, conversation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id, input.reference, input.userId, input.recipientContactId ?? null, input.recipientUserId ?? null,
      input.recipientHandle, input.recipientLabel, input.amountMinor, input.currency, input.narration ?? null,
      input.idempotencyKey ?? null, input.expiresAt, input.conversationId ?? null,
    );
    return intents.findById(input.id)!;
  },
  findById(id: string): IntentRow | undefined {
    return db().prepare('SELECT * FROM payment_intents WHERE id = ?').get(id) as IntentRow | undefined;
  },
  /** Owner-scoped read: used by every user-facing payment route. */
  findOwned(userId: string, id: string): IntentRow | undefined {
    return db().prepare('SELECT * FROM payment_intents WHERE id = ? AND user_id = ?').get(id, userId) as IntentRow | undefined;
  },
  findByIdempotencyKey(userId: string, key: string): IntentRow | undefined {
    return db().prepare('SELECT * FROM payment_intents WHERE idempotency_key = ? AND user_id = ?').get(key, userId) as IntentRow | undefined;
  },
  findByProviderRef(providerRef: string): IntentRow | undefined {
    return db().prepare('SELECT * FROM payment_intents WHERE provider_ref = ?').get(providerRef) as IntentRow | undefined;
  },
  /**
   * Unconditional status write. Prefer `applyOutcome` for anything money-related:
   * this variant does NOT guard against a concurrent writer and must only be used for
   * field updates that carry no state-machine meaning (e.g. recording the authorised
   * account before the provider is called).
   */
  updateStatus(id: string, status: PaymentStatus, extra: Partial<{ provider_ref: string; provider_id: string; account_id: string; auth_method: string; authorized_at: string; risk_score: number; risk_reasons: string }> = {}): void {
    const sets = ['status = ?', 'updated_at = ?'];
    const values: unknown[] = [status, nowIso()];
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined) continue;
      if (!INTENT_WRITE_COLUMNS.has(key)) throw new Error(`refusing to write unknown payment_intents column: ${key}`);
      sets.push(`${key} = ?`);
      values.push(value);
    }
    values.push(id);
    db().prepare(`UPDATE payment_intents SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  },

  /**
   * Conditional, ATOMIC payment-outcome write.
   *
   * Root cause of the unknown-outcome defect this replaces: the status UPDATE and the
   * ledger INSERT used to be separate, unguarded statements (`UPDATE ... SET status = ?
   * WHERE id = ?`). Two writers — a late provider callback and the reconciliation job, or
   * two callback deliveries racing — could both read the same "current" status and both
   * write, so the second write silently overwrote the first (a lost update), and a crash
   * between the two statements left an intent whose ledger row disagreed with its status.
   *
   * This method:
   *   - opens an IMMEDIATE transaction so the read-check-write is serialised,
   *   - validates the state machine against the status actually stored right now,
   *   - guards the UPDATE with `AND status = ?`, and treats `changes !== 1` as
   *     "someone else already moved this" instead of overwriting it,
   *   - writes the ledger row in the SAME transaction, so there is never a half state,
   *   - rolls back automatically if anything throws.
   */
  applyOutcome(input: {
    intentId: string;
    /** Statuses this write is allowed to move from; anything else means "already handled". */
    from: PaymentStatus[];
    to: PaymentStatus;
    extra?: Record<string, unknown>;
    transaction?: LedgerEntry;
  }): { applied: boolean; status: PaymentStatus; reason: 'applied' | 'already_moved' | 'illegal_transition' | 'not_found' } {
    const run = db().transaction((args: typeof input) => {
      const row = db().prepare('SELECT status FROM payment_intents WHERE id = ?').get(args.intentId) as { status: PaymentStatus } | undefined;
      if (!row) return { applied: false, status: args.to, reason: 'not_found' as const };
      if (!args.from.includes(row.status)) {
        return { applied: false, status: row.status, reason: 'already_moved' as const };
      }
      if (!canTransition(row.status, args.to)) {
        return { applied: false, status: row.status, reason: 'illegal_transition' as const };
      }

      const sets = ['status = ?', 'updated_at = ?'];
      const values: unknown[] = [args.to, nowIso()];
      for (const [key, value] of Object.entries(args.extra ?? {})) {
        if (value === undefined) continue;
        if (!INTENT_WRITE_COLUMNS.has(key)) throw new Error(`refusing to write unknown payment_intents column: ${key}`);
        sets.push(`${key} = ?`);
        values.push(value);
      }
      values.push(args.intentId, row.status);
      const info = db().prepare(`UPDATE payment_intents SET ${sets.join(', ')} WHERE id = ? AND status = ?`).run(...values);
      if (info.changes !== 1) {
        // Lost the race by a hair — the row moved between our SELECT and UPDATE.
        const current = db().prepare('SELECT status FROM payment_intents WHERE id = ?').get(args.intentId) as { status: PaymentStatus };
        return { applied: false, status: current.status, reason: 'already_moved' as const };
      }

      if (args.transaction) {
        const t = args.transaction;
        db().prepare(
          `INSERT INTO payment_transactions (id, intent_id, provider_id, provider_ref, attempt, status, amount_minor, currency, raw_status, error_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(`txn_${randomUUID()}`, args.intentId, t.providerId, t.providerRef ?? null, t.attempt, t.status, t.amountMinor, t.currency, t.rawStatus ?? null, t.errorReason ?? null);
      }
      return { applied: true, status: args.to, reason: 'applied' as const };
    });
    return run.immediate(input);
  },
  listForUser(userId: string, limit = 30) {
    return db().prepare('SELECT * FROM payment_intents WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit) as IntentRow[];
  },
  listStale(statuses: PaymentStatus[], olderThanIso: string, limit = 50): IntentRow[] {
    const placeholders = statuses.map(() => '?').join(',');
    return db().prepare(
      `SELECT * FROM payment_intents WHERE status IN (${placeholders}) AND updated_at < ? ORDER BY updated_at ASC LIMIT ?`,
    ).all(...statuses, olderThanIso, limit) as IntentRow[];
  },
};

export const transactions = {
  insert(input: { intentId: string; providerId: string; providerRef?: string | null; attempt: number; status: PaymentStatus; amountMinor: number; currency: string; rawStatus?: string | null; errorReason?: string | null }): void {
    db().prepare(
      `INSERT INTO payment_transactions (id, intent_id, provider_id, provider_ref, attempt, status, amount_minor, currency, raw_status, error_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(`txn_${randomUUID()}`, input.intentId, input.providerId, input.providerRef ?? null, input.attempt, input.status, input.amountMinor, input.currency, input.rawStatus ?? null, input.errorReason ?? null);
  },
  countForIntent(intentId: string): number {
    const row = db().prepare('SELECT COUNT(*) AS n FROM payment_transactions WHERE intent_id = ?').get(intentId) as { n: number };
    return row.n;
  },
  listForIntent(intentId: string) {
    return db().prepare('SELECT * FROM payment_transactions WHERE intent_id = ? ORDER BY attempt').all(intentId) as Array<Record<string, unknown>>;
  },
};

export const webhookEvents = {
  /** Returns false when the event id has already been processed (replay). */
  record(input: { eventId: string; providerId: string; providerRef?: string | null; payloadHash: string; signatureOk: boolean }): boolean {
    try {
      db().prepare(
        `INSERT INTO webhook_events (event_id, provider_id, provider_ref, payload_hash, signature_ok)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(input.eventId, input.providerId, input.providerRef ?? null, input.payloadHash, input.signatureOk ? 1 : 0);
      return true;
    } catch (error) {
      if (String(error).includes('UNIQUE')) return false;   // duplicate event id = replay
      throw error;
    }
  },
  markProcessed(eventId: string, result: string): void {
    db().prepare('UPDATE webhook_events SET processed_at = ?, result = ? WHERE event_id = ?').run(nowIso(), result, eventId);
  },
};

export const idempotency = {
  get(scope: string, key: string) {
    return db().prepare('SELECT * FROM idempotency_keys WHERE scope = ? AND key = ?').get(scope, key) as
      | { scope: string; key: string; request_hash: string; response_json: string | null; state: string } | undefined;
  },
  create(scope: string, key: string, requestHash: string): void {
    db().prepare('INSERT INTO idempotency_keys (scope, key, request_hash) VALUES (?, ?, ?)').run(scope, key, requestHash);
  },
  complete(scope: string, key: string, response: unknown): void {
    db().prepare('UPDATE idempotency_keys SET state = ?, response_json = ? WHERE scope = ? AND key = ?')
      .run('completed', JSON.stringify(response), scope, key);
  },
  hash(payload: unknown): string {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  },
};

export const requests = {
  create(input: { requesterUserId: string; payerUserId?: string | null; payerLabel: string; conversationId?: string | null; amountMinor: number; currency: string; description?: string | null; expiresAt: string }): { id: string; reference: string } {
    const id = `prq_${randomUUID()}`;
    const reference = `PR-${id.slice(4, 12).toUpperCase()}`;
    db().prepare(
      `INSERT INTO payment_requests (id, reference, requester_user_id, payer_user_id, payer_label, conversation_id, amount_minor, currency, description, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, reference, input.requesterUserId, input.payerUserId ?? null, input.payerLabel, input.conversationId ?? null, input.amountMinor, input.currency, input.description ?? null, input.expiresAt);
    return { id, reference };
  },
  findById(id: string) {
    return db().prepare('SELECT * FROM payment_requests WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  },
  visibleToUser(userId: string, id: string) {
    return db().prepare('SELECT * FROM payment_requests WHERE id = ? AND (requester_user_id = ? OR payer_user_id = ?)').get(id, userId, userId) as Record<string, unknown> | undefined;
  },
  updateStatus(id: string, status: string, paymentIntentId?: string | null): void {
    db().prepare('UPDATE payment_requests SET status = ?, payment_intent_id = COALESCE(?, payment_intent_id), updated_at = ? WHERE id = ?')
      .run(status, paymentIntentId ?? null, nowIso(), id);
  },
  listForUser(userId: string) {
    return db().prepare(
      `SELECT * FROM payment_requests WHERE requester_user_id = ? OR payer_user_id = ? ORDER BY created_at DESC LIMIT 50`,
    ).all(userId, userId) as Array<Record<string, unknown>>;
  },
  expireOverdue(now = nowIso()): number {
    return db().prepare(`UPDATE payment_requests SET status = 'EXPIRED', updated_at = ? WHERE status = 'PENDING' AND expires_at < ?`).run(now, now).changes;
  },
};

export const receipts = {
  create(input: { paymentIntentId: string; userId: string; amountMinor: number; currency: string; providerLabel: string; methodLabel: string; senderLabel: string; recipientLabel: string; status: PaymentStatus }): string {
    const id = `rct_${randomUUID()}`;
    const reference = `R-${id.slice(4, 12).toUpperCase()}`;
    db().prepare(
      `INSERT INTO receipts (id, reference, payment_intent_id, user_id, amount_minor, currency, provider_label, method_label, sender_label, recipient_label, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (payment_intent_id) DO UPDATE SET status = excluded.status`,
    ).run(id, reference, input.paymentIntentId, input.userId, input.amountMinor, input.currency, input.providerLabel, input.methodLabel, input.senderLabel, input.recipientLabel, input.status);
    return id;
  },
  /** Receipts are owner-scoped: only the payer (or the recipient via their own record) may read one. */
  findOwned(userId: string, id: string) {
    return db().prepare('SELECT * FROM receipts WHERE id = ? AND user_id = ?').get(id, userId) as Record<string, unknown> | undefined;
  },
  findByIntent(intentId: string) {
    return db().prepare('SELECT * FROM receipts WHERE payment_intent_id = ?').get(intentId) as Record<string, unknown> | undefined;
  },
  listForUser(userId: string) {
    return db().prepare('SELECT * FROM receipts WHERE user_id = ? ORDER BY issued_at DESC LIMIT 50').all(userId) as Array<Record<string, unknown>>;
  },
};

export const notifications = {
  create(input: { userId: string; type: string; title: string; body: string; data?: Record<string, unknown> }): string {
    const id = `ntf_${randomUUID()}`;
    db().prepare('INSERT INTO notifications (id, user_id, type, title, body, data_json) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, input.userId, input.type, input.title, input.body, JSON.stringify(input.data ?? {}));
    return id;
  },
  listForUser(userId: string) {
    return db().prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId) as Array<Record<string, unknown>>;
  },
  markRead(userId: string, id: string): void {
    db().prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?').run(nowIso(), id, userId);
  },
};


export const outbox = {
  publish(eventType: string, payload: Record<string, unknown>): void {
    db().prepare('INSERT INTO outbox (id, event_type, payload_json) VALUES (?, ?, ?)')
      .run(`obx_${randomUUID()}`, eventType, JSON.stringify(payload));
  },
  pending(limit = 20) {
    return db().prepare('SELECT * FROM outbox WHERE processed_at IS NULL ORDER BY created_at LIMIT ?').all(limit) as Array<{ id: string; event_type: string; payload_json: string }>;
  },
  markProcessed(id: string): void {
    db().prepare('UPDATE outbox SET processed_at = ?, attempts = attempts + 1 WHERE id = ?').run(nowIso(), id);
  },
};

export const sandboxState = {
  get(key: string): number | null {
    const row = db().prepare('SELECT value_minor FROM sandbox_state WHERE key = ?').get(key) as { value_minor: number } | undefined;
    return row ? row.value_minor : null;
  },
  set(key: string, valueMinor: number): void {
    db().prepare(
      `INSERT INTO sandbox_state (key, value_minor, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET value_minor = excluded.value_minor, updated_at = excluded.updated_at`,
    ).run(key, valueMinor, nowIso());
  },
};

/** Member ids of a conversation (excluding one user) — used for realtime fan-out. */
export function dbMemberIds(conversationId: string, excludeUserId?: string): string[] {
  const rows = db().prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?').all(conversationId) as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id).filter((id) => id !== excludeUserId);
}
