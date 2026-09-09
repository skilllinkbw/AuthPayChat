/**
 * Provider architecture — the acceptance tests for brief §2–§6.
 *
 * These tests exist to prove, not to assert by comment, that:
 *  - no core file names a provider
 *  - a brand-new provider can be added by CONFIGURATION ONLY (a real HTTP rail is
 *    stood up in-process and driven end to end with no core code change)
 *  - a provider can be removed, disabled, renamed and re-pointed the same way
 *  - capabilities are discovered from configuration, not assumed
 *  - the UI contract (GET /api/providers) carries everything the client needs
 *  - AuthePay and the banks are ordinary adapters with no special-casing anywhere
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createHttpServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parsePaymentCommand, flagUnsupportedMethod } from '@paychat/nlp';
import { registry, PROVIDER_DEFINITIONS } from '../apps/api/src/providers/registry.js';
import type { ProviderDefinition } from '../apps/api/src/providers/types.js';

type AnyDefinition = ProviderDefinition;

/** Returns a copy of the definition pointed at a base URL (still configuration, not code). */
function withBaseUrl(definition: ProviderDefinition, baseUrl: string): AnyDefinition {
  return { ...definition, transport: { ...(definition.transport as Record<string, unknown>), baseUrl } } as AnyDefinition;
}
import { createServer as createApp, seedProviders } from '../apps/api/src/server.js';
import { closeDb, getDb } from '../apps/api/src/db/index.js';
import { SandboxProvider } from '../apps/api/src/providers/sandbox.js';
import { resetRateLimits } from '../apps/api/src/security/rateLimit.js';
import { clearChallenges } from '../apps/api/src/security/challenges.js';
import * as repo from '../apps/api/src/repositories.js';
import { registerUser, addContact, stepUp } from './helpers.js';

// Repo root as a real Windows/Unix path. (URL `.pathname` would prefix `/C:/` on Windows
// and break every readdirSync below — a faithful repo-level test must use fileURLToPath.)
const ROOT = fileURLToPath(new URL('..', import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (['.ts', '.tsx', '.js', '.jsx', '.sql'].includes(extname(full))) out.push(full);
  }
  return out;
}

/** Provider names that must NEVER appear in core code (only in the data file / these tests). */
const FORBIDDEN_NAMES = ['orange', 'myzaka', 'smega', 'authepay', 'omascom', 'banka', 'karete'];

/** Normalises path separators so the data-file exclusion works on Windows too. */
function isProviderDataFile(filePath: string): boolean {
  return filePath.split(/[\\/]/).join('/').includes('providers/definitions.ts');
}

/**
 * Demo fixtures: a single explicitly-named client-side demo data path (see
 * apps/web/src/demo-fixtures/providers.ts). It carries ONLY sandbox/demo display
 * labels for the standalone review APK — never production coupling. This is the
 * same idea as providers/definitions.ts on the API side; every other file under
 * apps/web/src must stay provider-agnostic.
 */
function isDemoFixtureFile(filePath: string): boolean {
  return filePath.split(/[\\/]/).join('/').includes('src/demo-fixtures/');
}

describe('Provider architecture — no provider is hard-coded in core', () => {
  it('core source files contain no provider name', () => {
    const offenders: string[] = [];
    for (const file of [join(ROOT, 'apps/api/src'), join(ROOT, 'apps/web/src'), join(ROOT, 'packages')]) {
      for (const path of walk(file)) {
        const relative = path.replace(ROOT, '');
        // The registry's DATA file legitimately declares defaults; demo fixtures carry
        // sandbox display labels for the standalone review APK; tests assert on all of these.
        if (isProviderDataFile(relative)) continue;
        if (isDemoFixtureFile(relative)) continue;
        if (relative.startsWith('tests/')) continue;
        if (relative.includes('/__tests__/')) continue;
        const text = readFileSync(path, 'utf8').toLowerCase();
        for (const name of FORBIDDEN_NAMES) {
          if (text.includes(name)) offenders.push(`${relative}: ${name}`);
        }
      }
    }
    expect(offenders, `provider names found in core:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('the NLP package holds no provider list', () => {
    const nlp = readFileSync(join(ROOT, 'packages/nlp/src/intent.ts'), 'utf8');
    for (const name of FORBIDDEN_NAMES) expect(nlp.toLowerCase()).not.toContain(name);
  });

  it('there is no branch on provider identity anywhere in the API', () => {
    const offenders: string[] = [];
    for (const path of walk(join(ROOT, 'apps/api/src'))) {
      const relative = path.replace(ROOT, '');
      if (isProviderDataFile(relative)) continue;
      const text = readFileSync(path, 'utf8');
      if (/provider_?id\s*===?\s*['"]|provider_?id\s*==\s*['"]|case\s+['"][a-z_]+_bw['"]/i.test(text)) offenders.push(relative);
      if (/switch\s*\(\s*provider/i.test(text)) offenders.push(relative);
    }
    expect(offenders).toEqual([]);
  });

  it('PayChat does not depend on AuthePay (no circular integration)', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Record<string, Record<string, string>>;
    const allDeps = JSON.stringify(pkg).toLowerCase();
    expect(allDeps).not.toContain('authepay');
    for (const path of walk(join(ROOT, 'apps/api/src'))) {
      if (isProviderDataFile(path)) continue;
      expect(readFileSync(path, 'utf8').toLowerCase()).not.toContain('authepay');
    }
  });
});

/* ── A brand-new provider, added by configuration only ─────────────────────── */

const NEW_PROVIDER: ProviderDefinition = {
  id: 'zebra_pay_bw',
  displayName: 'ZebraPay',
  kind: 'mobile_money',
  country: 'BW',
  currencies: ['BWP'],
  enabled: true,
  transport: {
    type: 'rest',
    paths: { token: '/oauth/token', pay: '/v1/payouts', status: '/v1/payouts/{ref}', balance: '/v1/wallets/{ref}' },
    statusMap: { ACCEPTED: 'PROCESSING', DONE: 'SUCCESSFUL', ERROR: 'FAILED' },
  },
  auth: {
    type: 'oauth2_client_credentials',
    clientIdEnv: 'ZEBRA_CLIENT_ID',
    clientSecretEnv: 'ZEBRA_CLIENT_SECRET',
  },
  aliases: ['zebrapay', 'zebra pay', 'zebra'],
};

describe('Provider architecture — add / remove / replace by configuration', () => {
  let server: Server;
  let baseUrl: string;
  let app: FastifyInstance;
  const calls: string[] = [];

  beforeEach(async () => {
    calls.length = 0;
    server = createHttpServer((req, res) => {
      calls.push(`${req.method} ${req.url}`);
      if (req.url?.startsWith('/oauth/token')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ access_token: 'tok_live_zebra', expires_in: 3600 }));
        return;
      }
      if (req.url?.startsWith('/v1/wallets/')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ available: 90000, currency: 'BWP' }));
        return;
      }
      if (req.url?.startsWith('/v1/payouts')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ reference: 'zbr_1', status: 'ACCEPTED' }));
        return;
      }
      res.writeHead(404); res.end('{}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    process.env.ZEBRA_CLIENT_ID = 'zebra-id';
    process.env.ZEBRA_CLIENT_SECRET = 'zebra-secret';
    // The ONLY change: one JSON document of configuration.
    process.env.PAYCHAT_PROVIDERS = JSON.stringify([withBaseUrl(NEW_PROVIDER, baseUrl)]);

    resetRateLimits();
    clearChallenges();
    closeDb();
    app = createApp({ databasePath: ':memory:', sandbox: new SandboxProvider({ metadata: { scenario: 'success' } }) });
    seedProviders();
  });

  afterEach(async () => {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.PAYCHAT_PROVIDERS;
    delete process.env.ZEBRA_CLIENT_ID;
    delete process.env.ZEBRA_CLIENT_SECRET;
    registry.load();
  });

  it('appears in the registry and is discoverable by the client', async () => {
    const listed = registry.list('BW').find((p) => p.id === 'zebra_pay_bw');
    expect(listed).toBeDefined();
    expect(listed!.displayName).toBe('ZebraPay');
    expect(listed!.capabilities.initiatePayment).toBe(true);
    expect(listed!.capabilities.refundPayment).toBe(false);   // no refund path configured
    expect(listed!.capabilities.getBalance).toBe(true);

    const user = await registerUser(app, { phone: '+26771111000', name: 'Configurator' });
    const response = await app.inject({ method: 'GET', url: '/api/providers', headers: user.auth });
    expect(response.statusCode).toBe(200);
    const providers = response.json<{ providers: Array<{ id: string; capabilities: Record<string, boolean> }> }>().providers;
    expect(providers.some((p) => p.id === 'zebra_pay_bw')).toBe(true);
    // Every entry carries capabilities, so the UI renders from data alone.
    for (const provider of providers) expect(provider.capabilities).toBeTypeOf('object');
  });

  it('is usable end to end with no change to PayChat core', async () => {
    const user = await registerUser(app, { phone: '+26771111001', name: 'Configurator' });
    const contact = repo.users.create({ phone: '+26772222002', passwordHash: 'scrypt$x$y', displayName: 'Recipient' });
    const contactId = addContact(user.userId, 'Recipient', '+26772222002', contact.id);

    // Connect an account: the registry's balance call really hits the new rail.
    const linked = await app.inject({
      method: 'POST', url: '/api/accounts/connect', headers: user.auth,
      payload: { providerId: 'zebra_pay_bw', label: 'Zebra wallet', providerAccountRef: 'zw-1', makeDefault: true },
    });
    expect(linked.statusCode, linked.body).toBe(201);

    const steppedUp = await stepUp(app, user);
    const created = await app.inject({
      method: 'POST', url: '/api/payments/intents', headers: steppedUp.auth,
      payload: { recipientContactId: contactId, recipientLabel: 'Recipient', amountMinor: 2500, currency: 'BWP' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const intentId = String(created.json<{ id: string }>().id);

    const confirmed = await app.inject({
      method: 'POST', url: `/api/payments/intents/${intentId}/confirm`, headers: steppedUp.auth,
      payload: { accountId: repo.accounts.listForUser(user.userId)[0]!.id, authMethod: 'password' },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json<{ providerRef: string; status: string }>().providerRef).toBe('zbr_1');
    // Provider vocabulary was mapped through configuration (ACCEPTED → PROCESSING).
    expect(confirmed.json<{ status: string }>().status).toBe('PROCESSING');
    expect(calls.some((c) => c.includes('/v1/payouts'))).toBe(true);
  });

  it('can be disabled at runtime without touching code', async () => {
    const user = await registerUser(app, { phone: '+26771111002', name: 'Configurator' });
    registry.persist({ ...withBaseUrl(NEW_PROVIDER, baseUrl), enabled: false });
    registry.load();

    const response = await app.inject({ method: 'GET', url: '/api/providers', headers: user.auth });
    const providers = response.json<{ providers: Array<{ id: string; enabled: boolean }> }>().providers;
    expect(providers.find((p) => p.id === 'zebra_pay_bw')!.enabled).toBe(false);

    await expect(registry.get('zebra_pay_bw').initiatePayment({
      intentId: 'pin_x', amount: { minor: 100, currency: 'BWP' },
      source: { accountId: 'acc', providerAccountRef: 'zw-1' }, recipient: { handle: '+26772222002' },
      idempotencyKey: 'idem', callbackUrl: 'https://example.invalid/hook',
    })).rejects.toThrow(/disabled by configuration|not available/);
  });

  it('can be renamed and re-pointed by configuration (replace, not rewrite)', async () => {
    registry.persist({ ...withBaseUrl(NEW_PROVIDER, baseUrl), displayName: 'ZebraPay Business' });
    registry.load();
    const listed = registry.list('BW').find((p) => p.id === 'zebra_pay_bw');
    expect(listed!.displayName).toBe('ZebraPay Business');
    const row = getDb().prepare('SELECT display_name, enabled FROM payment_providers WHERE id = ?').get('zebra_pay_bw') as { display_name: string; enabled: number };
    expect(row.display_name).toBe('ZebraPay Business');
    expect(row.enabled).toBe(1);
  });

  it('a rail with no credentials advertises no money-moving capability', () => {
    delete process.env.ZEBRA_CLIENT_ID;
    delete process.env.ZEBRA_CLIENT_SECRET;
    registry.load();
    const listed = registry.list('BW').find((p) => p.id === 'zebra_pay_bw');
    expect(listed!.enabled).toBe(false);
    expect(listed!.capabilities.initiatePayment).toBe(false);
    expect(listed!.capabilities.getBalance).toBe(false);
  });

  it('the kill switch removes a provider from use without deleting it', () => {
    process.env.PAYCHAT_PROVIDER_DISABLE = 'zebra_pay_bw';
    registry.load();
    expect(registry.list('BW').find((p) => p.id === 'zebra_pay_bw')!.enabled).toBe(false);
    delete process.env.PAYCHAT_PROVIDER_DISABLE;
    registry.load();
    expect(registry.list('BW').find((p) => p.id === 'zebra_pay_bw')!.enabled).toBe(true);
  });
});

describe('Provider architecture — capability discovery and method resolution', () => {
  beforeEach(() => {
    resetRateLimits();
    clearChallenges();
    closeDb();
    const app = createApp({ databasePath: ':memory:', sandbox: new SandboxProvider({ metadata: { scenario: 'success' } }) });
    seedProviders();
    void app;
  });

  it('resolves a spoken method phrase to a configured provider', () => {
    const matches = registry.resolveMethodPhrase('orange money');
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.id).toBe('orange_money_bw');
  });

  it('ships AuthePay and banks A/B/C as ordinary configuration entries', () => {
    const ids = PROVIDER_DEFINITIONS().map((d) => d.id);
    expect(ids).toContain('authepay_bw');
    expect(ids).toContain('bank_a_bw');
    expect(ids).toContain('bank_b_bw');
    expect(ids).toContain('bank_c_bw');
    // All of them are the same adapter type — no bespoke code per bank.
    for (const id of ['bank_a_bw', 'bank_b_bw', 'bank_c_bw', 'authepay_bw']) {
      expect(registry.get(id).constructor.name).toBe('GenericRestProvider');
    }
  });

  it('never assumes a rail the user names but this deployment does not support', () => {
    const intent = parsePaymentCommand('Pay P50 Motakase using Bitcoin');
    expect(intent.paymentMethodQuery).toBe('bitcoin');
    const flagged = flagUnsupportedMethod(intent, ['orange_money_bw'], (phrase) => registry.resolveMethodPhrase(phrase));
    expect(flagged.clarification?.field).toBe('payment_method');
  });

  it('asks which provider to use when a phrase matches more than one', () => {
    const intent = parsePaymentCommand('Pay P50 Motakase using zebra');
    const flagged = flagUnsupportedMethod(intent, ['zebra_pay_bw', 'zebra_business_bw'], () => [
      { id: 'zebra_pay_bw', displayName: 'ZebraPay' },
      { id: 'zebra_business_bw', displayName: 'ZebraPay Business' },
    ]);
    expect(flagged.clarification?.field).toBe('payment_method_ambiguous');
    expect(flagged.clarification?.candidates?.length).toBe(2);
  });

  it('accepts a phrase that resolves to a provider the user actually has', () => {
    const intent = parsePaymentCommand('Pay P50 Motakase using zebra');
    const flagged = flagUnsupportedMethod(intent, ['zebra_pay_bw'], () => [{ id: 'zebra_pay_bw', displayName: 'ZebraPay' }]);
    expect(flagged.clarification).toBeUndefined();
  });
});
