# PayChat

**Chat. Pay. Done.**

PayChat is a secure conversational-payment platform where users send and receive
money through chat commands and rich payment messages. Built by
**Braincade Holdings (Pty) Ltd** (Reg. No. BW00001951757) in Gaborone, Botswana,
PayChat is designed for the Botswana market and the SADC region — supporting
Setswana and English, the Pula, and local mobile-money and banking rails.

> **PayChat is a financial-technology platform, not a bank.** Funds are held and
> moved by regulated provider rails (mobile money, commercial banks, card
> networks). See [docs/partner/BANK_PARTNERSHIP_BRIEF.md](docs/partner/BANK_PARTNERSHIP_BRIEF.md).

---

## Features

| Capability | Where |
|---|---|
| Natural-language payments | Type or say “Pay P50 Motakase”, “Duela Motakase P50” |
| Payment requests | “Request P200 from Thato” |
| Payment links | Share a signed, expiring link |
| QR payments | Merchant-displayed and user-scanned codes |
| Balance refresh | Provider-reported balances, cached with staleness flags |
| Conversation history | Cursor-paginated, end-to-end ownership-checked |
| WebAuthn / passkey step-up | Biometric or device confirmation for high-value payments |
| Merchant console | Onboarding, transactions, settlement, refunds, audit trail |
| Transaction receipts | Immutable, provider-verified |
| Notifications | Inbox generated **only** from verified provider callbacks |
| Provider-agnostic | Add/remove/disable rails by configuration — no code changes |

---

## Architecture

```
apps/api   Fastify 5+ API — TypeScript, better-sqlite3 (embedded) or Postgres
apps/web   React 18 + Vite 6 client — PWA, i18n (en/tn), Capacitor 8 Android
packages/shared   Shared domain types, money, payment-status, ids
packages/nlp      NLP intent parsing (English + Setswana)
android/  Capacitor 8 Android project (appId bw.co.braincade.paychat)
```

See **[docs/partner/PAYMENT_ARCHITECTURE.md](docs/partner/PAYMENT_ARCHITECTURE.md)** for
the full architecture and **[docs/RELEASE_READINESS.md](docs/RELEASE_READINESS.md)**
for the current readiness status.

---

## Setup

```bash
npm install
npm run build        # builds API + shared packages + web client
npm start            # starts the API (port 4000)
npm run dev          # starts API + web dev servers concurrently
```

### Environment

Copy `.env.example` to `.env` and fill in values:

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | Production | Asymmetric-capable JWT signing key |
| `TOKEN_ENCRYPTION_KEY` | Production | Refresh-token encryption key |
| `INTERNAL_JOB_TOKEN` | Production | Reconciliation job authentication |
| `DATABASE_PATH` | Dev | SQLite path (`.data/paychat.db`) |
| `REDIS_URL` | Optional | Shared rate-limiting/locking |
| `PG_URL` | Optional | Postgres (managed deployment) |
| `PAYCHAT_WEBHOOK_BASE_URL` | Production | Public callback URL for providers |
| `SANDBOX_WEBHOOK_SECRET` | Dev | Sandbox webhook HMAC |
| `PAYCHAT_DISABLE_SECURITY_HEADERS` | Never in prod | Set to `1` to skip the standard response hardening headers (debug only) |
| `HSTS_MAX_AGE_SECONDS` | Optional | HSTS max-age (default 31536000), emitted in production |

---

## Testing

```bash
npm test                        # full suite via scripts/run-tests.cjs
npx vitest run tests/auth.test.ts   # individual file
npm run verify:secrets          # secret-scan gate
npm run verify:migrations       # migration idempotence check
```

| Metric | Value |
|---|---|
| Test files | 14 |
| Tests | 169 passed / 0 failed (5 Redis-only skipped without Redis) |
| Typecheck | Pass |
| Lint | Pass (`--max-warnings 0`) |
| Dependencies (production) | 0 vulnerabilities (`npm audit --omit=dev`) |
| Dependencies (incl. dev) | 2 moderate, dev-tooling only (`@vitest/mocker` via vitest 3; not shipped) |

Supply-chain note: `uuid` is pinned to `^11` via an npm `override` (the `xcode`
package used by `@capacitor/cli` declared a vulnerable range). The stale
Capacitor 6 toolchain inside `apps/web` was removed — the root Capacitor 8
wrapper under `android/` is authoritative.

---

## Deployment

```bash
npm run build && npm start
```

- Android APK/AAB: `npm run build:android` (see
  [release reports](release/reports/))
- Signing: production keystore must be generated and held by Braincade
  (documented in `release/` — not stored in this repository).

---

## Documentation

| Audience | Documents |
|---|---|
| **Bank / payment partners** | [docs/partner/](docs/partner/) |
| **Legal / compliance** | [LEGAL/](LEGAL/) |
| **Developers** | This README + inline JSDoc + `apps/api/src/` |
| **Release status** | [docs/RELEASE_READINESS.md](docs/RELEASE_READINESS.md) |

---

## Company

**Braincade Holdings (Pty) Ltd** — Reg. No. BW00001951757
Registered in Botswana. PayChat is a Braincade product.

Contact: +267 76 749 821

---

## License

Proprietary. All rights reserved. See [LEGAL/IP_OWNERSHIP.md](LEGAL/IP_OWNERSHIP.md).
