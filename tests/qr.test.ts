/**
 * QR payments (brief §16).
 *
 * Verified here: generation, scanning/resolution, provider-and-merchant identification,
 * amount and reference handling, expiry, invalid/modified codes, replay and duplicate
 * payment, and the rule that QR data is never trusted — the amount always comes from the
 * signed payload, and a scan never moves money on its own.
 *
 * NOT verified here (marked BLOCKED in the readiness report): decoding a QR from a real
 * camera feed. There is no camera in this environment; the client uses the platform
 * BarcodeDetector with a manual-entry fallback, and that path is untested on hardware.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { newApp, registerUser, addAccount, stepUp } from './helpers.js';
import type { SandboxProvider } from '../apps/api/src/providers/sandbox.js';
import { createQrToken, verifyQrToken, extractQrToken, renderQrPng, QR_SCHEME } from '../apps/api/src/payments/qr.js';
import { getDb } from '../apps/api/src/db/index.js';
import { config } from '../apps/api/src/config.js';

describe('QR — generation and integrity', () => {
  it('generates a PNG the client can render without any external resource', async () => {
    const dataUrl = await renderQrPng('paychat://pay/test');
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const bytes = Buffer.from(dataUrl.split(',')[1]!, 'base64');
    expect(bytes.length).toBeGreaterThan(500);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');   // PNG magic
  });

  it('is deterministic: the same content always renders the same image', async () => {
    const a = await renderQrPng('paychat://pay/same');
    const b = await renderQrPng('paychat://pay/same');
    expect(a).toBe(b);
  });

  it('produces a token that survives a round trip, and rejects modification', () => {
    const { token } = createQrToken({ kind: 'payment_link', creatorUserId: 'usr_1', amountMinor: 2500, currency: 'BWP' });
    const payload = verifyQrToken(token)!;
    expect(payload.amountMinor).toBe(2500);
    expect(payload.kind).toBe('payment_link');

    const [body, mac] = token.split('.');
    expect(verifyQrToken(`${body}.${mac!.slice(0, -2)}xx`)).toBeNull();          // tampered MAC
    const tamperedBody = Buffer.from(JSON.stringify({ v: 1, kind: 'payment_link', jti: 'x', creatorUserId: 'usr_1', amountMinor: 999999, currency: 'BWP', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
    expect(verifyQrToken(`${tamperedBody}.${mac}`)).toBeNull();                   // re-signed body by an attacker
  });

  it('expires, and an expired code is refused', () => {
    const expired = createQrToken({ kind: 'payment_link', creatorUserId: 'usr_1', amountMinor: 100, currency: 'BWP', ttlSeconds: -10 });
    expect(verifyQrToken(expired.token)).toBeNull();
  });

  it('reads tokens out of a deep link, a URL and a raw scan', () => {
    const { token } = createQrToken({ kind: 'payment_link', creatorUserId: 'usr_1', amountMinor: 100, currency: 'BWP' });
    expect(extractQrToken(token)).toBe(token);
    expect(extractQrToken(`${QR_SCHEME}${token}`)).toBe(token);
    expect(extractQrToken(`https://paychat.example/pay/${token}`)).toBe(token);
    expect(extractQrToken('https://evil.example/pay/')).toBeNull();
    expect(extractQrToken('')).toBeNull();
  });

  it('never contains a secret, a token or a credential', () => {
    const { token } = createQrToken({ kind: 'merchant', creatorUserId: 'usr_1', merchantId: 'usr_1', amountMinor: null, currency: 'BWP' });
    const decoded = Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8').toLowerCase();
    expect(decoded).not.toContain('secret');
    expect(decoded).not.toContain('password');
    expect(decoded).not.toContain('client_secret');
    expect(decoded).not.toContain(config.jwt.secret.toLowerCase());
  });
});

describe('QR — scanning and payment', () => {
  let app: FastifyInstance;
  let sandbox: SandboxProvider;

  beforeEach(async () => {
    ({ app, sandbox } = await newApp('success'));
  });

  async function merchantAndPayer() {
    const merchant = await registerUser(app, { phone: '+26776111001', name: 'Shop' });
    await app.inject({
      method: 'POST', url: '/api/merchant/onboard', headers: merchant.auth,
      payload: { businessName: 'Mma Ramotswe Coffee', category: 'cafe' },
    });
    const payer = await registerUser(app, { phone: '+26776222002', name: 'Payer' });
    const accountId = addAccount(payer.userId, { label: 'Wallet', providerAccountRef: 'qr-wallet', isDefault: true });
    sandbox.setBalance('qr-wallet', 100000);
    return { merchant, payer: await stepUp(app, payer), accountId };
  }

  it('scanning resolves the merchant and the amount without creating a payment', async () => {
    const { merchant, payer } = await merchantAndPayer();
    const created = await app.inject({
      method: 'POST', url: '/api/payment-links', headers: merchant.auth,
      payload: { amountMinor: 4500, currency: 'BWP', description: 'Flat white' },
    });
    expect(created.statusCode).toBe(201);
    const link = created.json<{ token: string; qr: string }>();
    expect(link.qr.startsWith('data:image/png;base64,')).toBe(true);

    const scanned = await app.inject({
      method: 'POST', url: '/api/qr/scan', headers: payer.auth,
      payload: { code: `https://paychat.example/pay/${link.token}` },
    });
    expect(scanned.statusCode).toBe(200);
    const preview = scanned.json<{ merchant: { businessName: string } | null; amountMinor: number; amountFixed: boolean; requiresConfirmation: boolean; recipient: { name: string } }>();
    expect(preview.amountMinor).toBe(4500);
    expect(preview.amountFixed).toBe(true);
    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.recipient.name).toBe('Shop');
    // No payment exists yet — scanning is read-only.
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM payment_intents').get()).toMatchObject({ n: 0 });
  });

  it('a modified QR (different amount) is rejected, not honoured', async () => {
    const { merchant, payer } = await merchantAndPayer();
    const { token } = await app.inject({
      method: 'POST', url: '/api/payment-links', headers: merchant.auth,
      payload: { amountMinor: 4500 },
    }).then((r) => r.json<{ token: string }>());

    const [body] = token.split('.');
    const forgedBody = Buffer.from(JSON.stringify({
      v: 1, kind: 'payment_link', jti: 'lnk_forged', creatorUserId: merchant.userId,
      amountMinor: 450000, currency: 'BWP', exp: Math.floor(Date.now() / 1000) + 600,
    })).toString('base64url');

    const scanned = await app.inject({
      method: 'POST', url: '/api/qr/scan', headers: payer.auth,
      payload: { code: `${forgedBody}.${token.split('.')[1]}` },
    });
    expect(scanned.statusCode).toBe(400);
    expect(String(body)).toBeTruthy();
  });

  it('refuses a client that tries to override the signed amount', async () => {
    const { merchant, payer, accountId } = await merchantAndPayer();
    const { token } = await app.inject({
      method: 'POST', url: '/api/payment-links', headers: merchant.auth,
      payload: { amountMinor: 4500 },
    }).then((r) => r.json<{ token: string }>());

    const paid = await app.inject({
      method: 'POST', url: '/api/qr/pay', headers: payer.auth,
      payload: { code: token, accountId, amountMinor: 10 },
    });
    expect(paid.statusCode).toBe(400);
  });

  it('pays a scanned code once and blocks a replay of the same code', async () => {
    const { merchant, payer, accountId } = await merchantAndPayer();
    const { token } = await app.inject({
      method: 'POST', url: '/api/payment-links', headers: merchant.auth,
      payload: { amountMinor: 2000, description: 'Muffin' },
    }).then((r) => r.json<{ token: string }>());

    const first = await app.inject({
      method: 'POST', url: '/api/qr/pay', headers: payer.auth,
      payload: { code: token, accountId, authMethod: 'password' },
    });
    expect(first.statusCode, first.body).toBe(200);

    const replay = await app.inject({
      method: 'POST', url: '/api/qr/pay', headers: payer.auth,
      payload: { code: token, accountId, authMethod: 'password' },
    });
    expect(replay.statusCode).toBe(409);
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM payment_intents').get()).toMatchObject({ n: 1 });
  });

  it('merchant codes carry no fixed amount: the payer enters it, within limits', async () => {
    const { merchant, payer, accountId } = await merchantAndPayer();
    const merchantQr = await app.inject({
      method: 'POST', url: '/api/merchant/qr', headers: merchant.auth,
      payload: { currency: 'BWP', description: 'Pay at the counter' },
    });
    expect(merchantQr.statusCode).toBe(201);
    const { token } = merchantQr.json<{ token: string }>();

    const scanned = await app.inject({
      method: 'POST', url: '/api/qr/scan', headers: payer.auth, payload: { code: `${QR_SCHEME}${token}` },
    });
    const preview = scanned.json<{ amountFixed: boolean; merchant: { businessName: string } | null }>();
    expect(preview.amountFixed).toBe(false);
    expect(preview.merchant?.businessName).toBe('Mma Ramotswe Coffee');

    const noAmount = await app.inject({
      method: 'POST', url: '/api/qr/pay', headers: payer.auth, payload: { code: token, accountId },
    });
    expect(noAmount.statusCode).toBe(400);

    const paid = await app.inject({
      method: 'POST', url: '/api/qr/pay', headers: payer.auth,
      payload: { code: token, accountId, amountMinor: 7500, authMethod: 'password' },
    });
    expect(paid.statusCode, paid.body).toBe(200);
  });

  it('a non-merchant cannot publish a merchant code', async () => {
    const { payer } = await merchantAndPayer();
    const response = await app.inject({
      method: 'POST', url: '/api/merchant/qr', headers: payer.auth, payload: { currency: 'BWP' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('paying your own code is refused', async () => {
    const { merchant, accountId } = await merchantAndPayer();
    addAccount(merchant.userId, { label: 'Shop wallet', providerAccountRef: 'shop-wallet', isDefault: true });
    sandbox.setBalance('shop-wallet', 50000);
    const { token } = await app.inject({
      method: 'POST', url: '/api/payment-links', headers: merchant.auth, payload: { amountMinor: 1000 },
    }).then((r) => r.json<{ token: string }>());
    const paid = await app.inject({
      method: 'POST', url: '/api/qr/pay', headers: merchant.auth, payload: { code: token, accountId },
    });
    expect(paid.statusCode).toBe(400);
  });

  it('an unreadable code is a validation error, not a crash', async () => {
    const { payer } = await merchantAndPayer();
    for (const code of ['', 'not-a-code', 'https://example.com/', 'x'.repeat(5000)]) {
      const response = await app.inject({ method: 'POST', url: '/api/qr/scan', headers: payer.auth, payload: { code } });
      expect([400, 413]).toContain(response.statusCode);
    }
  });
});
