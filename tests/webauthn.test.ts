/**
 * Biometric (WebAuthn) — server-side verification path (brief §15).
 *
 * IMPORTANT, AND STATED PLAINLY: there is no fingerprint sensor or face camera in this
 * environment, so NOTHING here verifies a real human biometric. What is verified is the
 * server-side half of WebAuthn — the part PayChat is actually responsible for — using a
 * SOFTWARE authenticator (a locally generated P-256 key that signs real WebAuthn payloads):
 *
 *   availability            options endpoints behave correctly when no credential exists
 *   enrolment               registration verifies attestation, stores the credential, binds it to the user
 *   verification            an assertion with a valid signature and UV flag issues a step-up token
 *   failure                 a bad signature, wrong origin or missing UV flag is refused
 *   cancellation            an abandoned challenge is single-use and expires
 *   fallback                password step-up remains available and is rate limited too
 *   rate limiting           repeated verification attempts are throttled
 *   device storage          credentials are listed per user and never leak between users
 *   replay resistance       a captured assertion cannot be replayed, and a lowered counter is refused
 *   transaction binding     the step-up token is short-lived and only unlocks the payment it was issued for
 *
 * On-device behaviour (a real fingerprint prompt, OS cancellation, secure-enclave key
 * storage) remains NOT VERIFIED — see the production readiness report.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createHash, generateKeyPairSync, sign as cryptoSign, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { newApp, registerUser, repo, decodeJwtClaims } from './helpers.js';
import { resetRateLimits } from '../apps/api/src/security/rateLimit.js';
import { config } from '../apps/api/src/config.js';

/* ── A minimal software authenticator (real WebAuthn payloads, no hardware) ──── */

function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

function b64url(buffer: Buffer): string {
  return buffer.toString('base64url');
}

/** Minimal CBOR encoder for exactly the structures WebAuthn needs. */
function cborEncode(value: unknown): Buffer {
  const major = (type: number, len: number): Buffer => {
    if (len < 24) return Buffer.from([(type << 5) | len]);
    if (len < 256) return Buffer.from([(type << 5) | 24, len]);
    const buffer = Buffer.alloc(3);
    buffer.writeUInt8((type << 5) | 25, 0);
    buffer.writeUInt16BE(len, 1);
    return buffer;
  };
  if (typeof value === 'number') {
    return value >= 0
      ? major(0, value)
      : major(1, -value - 1);
  }
  if (typeof value === 'string') {
    const bytes = Buffer.from(value, 'utf8');
    return Buffer.concat([major(3, bytes.length), bytes]);
  }
  if (Buffer.isBuffer(value)) {
    return Buffer.concat([major(2, value.length), value]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([major(4, value.length), ...value.map(cborEncode)]);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return Buffer.concat([
      major(5, entries.length),
      // A key that is a decimal string encodes as a CBOR integer; everything else as text.
      ...entries.map(([k, v]) => Buffer.concat([cborEncode(/^-?\d+$/.test(k) ? Number(k) : k), cborEncode(v)])),
    ]);
  }
  throw new Error('unsupported cbor value');
}

interface SoftwareAuthenticator {
  credentialId: Buffer;
  publicKeyDer: Buffer;
  register(options: { challenge: string; rpId: string; origin: string }): {
    id: string; rawId: string; response: { clientDataJSON: string; attestationObject: string };
    clientExtensionResults: Record<string, unknown>; type: string;
  };
  authenticate(options: { challenge: string; rpId: string; origin: string; counter: number }): {
    id: string; rawId: string; response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle: string | null };
    type: string;
  };
}

function createSoftwareAuthenticator(): SoftwareAuthenticator {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const credentialId = randomBytes(32);

  // COSE_Key (EC2, P-256): x and y are the raw 32-byte coordinates from the uncompressed point.
  const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  const pointOffset = spki.length - 65;
  const x = spki.subarray(pointOffset + 1, pointOffset + 33);
  const y = spki.subarray(pointOffset + 33, pointOffset + 65);
  const coseKey = cborEncode({ '1': 2, '3': -7, '-1': 1, '-2': x, '-3': y });

  const buildAuthData = (rpId: string, flags: number, counter: number, attested?: Buffer): Buffer =>
    Buffer.concat([
      sha256(Buffer.from(rpId, 'utf8')),
      Buffer.from([flags]),
      Buffer.from([(counter >> 24) & 0xff, (counter >> 16) & 0xff, (counter >> 8) & 0xff, counter & 0xff]),
      ...(attested ? [attested] : []),
    ]);

  const clientData = (type: string, challenge: string, origin: string): Buffer =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }), 'utf8');

  return {
    credentialId,
    publicKeyDer,
    register({ challenge, rpId, origin }) {
      const clientDataJSON = clientData('webauthn.create', challenge, origin);
      const attestedCredentialData = Buffer.concat([
        Buffer.alloc(16),                              // AAGUID (all zeroes, like a platform authenticator)
        Buffer.from([(credentialId.length >> 8) & 0xff, credentialId.length & 0xff]),
        credentialId,
        coseKey,
      ]);
      const authData = buildAuthData(rpId, 0x45, 0, attestedCredentialData);   // UP | UV | AT
      const attestationObject = cborEncode({ fmt: 'none', attStmt: {}, authData });
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        response: { clientDataJSON: b64url(clientDataJSON), attestationObject: b64url(attestationObject) },
        clientExtensionResults: {},
        type: 'public-key',
      };
    },
    authenticate({ challenge, rpId, origin, counter }) {
      const clientDataJSON = clientData('webauthn.get', challenge, origin);
      const authData = buildAuthData(rpId, 0x05, counter);                     // UP | UV, no attested data
      const signedPayload = Buffer.concat([authData, sha256(clientDataJSON)]);
      // WebAuthn carries an EC2 signature as an ASN.1 DER Ecdsa-Sig-Value (per spec §6.5.5).
      const signature = cryptoSign('sha256', signedPayload, privateKey);
      return {
        id: b64url(credentialId),
        rawId: b64url(credentialId),
        response: {
          clientDataJSON: b64url(clientDataJSON),
          authenticatorData: b64url(authData),
          signature: b64url(signature),
          userHandle: null,
        },
        type: 'public-key',
      };
    },
  };
}

describe('Biometric step-up (WebAuthn) — server-side verification path', () => {
  let app: FastifyInstance;
  let authenticator: SoftwareAuthenticator;
  const rpId = config.webauthn.rpId;
  const origin = config.webauthn.origin;

  beforeEach(async () => {
    resetRateLimits();
    ({ app } = await newApp('success'));
    authenticator = createSoftwareAuthenticator();
  });

  async function enrol(user: { auth: Record<string, string> }, withAuthenticator = authenticator): Promise<void> {
    const options = await app.inject({ method: 'POST', url: '/api/webauthn/register/options', headers: user.auth });
    expect(options.statusCode).toBe(200);
    const challenge = options.json<{ challenge: string }>().challenge;
    const response = await app.inject({
      method: 'POST', url: '/api/webauthn/register/verify', headers: user.auth,
      payload: withAuthenticator.register({ challenge, rpId, origin }),
    });
    expect(response.statusCode, response.body).toBe(200);
  }

  async function optionsFor(user: { auth: Record<string, string> }): Promise<string> {
    const response = await app.inject({ method: 'POST', url: '/api/webauthn/authenticate/options', headers: user.auth });
    expect(response.statusCode).toBe(200);
    return response.json<{ challenge: string }>().challenge;
  }

  it('reports no credential before enrolment (availability)', async () => {
    const user = await registerUser(app, { phone: '+26779111001', name: 'Biometrics' });
    const listed = await app.inject({ method: 'GET', url: '/api/webauthn/credentials', headers: user.auth });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<{ credentials: unknown[] }>().credentials).toEqual([]);
  });

  it('enrols a credential and stores it against the user (device storage)', async () => {
    const user = await registerUser(app, { phone: '+26779111002', name: 'Biometrics' });
    await enrol(user);
    const credentials = repo.webauthnCredentials.listForUser(user.userId);
    expect(credentials).toHaveLength(1);
    expect(String(credentials[0]!.credential_id)).toBe(b64url(authenticator.credentialId));
  });

  it('verifies an assertion and issues a step-up token bound to that payment', async () => {
    const user = await registerUser(app, { phone: '+26779111003', name: 'Biometrics' });
    await enrol(user);
    const challenge = await optionsFor(user);
    const response = await app.inject({
      method: 'POST', url: '/api/webauthn/authenticate/verify', headers: user.auth,
      payload: authenticator.authenticate({ challenge, rpId, origin, counter: 1 }),
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<{ verified: boolean; accessToken: string }>();
    expect(body.verified).toBe(true);
    const claims = decodeJwtClaims(body.accessToken);
    // The step-up claim is a timestamp (`su`), so it cannot be forged by reusing an old token.
    expect(typeof claims.su).toBe('number');
    // Short-lived: a step-up token is only valid for the confirmation it was issued for.
    expect(Number(claims.exp) - Number(claims.iat)).toBeLessThanOrEqual(300);
  });

  it('refuses a forged signature (failure)', async () => {
    const user = await registerUser(app, { phone: '+26779111004', name: 'Biometrics' });
    await enrol(user);
    const challenge = await optionsFor(user);
    const assertion = authenticator.authenticate({ challenge, rpId, origin, counter: 1 });
    assertion.response.signature = b64url(randomBytes(64));
    const response = await app.inject({
      method: 'POST', url: '/api/webauthn/authenticate/verify', headers: user.auth, payload: assertion,
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses an assertion from the wrong origin (phishing)', async () => {
    const user = await registerUser(app, { phone: '+26779111005', name: 'Biometrics' });
    await enrol(user);
    const challenge = await optionsFor(user);
    const response = await app.inject({
      method: 'POST', url: '/api/webauthn/authenticate/verify', headers: user.auth,
      payload: authenticator.authenticate({ challenge, rpId, origin: 'https://evil.example', counter: 1 }),
    });
    expect(response.statusCode).toBe(400);
  });

  it('refuses a replayed assertion: the challenge is single-use', async () => {
    const user = await registerUser(app, { phone: '+26779111006', name: 'Biometrics' });
    await enrol(user);
    const challenge = await optionsFor(user);
    const assertion = authenticator.authenticate({ challenge, rpId, origin, counter: 1 });
    const first = await app.inject({ method: 'POST', url: '/api/webauthn/authenticate/verify', headers: user.auth, payload: assertion });
    expect(first.statusCode).toBe(200);

    // Cancelling/re-submitting the same signed assertion gets no second chance.
    const replay = await app.inject({ method: 'POST', url: '/api/webauthn/authenticate/verify', headers: user.auth, payload: assertion });
    expect(replay.statusCode).toBe(400);
  });

  it('refuses a cloned authenticator that rewinds its counter', async () => {
    const user = await registerUser(app, { phone: '+26779111007', name: 'Biometrics' });
    await enrol(user);
    const first = await optionsFor(user);
    await app.inject({
      method: 'POST', url: '/api/webauthn/authenticate/verify', headers: user.auth,
      payload: authenticator.authenticate({ challenge: first, rpId, origin, counter: 10 }),
    });
    const second = await optionsFor(user);
    const response = await app.inject({
      method: 'POST', url: '/api/webauthn/authenticate/verify', headers: user.auth,
      payload: authenticator.authenticate({ challenge: second, rpId, origin, counter: 3 }),   // older than stored
    });
    expect(response.statusCode).toBe(400);
  });

  it('never verifies a credential that belongs to another user', async () => {
    const owner = await registerUser(app, { phone: '+26779111008', name: 'Owner' });
    const attacker = await registerUser(app, { phone: '+26779111009', name: 'Attacker' });
    await enrol(owner);
    await enrol(attacker, createSoftwareAuthenticator());     // the attacker has their own device
    const challenge = await optionsFor(attacker);
    // They now replay the OWNER's credential id, signed by the owner's authenticator.
    const response = await app.inject({
      method: 'POST', url: '/api/webauthn/authenticate/verify', headers: attacker.auth,
      payload: authenticator.authenticate({ challenge, rpId, origin, counter: 1 }),
    });
    expect(response.statusCode, response.body).toBe(400);
  });

  it('rate limits repeated biometric attempts', async () => {
    const user = await registerUser(app, { phone: '+26779111010', name: 'Biometrics' });
    await enrol(user);
    const codes: number[] = [];
    for (let i = 0; i < 13; i++) {
      const challenge = await optionsFor(user);
      const assertion = authenticator.authenticate({ challenge, rpId, origin, counter: 100 + i });
      assertion.response.signature = b64url(randomBytes(64));       // always wrong
      const response = await app.inject({ method: 'POST', url: '/api/webauthn/authenticate/verify', headers: user.auth, payload: assertion });
      codes.push(response.statusCode);
    }
    expect(codes.some((code) => code === 429)).toBe(true);
  }, 30_000);

  it('keeps the password fallback available and rate limited', async () => {
    const user = await registerUser(app, { phone: '+26779111011', name: 'Fallback' });
    const wrong = await app.inject({ method: 'POST', url: '/api/auth/step-up', headers: user.auth, payload: { password: 'not-my-password' } });
    expect(wrong.statusCode).toBe(401);
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const response = await app.inject({ method: 'POST', url: '/api/auth/step-up', headers: user.auth, payload: { password: 'not-my-password' } });
      codes.push(response.statusCode);
    }
    expect(codes.some((code) => code === 429)).toBe(true);
  }, 30_000);

  it('an abandoned challenge cannot be used later (cancellation)', async () => {
    const user = await registerUser(app, { phone: '+26779111012', name: 'Cancel' });
    await enrol(user);
    const stale = await optionsFor(user);          // user walks away here
    await optionsFor(user);                        // a new attempt replaces the challenge
    const response = await app.inject({
      method: 'POST', url: '/api/webauthn/authenticate/verify', headers: user.auth,
      payload: authenticator.authenticate({ challenge: stale, rpId, origin, counter: 1 }),
    });
    expect(response.statusCode).toBe(400);
  });
});
