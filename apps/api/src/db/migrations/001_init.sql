-- PayChat core schema (SQLite). Postgres + RLS variant lives in db/postgres/.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id                TEXT PRIMARY KEY,
  phone_e164        TEXT NOT NULL UNIQUE,
  email             TEXT UNIQUE,
  password_hash     TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  default_currency  TEXT NOT NULL DEFAULT 'BWP',
  language          TEXT NOT NULL DEFAULT 'en',
  hide_balances     INTEGER NOT NULL DEFAULT 0,
  is_merchant       INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  avatar_color  TEXT NOT NULL DEFAULT '#0B3B8C',
  bio           TEXT,
  business_name TEXT,
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL UNIQUE,
  device_id          TEXT REFERENCES devices(id) ON DELETE SET NULL,
  device_label       TEXT,
  ip                 TEXT,
  user_agent         TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at         TEXT NOT NULL,
  revoked_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS devices (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label        TEXT,
  platform     TEXT,
  first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  trusted      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);

-- WebAuthn platform authenticators (fingerprint / face). Raw biometric templates are NEVER stored:
-- only the public key, credential id and signature counter.
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key    TEXT NOT NULL,
  counter       INTEGER NOT NULL DEFAULT 0,
  transports    TEXT,
  device_label  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_webauthn_user ON webauthn_credentials(user_id);

CREATE TABLE IF NOT EXISTS contacts (
  id              TEXT PRIMARY KEY,
  owner_user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  display_name    TEXT NOT NULL,
  phone_e164      TEXT NOT NULL,
  is_merchant     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (owner_user_id, contact_user_id),
  UNIQUE (owner_user_id, phone_e164)
);
CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_user_id);

CREATE TABLE IF NOT EXISTS conversations (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL DEFAULT 'direct',
  title           TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_message_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'member',
  joined_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_read_at    TEXT,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON conversation_members(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id                 TEXT PRIMARY KEY,
  conversation_id    TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id          TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind               TEXT NOT NULL DEFAULT 'text',
  body               TEXT,
  client_msg_id      TEXT,
  payment_intent_id  TEXT,
  payment_request_id TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (conversation_id, client_msg_id)
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS payment_providers (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL,
  country      TEXT NOT NULL,
  display_name TEXT NOT NULL,
  base_url     TEXT,
  enabled      INTEGER NOT NULL DEFAULT 0,
  capabilities TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS payment_accounts (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id         TEXT NOT NULL REFERENCES payment_providers(id),
  kind                TEXT NOT NULL,
  label               TEXT NOT NULL,
  provider_account_ref TEXT NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'BWP',
  is_default          INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'connected',
  last_error          TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON payment_accounts(user_id);

CREATE TABLE IF NOT EXISTS balance_cache (
  account_id        TEXT PRIMARY KEY REFERENCES payment_accounts(id) ON DELETE CASCADE,
  available_minor   INTEGER,
  pending_minor     INTEGER,
  unavailable_minor INTEGER,
  currency          TEXT NOT NULL,
  provider_status   TEXT NOT NULL DEFAULT 'ok',
  as_of             TEXT NOT NULL,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS payment_intents (
  id                 TEXT PRIMARY KEY,
  reference          TEXT NOT NULL UNIQUE,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_contact_id TEXT,
  recipient_user_id  TEXT,
  recipient_handle   TEXT NOT NULL,
  recipient_label    TEXT NOT NULL,
  amount_minor       INTEGER NOT NULL,
  currency           TEXT NOT NULL DEFAULT 'BWP',
  provider_id        TEXT,
  account_id         TEXT,
  narration          TEXT,
  status             TEXT NOT NULL DEFAULT 'CREATED',
  idempotency_key    TEXT UNIQUE,
  provider_ref       TEXT,
  risk_score         INTEGER NOT NULL DEFAULT 0,
  risk_reasons       TEXT NOT NULL DEFAULT '[]',
  auth_method        TEXT,
  authorized_at      TEXT,
  expires_at         TEXT NOT NULL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  conversation_id    TEXT
);
CREATE INDEX IF NOT EXISTS idx_intents_user ON payment_intents(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_intents_status ON payment_intents(status, updated_at);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id            TEXT PRIMARY KEY,
  intent_id     TEXT NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  provider_id   TEXT NOT NULL,
  provider_ref  TEXT,
  attempt       INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL,
  amount_minor  INTEGER NOT NULL,
  currency      TEXT NOT NULL,
  raw_status    TEXT,
  error_reason  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_txn_intent ON payment_transactions(intent_id);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id      TEXT PRIMARY KEY,
  provider_id   TEXT NOT NULL,
  provider_ref  TEXT,
  payload_hash  TEXT NOT NULL,
  signature_ok  INTEGER NOT NULL DEFAULT 0,
  received_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  processed_at  TEXT,
  result        TEXT
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope         TEXT NOT NULL,
  key           TEXT NOT NULL,
  request_hash  TEXT NOT NULL,
  response_json TEXT,
  state         TEXT NOT NULL DEFAULT 'in_progress',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (scope, key)
);

CREATE TABLE IF NOT EXISTS payment_requests (
  id                TEXT PRIMARY KEY,
  reference         TEXT NOT NULL UNIQUE,
  requester_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payer_user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  payer_label       TEXT NOT NULL,
  conversation_id   TEXT,
  amount_minor      INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'BWP',
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'PENDING',
  payment_intent_id TEXT,
  expires_at        TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_requests_requester ON payment_requests(requester_user_id);
CREATE INDEX IF NOT EXISTS idx_requests_payer ON payment_requests(payer_user_id);

CREATE TABLE IF NOT EXISTS receipts (
  id                TEXT PRIMARY KEY,
  reference         TEXT NOT NULL UNIQUE,
  payment_intent_id TEXT NOT NULL UNIQUE REFERENCES payment_intents(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_minor      INTEGER NOT NULL,
  currency          TEXT NOT NULL,
  provider_label    TEXT NOT NULL,
  method_label      TEXT NOT NULL,
  sender_label      TEXT NOT NULL,
  recipient_label   TEXT NOT NULL,
  status            TEXT NOT NULL,
  issued_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  data_json  TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_type    TEXT NOT NULL DEFAULT 'user',
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  ip            TEXT,
  user_agent    TEXT,
  metadata_json TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_user_id, created_at);

CREATE TABLE IF NOT EXISTS outbox (
  id          TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
