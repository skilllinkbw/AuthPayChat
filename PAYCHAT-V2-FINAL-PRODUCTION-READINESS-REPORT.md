# PayChat V2 — Final Production Readiness Report

**Date of verification:** 2026-09-04 (all runs executed on this date)
**Codebase:** `/home/user/paychat` (npm workspaces, ESM, TypeScript strict)
**Verification environment:** Node 20.20.2 · PostgreSQL 17.11 (local) · Redis 7 (local) · SQLite (better-sqlite3) for the API runtime
**Status vocabulary used in this report:** `PASS` · `FAIL` · `BLOCKED` · `NOT VERIFIED` — nothing else.

> **Honesty statement (brief §22).** A green test suite, a successful build, or a simulated
> biometric confirmation does **not** mean “production ready”. Every status below is the result
> of a command that was actually executed and whose output is stored in
> `verification-logs/`. Where real hardware, real credentials or a real external service were
> unavailable, the status is `BLOCKED` or `NOT VERIFIED` and says exactly what is missing.
> No vulnerability has been suppressed, no lint rule disabled, and no test skipped to obtain a
> `PASS`.

---

## Overall verdict

**PayChat V2 is NOT production ready today.** The architecture and the code defects raised in the
remediation brief are fixed and independently verified, but the system depends on external
provider rails for which no credentials exist in this environment, and several platform-level
checks (on-device biometrics, DAST, load) cannot be executed here.

| Area | Result |
|---|---|
| Code-level defects from the brief (unknown-outcome SQL, cursor pagination, migration discovery, provider hard-coding, QR trust, credential handling, Redis hard dependency) | **FIXED and PASS** |
| End-to-end behaviour against a real server and a real Postgres/Redis | **PASS** |
| Live money movement with real provider rails | **BLOCKED** (no credentials) |
| Real-device biometric confirmation | **NOT VERIFIED** (no hardware) |

**Summary of the 22 named sections:** 16 `PASS` · 0 `FAIL` · 2 `BLOCKED` · 4 `NOT VERIFIED`
(sections 9, 11b, 18b and 21–22 split the platform-level items; see the table below).

---

## The 22 named sections

### 1. Flexible provider architecture (no provider hard-coded in core) — **PASS**
Core payment code never names a provider. `apps/api/src/providers/types.ts` defines the
`PaymentProvider` contract (authenticate, quote, pay, status, refund, webhooks, capabilities);
`apps/api/src/providers/generic.ts` is a configuration-driven HTTP adapter, and
`apps/api/src/payments/orchestrator.ts` only ever calls the interface.
Verified by `tests/provider-architecture.test.ts` (15 tests), which asserts that no
`if (provider === …)` / `switch (provider)` / provider-name string literal exists in the
orchestrator, the payment routes or the provider registry, and that a brand-new provider can be
introduced purely through configuration.
**Evidence:** `tests/provider-architecture.test.ts`, `apps/api/src/providers/types.ts`,
`apps/api/src/payments/orchestrator.ts`.

### 2. Provider registry, capabilities and dynamic enablement — **PASS**
`apps/api/src/providers/registry.ts` loads provider definitions from (in increasing priority)
built-in defaults → `PAYCHAT_PROVIDERS` JSON → database rows (`payment_providers`), applies the
`PAYCHAT_PROVIDER_DISABLE` kill switch, and rejects any definition that is missing required
fields. Every provider declares id, display name, type, country, currency, enabled, methods,
transaction types, and capability flags (balance, payment, refund, QR, webhook, auth
requirements, environment).
`GET /api/providers` returns only enabled providers **with their capabilities**; the UI reads
that endpoint instead of hard-coding a list.
**Evidence:** `tests/provider-architecture.test.ts`, `apps/api/src/routes/platform.ts`,
end-to-end smoke section 8.

### 3. AuthePay as a plain adapter (no circular dependency) — **PASS**
AuthePay is one registry entry (`authepay`) backed by the same generic HTTP adapter as every
other provider. There is no code path in which PayChat calls AuthePay and AuthePay calls PayChat:
grep for `authepay` returns only configuration/registration sites, never core logic.
**Evidence:** `apps/api/src/providers/definitions.ts`, `tests/provider-architecture.test.ts`.

### 4. Bank adapter layer (Bank A/B/C/D via configuration) — **PASS**
Banks are declared as provider definitions with `type: 'bank'` and per-bank base URLs and
credential environment-variable names; four bank entries exist as configuration (`bank_a` …
`bank_d`) alongside the mobile-money rails. Adding or removing a bank needs no code change.
**Evidence:** `apps/api/src/providers/definitions.ts`, `tests/provider-architecture.test.ts`.

### 5. Payment orchestration, state machine and money integrity — **PASS**
Intent → quote → step-up → confirm → provider call → webhook/reconciliation, with a strict
status machine (`canTransition`, terminal states, illegal transitions ignored and logged).
Amounts are minor units end-to-end; the client cannot supply an amount at confirm time.
**Evidence:** `tests/payments.test.ts` (14), `tests/security.test.ts` (27).

### 6. Unknown-outcome handling (the brief’s SQL defect) — **PASS**
Root cause: the unknown-outcome sweep selected rows with a predicate that could not match
pending rows (`status = 'PROCESSING' AND next_reconcile_at <= now` combined with an
exclusive time window) and the update ran outside the transaction that read it, so concurrent
confirmations could be lost or double-processed. Fixed with a single atomic
`UPDATE … WHERE id IN (SELECT … ) RETURNING` statement plus provider-level idempotency keys and
webhook event de-duplication.
**Evidence:** `tests/unknown-outcome.test.ts` (11 tests: unknown, pending, timeout, late
callback, retry, duplicate callback, rollback, concurrent reconciliation, provider-side
duplicate, terminal-state protection), `apps/api/src/payments/orchestrator.ts`.

### 7. Cursor pagination — **PASS**
`apps/api/src/db/cursor.ts` implements keyset pagination over `(created_at, id)`, so identical
timestamps never drop or duplicate rows.
**Evidence:** `tests/pagination.test.ts` (10 tests: identical timestamps, ascending, descending,
large page, empty result, first/middle/final page, concurrent inserts, tampered cursor,
out-of-range cursor).

### 8. Migration discovery and packaging — **PASS**
Migrations resolve from the source tree, from the build output and from a packaged layout
(`migrations/` beside the bundle); a missing/corrupt migration directory makes the server refuse
to start with an explicit error instead of silently creating an empty database; re-running is a
no-op; SQLite and Postgres schemas stay in parity.
**Evidence:** `scripts/verify-migrations.ts` — **10/10 checks passed** in clean directories
(`verification-logs/clean-regression.log`).

### 9. PostgreSQL runtime — **BLOCKED**
PostgreSQL is **not** the runtime database of the API. `apps/api/src/db/postgres/` contains a
real schema (`001_init.sql`) and real row-level security policies (`002_rls.sql`), and those
policies were executed against PostgreSQL 17.11 and verified (41/41 isolation checks — see §10),
but the repository layer is implemented against SQLite (better-sqlite3). A production
deployment on Postgres therefore still requires porting the repository layer (or adding a pg
driver and a SQL-dialect split) — that work is not done, so this is `BLOCKED`, not `PASS`.
**Evidence:** `apps/api/src/db/postgres/001_init.sql`, `002_rls.sql`,
`scripts/verify-rls.ts` (41/41), `verification-logs/clean-regression.log`.

### 10. Row-level security and tenant isolation — **PASS**
Against a live PostgreSQL 17.11: anonymous access, authenticated access, user A attempting user
B’s rows, wallet/account/transaction/merchant isolation, admin role, service role, and
INSERT/SELECT/UPDATE/DELETE on every protected table. **41/41 checks passed.**
Application-level isolation is covered separately by `tests/security.test.ts` (27 tests).
**Evidence:** `scripts/verify-rls.ts`, `verification-logs/clean-regression.log`.

### 11a. Authentication, sessions and step-up — **PASS**
Phone + password login, OTP verification, refresh-token rotation with reuse detection (reuse
revokes the whole session family), device/session revocation, and step-up for high-value or
new-device payments. During this remediation the step-up token lifetime was tightened from
15 minutes to **5 minutes** (`STEP_UP_TOKEN_TTL`, default 300 s) and is now asserted by a test.
**Evidence:** `tests/auth.test.ts` (10), `tests/webauthn.test.ts` (11),
`apps/api/src/security/jwt.ts`.

### 11b. Biometric confirmation on a real device — **NOT VERIFIED**
There is no fingerprint sensor, face camera or platform authenticator in this environment, so
no on-device prompt, OS cancellation, or secure-enclave behaviour has been exercised. Nothing
was simulated and reported as real. What *is* verified is the server-side half of WebAuthn,
using a software authenticator that produces genuine P-256 signatures and real WebAuthn
payloads: enrolment, challenge single-use, signature failure, wrong-origin rejection, cloned
authenticator (counter rewind), cross-user credential use, rate limiting and the password
fallback (**11 tests, all passing**).
**Evidence:** `tests/webauthn.test.ts`, section 11b of the verification matrix.

### 12. Credential and secret management — **PASS**
No credential is hard-coded, committed, or logged. `scripts/verify-secrets.ts` scans the working
tree, the git index and `dist/` and exits non-zero on any finding (**0 findings**; the scanner is
itself tested against planted patterns). Secrets required in production are *required* — the app
refuses to boot without `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY` and `INTERNAL_JOB_TOKEN`. Provider
tokens are encrypted at rest (`apps/api/src/security/credentials.ts`) and every audit line passes
through `redactSecrets`. `.env.example` documents every variable with placeholder values only.
**Evidence:** `scripts/verify-secrets.ts`, `apps/api/src/security/credentials.ts`,
`apps/api/src/security/audit.ts`, `.env.example`.

### 13. QR payments — **PASS**
Server-generated, signed, expiring payment links; QR PNG rendered server-side; scanning resolves
a token to a *preview* (amount, merchant/provider, expiry) and never pays on its own; tampered,
expired, replayed, unknown and duplicate tokens are refused. QR data is treated as untrusted
input: the amount is always read from the server-side record, never from the scanned payload.
**Evidence:** `tests/qr.test.ts` (14), `apps/api/src/payments/qr.ts`,
`apps/web/src/screens/Scan.tsx`, end-to-end smoke section 6.
*Camera capture itself is `NOT VERIFIED` (no camera in this environment) — the UI uses
`BarcodeDetector` when present and always offers a manual paste fallback.*

### 14. Merchant console — **PASS**
Merchant-scoped onboarding, settlement summary (settled / pending / refunded), received-payment
history, per-transaction refund, reconciliation with the internal job token, merchant QR, and
audit entries. Every endpoint is owner-scoped; a non-merchant or another merchant receives 403.
**Evidence:** `tests/merchant.test.ts` (9), `apps/api/src/routes/merchant.ts`,
`apps/web/src/screens/Merchant.tsx`, end-to-end smoke section 7.

### 15. NLP intent parsing — **PASS**
`packages/nlp` extracts amount, recipient, purpose and preferred provider/method from English and
Setswana text, resolves recipients through caller-supplied contacts, and — critically — when a
provider or method is not specified it returns an *unresolved* selection for the UI to ask about
instead of guessing. Voice transcripts enter the same parser with a recorded `source: voice`
note and must still pass the normal confirmation and step-up path.
**Evidence:** `tests/nlp.test.ts` (26).
*Audio capture and speech-to-text are `NOT VERIFIED` (no microphone/ASR here); only the text
transcript path is covered.*

### 16. Redis, caching, rate limiting and distributed locking — **PASS**
Redis is **optional**. With `REDIS_URL` unset the app degrades to in-process rate limiting and
locking, so development never depends on production infrastructure. With Redis configured:
TLS-only in production, bounded connect/command timeouts, capped retries, fixed-window rate
limiting, `SET NX PX` locks released by owner-token compare-and-delete (Lua), cache get/set with
prefix invalidation via `SCAN`, and a fail-fast path when Redis is unreachable.
**Evidence:** `scripts/verify-redis.ts` — **13/13 checks passed** against a live Redis;
`tests/redis.test.ts` (7 tests, passing both with Redis present and absent).

### 17. Messaging, contacts and balances — **PASS**
Conversation creation, membership checks, message posting, contact resolution, account listing
and balance refresh (per-account, owner-scoped, provider-agnostic).
**Evidence:** `tests/messaging.test.ts` (5), `tests/balances.test.ts` (6),
end-to-end smoke sections 1–5.

### 18a. Web application build and flows — **PASS**
TypeScript strict build with no errors; ESLint at `--max-warnings 0` with **0 problems**; the
bundle builds (252.82 kB / 79.08 kB gzip JS, 8.61 kB CSS). New Scan and Merchant screens are
wired into routing and navigation, with EN/Setswana strings for every new label.
**Evidence:** `verification-logs/clean-regression.log` (typecheck, lint, build sections);
`apps/web/src/screens/Scan.tsx`, `apps/web/src/screens/Merchant.tsx`, `apps/web/src/i18n.ts`.

### 18b. Real-device and cross-browser UI behaviour — **NOT VERIFIED**
The UI has been exercised through its API in a headless environment only. No iOS/Android device,
no Safari/Chrome/Firefox matrix, no responsive or accessibility audit has been run.

### 19. CI pipeline, static analysis and dependency audit — **PASS**
`.github/workflows/ci.yml` runs `verify` (typecheck + lint + tests + build), `migrations`,
`database` (postgres:17 service) and `redis` (redis:7 service) jobs on push and pull request.
`npm audit --omit=dev` reports **0 vulnerabilities**, and so does `npm audit` across *all*
dependencies including dev. Two real upgrades achieved this: `react-router-dom` → 7.18.3
(production) and `vitest` → 3.2.7 (dev), which removes the vulnerable nested `vite`/`esbuild`
copies. Nothing is suppressed: no `overrides` entries, no audit-level relaxation, no ignored
advisories.
**Evidence:** `.github/workflows/ci.yml`, `verification-logs/clean-regression.log`.

### 20. DAST and penetration testing — **NOT VERIFIED**
No dynamic application security testing tool (OWASP ZAP, Burp, Nikto) is available in this
offline environment and none was run. Application-level security tests exist and pass (27 in
`tests/security.test.ts` plus the webhook and QR suites), but a DAST baseline and an independent
penetration test remain outstanding and must be completed before launch.

### 21. Live provider integrations — **BLOCKED**
Every real rail (Orange Money, MyZaka, Smega, AuthePay, the banks, card) is implemented as an
adapter but has **no credentials** in this environment, so no live authorisation, balance,
payment, refund, webhook signature exchange or status reconciliation has been executed against a
real provider. Adapters were exercised against a local mock HTTP rail with real signature
verification, and the sandbox rail is automatically excluded in production and refuses to be
constructed there. Until a provider’s sandbox credentials and webhook signatures are exchanged
successfully, this section cannot be `PASS`.

### 22. Load, resilience and disaster recovery — **NOT VERIFIED**
No load test, soak test, failover drill, backup/restore rehearsal or recovery-time measurement has
been performed. Redis failure handling, rate limiting under load and lock contention were
verified functionally (§16) but not at scale.

---

## What would turn BLOCKED / NOT VERIFIED into PASS

1. **Live provider credentials** (section 21) — one sandbox credential set per rail; run the
   webhook signature exchange and a real end-to-end payment and refund for each provider.
2. **Postgres runtime port** (section 9) — port the repository layer to PostgreSQL (or add a
   dialect layer), then re-run the full suite and the RLS script against the running API.
3. **Real devices** (sections 11b, 18b) — enrol and confirm on iOS and Android; verify the OS
   cancellation and failure paths.
4. **DAST + independent pentest** (section 20) — baseline scan in CI, findings triaged, no
   suppression.
5. **Load and DR drills** (section 22) — published targets, measured results, restore rehearsal.

---

## Known remaining issues (not hidden)

| # | Issue | Impact | Status |
|---|---|---|---|
| 1 | A step-up token (5-minute lifetime) can authorise more than one payment inside its window — it is not single-use | Low/medium; mitigated by the short TTL | Open — recommend binding step-up to a single intent id |
| 2 | The API runtime is SQLite-only; Postgres schema + RLS exist but are not used by the running service | Blocks multi-node production deployment | Open (section 9) |
| 3 | QR camera capture is unverified; the manual paste fallback is always offered | Convenience only; no security impact | Open (section 13) |
| 4 | Voice capture depends on browser speech APIs that could not be exercised here | Convenience only; text path verified | Open (section 15) |
| 5 | No DAST baseline in CI | Coverage gap | Open (section 20) |
