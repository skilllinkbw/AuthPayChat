# PayChat — Release Readiness

**Company:** Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
**Product:** PayChat
**Release candidate:** `ba06c61` + this change set
**Date:** 2026-09-19
**Build platform:** Windows 11, Node.js 24 (CI targets Node 20)

> **Reading this document:** every "PASS" below is the result of a command that
> can be re-run from a clean checkout. Anything that requires an external party —
> a bank, payment provider, regulator, auditor, certification body or legal
> practitioner — is listed as **BLOCKED (external)** and is **not** claimed as
> complete anywhere in this repository.

---

## 1. Build Status

| Item | Result |
|---|---|
| Language / runtime | TypeScript 5.9.3 (strict) on Node.js ≥ 20.11 |
| API | Fastify 5.12.3 → `dist/api/index.js` **188.7 kB** |
| Web | React 18.3.1 + Vite 6.4.3 → `dist/web` **285.11 kB** (87.89 kB gzip) + 9.92 kB CSS |
| Android | Capacitor 8 wrapper, `bw.co.braincade.paychat` |
| Migrations published | 5 (`001_init` … `005_merchant`) |

**Verification command**

```bash
npm run verify        # typecheck → lint → test → build
```

| Gate | Command | Result |
|---|---|---|
| Typecheck | `tsc -p tsconfig.json --noEmit` | **PASS** (0 errors) |
| Lint | `eslint . --max-warnings 0` | **PASS** (0 problems) |
| Tests | `node scripts/run-tests.cjs` | **PASS** (see §2) |
| Production build | `npm run build` | **PASS** |
| Secret scan | `npm run verify:secrets` | **PASS** — 0 findings in CI; on a developer workstation the scan flags the untracked, gitignored `.env` by design (material must never be committed) |
| Dependency audit | `npm audit --audit-level=high --omit=dev` | **PASS** (0 high/critical) |
| Migrations | `npm run verify:migrations` | **PASS** |
| End-to-end smoke | `scripts/e2e-smoke.ts` (CI) | **PASS** |

## 2. Test Status

| Metric | Value |
|---|---|
| Test files | **14 passed / 14** |
| Tests | **165 passed, 0 failed, 5 skipped** |
| Runner | Vitest 3, one process per file (`scripts/run-tests.cjs`) |
| Skipped | 5 — Redis-backed integration tests, skipped when `REDIS_URL` is unset; executed in the CI `redis` job |

Suites: `auth`, `balances`, `merchant`, `messaging`, `nlp`, `notifications`,
`pagination`, `payments`, `provider-architecture`, `qr`, `redis`,
`security` (27), `unknown-outcome` (11), `webauthn` (11).

Redis, PostgreSQL RLS and migration verification run as separate CI jobs because
they require real services (`.github/workflows/ci.yml`).

## 3. Security Status

| Area | Status | Evidence |
|---|---|---|
| Authentication | **PASS** | scrypt hashing, 15-min JWT, rotating single-use refresh tokens, reuse → all sessions revoked, WebAuthn step-up |
| Authorisation | **PASS** | Server-side ownership checks returning 404, merchant guard, internal-job token (constant-time compare), PostgreSQL RLS |
| Payment integrity | **PASS** | Server-authoritative amounts/recipients, idempotency keys, duplicate-confirm rejection, state machine, reconciled pending states |
| Webhook security | **PASS** | HMAC-SHA256 over raw bytes, `event_id` uniqueness (replay), amount cross-check before transition |
| Secrets | **PASS** | No secrets in source/git/dist; production boot requires `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `INTERNAL_JOB_TOKEN` |
| Injection / XSS / SSRF | **PASS** | Parameterised SQL throughout, React escaping, no user-controlled outbound URLs |
| Rate limiting | **PASS** | Redis-backed when available, in-process fallback; login and step-up identity-scoped |
| Audit logging | **PASS** | Security-sensitive events with secret redaction; no OTP, password or credential values |
| Independent penetration test | **BLOCKED (external)** | Not performed |
| Independent certification (SOC 2 / ISO 27001) | **BLOCKED (external)** | Not obtained |

## 4. Frontend Status

| Item | Status |
|---|---|
| Screens | Auth, Home, Chat, Activity, Scan, Merchant, Balances, Inbox, Settings, Contacts, Terms, Privacy, Security Guide |
| Branding | Official PayChat logo/mark/favicon (`apps/web/public/`) — no replacement or AI-generated logo |
| States | Loading, empty, error and retry states on every network-backed view |
| Currency | Pula formatting via shared money helpers; amounts never re-computed in the UI |
| Truthfulness | No success message is shown unless the server returns a provider-confirmed status |
| Responsive / accessible | Mobile-first layout, labelled controls, keyboard-reachable navigation, visible focus |
| Demo mode | Explicitly labelled; no real funds; never presented as production |
| Bundle size | 285.11 kB (87.89 kB gzip) main chunk — no stray heavy dependency |
| Accessibility | Labelled form controls, visible focus rings, keyboard-reachable navigation, WCAG-AA contrast on the brand palette, ≥44px touch targets |
| Empty states | Every list view renders a professional empty state (e.g. "No transactions yet.") instead of blank space or invented numbers |
| Error UX | Network/provider failures map to plain-language copy ("PayChat could not reach the payment service. Please try again."); stack traces stay server-side |
| Artificial artefacts removed | No lorem ipsum, no "coming soon", no AI-styled gradient/glass decoration, no placeholder statistics, no debug banners |

## 5. Backend / API Status

| Item | Status |
|---|---|
| Routes | `auth`, `chat`, `payments`, `merchant`, `platform` (WebAuthn, webhooks, health, internal jobs) |
| Validation | Zod schema on every route; unknown fields rejected |
| Error contract | Stable `{ error: { code, message } }`; 5xx never leaks internals |
| Health | `/healthz` (no DB touch) and `/readyz` (DB + provider registry, per-dependency honesty) |
| Idempotency | `Idempotency-Key` on payment initiation; duplicate confirm rejected |
| Reconciliation | Interval job + `POST /api/internal/reconcile` (constant-time token compare) |
| Provider layer | Generic HTTP adapter + config-driven registry; no core changes needed to add a rail |
| Real payments | **BLOCKED (external)** — no provider contract or live credentials exist; the sandbox rail is labelled as such and never presented as live |

## 6. Mobile (Android) Status

| Item | Status |
|---|---|
| Framework | Capacitor 8 WebView wrapper |
| Application ID / label | `bw.co.braincade.paychat` / "PayChat" |
| Icon + splash | Generated from the official PayChat mark (`scripts/gen-launcher-icons.ps1`); brand background `#0B3B8C` |
| Permissions | `INTERNET` only |
| Cleartext traffic | **Disabled** (`usesCleartextTraffic="false"` + `network_security_config.xml`) |
| Backup / extraction | `allowBackup="false"`, `dataExtractionRules` restricting backup |
| Exported components | Launcher activity only (required); `FileProvider` not exported |
| Secrets in APK | None — the client holds no key or provider credential |
| Screenshots / orientation | Responsive layout; rotation supported via `configChanges` |
| Signed release build | **BLOCKED (external)** — release keystore must be generated and held by Braincade; no keystore is committed |
| Gradle release build on this machine | **NOT VERIFIED** — no Android SDK/JDK toolchain was present in the build environment; CI does not yet build the APK |

## 7. Database Status

| Item | Status |
|---|---|
| Development / test engine | SQLite via `better-sqlite3` (embedded, zero-setup) |
| Production engine | PostgreSQL, migrations in `apps/api/src/db/postgres/` |
| Migrations | 5 published (`001_init` … `005_merchant`); discovery verified in a clean environment |
| Row-level security | Policies in `002_rls.sql`; verified by `scripts/verify-rls.ts` against real PostgreSQL in CI |
| Constraints | Foreign keys, unique constraints (including webhook `event_id`), status/amount checks |
| Concurrency | Immediate write-locked transactions; conditional status writes prevent double transitions |
| Audit records | `audit_logs`, append-only by convention, owner-scoped reads |
| Client bypass of financial controls | Not possible — the app role cannot reach credential tables, and all financial state changes happen server-side |



## 8. Compliance Documentation Status

| Document | Location | Status |
|---|---|---|
| Privacy Notice | `LEGAL/PRIVACY_NOTICE.md` | Drafted — **not reviewed by counsel** |
| Terms & Conditions | `LEGAL/TERMS_AND_CONDITIONS.md` (+ in-app `screens/Terms.tsx`) | Drafted — **not reviewed by counsel** |
| Cookie / tracking notice | `LEGAL/COOKIE_AND_TRACKING_NOTICE.md` | Drafted |
| Acceptable use policy | `LEGAL/ACCEPTABLE_USE_POLICY.md` | Drafted |
| Data retention policy | `LEGAL/DATA_RETENTION_POLICY.md` | Drafted |
| Data-subject rights procedure | `LEGAL/DATA_SUBJECT_RIGHTS.md` | Drafted |
| Data-breach response procedure | `LEGAL/DATA_BREACH_RESPONSE.md` | Drafted |
| Information security policy | `LEGAL/INFORMATION_SECURITY_POLICY.md` | Drafted |
| Botswana Data Protection Act 2018 alignment | `docs/partner/DATA_PROTECTION.md` | Documented — **no certification claimed** |
| Data-subject rights in-app | `apps/web/src/screens/Privacy.tsx`, `SecurityGuide.tsx` | Implemented |
| Controller registration (Information and Data Protection Commission) | — | **BLOCKED (external)** — not filed |

## 9. Commercial Documentation Status

| Document | Location | Status |
|---|---|---|
| Product description | `docs/partner/PAYCHAT_PRODUCT_OVERVIEW.md` | Complete |
| Pricing architecture | `config/commercial.json` + `LEGAL/FEES_AND_PRICING.md` | Configured; **values intentionally `null` pending owner decision** — no invented prices |
| Commercial terms (merchant/enterprise) | `LEGAL/COMMERCIAL_TERMS.md` | Drafted — pending counsel + commercial agreement |
| Refund / reversal policy | `LEGAL/REFUNDS_AND_REVERSALS.md` | Drafted |
| Support and disputes | `LEGAL/SUPPORT_AND_DISPUTES.md` | Drafted |
| SLA framework | `LEGAL/SLA_FRAMEWORK.md` | Drafted; availability figure is a **target**, not a measured result |
| Acceptable use | `LEGAL/ACCEPTABLE_USE_POLICY.md` | Drafted |
| Merchant onboarding | `docs/partner/PARTNER_ONBOARDING.md` | Complete |
| Subscription / trial handling | `config/commercial.json` (`trial.enabled=false`) | Configured, disabled |
| Provider-fee pass-through | `config/commercial.json` (`providerFees`) | Configured — no default assumed |

## 10. Bank / Payment-Partner Readiness

| Artefact | Status |
|---|---|
| Product overview | Complete |
| Bank partnership brief | Complete |
| Payment architecture (flow + state machine) | Complete |
| Security overview with test mapping | Complete |
| Data protection (Botswana) | Complete |
| AML / KYC overview | Complete — obligation allocation to be confirmed per partner |
| Risk and controls | Complete |
| Incident response / BC / DR | Complete — targets defined, **not yet exercised** |
| API integration overview | Complete |
| Partner onboarding pack | Complete |
| Technical due diligence pack | Complete |
| Compliance checklist (implemented vs external) | Complete |
| Third-party dependency + licence inventory | Complete |
| Information classification | Complete |
| Existing partnership | **NONE** — no partnership, endorsement or licence is claimed |

## 11. Known Limitations

1. **No live payment rail.** No provider contract, credential or webhook secret
   exists. Real money movement is impossible until an external partner is
   contracted. This is the single largest blocker.
2. **No Android release keystore.** The APK/AAB cannot be signed by Braincade yet.
3. **Gradle release build unverified** in this environment (no Android SDK/JDK).
4. **No production infrastructure.** Deployment region, secret manager, backups
   and TLS termination are deployment-time decisions and are not enforced by code.
5. **No monitoring/alerting backend.** Logs are emitted but not aggregated or paged.
6. **No independent security testing.** Penetration test and DAST outstanding.
7. **Backup/restore and DR have not been exercised.** RPO/RTO are targets only.
8. **Pricing is unset by design.** `config/commercial.json` values are `null`
   pending an owner decision; no figures were invented.
9. **Push notifications not integrated.** Notifications are in-app only.
10. **No FX engine.** Currency handling is per-currency with no conversion.
11. **Redis and PostgreSQL integration tests are skipped locally** when those
    services are absent (5 skipped); they run in dedicated CI jobs.
12. **No load/performance testing** has been performed.


## 12. External Approvals Still Required

Nothing in this list can be completed by a code change. Each is a human,
contractual, regulatory or certification action.

| # | Requirement | Owner | Blocks |
|---|---|---|---|
| 1 | Payment provider / bank contract + live credentials + webhook secret | Braincade | All real payments |
| 2 | Written provider capability confirmation (payments, balance, refunds) | Provider | Feature enablement per rail |
| 3 | Data Processing Agreement per provider/processor | Braincade + provider | Live personal-data processing |
| 4 | Data-controller registration with the Information and Data Protection Commission (Botswana) | Braincade | Commercial launch |
| 5 | Legal review and sign-off of all `LEGAL/` documents by qualified Botswana counsel | Counsel | Publication of terms, privacy notice, fees |
| 6 | Regulatory-perimeter confirmation (payment services / AML-CFT reporting allocation) | Counsel + regulator | Regulated activity scope |
| 7 | AML/CFT compliance-officer appointment, if required by the applicable regime | Braincade | Regulated activity scope |
| 8 | Android release keystore generation and custody | Braincade | Signed APK/AAB distribution |
| 9 | Independent penetration test and remediation sign-off | Third-party security firm | Bank-partner acceptance |
| 10 | Independent availability / DR exercise with evidence | Braincade + infra provider | SLA commitments |
| 11 | Production infrastructure provisioning (in-region, secret manager, backups, TLS) | Braincade / infra provider | Production operation |
| 12 | Monitoring and on-call/paging arrangement | Braincade | Operational SLA |

**No partnership, licence, registration, certification or regulatory approval is
claimed to exist.** Items 1–12 are all outstanding.

## 13. Final Quality Gate

| Check | Status |
|---|---|
| No known blocking bugs | PASS — full suite green |
| No fake production flows | PASS — sandbox rail is explicitly labelled; no live-rail claim |
| No fake payment confirmations | PASS — success shown only from a provider-confirmed status |
| No hardcoded secrets | PASS — `verify:secrets` gate |
| No exposed credentials | PASS — none in source, git, logs or bundles |
| Authentication hardened | PASS |
| Authorization hardened | PASS |
| Payment flows protected | PASS — server-authoritative amount, recipient, currency |
| Idempotency reviewed | PASS |
| Webhooks secured | PASS — signature + replay defence + amount cross-check |
| Database policies reviewed | PASS — RLS verified against PostgreSQL in CI |
| API security reviewed | PASS |
| Frontend polished | PASS |
| Dashboard redesigned professionally | PASS — real data only, professional empty states |
| Real logo used | PASS — official brand asset, no replacement mark |
| Mobile UI reviewed | PASS |
| Artifacts removed | PASS — no lorem ipsum, "coming soon", placeholder stats or debug banners |
| Accessibility reviewed | PASS |
| Error handling reviewed | PASS — plain-language errors, diagnostics server-side only |
| Privacy / Data Protection documentation created | PASS (draft, pending counsel) |
| Terms & Conditions created | PASS (draft, pending counsel) |
| Commercial documents created | PASS (pricing intentionally unset) |
| Bank partnership brief created | PASS |
| Security overview created | PASS |
| IP documentation created | PASS |
| Open-source licences reviewed | PASS — no copyleft in the direct dependency set |
| Tests pass | PASS — 165 passed, 0 failed, 5 skipped |
| Lint passes | PASS — `--max-warnings 0` |
| Typecheck passes | PASS — 0 errors |
| Production build passes | PASS |
| Release package validated | PASS for API + web; **Android APK NOT BUILT** (no SDK/keystore) |
| README updated | PASS |
| Release-readiness report generated | PASS — this document |

## 14. Release Information

| Item | Value |
|---|---|
| Branch | `main` |
| Remote | `origin` → `https://github.com/skilllinkbw/AuthPayChat.git` |
| Previous release candidate | `ba06c61` |
| Push policy | Push to `origin/main` only after the gate above is re-run on the committed tree; never force-push |
| Artefacts | `dist/api/index.js`, `dist/web/**` (generated, not committed) |

## 15. Statement of Readiness

PayChat's **software** is at release-candidate quality and is **not** production
live. There is no bank partnership, no payment-provider contract, no data-controller
registration and no independent security certification. Any use of the words
"production ready" must be qualified: the application is ready to be *taken to* a
partner, not to move real money.

The next genuine milestone is not a code change — it is a signed provider
agreement, which unlocks items 1–3 in §12 and, with the remaining external
approvals, all real payment functionality.
