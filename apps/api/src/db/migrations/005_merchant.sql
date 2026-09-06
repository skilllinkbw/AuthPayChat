-- Merchant onboarding + QR/payment-link tracking.
ALTER TABLE profiles ADD COLUMN merchant_category TEXT;
ALTER TABLE profiles ADD COLUMN settlement_currency TEXT NOT NULL DEFAULT 'BWP';

CREATE TABLE IF NOT EXISTS merchant_transactions (
  id             TEXT PRIMARY KEY,
  merchant_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  intent_id      TEXT REFERENCES payment_intents(id) ON DELETE SET NULL,
  reference      TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL,
  currency       TEXT NOT NULL,
  status         TEXT NOT NULL,
  customer_label TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_merchant_txn ON merchant_transactions(merchant_id, created_at);

CREATE TABLE IF NOT EXISTS payment_links (
  id          TEXT PRIMARY KEY,
  jti         TEXT NOT NULL UNIQUE,
  creator_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_minor INTEGER,
  currency    TEXT NOT NULL DEFAULT 'BWP',
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'OPEN',     -- OPEN | PAID | EXPIRED | CANCELLED
  intent_id   TEXT,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_links_creator ON payment_links(creator_id, created_at);
