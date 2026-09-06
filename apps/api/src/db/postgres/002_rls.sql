-- ============================================================================
-- PayChat — PostgreSQL Row Level Security
--
-- Apply AFTER 001_init.sql.  Idempotent (DROP POLICY IF EXISTS before CREATE).
--
-- How the app identifies the caller:
--   SET LOCAL paychat.user_id = 'usr_...'      -- set per request/transaction by the API
--   (Supabase/PostgREST style `request.jwt.claim.sub` is also honoured when present.)
--
-- Roles:
--   paychat_app     — application role, RLS applies (NOBYPASSRLS)
--   paychat_service — background jobs / reconciliation, BYPASSRLS (use sparingly)
--
-- Verified by: scripts/verify-rls.ts  (run: npm run verify:rls)
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS paychat;

CREATE OR REPLACE FUNCTION paychat.current_user_id() RETURNS text AS $$
  SELECT COALESCE(
    NULLIF(current_setting('paychat.user_id', true), ''),
    NULLIF(current_setting('request.jwt.claim.sub', true), '')
  );
$$ LANGUAGE sql STABLE;

-- Helper: is the caller a member of this conversation?
CREATE OR REPLACE FUNCTION paychat.is_conversation_member(conversation_id text) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversation_members m
     WHERE m.conversation_id = $1 AND m.user_id = paychat.current_user_id()
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ── Grants ──────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paychat_app') THEN
    CREATE ROLE paychat_app LOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paychat_service') THEN
    CREATE ROLE paychat_service LOGIN BYPASSRLS;
  END IF;
END
$$;

ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE balance_cache        ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_intents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox               ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_credentials ENABLE ROW LEVEL SECURITY;

-- Force RLS even for the table owner (defence in depth against a compromised app role).
ALTER TABLE users                FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_accounts     FORCE ROW LEVEL SECURITY;
ALTER TABLE balance_cache        FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_intents      FORCE ROW LEVEL SECURITY;
ALTER TABLE payment_requests     FORCE ROW LEVEL SECURITY;
ALTER TABLE receipts             FORCE ROW LEVEL SECURITY;
ALTER TABLE messages             FORCE ROW LEVEL SECURITY;

-- ── Users & profiles: only yourself ─────────────────────────────────────────
DROP POLICY IF EXISTS users_self ON users;
CREATE POLICY users_self ON users
  FOR ALL TO paychat_app
  USING (id = paychat.current_user_id())
  WITH CHECK (id = paychat.current_user_id());

DROP POLICY IF EXISTS profiles_self ON profiles;
CREATE POLICY profiles_self ON profiles
  FOR ALL TO paychat_app
  USING (user_id = paychat.current_user_id())
  WITH CHECK (user_id = paychat.current_user_id());

-- ── Devices, sessions, WebAuthn credentials ─────────────────────────────────
DROP POLICY IF EXISTS devices_self ON devices;
CREATE POLICY devices_self ON devices
  FOR ALL TO paychat_app
  USING (user_id = paychat.current_user_id())
  WITH CHECK (user_id = paychat.current_user_id());

DROP POLICY IF EXISTS sessions_self ON sessions;
CREATE POLICY sessions_self ON sessions
  FOR ALL TO paychat_app
  USING (user_id = paychat.current_user_id())
  WITH CHECK (user_id = paychat.current_user_id());

DROP POLICY IF EXISTS webauthn_self ON webauthn_credentials;
CREATE POLICY webauthn_self ON webauthn_credentials
  FOR ALL TO paychat_app
  USING (user_id = paychat.current_user_id())
  WITH CHECK (user_id = paychat.current_user_id());

-- ── Contacts: owner only ────────────────────────────────────────────────────
DROP POLICY IF EXISTS contacts_owner ON contacts;
CREATE POLICY contacts_owner ON contacts
  FOR ALL TO paychat_app
  USING (owner_user_id = paychat.current_user_id())
  WITH CHECK (owner_user_id = paychat.current_user_id());

-- ── Conversations & messages: members only ──────────────────────────────────
DROP POLICY IF EXISTS conversation_members_self ON conversation_members;
CREATE POLICY conversation_members_self ON conversation_members
  FOR ALL TO paychat_app
  USING (user_id = paychat.current_user_id())
  WITH CHECK (user_id = paychat.current_user_id());

DROP POLICY IF EXISTS conversations_member ON conversations;
CREATE POLICY conversations_member ON conversations
  FOR ALL TO paychat_app
  USING (paychat.is_conversation_member(id))
  WITH CHECK (paychat.is_conversation_member(id));

DROP POLICY IF EXISTS messages_member ON messages;
CREATE POLICY messages_member ON messages
  FOR ALL TO paychat_app
  USING (paychat.is_conversation_member(conversation_id))
  WITH CHECK (
    paychat.is_conversation_member(conversation_id)
    AND (sender_id IS NULL OR sender_id = paychat.current_user_id())
  );

-- ── Connected accounts + balances ───────────────────────────────────────────
DROP POLICY IF EXISTS accounts_owner ON payment_accounts;
CREATE POLICY accounts_owner ON payment_accounts
  FOR ALL TO paychat_app
  USING (user_id = paychat.current_user_id())
  WITH CHECK (user_id = paychat.current_user_id());

DROP POLICY IF EXISTS balances_owner ON balance_cache;
CREATE POLICY balances_owner ON balance_cache
  FOR ALL TO paychat_app
  USING (EXISTS (SELECT 1 FROM payment_accounts a WHERE a.id = account_id AND a.user_id = paychat.current_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM payment_accounts a WHERE a.id = account_id AND a.user_id = paychat.current_user_id()));

-- ── Payments: payer only ────────────────────────────────────────────────────
DROP POLICY IF EXISTS intents_owner ON payment_intents;
CREATE POLICY intents_owner ON payment_intents
  FOR ALL TO paychat_app
  USING (user_id = paychat.current_user_id())
  WITH CHECK (user_id = paychat.current_user_id());

DROP POLICY IF EXISTS transactions_owner ON payment_transactions;
CREATE POLICY transactions_owner ON payment_transactions
  FOR SELECT TO paychat_app
  USING (EXISTS (SELECT 1 FROM payment_intents i WHERE i.id = intent_id AND i.user_id = paychat.current_user_id()));

-- ── Requests: requester or payer ────────────────────────────────────────────
DROP POLICY IF EXISTS requests_parties ON payment_requests;
CREATE POLICY requests_parties ON payment_requests
  FOR ALL TO paychat_app
  USING (requester_user_id = paychat.current_user_id() OR payer_user_id = paychat.current_user_id())
  WITH CHECK (requester_user_id = paychat.current_user_id() OR payer_user_id = paychat.current_user_id());

-- ── Receipts & notifications ────────────────────────────────────────────────
DROP POLICY IF EXISTS receipts_owner ON receipts;
CREATE POLICY receipts_owner ON receipts
  FOR ALL TO paychat_app
  USING (user_id = paychat.current_user_id())
  WITH CHECK (user_id = paychat.current_user_id());

DROP POLICY IF EXISTS notifications_owner ON notifications;
CREATE POLICY notifications_owner ON notifications
  FOR ALL TO paychat_app
  USING (user_id = paychat.current_user_id())
  WITH CHECK (user_id = paychat.current_user_id());

-- ── Audit logs: readable by the actor, never writable by the app role ───────
DROP POLICY IF EXISTS audit_read_own ON audit_logs;
CREATE POLICY audit_read_own ON audit_logs
  FOR SELECT TO paychat_app
  USING (actor_user_id = paychat.current_user_id());

-- ── Provider registry & credentials: read-only for the app, no secrets exposed
DROP POLICY IF EXISTS providers_read ON payment_providers;
CREATE POLICY providers_read ON payment_providers
  FOR SELECT TO paychat_app USING (true);

DROP POLICY IF EXISTS provider_credentials_none ON provider_credentials;
CREATE POLICY provider_credentials_none ON provider_credentials
  FOR ALL TO paychat_app USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS outbox_none ON outbox;
CREATE POLICY outbox_none ON outbox
  FOR ALL TO paychat_app USING (false) WITH CHECK (false);


GRANT USAGE ON SCHEMA public TO paychat_app, paychat_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO paychat_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO paychat_service;
-- The app must never read the encrypted credential material or the internal outbox.
REVOKE ALL ON provider_credentials FROM paychat_app;
REVOKE ALL ON outbox FROM paychat_app;
GRANT EXECUTE ON FUNCTION paychat.current_user_id() TO paychat_app, paychat_service;
GRANT EXECUTE ON FUNCTION paychat.is_conversation_member(text) TO paychat_app, paychat_service;
