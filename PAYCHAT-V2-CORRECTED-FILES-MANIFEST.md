# PayChat V2 — Corrected Files Manifest

Every file below exists **in full** at the path shown inside the repository (`/home/user/paychat`,
also packaged as `PAYCHAT-V2-CORRECTED-FINAL.zip`). No snippets, no patches, no truncation, no
`…` placeholders. No real API key, password, token, private key or personal data appears in any
file — configuration is documented with placeholders in `.env.example`.

Legend for **Verification status**:
`PASS` = covered by an executed check listed in `PAYCHAT-V2-FINAL-VERIFICATION-MATRIX.md` ·
`BLOCKED` / `NOT VERIFIED` = as recorded in the readiness report ·
`REVIEW` = non-behavioural artefact (docs/config) reviewed by inspection.

---

## A. New files — provider architecture (brief §2–§6)

| Path | Status | Purpose | Verification |
|---|---|---|---|
| `apps/api/src/providers/types.ts` | Created | The provider contract: `PaymentProvider` interface, capability flags, money/status types. Core depends only on this. | PASS |
| `apps/api/src/providers/definitions.ts` | Created | Central registry data: id, display name, type, country, currency, enabled, methods, transaction types, capabilities, auth and config requirements for every rail (mobile money, AuthePay, banks, card, sandbox). | PASS |
| `apps/api/src/providers/disabled.ts` | Created | The adapter used when a provider is disabled or unconfigured — reports unavailability instead of silently simulating. | PASS |
| `apps/api/src/providers/registry.ts` | Created *(replaces the previous provider list)* | Loads definitions from defaults → `PAYCHAT_PROVIDERS` → database rows, validates them, applies the kill switch, persists and exposes capabilities. | PASS |
| `apps/api/src/providers/generic.ts` | Modified | Configuration-driven HTTP adapter (auth, balance, payment, status, refund, webhook verification) shared by every HTTP-based provider. | PASS |
| `apps/api/src/providers/signature.ts` | Modified | Webhook signature construction and constant-time verification with timestamp window and replay protection. | PASS |
| `apps/api/src/providers/sandbox.ts` | Modified | Development/test rail. Automatically excluded in production and refuses to construct there. Not a simulation of a real provider in production. | PASS |
| `apps/api/src/security/credentials.ts` | Created | AES-256-GCM encryption of stored provider tokens using `TOKEN_ENCRYPTION_KEY`. | PASS |
| `tests/provider-architecture.test.ts` | Created | 15 tests: no provider name in core, add/remove/replace through configuration, capabilities advertised, kill switch, sandbox gating. | PASS |

## B. New files — corrected defects

| Path | Status | Purpose | Verification |
|---|---|---|---|
| `apps/api/src/payments/orchestrator.ts` | Modified | Fixed the unknown-outcome sweep (atomic `UPDATE … WHERE id IN (SELECT …) RETURNING`), provider-agnostic payment flow, idempotency keys, terminal-state protection. | PASS |
| `tests/unknown-outcome.test.ts` | Created | 11 regression tests: unknown, pending, timeout, late callback, retry, duplicate callback, rollback, concurrent reconciliation. | PASS |
| `apps/api/src/db/cursor.ts` | Created | Keyset `(created_at, id)` cursor pagination — no skipped or duplicated rows with identical timestamps. | PASS |
| `tests/pagination.test.ts` | Created | 10 tests: identical timestamps, asc/desc, empty/large/first/middle/final page, concurrent inserts, tampered cursor. | PASS |
| `apps/api/src/db/migrations/004_provider_registry.sql` | Created | `payment_providers` table so providers can be added/edited in the database. | PASS |
| `apps/api/src/db/migrations/005_merchant.sql` | Created | Merchant tables (profile, settlement state, merchant transactions). | PASS |
| `scripts/verify-migrations.ts` | Created | Proves migration discovery from the source tree, build output and a packaged layout in clean directories; failure mode, idempotence and SQLite↔Postgres parity. | PASS (10/10) |

## C. New files — QR (§16) and merchant (§17)

| Path | Status | Purpose | Verification |
|---|---|---|---|
| `apps/api/src/payments/qr.ts` | Created | Signed, expiring payment-link tokens; server-side QR rendering; resolution of a scanned token to a preview (never to a payment). | PASS |
| `apps/api/src/routes/merchant.ts` | Created | Owner-scoped merchant onboarding, summary, transactions, refunds, reconciliation and merchant QR. | PASS |
| `apps/web/src/screens/Scan.tsx` | Created | “My code” QR, scanning via `BarcodeDetector` when available **with a manual paste fallback always present**, and a confirm-before-pay preview sheet. | PASS (camera capture NOT VERIFIED) |
| `apps/web/src/screens/Merchant.tsx` | Created | Merchant console UI: onboarding, settlement summary, received payments with refund, reconcile, publish QR. | PASS |
| `tests/qr.test.ts` | Created | 14 tests: generation, signing, expiry, tamper, replay, duplicate pay, amount source, unknown token, merchant QR. | PASS |
| `tests/merchant.test.ts` | Created | 9 tests: onboarding, isolation, history, refund, settlement, reconciliation, QR. | PASS |

## D. New files — infrastructure, security, CI (§14, §18, §19)

| Path | Status | Purpose | Verification |
|---|---|---|---|
| `apps/api/src/infra/redis.ts` | Created | Optional Redis client: lazy connect, TLS-in-production, bounded timeouts and retries, cache with prefix invalidation, `withLock` (SET NX PX + owner-token compare-and-delete), fixed-window rate limiting, in-process fallbacks. | PASS (13/13) |
| `apps/api/src/security/rateLimit.ts` | Modified | Rate limiter that uses Redis when available and falls back in-process; returns `{ allowed, retryAfterSeconds, mode }`. | PASS |
| `scripts/verify-redis.ts` | Created | 13 checks against a live Redis: connectivity, config, timeouts, cross-client counters, lock exclusivity/ownership/TTL, cache round-trip and invalidation, unreachable-Redis fail-fast, API healthy without Redis. | PASS |
| `tests/redis.test.ts` | Created | 7 tests that pass with Redis present **and** absent. | PASS |
| `scripts/verify-rls.ts` | Created | 41 row-level security checks against a real PostgreSQL instance. | PASS (41/41) |
| `apps/api/src/db/postgres/001_init.sql` | Created | PostgreSQL schema for the production database. | PASS (schema parity) |
| `apps/api/src/db/postgres/002_rls.sql` | Modified | RLS policies on every tenant-scoped table (wallets, accounts, transactions, merchants, messages). | PASS (41/41) |
| `scripts/verify-secrets.ts` | Created | Secret scanner over the working tree, the git index and `dist/`; exits non-zero on any finding. | PASS (0 findings) |
| `.github/workflows/ci.yml` | Created | CI: `verify` (typecheck + lint + tests + build), `migrations`, `database` (postgres:17) and `redis` (redis:7) jobs. | REVIEW (not executed on a live runner here) |

## E. Modified files — application core

| Path | Status | Purpose | Verification |
|---|---|---|---|
| `apps/api/src/config.ts` | Modified | All configuration from the environment; production refuses to boot without `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `INTERNAL_JOB_TOKEN`; provider toggles; Redis settings; new `STEP_UP_TOKEN_TTL`. | PASS |
| `apps/api/src/server.ts` | Modified | `/healthz` and `/readyz` (DB check + registry load, 503 on failure); registers merchant routes; graceful shutdown. | PASS |
| `apps/api/src/security/jwt.ts` | Modified | Step-up tokens now expire in 5 minutes (`STEP_UP_TOKEN_TTL`) instead of the full access-token lifetime. | PASS |
| `apps/api/src/security/auth.ts` | Modified | Login, OTP, refresh rotation with reuse revocation, step-up enforcement, password fallback. | PASS |
| `apps/api/src/security/audit.ts` | Modified | Every audit line passes through `redactSecrets`. | PASS |
| `apps/api/src/routes/auth.ts` | Modified | Auth endpoints with rate limiting and audit events. | PASS |
| `apps/api/src/routes/payments.ts` | Modified | Payment intents, quotes, confirm (server-side amount), status, receipts, cursor-paginated history. | PASS |
| `apps/api/src/routes/chat.ts` | Modified | Conversations and messages with membership checks. | PASS |
| `apps/api/src/routes/platform.ts` | Modified | Provider discovery, WebAuthn registration/authentication, device and session management, health endpoints. | PASS (on-device biometric NOT VERIFIED) |
| `apps/api/src/repositories.ts` | Modified | Data access layer; provider persistence; webauthn credential store (scoped by user). | PASS |
| `apps/api/src/payments/orchestrator.ts` | See §B | — | PASS |
| `packages/nlp/src/intent.ts` | Modified | Amount/recipient/purpose/provider extraction; never assumes a provider; records `source: voice`. | PASS |
| `apps/web/src/App.tsx` | Modified | Routes and bottom navigation, including the new `/scan` and `/merchant` screens. | PASS |
| `apps/web/src/i18n.ts` | Modified | +50 English and Setswana strings for the scan and merchant screens. | PASS |
| `apps/web/src/styles.css` | Modified | Styles for the new screens (`qr-wrap`, `qr-video`, `stat-grid`, `row-between`, `row-gap`, `btn.small`, `notice.ok/error`, …). | PASS |

## F. New / modified tests and scripts

| Path | Status | Purpose | Verification |
|---|---|---|---|
| `tests/webauthn.test.ts` | Created | 11 tests of the server-side WebAuthn verification path using a software authenticator (real P-256 signatures): enrolment, valid assertion, forged signature, wrong origin, replay, counter rewind, cross-user credential, rate limiting, password fallback, abandoned challenge. | PASS (on-device NOT VERIFIED) |
| `tests/helpers.ts` | Modified | Test fixtures; added a JWT claim decoder. | PASS |
| `tests/nlp.test.ts` | Modified | Extended with provider-selection and voice-source expectations. | PASS |
| `scripts/e2e-smoke.ts` | Modified | End-to-end smoke against a running server — 8 sections (auth, chat, payments, NLP, balances, QR, merchant, provider registry), 34 checks. | PASS |
| `scripts/seed-demo.ts` | Modified | Deterministic demo data (no real personal data). | PASS |
| `package.json` | Modified | Workspace scripts (`verify`, `verify:rls`, `verify:migrations`, `verify:redis`, `verify:secrets`), dependency fix (`react-router-dom` 7.18.3). | PASS |
| `package-lock.json` | Modified | Lockfile for the dependency upgrade. | PASS |
| `.env.example` | Modified | Every environment variable documented with placeholder values only; nothing real. | REVIEW |

## G. Documentation (this delivery)

| Path | Status | Purpose | Verification |
|---|---|---|---|
| `PAYCHAT-V2-FINAL-PRODUCTION-READINESS-REPORT.md` | Created | 22 named sections with PASS / FAIL / BLOCKED / NOT VERIFIED statuses and an honest overall verdict. | REVIEW |
| `PAYCHAT-V2-FINAL-VERIFICATION-MATRIX.md` | Created | Requirement / implementation / test / result / evidence / remaining issue for every area. | REVIEW |
| `PAYCHAT-V2-CORRECTED-FILES-MANIFEST.md` | Created | This file. | REVIEW |
| `README.md` | Modified | Architecture, provider model, how to run, how to verify, and the honest blockers. | REVIEW |
| `verification-logs/clean-regression.log` | Created | Raw output of the clean-environment regression run (typecheck, lint, tests, build, audit, secret scan, Postgres RLS, migrations, Redis, end-to-end smoke). | PASS |
| `PAYCHAT-V2-CORRECTED-FINAL.zip` | Created | The complete source tree (135 files), excluding `node_modules/`, `dist/`, `.data/` and `.git/`. Delivered at the workspace root, i.e. **alongside** the tree rather than inside it: `/home/user/PAYCHAT-V2-CORRECTED-FINAL.zip`. | REVIEW |

---

## What is deliberately **not** in the package

- `node_modules/` — installed with `npm ci` from the committed lockfile (391 packages).
- `dist/` — produced by `npm run build`.
- `.data/` — local SQLite database created at runtime.
- `.git/` — repository history is kept in the working clone; the zip ships the working tree.
- Any real credential. `.env.example` contains placeholders only.

## Individual corrected files

Every corrected file listed above is also available on its own, at its repository-relative path,
under **`/home/user/paychat-corrected-files/`** — e.g.
`/home/user/paychat-corrected-files/apps/api/src/payments/orchestrator.ts`. Copy each one over
the matching path in a checkout; no file is a partial diff or a fragment.
