-- Provider registry: runtime configuration + encrypted credentials.
ALTER TABLE payment_providers ADD COLUMN config TEXT NOT NULL DEFAULT '{}';
ALTER TABLE payment_providers ADD COLUMN updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'));

CREATE TABLE IF NOT EXISTS provider_credentials (
  id          TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES payment_providers(id) ON DELETE CASCADE,
  key_name    TEXT NOT NULL,
  ciphertext  TEXT NOT NULL,
  iv          TEXT NOT NULL,
  auth_tag    TEXT NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (provider_id, key_name)
);
