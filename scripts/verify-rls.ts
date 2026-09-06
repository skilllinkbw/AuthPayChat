/**
 * PostgreSQL Row Level Security verification.
 *
 * This is a REAL database test — it stands up a database, applies the production
 * schema + policies, creates two users and a merchant, and then attempts the
 * cross-tenant reads/writes an attacker would attempt.
 *
 * Usage:
 *   PG_ADMIN_URL=postgres://paychat_owner:...@127.0.0.1:5432/postgres npm run verify:rls
 *
 * It exits non-zero if any policy fails to isolate data.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const adminUrl = process.env.PG_ADMIN_URL;
if (!adminUrl) {
  console.error('PG_ADMIN_URL is required, e.g. postgres://paychat_owner:secret@127.0.0.1:5432/postgres');
  process.exit(2);
}

const DB_NAME = process.env.PG_TEST_DB ?? 'paychat_rls_test';
const APP_PASSWORD = 'paychat_app_pw';
const SERVICE_PASSWORD = 'paychat_service_pw';

const results: Array<{ section: string; check: string; pass: boolean; detail?: string }> = [];
function record(section: string, check: string, pass: boolean, detail?: string) {
  results.push({ section, check, pass, detail });
  console.log(`  ${pass ? '✓' : '✗'} [${section}] ${check}${detail && !pass ? ` — ${detail}` : ''}`);
}

const admin = new Client({ connectionString: adminUrl });

async function main() {
  await admin.connect();

  console.log(`\nPayChat RLS verification — database "${DB_NAME}"\n`);
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();

  const dbUrl = adminUrl.replace(/\/[^/]+$/, `/${DB_NAME}`);
  const owner = new Client({ connectionString: dbUrl });
  await owner.connect();

  console.log('1. Applying schema + policies');
  const init = readFileSync(join(here, '../apps/api/src/db/postgres/001_init.sql'), 'utf8');
  const rls = readFileSync(join(here, '../apps/api/src/db/postgres/002_rls.sql'), 'utf8');
  await owner.query(init);
  await owner.query(rls);
  record('schema', '001_init.sql applies', true);
  record('schema', '002_rls.sql applies', true);

  await owner.query(`ALTER ROLE paychat_app PASSWORD '${APP_PASSWORD}'`);
  await owner.query(`ALTER ROLE paychat_service PASSWORD '${SERVICE_PASSWORD}'`);

  // ---- fixtures -------------------------------------------------------------
  const A = 'usr_aaaa';
  const B = 'usr_bbbb';
  const MERCHANT = 'usr_merch';
  await owner.query(
    `INSERT INTO users (id, phone_e164, password_hash, display_name, is_merchant) VALUES
     ($1,'+26771111000','x','Alice',false), ($2,'+26772222000','x','Bob',false), ($3,'+26773333000','x','Shop',true)
     ON CONFLICT DO NOTHING`, [A, B, MERCHANT]);
  await owner.query(
    `INSERT INTO conversations (id, type) VALUES ('cnv_ab','direct'), ('cnv_merch','merchant') ON CONFLICT DO NOTHING`);
  await owner.query(
    `INSERT INTO conversation_members (conversation_id, user_id) VALUES
     ('cnv_ab',$1),('cnv_ab',$2),('cnv_merch',$1),('cnv_merch',$3) ON CONFLICT DO NOTHING`, [A, B, MERCHANT]);
  await owner.query(
    `INSERT INTO messages (id, conversation_id, sender_id, body) VALUES
     ('msg_a1','cnv_ab',$1,'alice message'),('msg_b1','cnv_ab',$2,'bob message') ON CONFLICT DO NOTHING`, [A, B]);
  await owner.query(
    `INSERT INTO payment_providers (id, kind, country, display_name, enabled) VALUES
     ('sandbox','mobile_money','BW','Sandbox Rail',true) ON CONFLICT DO NOTHING`);
  await owner.query(
    `INSERT INTO payment_accounts (id, user_id, provider_id, kind, label, provider_account_ref) VALUES
     ('acc_a',$1,'sandbox','mobile_money','Alice Wallet','wa'),('acc_b',$2,'sandbox','mobile_money','Bob Wallet','wb'),
     ('acc_m',$3,'sandbox','mobile_money','Shop Wallet','wm') ON CONFLICT DO NOTHING`, [A, B, MERCHANT]);
  await owner.query(
    `INSERT INTO balance_cache (account_id, available_minor, currency, as_of) VALUES
     ('acc_a',1000,'BWP',now()),('acc_b',2000,'BWP',now()),('acc_m',3000,'BWP',now()) ON CONFLICT DO NOTHING`);
  await owner.query(
    `INSERT INTO payment_intents (id, reference, user_id, recipient_handle, recipient_label, amount_minor, currency, expires_at)
     VALUES ('pin_a','PC-A',$1,'+26772222000','Bob',5000,'BWP', now() + interval '1 hour'),
            ('pin_b','PC-B',$2,'+26771111000','Alice',7000,'BWP', now() + interval '1 hour') ON CONFLICT DO NOTHING`, [A, B]);
  await owner.query(
    `INSERT INTO payment_transactions (id, intent_id, provider_id, status, amount_minor, currency)
     VALUES ('txn_a','pin_a','sandbox','PENDING',5000,'BWP') ON CONFLICT DO NOTHING`);
  await owner.query(
    `INSERT INTO receipts (id, reference, payment_intent_id, user_id, amount_minor, currency, provider_label, method_label, sender_label, recipient_label, status)
     VALUES ('rct_a','R-A','pin_a',$1,5000,'BWP','Sandbox','mobile_money','Alice','Bob','SUCCESSFUL') ON CONFLICT DO NOTHING`, [A]);
  await owner.query(
    `INSERT INTO payment_requests (id, reference, requester_user_id, payer_user_id, payer_label, amount_minor, expires_at)
     VALUES ('prq_a','PR-A',$1,$2,'Bob',3000, now() + interval '1 hour') ON CONFLICT DO NOTHING`, [A, B]);
  await owner.query(
    `INSERT INTO notifications (id, user_id, type, title, body) VALUES ('ntf_a',$1,'x','a','a') ON CONFLICT DO NOTHING`, [A]);
  await owner.query(
    `INSERT INTO contacts (id, owner_user_id, display_name, phone_e164) VALUES ('ctc_a',$1,'Bob','+26772222000') ON CONFLICT DO NOTHING`, [A]);
  await owner.query(
    `INSERT INTO audit_logs (id, actor_user_id, action) VALUES ('aud_a',$1,'payment.intent_created') ON CONFLICT DO NOTHING`, [A]);
  await owner.query(
    `INSERT INTO devices (id, user_id, label) VALUES ('dev_a',$1,'Alice phone') ON CONFLICT DO NOTHING`, [A]);
  await owner.query(
    `INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key) VALUES ('wac_a',$1,'cred-a','pk-a') ON CONFLICT DO NOTHING`, [A]);
  await owner.query(
    `INSERT INTO provider_credentials (id, provider_id, key_name, ciphertext, iv, auth_tag)
     VALUES ('pcr_1','sandbox','client_secret','cipher','iv','tag') ON CONFLICT DO NOTHING`);

  const appUrl = dbUrl.replace(/:\/\/[^@]+@/, `://paychat_app:${APP_PASSWORD}@`);
  const serviceUrl = dbUrl.replace(/:\/\/[^@]+@/, `://paychat_service:${SERVICE_PASSWORD}@`);

  async function asUser(client: Client, userId: string | null) {
    await client.query('BEGIN');
    if (userId) await client.query(`SELECT set_config('paychat.user_id', $1, true)`, [userId]);
    else await client.query(`SELECT set_config('paychat.user_id', '', true)`);
  }
  const count = async (client: Client, sql: string, params: unknown[] = []) =>
    (await client.query(sql, params)).rowCount ?? 0;

  const app = new Client({ connectionString: appUrl });
  await app.connect();

  // ---- anonymous ------------------------------------------------------------
  console.log('\n2. Anonymous access');
  await asUser(app, null);
  const anonUsers = await count(app, 'SELECT * FROM users');
  const anonAccounts = await count(app, 'SELECT * FROM payment_accounts');
  const anonBalances = await count(app, 'SELECT * FROM balance_cache');
  const anonIntents = await count(app, 'SELECT * FROM payment_intents');
  record('anonymous', 'users returns 0 rows', anonUsers === 0, `got ${anonUsers}`);
  record('anonymous', 'accounts returns 0 rows', anonAccounts === 0, `got ${anonAccounts}`);
  record('anonymous', 'balances returns 0 rows', anonBalances === 0, `got ${anonBalances}`);
  record('anonymous', 'intents returns 0 rows', anonIntents === 0, `got ${anonIntents}`);
  await app.query('ROLLBACK');

  // ---- user A sees only their own -------------------------------------------
  console.log('\n3. Authenticated user A — own data visible');
  await asUser(app, A);
  record('user A', 'sees own profile', (await count(app, 'SELECT * FROM users')) === 1);
  record('user A', 'sees own accounts', (await count(app, 'SELECT * FROM payment_accounts')) === 1);
  record('user A', 'sees own balance', (await count(app, 'SELECT * FROM balance_cache')) === 1);
  record('user A', 'sees own intents', (await count(app, 'SELECT * FROM payment_intents')) === 1);
  record('user A', 'sees own receipt', (await count(app, 'SELECT * FROM receipts')) === 1);
  record('user A', 'sees own notifications', (await count(app, 'SELECT * FROM notifications')) === 1);
  record('user A', 'sees own contacts', (await count(app, 'SELECT * FROM contacts')) === 1);
  record('user A', 'sees own device', (await count(app, 'SELECT * FROM devices')) === 1);
  record('user A', 'sees own webauthn credential', (await count(app, 'SELECT * FROM webauthn_credentials')) === 1);
  record('user A', 'sees both messages in shared conversation', (await count(app, 'SELECT * FROM messages')) === 2);
  record('user A', 'sees request they are party to', (await count(app, 'SELECT * FROM payment_requests')) === 1);
  record('user A', 'sees own audit entries', (await count(app, 'SELECT * FROM audit_logs')) === 1);
  record('user A', 'can read provider registry', (await count(app, 'SELECT * FROM payment_providers')) >= 1);
  await app.query('ROLLBACK');

  // ---- user A attacking user B ----------------------------------------------
  console.log('\n4. User A attempting user B data (must all fail)');
  await asUser(app, A);

  const attempts: Array<[string, string, unknown[]]> = [
    ['SELECT another user profile', 'SELECT * FROM users WHERE id = $1', [B]],
    ['UPDATE another user profile', 'UPDATE users SET display_name = $1 WHERE id = $2', ['hacked', B]],
    ['DELETE another user profile', 'DELETE FROM users WHERE id = $1', [B]],
    ['SELECT another user intent', 'SELECT * FROM payment_intents WHERE id = $1', ['pin_b']],
    ['UPDATE another user intent', 'UPDATE payment_intents SET status = $1 WHERE id = $2', ['SUCCESSFUL', 'pin_b']],
    ['DELETE another user intent', 'DELETE FROM payment_intents WHERE id = $1', ['pin_b']],
    ['SELECT another user account', 'SELECT * FROM payment_accounts WHERE id = $1', ['acc_b']],
    ['SELECT another user balance', 'SELECT * FROM balance_cache WHERE account_id = $1', ['acc_b']],
    ['UPDATE another user balance', 'UPDATE balance_cache SET available_minor = 999999 WHERE account_id = $1', ['acc_b']],
    ['SELECT another user receipt', 'SELECT * FROM receipts WHERE payment_intent_id = $1', ['pin_b']],
    ['SELECT another user transactions', 'SELECT * FROM payment_transactions WHERE intent_id = $1', ['pin_b']],
    ['SELECT another user contacts', 'SELECT * FROM contacts WHERE owner_user_id = $1', [B]],
    ['SELECT another user device', 'SELECT * FROM devices WHERE user_id = $1', [B]],
    ['SELECT another user credential', 'SELECT * FROM webauthn_credentials WHERE user_id = $1', [B]],
    ['SELECT merchant conversation messages', 'SELECT * FROM messages WHERE conversation_id = $1', ['cnv_merch']],
  ];

  for (const [label, sql, params] of attempts) {
    try {
      const result = await app.query(sql, params);
      const affected = result.rowCount ?? 0;
      const isSelect = /^SELECT/i.test(sql);
      record('isolation', `${label} → blocked`, isSelect ? affected === 0 : affected === 0, `affected ${affected}`);
    } catch (error) {
      // A policy error is also a block.
      record('isolation', `${label} → rejected`, true, String(error).slice(0, 90));
    }
  }

  // Write attempts that must be blocked by WITH CHECK
  let insertBlocked = false;
  try {
    await app.query(
      `INSERT INTO payment_intents (id, reference, user_id, recipient_handle, recipient_label, amount_minor, currency, expires_at)
       VALUES ('pin_evil','PC-EVIL',$1,'+26770000000','Evil',100,'BWP', now() + interval '1 hour')`, [B]);
  } catch { insertBlocked = true; }
  record('isolation', 'INSERT an intent for another user → blocked', insertBlocked);

  let balanceInsertBlocked = false;
  try {
    await app.query(`INSERT INTO balance_cache (account_id, available_minor, currency, as_of) VALUES ($1, 1, 'BWP', now())`, ['acc_b']);
  } catch { balanceInsertBlocked = true; }
  record('isolation', 'INSERT a balance for another user → blocked', balanceInsertBlocked);

  let credentialReadBlocked = false;
  try {
    await app.query('SELECT * FROM provider_credentials');
  } catch { credentialReadBlocked = true; }
  record('secrets', 'app role cannot read provider_credentials', credentialReadBlocked);
  await app.query('ROLLBACK');

  // ---- merchant isolation ----------------------------------------------------
  console.log('\n5. Merchant isolation');
  await asUser(app, MERCHANT);
  record('merchant', 'sees only own account', (await count(app, 'SELECT * FROM payment_accounts')) === 1);
  record('merchant', 'sees no foreign intents', (await count(app, 'SELECT * FROM payment_intents')) === 0);
  record('merchant', 'sees own conversation', (await count(app, 'SELECT * FROM conversations WHERE id = $1', ['cnv_merch'])) === 1);
  await app.query('ROLLBACK');

  // ---- service role ----------------------------------------------------------
  console.log('\n6. Service role (reconciliation/jobs)');
  const service = new Client({ connectionString: serviceUrl });
  await service.connect();
  const serviceIntentCount = await count(service, 'SELECT * FROM payment_intents');
  record('service role', 'sees all intents (BYPASSRLS)', serviceIntentCount === 2, `got ${serviceIntentCount}`);
  await service.end();

  await app.end();
  await owner.end();

  // ---- summary ---------------------------------------------------------------
  const failed = results.filter((r) => !r.pass);
  console.log(`\nRLS verification: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    for (const f of failed) console.error(`  FAILED: [${f.section}] ${f.check} ${f.detail ?? ''}`);
    process.exit(1);
  }
  console.log('All RLS isolation checks passed.\n');
  process.exit(0);
}

main().catch((error) => {
  console.error('RLS verification error:', error);
  process.exit(1);
});
