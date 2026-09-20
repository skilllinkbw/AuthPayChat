# Security Overview

**Company:** Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
**Status:** Implemented controls verified by tests

---

## 1. Security Principles

1. **Never trust the client.** Amounts, recipients, and balances are validated
   server-side. The frontend cannot alter payment parameters at confirm time.
2. **Financial state changes only from verified sources.** Only the orchestrator,
   a signed provider webhook, or the reconciliation job can transition payment
   status — never the client.
3. **Defence in depth.** Multiple independent controls protect each payment.
4. **Fail safe.** Unknown outcomes (timeout, 5xx) leave payments PENDING with a
   ledger row — never claiming success or failure without proof.
5. **Audit everything.** Every security-sensitive event is logged.

## 2. Authentication

| Component | Implementation |
|---|---|
| Password hashing | scrypt with per-user salt (`apps/api/src/security/passwords.ts`) |
| Access tokens | Signed JWT, 15-min expiry |
| Refresh tokens | Encrypted at rest, single-use rotation |
| Refresh-token reuse | Detected → all user sessions revoked |
| WebAuthn / passkeys | Server verifies attestation + assertion (`@simplewebauthn/server`) |
| Step-up auth | Required for high-risk payments (velocity, new device, high amount) |
| Session management | `sessions` table with device tracking, revocation |
| Password policy | Minimum 10 characters |

## 3. Authorization (RBAC)

| Boundary | Control |
|---|---|
| Payment intents | `findOwned(userId, intentId)` — IDOR blocked (404, not 403) |
| Conversations/messages | Membership checked — non-members get 404 |
| Sessions | Scoped to owner |
| Merchant endpoints | `is_merchant` flag checked — non-merchants get 403 |
| Accounts | `findOwned(userId, accountId)` — client cannot use another user's account |
| Notifications | Scoped to owner; strangers get 404 |
| Audit logs | Read-only by own actor |
| Provider credentials | App role has NO access to credential table |

## 4. Rate Limiting

| Vector | Limit |
|---|---|
| Login attempts | 5 per identity per 10 min → 429 |
| Step-up attempts | 5 per user per 10 min → 429 |
| General API | Configurable per-route limits |
| Shared backend | Redis-backed when available; in-process fallback |
| Internal jobs | `INTERNAL_JOB_TOKEN` required on `POST /api/internal/*` |

## 5. Input Validation

- **Zod schemas** on every route
- Amount: positive integer minor units, max 10^12
- Currency: whitelist (`BWP`, `ZAR`, etc.)
- Phone: E.164 format enforced
- Idempotency-Key: UUID format
- Cursor: base64-encoded, validated structure
- Request size: capped per route

## 6. Output Sanitization / Error Handling

- Internal errors never leak stack traces to clients
- Production error message: "PayChat could not connect to the payment service"
- Technical diagnostics in server-side logs only
- No database details, secrets, or internal paths in responses

## 7. Network Security

| Control | Status |
|---|---|
| HTTPS | Enforced in production |
| Android Network Security Config | Plaintext disabled for paychat domain |
| CORS | Same-origin by default; explicit allow-list in production |
| Secure headers | HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy |
| Request size limits | 10 MB default, lower on payment endpoints |

## 8. Payment Security

| Control | Implementation | Verified by |
|---|---|---|
| Amount immutability | Server reads from stored intent at confirm | `payments.test.ts` |
| Duplicate confirm | REJECT on non-CREATED status | `payments.test.ts` |
| Webhook signature | HMAC-SHA256 over raw bytes | `security.test.ts` |
| Webhook replay | `event_id PRIMARY KEY` | `security.test.ts` |
| Amount lock on webhook | Verified before transition | `security.test.ts` |
| Transaction ownership | `findOwned` + IDOR test | `security.test.ts` |
| Idempotency | `Idempotency-Key` → table | `payments.test.ts` |
| State machine | Conditional writes in IMMEDIATE transaction | `unknown-outcome.test.ts` |
| Unknown outcome | PENDING + ledger, no claim | `unknown-outcome.test.ts` |

## 9. Secrets Management

- **Never in source code.** `.env` is git-ignored; `.env.example` documents names only
- `verify-secrets.ts` scans source for known patterns — runs in CI
- Production must use a secret manager
- `.gitignore` covers `.env`, keystores, release artifacts
- JWT secret and token encryption key are never logged

## 10. Data Protection

- Passwords: scrypt-hashed, never returned in any response
- Payment credentials: never stored — tokens handled by providers
- PII: only collected for payment processing
- Audit logs: retained per policy
- Database: PostgreSQL RLS policies enforce row-level ownership

## 11. Security Testing

| Suite | Tests | Status |
|---|---|---|
| `security.test.ts` | 27 | PASS |
| `webauthn.test.ts` | 11 | PASS |
| `unknown-outcome.test.ts` | 11 | PASS |
| `qr.test.ts` | 14 | PASS |
| Secret scan (CI) | — | PASS |
| Dependency audit (CI) | — | 0 high/critical |
| DAST / penetration test | — | **NOT VERIFIED** |

## 12. Incident Response

- Security events logged to `audit_logs` with actor, action, metadata
- Runbook: `docs/partner/INCIDENT_RESPONSE.md`
- Contact: security@paychat.bw