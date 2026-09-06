/**
 * Seeds a realistic demo workspace (development / demo environments only).
 * Creates two users, contacts, a conversation and connected sandbox accounts with balances,
 * so the full "Pay P50 Motakase" experience can be tried end to end.
 *
 * It is refused in production.
 */

import { config } from '../apps/api/src/config.js';
import { initDb, closeDb } from '../apps/api/src/db/index.js';
import * as repo from '../apps/api/src/repositories.js';
import { SandboxProvider } from '../apps/api/src/providers/sandbox.js';
import { hashPassword } from '../apps/api/src/security/passwords.js';
import { seedProviders } from '../apps/api/src/server.js';

if (config.isProduction) {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const DEMO_PHONE = process.env.DEMO_PHONE ?? '+26771000000';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'PayChat2025!';

initDb(process.env.DATABASE_PATH ?? '.data/paychat.db');
seedProviders();

const existing = repo.users.findByPhone(DEMO_PHONE);
if (existing) {
  console.log(`Demo user ${DEMO_PHONE} already exists — skipping seed.`);
  closeDb();
  process.exit(0);
}

const passwordHash = await hashPassword(DEMO_PASSWORD);

const demo = repo.users.create({ phone: DEMO_PHONE, passwordHash, displayName: 'You', language: 'en' });

const peers = [
  { phone: '+26772000001', name: 'Motakase', merchant: false },
  { phone: '+26773000002', name: 'Neo', merchant: false },
  { phone: '+26774000003', name: 'Thato', merchant: false },
  { phone: '+26775000004', name: 'John', merchant: false },
  { phone: '+26776000005', name: 'Mma Dineo Bakery', merchant: true },
];

for (const peer of peers) {
  const user = repo.users.create({
    phone: peer.phone,
    passwordHash,
    displayName: peer.name,
    isMerchant: peer.merchant,
  });
  repo.contacts.add(demo.id, { contactUserId: user.id, displayName: peer.name, phone: peer.phone, isMerchant: peer.merchant });
  // Give the peer their own contact entry so the conversation reads naturally both ways.
  repo.contacts.add(user.id, { contactUserId: demo.id, displayName: 'You', phone: DEMO_PHONE });
}

const motakase = repo.users.findByPhone('+26772000001')!;
const conversationId = repo.conversations.ensureDirect(demo.id, motakase.id);
repo.conversations.addMessage({ conversationId, senderId: motakase.id, body: 'Dumela! Are o ntshumeletse P50?' });
repo.conversations.addMessage({ conversationId, senderId: demo.id, body: 'Ke tla go duela jaanong.' });

// Connected accounts (sandbox rail, development only) with the balances from the product spec.
const accounts = [
  { label: 'Orange Money', kind: 'mobile_money', ref: 'demo-orange', balance: 18540 },
  { label: 'MyZaka', kind: 'mobile_money', ref: 'demo-myzaka', balance: 42000 },
  { label: 'Smega', kind: 'mobile_money', ref: 'demo-smega', balance: 9500 },
  { label: 'Bank Account', kind: 'bank', ref: 'demo-bank', balance: 125000 },
];

for (const account of accounts) {
  const id = repo.accounts.add({
    userId: demo.id,
    providerId: 'sandbox',
    kind: account.kind,
    label: account.label,
    providerAccountRef: account.ref,
    currency: 'BWP',
    isDefault: account.label === 'Orange Money',
  });
  repo.balances.upsert({
    accountId: id,
    availableMinor: account.balance,
    pendingMinor: 0,
    unavailableMinor: 0,
    currency: 'BWP',
    providerStatus: 'ok',
    asOf: new Date().toISOString(),
  });
}

const sandbox = new SandboxProvider({ metadata: { scenario: 'success' } });
for (const account of accounts) sandbox.setBalance(account.ref, account.balance);

console.log(JSON.stringify({
  seeded: true,
  demoUser: { phone: DEMO_PHONE, password: DEMO_PASSWORD, id: demo.id },
  contacts: peers.map((p) => p.name),
  accounts: accounts.map((a) => ({ label: a.label, balance: a.balance / 100 })),
  conversationId,
}, null, 2));

closeDb();
