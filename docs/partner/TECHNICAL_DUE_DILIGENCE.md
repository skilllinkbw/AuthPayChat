# Technical Due Diligence Pack

**Company:** Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
**Product:** PayChat
**Prepared for:** bank / payment-partner security, risk and technology reviewers
**Last updated:** 2026-09-19

Answers below describe **the current codebase**, verified by automated tests where
stated. Where an answer depends on infrastructure, contract or certification that
does not yet exist, this is stated plainly.

---

## A. Architecture

| Question | Answer |
|---|---|
| What is the product? | A conversational payment interface (chat commands, payment links, QR) that orchestrates payments executed by licensed provider rails. |
| Is PayChat a bank? | **No.** Braincade holds no banking licence and does not hold or custody customer funds. |
| Architecture shape | Modular monolith: Fastify 5 API (`apps/api`), React 18 + Vite 6 client (`apps/web`), shared domain package, NLP package, Capacitor 8 Android wrapper. |
| Language / runtime | TypeScript (strict) on Node.js ≥ 20.11. |
| Datastore | PostgreSQL in managed deployment (RLS enabled) or embedded SQLite for development/test. |
| Cache / shared state | Optional Redis for rate limiting and locks; deterministic in-process fallback. |
| Provider extensibility | Single generic HTTP adapter plus a configuration-driven provider registry. Adding a rail requires **no core code change**. |

## B. Payment Integrity

| Question | Answer | Verified by |
|---|---|---|
| Can a client change an amount or recipient at confirmation time? | No. The server re-reads the stored intent; client-supplied amounts/recipients are ignored. | `tests/security.test.ts`, `tests/payments.test.ts` |
| Is a payment idempotent? | Yes — `Idempotency-Key` on initiation plus a duplicate-confirm rejection. | `tests/payments.test.ts` |
| What happens on provider timeout or 5xx? | State stays `PENDING` with a ledger row. PayChat never claims success or failure without proof. | `tests/unknown-outcome.test.ts` |
| How is a webhook authenticated? | HMAC-SHA256 over raw request bytes, compared in constant time. | `tests/security.test.ts` |
| How is webhook replay prevented? | Provider event id is a primary key; a repeat event is acknowledged and discarded. | `tests/security.test.ts` |
| Is status mutable by the client? | No route accepts a status change from a client. | `tests/security.test.ts` |
| Is there a state machine? | Yes — conditional writes inside an immediate (write-locked) transaction. | `tests/payments.test.ts` |
| Is there reconciliation? | Yes — `POST /api/internal/reconcile`, token-protected, compares internal state against provider state. | Server code + smoke test |
| Are receipts truthful? | Receipts are produced only from provider-confirmed outcomes. | `tests/payments.test.ts` |
| Fees / forex | No FX conversion engine. A quote endpoint exists; any fee must be supplied by configuration per provider. |

## C. Authentication

| Question | Answer |
|---|---|
| Password storage | scrypt with per-user random salt; constant-time comparison. |
| Access token | Signed JWT, 15-minute expiry. |
| Refresh token | Encrypted at rest, single-use, rotated on every use. |
| Reuse detection | A reused refresh token revokes **all** sessions for that user. |
| Strong authentication | WebAuthn (passkeys / platform biometrics) with server-side attestation and assertion verification. |
| Step-up requirement | Triggered by risk rules (value, velocity, new device); the step-up claim is verified server-side and cannot be forged. |
| Session visibility | Sessions are listed with device label/platform and can be revoked individually. |
| Brute-force protection | Login limited to 5 attempts per identity per 10 minutes (429). |
| Secrets in the client bundle | None. No key, token or provider credential is shipped to the browser or APK. |

## D. Authorisation

| Question | Answer |
|---|---|
| Model | Server-side ownership checks plus role flags; PostgreSQL RLS as a second layer. |
| Cross-account access | Ownership lookups return 404 (not 403) so resource existence is not disclosed. |
| Merchant endpoints | Guarded by an `is_merchant` check. |
| Administrative endpoints | Separated from user endpoints; internal jobs require `INTERNAL_JOB_TOKEN`. |
| IDOR testing | Covered explicitly in `tests/security.test.ts`. |

## E. Data Protection and Privacy

| Question | Answer |
|---|---|
| Regime | Botswana Data Protection Act, 2018 (alignment documented, **not certified**). |
| Data minimisation | Only identity, authentication, transactional and audit data are stored. |
| Card data | Never stored; no PAN, CVV or PIN enters PayChat. |
| Encryption | TLS in transit; database-level encryption at rest in production. |
| Retention | Defined schedule (`LEGAL/DATA_RETENTION_POLICY.md`). |
| Cross-border | In-region deployment required; out-of-region needs a documented transfer basis. |
| Controller registration | **Not yet filed** — external action. |

## F. Application and API Security

| Question | Answer |
|---|---|
| Input validation | Zod schemas on every route; amount limits, currency allow-list, E.164 phone format, UUID idempotency keys, validated cursors. |
| Output hygiene | Internal errors are mapped to safe messages; stack traces, SQL details and file paths are never returned. |
| Rate limiting | Per-route limits; login and step-up are additionally identity-scoped. Redis-backed when available. |
| Request size limits | Body size capped; lower on payment routes. |
| CORS | Same-origin by default; explicit allow-list in production. |
| Security headers | HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`. |
| Injection | Parameterised queries throughout; no string-built SQL. |
| SSRF | Provider base URLs come from configuration, not user input; user-supplied URLs are never fetched. |
| CSRF | Bearer-token API with no cookie-based session, so classic CSRF does not apply; the token is never stored in a cookie. |
| SQL/NoSQL injection | N/A for NoSQL; SQL is parameterised. |
| XSS | React escapes by default; no `dangerouslySetInnerHTML` in the codebase. |
| Secret leakage | Automated scan gate (`npm run verify:secrets`) runs in CI. |
| Console/debug artifacts in production | Release build strips dev-only surfaces; no debug banners. |

## G. Platform Security (Android)

| Question | Answer |
|---|---|
| Application ID | `bw.co.braincade.paychat` |
| Permissions | `INTERNET` only. |
| Cleartext traffic | Disabled in the network-security configuration. |
| Exported components | Single launcher activity (`exported="true"`, required to launch); the `FileProvider` is `exported="false"`. |
| WebView hardening | The wrapper loads the application's own HTTPS origin; no third-party or user-supplied URLs are loaded. |
| Secrets in the APK | None — the client holds no keys or provider credentials. |
| Signing | Release keystore is **not** in the repository and has **not** yet been generated by Braincade. |
| Obfuscation | R8/ProGuard rules present; released builds should be built with minification enabled after signing is configured. |
| Backup | `allowBackup="true"` — to be reviewed against the data-retention stance before release. |

## H. Operations

| Question | Answer |
|---|---|
| Logging | Structured JSON logs with event names; no secrets or full payment credentials. |
| Audit trail | Security-sensitive events are written to `audit_logs` (actor, action, target, timestamp, metadata). |
| Monitoring / alerting backend | **Not configured.** Logs are emitted; no aggregation backend or paging is wired up. |
| Health endpoints | `/healthz` (liveness) and `/readyz` (readiness, includes database and provider-registry checks). |
| Backups and restore drills | **Not yet performed** — requires production infrastructure. |
| RPO / RTO | Targets defined in `DISASTER_RECOVERY.md`; **not yet exercised**. |
| Incident response | Procedure documented in `INCIDENT_RESPONSE.md`; no 24/7 rota contracted. |
| Change management | Pull requests gated by CI (typecheck, lint, tests, build, secret scan, dependency audit, e2e smoke). |

## I. Quality Assurance

| Question | Answer |
|---|---|
| Test framework | Vitest 3, node environment, per-file isolation runner for native-module stability. |
| Coverage areas | Authentication, authorisation/IDOR, payment lifecycle, webhooks, unknown outcomes, balances, messaging, QR, pagination, notifications, merchant, NLP, provider architecture, WebAuthn, security. |
| Continuous integration | GitHub Actions: verify, migrations, PostgreSQL RLS, Redis integration jobs. |
| Independent penetration test | **Not performed.** |
| Fuzzing / DAST | **Not performed.** |
| Load / performance testing | **Not performed.** |

## J. Open Items the Partner Should Expect

1. Live provider credentials and a webhook secret must be exchanged before any
   live payment can be executed.
2. Provider-side capability confirmation is required (payments, balance, refunds).
3. A Data Processing Agreement and service terms must be signed.
4. Independent penetration testing is outstanding.
5. Independent availability/DR testing is outstanding.
6. Any AML/KYC obligation allocation must be agreed in writing per partner.

## K. Diligence Artefacts Available on Request

- `PAYMENT_ARCHITECTURE.md` — request/data flow and state machine
- `SECURITY_OVERVIEW.md` — control-by-control summary with test mapping
- `COMPLIANCE_CHECKLIST.md` — implemented vs external items
- `THIRD_PARTY_DEPENDENCIES.md` — service and licence inventory
- `INFORMATION_CLASSIFICATION.md` — data classification and handling
- Automated test suite and CI configuration (as a code review)
- CI logs and release-rehearsal evidence for the current candidate build

## L. Statement

This pack is provided for evaluation purposes and is accurate as at its stated
date. It contains no claim of certification, licence, regulator approval or
existing partnership. Braincade Holdings (Pty) Ltd · +267 76 749 821

