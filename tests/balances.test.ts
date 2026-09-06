import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { newApp, registerUser, addAccount, repo } from './helpers.js';
import type { SandboxProvider } from '../apps/api/src/providers/sandbox.js';
import { money, sumSameCurrency } from '@paychat/shared';

describe('Balances', () => {
  let app: FastifyInstance;
  let sandbox: SandboxProvider;

  beforeEach(async () => {
    ({ app, sandbox } = await newApp('success'));
  });

  it('shows every connected account with its provider-reported balance', async () => {
    const user = await registerUser(app, { phone: '+26771111000' });
    addAccount(user.userId, { label: 'Orange Money', providerAccountRef: 'w-om' });
    addAccount(user.userId, { label: 'MyZaka', providerAccountRef: 'w-mz' });
    addAccount(user.userId, { label: 'Bank', providerAccountRef: 'w-bank', kind: 'bank' });
    sandbox.setBalance('w-om', 18540);
    sandbox.setBalance('w-mz', 42000);
    sandbox.setBalance('w-bank', 125000);

    for (const id of repo.accounts.listForUser(user.userId).map((a) => a.id)) {
      const account = repo.accounts.listForUser(user.userId).find((a) => a.id === id)!;
      await app.inject({ method: 'POST', url: `/api/accounts/${id}/balance/refresh`, headers: user.auth });
      expect(account.label).toBeTruthy();
    }

    const list = await app.inject({ method: 'GET', url: '/api/accounts', headers: user.auth });
    const balances = list.json<{ accounts: Array<{ label: string; balance: { availableMinor: number } | null }> }>().accounts;
    expect(balances.map((b) => b.balance?.availableMinor).sort((a, b) => Number(a) - Number(b))).toEqual([18540, 42000, 125000]);
  });

  it('marks a balance unavailable rather than inventing one when the provider is down', async () => {
    ({ app, sandbox } = await newApp('unavailable'));
    const user = await registerUser(app, { phone: '+26771111001' });
    const accountId = addAccount(user.userId, { label: 'Smega', providerAccountRef: 'w-smega' });

    const response = await app.inject({ method: 'POST', url: `/api/accounts/${accountId}/balance/refresh`, headers: user.auth });
    const body = response.json<{ availableMinor: number | null; providerStatus: string }>();
    expect(response.statusCode).toBe(200);
    expect(body.availableMinor).toBeNull();
    expect(body.providerStatus).toBe('unavailable');
  });

  it('keeps the last known balance but flags it stale when the provider stops answering', async () => {
    const user = await registerUser(app, { phone: '+26771111002' });
    const accountId = addAccount(user.userId, { label: 'Orange Money', providerAccountRef: 'w-stale' });
    sandbox.setBalance('w-stale', 18540);
    await app.inject({ method: 'POST', url: `/api/accounts/${accountId}/balance/refresh`, headers: user.auth });

    // Provider goes down after we have a cached value.
    sandbox.scenario = 'unavailable';
    const response = await app.inject({ method: 'POST', url: `/api/accounts/${accountId}/balance/refresh`, headers: user.auth });
    const body = response.json<{ availableMinor: number | null; providerStatus: string; stale?: boolean }>();
    expect(body.availableMinor).toBe(18540);
    expect(body.providerStatus).toBe('unavailable');
    expect(body.stale).toBe(true);

    const list = await app.inject({ method: 'GET', url: '/api/accounts', headers: user.auth });
    const account = list.json<{ accounts: Array<{ balance: { stale: boolean; providerStatus: string } }> }>().accounts[0]!;
    expect(account.balance.providerStatus).toBe('unavailable');
  });

  it('flags insufficient funds per method for a proposed amount', async () => {
    const user = await registerUser(app, { phone: '+26771111003' });
    const om = addAccount(user.userId, { label: 'Orange Money', providerAccountRef: 'w-a' });
    const mz = addAccount(user.userId, { label: 'MyZaka', providerAccountRef: 'w-b' });
    sandbox.setBalance('w-a', 18540);   // P185.40
    sandbox.setBalance('w-b', 42000);   // P420.00
    await app.inject({ method: 'POST', url: `/api/accounts/${om}/balance/refresh`, headers: user.auth });
    await app.inject({ method: 'POST', url: `/api/accounts/${mz}/balance/refresh`, headers: user.auth });

    const quote = await app.inject({
      method: 'POST', url: '/api/accounts/quote', headers: user.auth, payload: { amountMinor: 30000, currency: 'BWP' },
    });
    const methods = quote.json<{ methods: Array<{ label: string; insufficient: boolean | null; availableMinor: number | null }> }>().methods;
    expect(methods.find((m) => m.label === 'Orange Money')!.insufficient).toBe(true);
    expect(methods.find((m) => m.label === 'MyZaka')!.insufficient).toBe(false);
  });

  it('never aggregates balances across different currencies', async () => {
    const total = sumSameCurrency([money(18540, 'BWP'), money(42000, 'BWP'), money(1000, 'ZAR')]);
    expect(total).toBeNull();
    const sameTotal = sumSameCurrency([money(18540, 'BWP'), money(42000, 'BWP')]);
    expect(sameTotal?.minor).toBe(60540);
  });

  it('does not expose a currency-mismatched balance as usable', async () => {
    const user = await registerUser(app, { phone: '+26771111004' });
    const zar = addAccount(user.userId, { label: 'SA Account', providerAccountRef: 'w-zar', currency: 'ZAR' });
    sandbox.setBalance('w-zar', 50000);
    await app.inject({ method: 'POST', url: `/api/accounts/${zar}/balance/refresh`, headers: user.auth });

    const quote = await app.inject({
      method: 'POST', url: '/api/accounts/quote', headers: user.auth, payload: { amountMinor: 10000, currency: 'BWP' },
    });
    const method = quote.json<{ methods: Array<{ availableMinor: number | null; insufficient: boolean | null }> }>().methods[0]!;
    expect(method.availableMinor).toBeNull();
    expect(method.insufficient).toBeNull();
  });
});
