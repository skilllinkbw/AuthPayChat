# Risk and Controls

**Company:** Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
**Status:** Implemented controls — ongoing monitoring program

---

## 1. Risk Register

| ID | Risk | Likelihood | Impact | Treatment | Status |
|---|---|---|---|---|---|
| R01 | Provider webhook forgery | Low | Critical | HMAC signature verification + event ID dedup | Implemented |
| R02 | Duplicate payment (double confirm) | Low | High | Idempotency key + state machine conditional writes | Implemented |
| R03 | Client-side amount manipulation | Medium | Critical | Server-side amount storage, client cannot change at confirm | Implemented |
| R04 | Client-side recipient manipulation | Medium | Critical | Server-side recipient resolution | Implemented |
| R05 | Unknown payment outcome (timeout) | Low | Medium | PENDING state + reconciliation job, no false claim | Implemented |
| R06 | Lost update on payment status | Low | High | Conditional writes in IMMEDIATE transaction | Implemented |
| R07 | IDOR — access another user's data | Medium | High | `findOwned` checks on every query | Implemented |
| R08 | Provider compromise (credential theft) | Medium | Critical | Credentials in Postgres/Vault, NOT in app DB or source | Implemented |
| R09 | Session hijack | Medium | High | 15-min access tokens, refresh token rotation, session revocation | Implemented |
| R10 | Brute-force login | Medium | Medium | Rate limiting (5/10min), 429 responses | Implemented |
| R11 | Weak password | High | Medium | 10-char minimum enforced | Implemented |
| R12 | No KYC / identity verification | High | High | **Planned** — requires external provider | Planned |
| R13 | Sanctions / PEP screening | Medium | High | **Planned** — requires external provider | Planned |
| R14 | DAST / penetration test | Medium | High | **NOT VERIFIED** — no tool available in this environment | Not verified |
| R15 | SQL injection | Low | Critical | Parameterized queries + Zod validation | Implemented |
| R16 | XSS | Low | Medium | React DOM escaping, CSP headers | Implemented |
| R17 | CSRF | Low | Medium | JWT bearer tokens (no cookie auth) | Implemented |
| R18 | SSRF | Low | Medium | No server-side URL fetching from user input | Implemented |

## 2. Fraud Controls

| Control | Implementation | Threshold |
|---|---|---|
| Velocity check | `apps/api/src/payments/risk.ts` | 5 payments/hour |
| Step-up requirement | Risk score + amount threshold | P500 (`RISK_STEP_UP_AMOUNT_MINOR`) |
| New-device flag | 24-hour window | `RISK_NEW_DEVICE_HOURS=24` |
| Recipient validation | Server-side contact resolution | Must be in user's contacts |
| Amount limits | Per-provider configuration | P5,000 daily default |
| Unknown outcome | Never claims success without webhook | PENDING + reconciliation |

## 3. Financial Integrity Controls

1. **Amount immutability:** Stored on intent creation; confirmed from stored
   value, never from client payload.
2. **Recipient immutability:** Resolved server-side at intent creation.
3. **State machine enforcement:** Conditional writes prevent illegal transitions.
4. **Single writer principle:** Only the orchestrator, signed webhooks, or the
   reconciliation job can transition state.
5. **Ledger append-only trail:** `payment_transactions` records every attempt.
6. **Receipt immutability:** Receipts created only from verified SUCCESSFUL state.
7. **No client-side financial calculation:** All balances, totals, and status
   computed server-side.

## 4. Operational Controls

| Control | Implementation |
|---|---|
| Migration verification | `scripts/verify-migrations.ts` — idempotence check |
| Secret scanning | `scripts/verify-secrets.ts` — CI gate |
| Dependency audit | `npm audit --audit-level=high` — CI gate |
| RLS verification | `scripts/verify-rls.ts` — PostgreSQL schema |
| Internal job auth | `INTERNAL_JOB_TOKEN` on `POST /api/internal/*` |
| Health checks | `/healthz` (no DB), `/readyz` (dependency checks) |
| API logging | Structured JSON logs with request IDs |

## 5. Security Monitoring

- **Real-time:** Rate limit violations trigger 429 + audit log entry
- **Near-real-time:** Payment state transitions logged to `audit_logs`
- **Batch:** Reconciliation job resolves stale payments
- **Alert:** Webhook signature failures, replay attempts, IDOR attempts
  all produce audit events for SIEM ingestion

## 6. Key Risk Indicators (KRIs)

| KRI | Threshold | Alert |
|---|---|---|
| Failed login attempts (per IP) | >20/hour | Security team |
| Webhook signature failures | >5/hour | Security team |
| Payment state machine rejections | >10/hour | Engineering |
| Rate limit hits | >100/hour | Operations |
| Unknown outcomes | >5 in 1 hour | Operations |

## 7. Audit Points Verified

- 165 tests pass (14 files)
- 0 high/critical npm vulnerabilities
- No provider names in core source
- No secrets in source code
- No hardcoded credentials
- Webhook replay protection (event_id PRIMARY KEY)
- IDOR protection (findOwned on all queries)
- State machine (conditional writes + IMMEDIATE transaction)
- Unknown outcome handling (PENDING + ledger, no false claim)