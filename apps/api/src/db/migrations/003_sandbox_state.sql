-- Simulated ledger for the sandbox rail (development/test only).
-- Lives in the database so a fresh provider instance still sees the same balances.
CREATE TABLE IF NOT EXISTS sandbox_state (
  key         TEXT PRIMARY KEY,
  value_minor INTEGER NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
