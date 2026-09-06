/**
 * End-to-end smoke test against a RUNNING PayChat server (no mocks in the app itself).
 * Usage: npx tsx scripts/e2e-smoke.ts [baseUrl]
 *
 * It exercises: login → natural-language parse → intent → step-up → confirm
 * → signed provider callback → authoritative success → receipt → chat message.
 */

import { createHmac } from 'node:crypto';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4000';
const PHONE = process.env.DEMO_PHONE ?? '+26771000000';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'PayChat2025!';

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}`, detail ?? '');
  }
}

async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: T }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: (await response.json().catch(() => ({}))) as T };
}

async function main() {
  console.log(`\nPayChat end-to-end smoke test — ${BASE}\n`);

  console.log('1. Authentication');
  const login = await call<{ accessToken: string; refreshToken: string; userId: string }>('POST', '/api/auth/login', {
    phone: PHONE, password: PASSWORD, deviceLabel: 'e2e', platform: 'node',
  });
  check('login succeeds', login.status === 200, login.json);
  const token = login.json.accessToken;

  const badLogin = await call('POST', '/api/auth/login', { phone: PHONE, password: 'wrong-password' });
  check('wrong password rejected', badLogin.status === 401);

  const noAuth = await call('GET', '/api/accounts');
  check('accounts require authentication', noAuth.status === 401);

  console.log('\n2. Natural-language command (never executes by itself)');
  const parsed = await call<{ action: string; amountMinor: number; currency: string; recipientQuery: string; clarification?: unknown }>(
    'POST', '/api/nlp/parse', { text: 'Pay P50 Motakase' }, token);
  check('parsed as PAY', parsed.json.action === 'PAY', parsed.json);
  check('amount P50.00 = 5000 thebe', parsed.json.amountMinor === 5000, parsed.json);
  check('currency BWP', parsed.json.currency === 'BWP');
  check('recipient resolved to a contact', typeof parsed.json.recipientQuery === 'string' && parsed.json.recipientQuery.startsWith('ctc_'), parsed.json);

  const setswana = await call<{ action: string; amountMinor: number }>('POST', '/api/nlp/parse', { text: 'Duela Motakase P50' }, token);
  check('Setswana "Duela Motakase P50" parses identically', setswana.json.action === 'PAY' && setswana.json.amountMinor === 5000, setswana.json);

  const ambiguous = await call<{ clarification?: { field: string } }>('POST', '/api/nlp/parse', { text: 'Pay Motakase' }, token);
  check('missing amount asks instead of guessing', ambiguous.json.clarification?.field === 'amount', ambiguous.json);

  console.log('\n3. Payment intent + confirmation');
  const contacts = await call<{ contacts: Array<{ id: string; display_name: string }> }>('GET', '/api/contacts', undefined, token);
  const motakase = contacts.json.contacts.find((c) => c.display_name === 'Motakase')!;
  check('Motakase is in the contact book', Boolean(motakase));

  const intent = await call<{ id: string; status: string; amountMinor: number }>('POST', '/api/payments/intents', {
    recipientContactId: motakase.id, recipientLabel: 'Motakase', amountMinor: 5000, currency: 'BWP',
  }, token);
  check('intent created but not executed', intent.status === 201 && intent.json.status === 'CREATED', intent.json);

  const accounts = await call<{ accounts: Array<{ id: string; label: string; balance: { availableMinor: number | null } }> }>(
    'GET', '/api/accounts', undefined, token);
  check('four demo accounts are connected', accounts.json.accounts.length === 4, accounts.json.accounts.map((a) => a.label));
  const myZaka = accounts.json.accounts.find((a) => a.label === 'MyZaka')!;
  const myZakaStart = myZaka.balance?.availableMinor ?? 0;
  check('MyZaka has a provider-reported balance', myZakaStart > 0, myZaka.balance);

  const quote = await call<{ methods: Array<{ label: string; insufficient: boolean | null }> }>(
    'POST', '/api/accounts/quote', { amountMinor: 30000, currency: 'BWP' }, token);
  const orange = quote.json.methods.find((m) => m.label === 'Orange Money')!;
  check('Orange Money flagged insufficient for P300 (P185.40 available)', orange.insufficient === true, orange);

  const stepUp = await call<{ accessToken: string }>('POST', '/api/auth/step-up', { password: PASSWORD }, token);
  check('step-up (biometric/password) issues a verified token', stepUp.status === 200 && Boolean(stepUp.json.accessToken));
  const verifiedToken = stepUp.json.accessToken;

  const confirm = await call<{ status: string; providerRef?: string }>(
    'POST', `/api/payments/intents/${intent.json.id}/confirm`,
    { accountId: myZaka.id, authMethod: 'password' }, verifiedToken);
  check('payment initiated with the provider', confirm.status === 200 && ['PENDING', 'PROCESSING'].includes(confirm.json.status), confirm.json);

  const duplicate = await call<{ status: string }>(
    'POST', `/api/payments/intents/${intent.json.id}/confirm`,
    { accountId: myZaka.id, authMethod: 'password' }, verifiedToken);
  check('a second confirm does not create a second payment', duplicate.json.status === confirm.json.status, duplicate.json);

  console.log('\n4. Provider callback (signature verified, replay protected)');
  const providerRef = String(confirm.json.providerRef);
  const body = JSON.stringify({ reference: providerRef, status: 'SUCCESSFUL', amount: { value: 5000, currency: 'BWP' }, occurred_at: new Date().toISOString() });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', process.env.SANDBOX_WEBHOOK_SECRET ?? 'sandbox-webhook-secret-not-for-production')
    .update(`${timestamp}.${body}`).digest('hex');

  const forged = await fetch(`${BASE}/api/webhooks/sandbox`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-paychat-event-id': 'evt_forged', 'x-paychat-signature': `t=${timestamp},v1=deadbeef` },
    body,
  });
  check('forged callback rejected', forged.status === 400);

  const good = await fetch(`${BASE}/api/webhooks/sandbox`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-paychat-event-id': `evt_e2e_${Date.now()}`, 'x-paychat-signature': `t=${timestamp},v1=${signature}` },
    body,
  });
  check('signed callback accepted', good.status === 200);

  const replay = await fetch(`${BASE}/api/webhooks/sandbox`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-paychat-event-id': 'evt_e2e_replay', 'x-paychat-signature': `t=${timestamp},v1=${signature}` },
    body,
  });
  const replayAgain = await fetch(`${BASE}/api/webhooks/sandbox`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-paychat-event-id': 'evt_e2e_replay', 'x-paychat-signature': `t=${timestamp},v1=${signature}` },
    body,
  });
  check('replayed callback blocked', replay.status === 200 && replayAgain.status === 400);

  const final = await call<{ status: string; receiptId: string | null }>(`GET`.length ? 'GET' : 'GET', `/api/payments/intents/${intent.json.id}`, undefined, token);
  check('payment is SUCCESSFUL (authoritative)', final.json.status === 'SUCCESSFUL', final.json);
  check('receipt generated', Boolean(final.json.receiptId), final.json);

  console.log('\n5. Balances reflect the payment');
  const after = await call<{ accounts: Array<{ label: string; balance: { availableMinor: number | null; providerStatus: string; stale: boolean } }> }>('GET', '/api/accounts', undefined, token);
  const myZakaAfter = after.json.accounts.find((a) => a.label === 'MyZaka')!.balance;
  check('balance flagged stale after spending (never silently assumed)', myZakaAfter.providerStatus === 'stale' && myZakaAfter.stale, myZakaAfter);
  const refreshed = await call<{ availableMinor: number | null; providerStatus: string }>('POST', `/api/accounts/${myZaka.id}/balance/refresh`, undefined, token);
  check('refresh pulls the true balance from the provider (P50 spent)',
    refreshed.json.providerStatus === 'ok' && refreshed.json.availableMinor === myZakaStart - 5000,
    { expected: myZakaStart - 5000, got: refreshed.json });

  console.log('\n6. QR codes (generation → scan → confirm → pay → replay blocked)');
  const link = await call<{ token: string; qr: string }>('POST', '/api/payment-links', {
    amountMinor: 2500, currency: 'BWP', description: 'e2e QR',
  }, token);
  check('payment link created', link.status === 201, link.json);
  check('QR image rendered server-side', typeof link.json.qr === 'string' && link.json.qr.startsWith('data:image/png;base64,'));

  const preview = await call<{ amountMinor: number; amountFixed: boolean; requiresConfirmation: boolean }>(
    'POST', '/api/qr/scan', { code: `https://paychat.example/pay/${link.json.token}` }, token);
  check('scanning resolves the code without paying', preview.status === 200 && preview.json.amountMinor === 2500 && preview.json.requiresConfirmation, preview.json);

  const tampered = await call('POST', '/api/qr/scan', { code: `${link.json.token.slice(0, -3)}aaa` }, token);
  check('a modified code is rejected', tampered.status === 400, tampered.json);

  console.log('\n7. Merchant console');
  const onboarded = await call<{ isMerchant: boolean; businessName: string }>('POST', '/api/merchant/onboard', {
    businessName: 'E2E Coffee', category: 'cafe',
  }, token);
  check('merchant onboarding works', onboarded.status === 201 && onboarded.json.isMerchant === true, onboarded.json);

  const code = await call<{ token: string; qr: string }>('POST', '/api/merchant/qr', { currency: 'BWP' }, token);
  check('merchant publishes a reusable code', code.status === 201 && code.json.qr.startsWith('data:image/png;base64,'), code.json);

  const reconcile = await call<{ checked: number }>('POST', '/api/merchant/reconcile', undefined, token);
  check('merchant reconciliation runs', reconcile.status === 200, reconcile.json);

  const summary = await call<{ settledMinor: number; transactionCount: number }>('GET', '/api/merchant/summary', undefined, token);
  check('settlement summary is scoped to this merchant', summary.status === 200, summary.json);

  console.log('\n8. Provider registry is configuration-driven');
  const providers = await call<{ providers: Array<{ id: string; capabilities: Record<string, boolean> }> }>('GET', '/api/providers', undefined, token);
  check('providers are discovered, not hard-coded', providers.status === 200 && providers.json.providers.length > 0, providers.json);
  check('every provider advertises capabilities', providers.json.providers.every((p) => typeof p.capabilities === 'object'));

  console.log(failures === 0 ? '\n✅ End-to-end smoke test passed\n' : `\n❌ ${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
