# PayChat V2 — Final Verification Matrix

**Requirement → Implementation → Test → Result → Evidence → Remaining issue**

Date: 2026-09-04 · Codebase: `/home/user/paychat` · Node 20.20.2 · PostgreSQL 17.11 · Redis 7

**Results vocabulary:** `PASS` · `FAIL` · `BLOCKED` · `NOT VERIFIED`.
**Evidence key:**
- `clean-regression.log` = `verification-logs/clean-regression.log` (full clean-environment run)
- `vitest` = `INTERNAL_JOB_TOKEN=test-token npx vitest run`
- `tsc` = `npx tsc -p tsconfig.json --noEmit`
- `lint` = `npx eslint . --max-warnings 0`

---

## 1. Flexible provider architecture

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| No provider name (`Orange Money`, `MyZaka`, …) in core payment logic | `PaymentProvider` interface + generic HTTP adapter; orchestrator depends only on the interface | Source-level assertions across orchestrator, routes, registry | PASS | `tests/provider-architecture.test.ts` (15 tests) | — |
| A provider can be added without touching core | Registry merges built-in defaults, `PAYCHAT_PROVIDERS` JSON and DB rows by id | New provider declared in config appears in `GET /api/providers` and completes a payment | PASS | `tests/provider-architecture.test.ts`; e2e smoke §8 | — |
| A provider can be removed without touching core | Removing the definition removes it from registry, API and UI lists | Provider absence reflected end-to-end | PASS | `tests/provider-architecture.test.ts` | — |
| A provider can be replaced (same id, new endpoint) | DB row / env override wins over defaults | Override test | PASS | `tests/provider-architecture.test.ts` | — |
| Kill switch per deployment | `PAYCHAT_PROVIDER_DISABLE` | Disabled provider is unusable | PASS | `apps/api/src/providers/registry.ts`; tests | — |
| Invalid definitions rejected | Validation on load with explicit error | Malformed definition → boot/load error | PASS | `apps/api/src/providers/registry.ts` | — |

## 2. Provider registry & capabilities

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| Central registry declaring id, name, type, country, currency, enabled, methods, txn types | `definitions.ts` + `types.ts` | Registry shape assertions | PASS | `tests/provider-architecture.test.ts` | — |
| Capability flags (balance, payment, refund, QR, webhook, auth, environment) | `ProviderCapabilities` in `types.ts` | Every provider advertises capabilities | PASS | e2e smoke §8 | — |
| UI discovers providers dynamically | `GET /api/providers` consumed by web | Providers discovered, not hard-coded | PASS | e2e smoke §8 | — |
| Environment gating (sandbox never in production) | Sandbox excluded when `PAYCHAT_ENV=production`; adapter throws if constructed there | Boot-time behaviour | PASS | `apps/api/src/providers/registry.ts:85`, `providers/sandbox.ts` | — |

## 3. AuthePay decoupling

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| AuthePay is an adapter, not a dependency of core | Registry entry backed by the generic adapter | No `authepay` reference in core modules | PASS | `tests/provider-architecture.test.ts` | — |
| No circular PayChat ↔ AuthePay dependency | One-directional call through the interface | Static check | PASS | `apps/api/src/providers/definitions.ts` | — |
| Real AuthePay calls | Blocked — no credentials | — | BLOCKED | — | Needs sandbox credentials |

## 4. Banks (A/B/C/D)

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| Banks are configuration, not code | `bank_a`…`bank_d` definitions with per-bank base URL and credential env names | Definition-driven discovery | PASS | `apps/api/src/providers/definitions.ts`; tests | — |
| Live bank calls | Blocked — no credentials | — | BLOCKED | — | Needs bank API credentials |

## 5. Payment orchestration & money integrity

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| Intent → quote → step-up → confirm → provider → webhook | `payments/orchestrator.ts` | 14 payment tests | PASS | `tests/payments.test.ts` | — |
| Strict status machine; illegal transitions ignored | `canTransition`, terminal states | Illegal transition logged and ignored | PASS | e2e smoke; `tests/payments.test.ts` | — |
| Client cannot supply amount at confirm | Amount read server-side | Forged amount test | PASS | `tests/security.test.ts` | — |
| Step-up required above threshold / new device | Risk rules + `su` claim check | Skipped-auth payment blocked | PASS | `tests/security.test.ts` | — |
| Amount validation (zero, negative, absurd) | Minor-unit integer validation | Rejection tests | PASS | `tests/security.test.ts` | — |
| Recipient must be a contact | Contact membership check | Rejection test | PASS | `tests/security.test.ts` | — |
| Funding account must belong to payer | Ownership check | Rejection test | PASS | `tests/security.test.ts` | — |
| Step-up token short-lived | TTL tightened to 300 s (`STEP_UP_TOKEN_TTL`) | Token lifetime asserted | PASS | `tests/webauthn.test.ts`; `apps/api/src/security/jwt.ts` | Token is not single-use (see report §known issues #1) |

## 6. Unknown-outcome handling (brief defect)

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| Pending/unknown payments are found by the sweep | Atomic `UPDATE … WHERE id IN (SELECT …) RETURNING`; predicate fixed | Unknown outcome recovered | PASS | `tests/unknown-outcome.test.ts` | — |
| No lost update under concurrency | Same-statement read+claim | Concurrent reconciliation | PASS | `tests/unknown-outcome.test.ts` | — |
| Late / duplicate callbacks safe | Provider event id de-duplication + terminal-state protection | Duplicate callback, late callback | PASS | `tests/unknown-outcome.test.ts`; e2e smoke | — |
| Provider timeout leaves a recoverable state | Pending state + retry with idempotency key | Timeout scenario | PASS | `tests/unknown-outcome.test.ts` | — |
| Rollback on failure | Transaction-scoped updates | Rollback test | PASS | `tests/unknown-outcome.test.ts` | — |

## 7. Cursor pagination

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| No skipped or duplicated rows with identical timestamps | Keyset `(created_at, id)` | Identical-timestamp test | PASS | `tests/pagination.test.ts` | — |
| Ascending and descending traversal | `apps/api/src/db/cursor.ts` | Both directions | PASS | `tests/pagination.test.ts` | — |
| First / middle / final / empty pages | Cursor encoding | 10 tests | PASS | `tests/pagination.test.ts` | — |
| Concurrent inserts during traversal | Keyset, not offset | Concurrency test | PASS | `tests/pagination.test.ts` | — |
| Tampered / out-of-range cursor | Validation → 400 | Rejection tests | PASS | `tests/pagination.test.ts` | — |

## 8. Migrations & packaging

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| Migrations found from source tree, build output and packaged layout | Multi-path resolver | 10/10 checks, clean directories | PASS | `scripts/verify-migrations.ts`; `clean-regression.log` | — |
| Missing migrations fail loudly (no empty DB) | Boot refuses with explicit error | Failure-mode checks | PASS | `scripts/verify-migrations.ts` | — |
| Idempotent re-run | Migration ledger | Re-run no-op | PASS | `scripts/verify-migrations.ts` | — |
| SQLite ↔ Postgres schema parity | Parity check in the script | Core tables present in both | PASS | `scripts/verify-migrations.ts` | — |

## 9–10. PostgreSQL & row-level security

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| RLS enabled and enforced on every tenant table | `apps/api/src/db/postgres/002_rls.sql` | 41/41 checks against PostgreSQL 17.11 | PASS | `scripts/verify-rls.ts`; `clean-regression.log` | — |
| Anonymous access denied | Policies | Check included | PASS | `scripts/verify-rls.ts` | — |
| User A cannot see/modify user B’s wallet, account, transaction, merchant row | Policies + app checks | Isolation checks; `tests/security.test.ts` | PASS | `scripts/verify-rls.ts`, `tests/security.test.ts` | — |
| Service role and admin behave as intended | Role-based policies | Included in 41 checks | PASS | `scripts/verify-rls.ts` | — |
| API runs on PostgreSQL | **Not implemented** — repository layer is SQLite-only | — | BLOCKED | `apps/api/src/db/postgres/*` exists and is verified; `apps/api/src/repositories.ts` is SQLite | Requires repository port / dialect layer |

## 11. Authentication, step-up & biometrics

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| Login, OTP, session issuing | `security/auth.ts`, `routes/auth.ts` | 10 tests | PASS | `tests/auth.test.ts` | — |
| Refresh-token rotation + reuse revokes family | Rotation with reuse detection | Reuse test | PASS | `tests/auth.test.ts` | — |
| Device/session revocation | `repo.sessions` | Revocation tests | PASS | `tests/auth.test.ts`, `tests/security.test.ts` | — |
| Step-up for high value / new device | Risk rules | Blocked-payment test | PASS | `tests/security.test.ts` | — |
| Forged `su` claim rejected | Signature verified, claim server-issued | Forgery test | PASS | `tests/security.test.ts` | — |
| WebAuthn server-side verification (enrolment, assertion, origin, RP ID, UV flag, counter) | `@simplewebauthn/server` in `routes/platform.ts` | 11 tests with a software authenticator (real P-256 signatures) | PASS | `tests/webauthn.test.ts` | — |
| Biometric challenge single-use | `takeChallenge` consumes | Replay test | PASS | `tests/webauthn.test.ts` | — |
| Biometric rate limiting + password fallback | `rateLimit('webauthn:<user>', 10, 300)` | Rate-limit and fallback tests | PASS | `tests/webauthn.test.ts` | — |
| On-device biometric prompt, OS cancellation, secure-enclave storage | Implemented client-side (`@simplewebauthn/browser`) | **Cannot be executed here** | NOT VERIFIED | — | Needs real iOS/Android hardware |

## 12. Credentials & secrets

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| No secrets in source, git index or build output | `scripts/verify-secrets.ts` (tree + `git ls-files` + `dist`) | 0 findings | PASS | `clean-regression.log` | — |
| Scanner actually detects planted secrets | Self-test with planted patterns | Positive control | PASS | `scripts/verify-secrets.ts` | — |
| Production refuses to boot without secrets | `required()` on `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `INTERNAL_JOB_TOKEN` | Boot behaviour | PASS | `apps/api/src/config.ts` | — |
| Provider tokens encrypted at rest | AES-256-GCM via `security/credentials.ts` | Round-trip tests | PASS | `apps/api/src/security/credentials.ts` | Key must come from a KMS/secret manager in production |
| Secrets never logged | `redactSecrets` on every audit line | Log assertions | PASS | `apps/api/src/security/audit.ts` | — |
| Documented configuration | `.env.example` with placeholders only | Review | PASS | `.env.example` | — |

## 13. QR payments

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| QR generation | Server-rendered PNG data URI (`POST /api/payment-links`) | 201 + `data:image/png;base64` | PASS | `tests/qr.test.ts`; e2e smoke §6 | — |
| Signed, expiring token | HMAC signature + expiry | Expired link rejected | PASS | `tests/qr.test.ts` | — |
| Scan resolves to a preview, never pays | `POST /api/qr/scan` returns `requiresConfirmation` | Scan-without-payment test | PASS | `tests/qr.test.ts`; e2e smoke §6 | — |
| Tampered / modified QR rejected | Signature verification | Tamper test (last 3 chars altered → 400) | PASS | e2e smoke §6; `tests/qr.test.ts` | — |
| Replay / duplicate payment of one link refused | Single-use settlement | Duplicate-pay test | PASS | `tests/qr.test.ts` | — |
| Amount always taken from the server record | Untrusted QR payload | Amount-override tests | PASS | `tests/qr.test.ts` | — |
| Merchant QR | `POST /api/merchant/qr` | PNG produced | PASS | e2e smoke §7 | — |
| Camera capture on a device | `BarcodeDetector` when available | **Cannot be executed here** | NOT VERIFIED | `apps/web/src/screens/Scan.tsx` | Manual paste fallback always offered |

## 14. Merchant console

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| Merchant onboarding | `POST /api/merchant/onboard` (owner-scoped) | 201 + `isMerchant: true` | PASS | `tests/merchant.test.ts`; e2e smoke §7 | — |
| Payment history & status | Owner-scoped queries | History tests | PASS | `tests/merchant.test.ts` | — |
| Settlement totals | `GET /api/merchant/summary` | Summary test | PASS | e2e smoke §7 | — |
| Refunds | Per-transaction refund through the provider interface | Refund tests | PASS | `tests/merchant.test.ts` | Live refund BLOCKED (no credentials) |
| Reconciliation | `POST /api/merchant/reconcile` with internal job token | 200 + unknown outcomes resolved | PASS | e2e smoke §7 | — |
| Merchant isolation | Owner scoping on every route | Cross-merchant 403 | PASS | `tests/merchant.test.ts` | — |
| Audit trail | `logEvent` on merchant actions | Audit assertions | PASS | `apps/api/src/routes/merchant.ts` | — |

## 15. NLP

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| Extract amount, recipient, purpose | `packages/nlp/src/intent.ts` | 26 tests (EN + TN) | PASS | `tests/nlp.test.ts` | — |
| Preferred provider/method respected when stated | Provider hint parsing | Specified-provider tests | PASS | `tests/nlp.test.ts` | — |
| Never assume provider/account when unspecified | Returns unresolved selection for the UI | Unresolved-selection tests | PASS | `tests/nlp.test.ts` | — |
| Unsupported method flagged | `flagUnsupportedMethod` | Flag test | PASS | `tests/nlp.test.ts` | — |
| Voice transcripts cannot bypass confirmation or auth | Same parser, `source: voice` note, unchanged auth path | Voice-source test | PASS | `tests/nlp.test.ts` | — |
| Speech-to-text capture | Browser/ASR dependent | **Cannot be executed here** | NOT VERIFIED | — | Needs a device with a microphone |

## 16. Redis & infrastructure

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| Redis optional — dev works without it | `getRedis()` returns null when `REDIS_URL` unset; in-process fallbacks | 13/13 with Redis, 7/7 tests in both modes | PASS | `scripts/verify-redis.ts`, `tests/redis.test.ts` | — |
| Secure connection (TLS in production, AUTH) | Plain `redis://` refused in production | Config check | PASS | `apps/api/src/infra/redis.ts` | — |
| Timeouts and bounded retries | connectTimeout 2 s, commandTimeout 1.5 s, maxRetriesPerRequest 2, offline queue disabled | Blocking-command abort, unreachable-Redis checks | PASS | `scripts/verify-redis.ts` | — |
| Distributed locking | `SET NX PX` + owner-token compare-and-delete (Lua) | Exclusivity, non-owner, owner, TTL checks | PASS | `scripts/verify-redis.ts` | — |
| Cache invalidation | Prefix invalidation via `SCAN` | Round-trip, expiry, invalidate | PASS | `scripts/verify-redis.ts` | — |
| Rate limiting shared across nodes | Fixed-window `INCR` with graceful fallback | Cross-client counter; API healthy without Redis | PASS | `scripts/verify-redis.ts` | — |
| Documented production dependencies | README + `.env.example` | Review | PASS | `README.md`, `.env.example` | — |

## 17. Messaging, contacts, balances

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| Conversations and membership | `routes/chat.ts` | 5 tests | PASS | `tests/messaging.test.ts` | — |
| Contact resolution for payments | `packages` helpers + repo | Security tests | PASS | `tests/security.test.ts` | — |
| Accounts and balance refresh (owner-scoped, provider-agnostic) | `routes/payments.ts` | 6 tests | PASS | `tests/balances.test.ts` | Live balance BLOCKED (no credentials) |

## 18. Web application

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| Typecheck | strict TS | exit 0 | PASS | `clean-regression.log` | — |
| Lint at zero warnings | ESLint, no rule disabled, no file excluded | 0 problems | PASS | `clean-regression.log` | — |
| Production build | Vite | 252.82 kB JS (79.08 kB gzip), 8.61 kB CSS | PASS | `clean-regression.log` | Bundle > 250 kB — code-splitting not done |
| Scan and Merchant screens wired | `/scan`, `/merchant` routes + nav | e2e smoke; build | PASS | `apps/web/src/App.tsx` | — |
| Bilingual EN/Setswana labels | `i18n.ts` (+50 keys) | Build + review | PASS | `apps/web/src/i18n.ts` | — |
| Real device & cross-browser behaviour | — | **Cannot be executed here** | NOT VERIFIED | — | Needs device/browser matrix |

## 19. CI, static analysis, dependencies

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| CI runs verify + migrations + Postgres + Redis jobs | `.github/workflows/ci.yml` | Workflow definition reviewed | PASS | `.github/workflows/ci.yml` | Workflow not executed on a live runner here |
| Dependency vulnerabilities | `react-router-dom` upgraded to 7.18.3 (production); `vitest` upgraded to 3.2.7 so its nested `vite`/`esbuild` resolve to non-vulnerable versions (dev) | `npm audit --omit=dev` → 0 · `npm audit` (all deps) → 0 | PASS | `clean-regression.log` | No suppression, no `overrides`, no audit-level relaxation used |
| Secret scan in the gate | `scripts/verify-secrets.ts` | 0 findings | PASS | `clean-regression.log` | — |

## 20. DAST & penetration testing

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| DAST baseline (OWASP ZAP or equivalent) | Not run — no DAST tool available offline | — | NOT VERIFIED | — | Add a DAST stage to CI |
| Independent penetration test | Not performed | — | NOT VERIFIED | — | Required before launch |
| Application-level security tests | 27 tests (XSS/IDOR/amount tampering/step-up/webhooks) + QR + merchant suites | All pass | PASS | `tests/security.test.ts` and others | — |

## 21. Live provider integrations

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| Live authorisation, balance, payment, refund, status, webhook per rail | Adapters implemented (`providers/generic.ts`, `signature.ts`) | Exercised against a local mock HTTP rail, not a real provider | BLOCKED | `tests/provider-architecture.test.ts` | Needs one sandbox credential set per provider |
| Real webhook signature exchange | HMAC verification implemented and unit-tested | Signature, timestamp window, replay, duplicate-event tests pass locally | BLOCKED (live exchange) | `tests/security.test.ts` | Needs provider-side secret and a reachable callback URL |
| Reconciliation against a real provider | Implemented + tested with the sandbox rail | Sandbox scenarios pass | BLOCKED (live) | `tests/unknown-outcome.test.ts` | Needs credentials |

## 22. Load, resilience, disaster recovery

| Requirement | Implementation | Test | Result | Evidence | Remaining issue |
|---|---|---|---|---|---|
| Load / soak testing | Not performed | — | NOT VERIFIED | — | Define targets and measure |
| Failover and DR drills | Not performed | — | NOT VERIFIED | — | Backup/restore rehearsal needed |
| Graceful degradation verified functionally | Redis-unreachable path, rate limiting, locking fallbacks | 13/13 checks | PASS | `scripts/verify-redis.ts` | Not verified at scale |

---

## Clean regression run (no cached results) — 2026-09-04

| Step | Command | Result |
|---|---|---|
| Clean install | `rm -rf dist .data node_modules/.vite && npm ci` | 389 packages, 0 vulnerabilities (npm ci audit) |
| Typecheck | `npx tsc -p tsconfig.json --noEmit` | exit 0 |
| Lint | `npx eslint . --max-warnings 0` | 0 problems |
| Tests | `INTERNAL_JOB_TOKEN=test-token npx vitest run --no-cache` | **165 passed / 13 files** |
| Build | `npm run build` | API bundle + 5 migrations; web 252.82 kB (79.08 kB gzip) |
| Dependency audit (production) | `npm audit --omit=dev` | 0 vulnerabilities |
| Dependency audit (including dev) | `npm audit` | 0 vulnerabilities |
| Secret scan | `npx tsx scripts/verify-secrets.ts` | 0 findings |
| Postgres RLS | `PG_ADMIN_URL=… npx tsx scripts/verify-rls.ts` | **41/41** |
| Migrations | `npx tsx scripts/verify-migrations.ts` | **10/10** |
| Redis | `REDIS_URL=… npx tsx scripts/verify-redis.ts` | **13/13** |
| End-to-end smoke | `npx tsx scripts/e2e-smoke.ts http://127.0.0.1:4000` | 34 checks across 8 sections, all ✓ |

Test files: `tests/nlp.test.ts` (26) · `auth` (10) · `payments` (14) · `security` (27) ·
`messaging` (5) · `balances` (6) · `provider-architecture` (15) · `unknown-outcome` (11) ·
`pagination` (10) · `qr` (14) · `merchant` (9) · `redis` (7) · `webauthn` (11) = **165**.
