# PAYCHAT V2 — FINAL VERIFICATION

Generated: 2026-09-04 · Workspace: `/home/user/paychat`

**Every status below is what was actually verified in this workspace.** Nothing is marked
READY on the strength of a successful compile alone.

| Check | Result |
|---|---|
| `npm run typecheck` (tsc strict, noEmit) | **PASS** |
| `npm run lint` (eslint, 0 warnings allowed) | **PASS** |
| `npm test` (vitest) | **PASS — 88 tests, 6 files** |
| `npm run build` (API bundle + web bundle) | **PASS** |
| `scripts/e2e-smoke.ts` against a running server | **PASS — 24 checks** |
| Production readiness | **NOT READY** (see Remaining Issues) |

---

## Repository

* **Repository:** `/home/user/paychat` (git, initialised during this build)
* **Branch:** `main`
* **Commit:** `c83d2d8`
* **Working tree:** clean at time of report
* **Prior state:** the workspace contained **no PayChat code** — only the logo assets. This is a
  from-scratch build, so "preserve working functionality" was not applicable; the architecture was
  built to the spec instead (audit finding #1).

## Architecture

* **Status: IMPLEMENTED**
* Monorepo: `packages/shared` (money, status machine, provider contract), `packages/nlp`
  (English/Setswana), `apps/api` (Fastify), `apps/web` (React + Vite).
* Strict TS, integer minor units everywhere, no floats in money paths.
* Provider-agnostic: no gateway is hard-coded into the UI or the core workflow.

## Payment Orchestrator

* **Status: VERIFIED**
* Single component that moves money. Enforces: state-machine transitions, idempotency,
  account ownership, currency match, recipient ownership, risk step-up, expiry, provider
  failure handling, reconciliation.
* Tests: success-by-webhook, insufficient funds, timeout (stays `PENDING`), unavailable,
  cancel, expiry, duplicate confirm, idempotency key, polling reconciliation, refund.

## Provider abstraction / registry

* **Status: IMPLEMENTED (adapters), NOT CONNECTED (no credentials)**
* `PaymentProvider` interface with capability discovery (10 capabilities).
* `GenericRestProvider`: real OAuth2 client-credentials, idempotency key header, status mapping,
  HMAC-signed webhook verification, honest error mapping (5xx → retryable, never fake success).
* Registry is configuration-driven per country/kind: Orange Money, MyZaka, Smega, generic bank,
  generic card (Botswana). Each is **disabled unless its credentials are present** — the API
  reports "not available" rather than pretending.
* `SandboxProvider`: deterministic simulator for dev/test only; constructor throws in production.

## Authentication

* **Status: VERIFIED**
* scrypt password hashing; HS256 access tokens (15 min) with strict claim validation;
  opaque refresh tokens hashed at rest and rotated.
* Verified: login/register, identical errors for unknown-user vs wrong password (no enumeration),
  expired token rejection, forged-signature rejection, refresh rotation, **refresh replay revokes
  all sessions**, logout invalidation, rate limiting after repeated failures.

## Biometric (WebAuthn)

* **Status: IMPLEMENTED — DEVICE VERIFICATION PENDING**
* Real WebAuthn: `userVerification: required`, platform authenticator, RP/origin bound,
  one-time single-use challenges, signature + counter verification via `@simplewebauthn/server`.
* Only credential id, public key and counter are stored — **no biometric data ever reaches PayChat**.
* Verified here: challenge single-use, unknown-credential rejection, malformed assertion rejection,
  step-up claim required before privileged payment routes.
* **Not verified:** an actual fingerprint/face prompt on real hardware (none in this environment);
  password step-up is the tested fallback.

## Chat

* **Status: VERIFIED**
* Send/receive, membership-checked reads, cursor pagination (stable under identical timestamps),
  unread tracking, `client_msg_id` de-duplication for offline retries, SSE realtime with polling
  fallback, offline outbox, draft persistence.

## English NLP

* **Status: VERIFIED** — `Pay P50 Motakase`, `Pay P100 to John`, `Send P25 to Neo`,
  `Pay fifty pula to Motakase`, `Pay P1,250.50 Motakase`, `Pay 50 thebe Motakase`.

## Setswana NLP

* **Status: VERIFIED** — `Duela Motakase P50`, `Ke batla go duela Motakase P50`,
  `Nthuse go duela Motakase P50`, `Duela Motakase P50 ka Orange Money`, `Romela Neo P25`,
  `Kopa Thato P200` (request), `masome a matlhano pula` (number words).

## Ambiguity handling (never guesses)

* **Status: VERIFIED** — missing amount, missing recipient, unknown contact, multiple contacts
  (returns candidate list), unsupported method, no-action commands all produce a bilingual
  clarification instead of an intent.

## Voice

* **Status: IMPLEMENTED — DEVICE VERIFICATION PENDING**
* Web Speech API → transcript → **the same intent parser** → the same confirmation sheet.
  Requests `tn-BW` with automatic English fallback and a typed fallback if speech is unsupported.
  No headless browser here, so the audio path itself is untested (only the transcript→intent path is).

## Payments

| Item | Status |
|---|---|
| Multi-provider architecture | IMPLEMENTED |
| Idempotency (intent + confirm + messages) | VERIFIED |
| Duplicate confirm blocked | VERIFIED |
| Insufficient funds | VERIFIED |
| Provider timeout / unavailable | VERIFIED (stays PENDING, reconciled) |
| Cancel / expire / refund | VERIFIED |
| Payment status authoritative | VERIFIED (only provider callback or verified poll changes status) |
| Reconciliation | VERIFIED (polling sweep + expiry of abandoned intents) |

## Webhook security

* **Status: VERIFIED**
* Rejected and tested: forged signature, tampered body, replayed event id, stale timestamp
  (outside 5-min window), unknown reference, **amount mismatch vs the confirmed intent**,
  missing event id. Rejections return a generic body that leaks no provider internals.

## Multiple accounts / balances

* **Status: VERIFIED (sandbox rail)**
* Four connected accounts with per-method balances in the payment dropdown, sufficiency flags
  per amount, per-account refresh, `available / pending` display, stale flagging after spending,
  unavailable provider → `null` (never an invented number), and **no cross-currency totals**.

## Payment requests

* **Status: IMPLEMENTED (API + chat cards), UI PARTIAL**
* Create with amount/currency/description/expiry; pay route creates a normal intent and goes
  through the identical confirmation + step-up path; decline route; auto-expiry of overdue requests.

## Receipts

* **Status: VERIFIED**
* Generated only after an authoritative `SUCCESSFUL`; owner-scoped reads; reference, amount,
  currency, method, provider, parties, timestamp; view/share/print.

## Payment links / QR

* **Status: PARTIAL**
* Signed, expiring, secret-free link tokens with server-side amount validation and single-use
  enforcement: create, preview/redeem, pay (**verified** — tampered, expired and replayed links
  are rejected). **Not built:** QR image generation/scanning UI and merchant QR codes.

## Balance security

* **Status: IMPLEMENTED**
* Owner-scoped account reads, rate-limited refresh, cached values flagged stale, audit logging
  of balance views, no public endpoints. Provider-token encryption is **reserved but unused** —
  no provider OAuth tokens are persisted yet (see Remaining Issues).

## Database security

* **Status: IMPLEMENTED (SQLite: ownership scoping), PARTIAL (Postgres)**
* 22 tables, versioned migrations, foreign keys on, WAL.
* SQLite: every repository function is owner-scoped; IDOR attempts are covered by tests.
* `apps/api/src/db/postgres/002_rls.sql` ships the full RLS policy set (users, sessions, devices,
  credentials, contacts, conversations, messages, accounts, balances, intents, transactions,
  requests, receipts, notifications).

## RLS

* **Status: AUTHORED — NOT EXECUTED / NOT VERIFIED**
* No PostgreSQL instance exists in this workspace, so the policies were never applied or tested.
  They must be applied and exercised (`SET LOCAL paychat.user_id`) before go-live.

## Security audit

* **Status: AUTOMATED TESTS PASS — MANUAL PEN-TEST NOT PERFORMED**
* Covered by tests: IDOR (conversation, messages, intent, receipt, account, balance, session,
  device), amount/recipient/method tampering at confirm time, client-supplied status changes
  (no such route), unauthenticated access to every money endpoint, refresh-token replay,
  forged step-up claims, malformed JSON, webhook forgery/replay/tampering, link tampering/replay.
* Not covered: dependency CVE scan (`npm audit`), DAST, infrastructure review, load testing.

## Tests

* **Status: PASS — 88 tests**
  `tests/nlp.test.ts` (26), `tests/auth.test.ts` (10), `tests/payments.test.ts` (14 incl.
  reconciliation), `tests/security.test.ts` (27 incl. webhooks and payment links),
  `tests/messaging.test.ts` (5), `tests/balances.test.ts` (6).

## Production build

* **Status: PASS**
* API bundles to `dist/api/index.js` (esbuild, migrations copied alongside); web builds to
  `dist/web`. A real bug was caught by running the bundle (missing migrations in `dist`) and fixed.
* A successful build is **not** proof of readiness — see below.

---

## Remaining Issues (blocking production)

1. **No live payment provider credentials.** Orange Money / MyZaka / Smega / bank / card adapters
   are real HTTP clients but disabled without credentials + commercial agreements. Today only the
   dev/test sandbox rail transacts. Nothing fake runs in production, but no real money can move yet.
2. **Postgres RLS unverified.** Policies are authored, not applied or tested. Also: the SQLite
   ownership scoping must be re-verified against the Postgres policies after migration.
3. **Biometric and voice untested on real devices.** WebAuthn verification logic is exercised for
   failure paths only; a real fingerprint/face prompt and Setswana speech recognition were not.
4. **No provider OAuth token persistence/encryption.** `TOKEN_ENCRYPTION_KEY` is reserved but
   unused; account connection currently stores a provider account reference only. Required before
   real bank/card OAuth flows.
5. **Merchant console not built.** Merchants exist as a user type and a contact badge, with
   messaging and payment requests, but there is no merchant dashboard, catalogue or settlement view.
6. **QR scanning/rendering UI missing** (link layer is done and tested).
7. **Operational gaps:** in-memory rate limiting and SSE bus must move to Redis for multi-node;
   no `npm audit`/dependency CVE gate; no DAST/load testing; no CI pipeline; no secrets manager wiring;
   no alerting on reconciliation failures; no data-export/account-deletion workflows.
8. **AI assistant not built.** The prompt allows optional AI: PayChat deliberately works fully
   without it (rule-based NLP only), so there is no AI failure mode — but no LLM assistance either.

## Production Readiness

**NOT READY** — deliberately. The security-critical core (orchestrator, idempotency, webhook
verification, ownership scoping, step-up, reconciliation, honest failure states) is implemented and
verified by tests plus a live end-to-end run. What stands between this and launch is integration
work that cannot be faked: real provider credentials and agreements, Postgres RLS verification,
real-device biometric and voice testing, and the operational hardening listed above.

Nothing in this build simulates a real payment provider, a biometric verification, or a payment
success. Every "verified" claim above is backed by a test or a live end-to-end check.
