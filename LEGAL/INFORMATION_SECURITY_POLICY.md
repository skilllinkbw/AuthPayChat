# Information Security Policy

**Product:** PayChat · **Operator:** Braincade Holdings (Pty) Ltd
**Version:** 1.0-draft · **Legal review status: DRAFT — NOT REVIEWED BY COUNSEL**
**Last updated:** 2026-09-19

Internal policy baseline for PayChat. Control-level detail and test evidence are
in [`../docs/partner/SECURITY_OVERVIEW.md`](../docs/partner/SECURITY_OVERVIEW.md).
Data classification and handling rules are in
[`../docs/partner/INFORMATION_CLASSIFICATION.md`](../docs/partner/INFORMATION_CLASSIFICATION.md).

---

## 1. Principles

1. **Never trust the client.** Amounts, recipients, balances and statuses are
   authoritative only on the server. Client input is validated, never believed.
2. **Single source of financial truth.** Only the orchestrator, a signature-verified
   webhook, or reconciliation may change a payment's status.
3. **Fail safe.** An unknown outcome leaves a payment pending with a ledger entry
   — never a fabricated success.
4. **Least privilege.** Access is granted for a purpose, scoped, reviewed, and
   withdrawn when no longer needed.
5. **Defence in depth.** Every critical control is backed by a second, independent
   control.
6. **Auditable by default.** Security-relevant events are recorded and retained.
7. **No secrets in the repository.** Ever.

## 2. Access control

| Control | Policy |
|---|---|
| Repository access | Private; least privilege; reviewed quarterly |
| `main` branch | Protected; CI must pass; no direct force-push |
| Production access | Named individuals only; no shared accounts; MFA required **once infrastructure exists** |
| Database ownership credential | Not used by user-facing request paths |
| Administrative console | Restricted role; actions audit-logged |
| Secrets access | Minimum number of operators; access recorded |
| Leavers | Access removed on the departure date |

**Gap:** production access provisioning, MFA enforcement and a quarterly access
review are policy requirements that require production infrastructure and a named
owner. They are not yet operational.

## 3. Authentication and credentials

| Control | Requirement |
|---|---|
| Password storage | scrypt with per-user random salt; constant-time comparison |
| Password policy | Minimum 10 characters; no maximum below 128 |
| Tokens | Signed JWT, 15-minute expiry; refresh tokens encrypted at rest, single-use, rotated |
| Reuse detection | A reused refresh token revokes all sessions for that user |
| Strong authentication | WebAuthn/passkeys supported; server verifies attestation and assertion |
| Step-up | Required by risk rules; the step-up claim is verified server-side |
| Session control | Sessions listed with device and platform; individually revocable |
| Brute force | Login limited to 5 per identity per 10 minutes; 429 on breach |
| Credential transport | Bearer token header; credentials never placed in URLs |

Never share credentials. Shared administrative logins are prohibited.

## 4. Cryptography

| Use | Requirement |
|---|---|
| Transport | TLS 1.2+; plaintext HTTP disabled; Android cleartext traffic disabled |
| Passwords | scrypt (never reversible; never stored in plaintext) |
| Refresh tokens | Encrypted at rest with a key held only in the secret manager |
| Webhooks | HMAC-SHA256 over the raw request bytes, compared in constant time |
| Key management | Keys supplied by the environment/secret manager; rotated on suspected compromise or privileged-role change |

Custom cryptography is prohibited. Only vetted platform or library primitives are
used. Keys are never logged, never returned in any response, and never committed.

## 5. Payment-specific controls

1. Amounts and recipients are read from the stored intent at confirmation time.
2. Idempotency keys prevent duplicate instruction submission.
3. A confirmed payment cannot be confirmed again (duplicate confirm is rejected).
4. Webhook events are unique per provider event id; a repeated event is
   acknowledged and discarded.
5. Webhook amount, currency and reference must match the stored intent before any
   state transition.
6. Status transitions occur only inside a write-locked conditional transaction.
7. Ownership is checked on every payment read and write.
8. Every payment event is written to the audit log.

## 6. Secure development

| Control | Requirement |
|---|---|
| Peer review | Every change is reviewed before merge |
| Automated gates | Typecheck, lint (zero warnings), tests, build, secret scan, dependency audit — all must pass |
| Secrets | `.env` is git-ignored; `.env.example` contains names only |
| Dependency policy | Lockfile committed; `npm ci` for deterministic builds; high/critical advisories blocked |
| Test requirement | A bug fix must add a regression test; assertions are never weakened to pass |
| Third-party code | No vendoring; licences recorded in [`OPEN_SOURCE_LICENCES.md`](OPEN_SOURCE_LICENCES.md) |

## 7. Logging and monitoring

**Logged:** authentication events (success, failure, logout), password changes,
OTP/MFA events, permission changes, administrative actions, payment initiation,
confirmation and failure, refunds and reversals, provider configuration changes,
API key changes, and other security events.

**Never logged:** passwords, OTP values, full payment credentials, private keys,
secrets, full card data, or unnecessary personal data.

**Gap:** no log aggregation or alerting backend is configured. Logs are emitted
as structured JSON to standard output and must be shipped to a retained,
access-controlled store in production.

## 8. Incident management

Governed by [`DATA_BREACH_RESPONSE.md`](DATA_BREACH_RESPONSE.md) and
[`../docs/partner/INCIDENT_RESPONSE.md`](../docs/partner/INCIDENT_RESPONSE.md).
Incidents are classified, contained, assessed, notified where required, remediated
and reviewed. Named owners and a 24/7 escalation path must be recorded before
go-live.

## 9. Business continuity and recovery

See [`../docs/partner/BUSINESS_CONTINUITY.md`](../docs/partner/BUSINESS_CONTINUITY.md)
and [`../docs/partner/DISASTER_RECOVERY.md`](../docs/partner/DISASTER_RECOVERY.md).
Backups, restore drills and RPO/RTO verification require production
infrastructure and are **not yet performed**.

## 10. Third-party and supplier security

Before a provider or supplier is enabled: confirm the security posture, execute a
Data Processing Agreement, confirm the data flows, and record the dependency.
Inventory: [`../docs/partner/THIRD_PARTY_DEPENDENCIES.md`](../docs/partner/THIRD_PARTY_DEPENDENCIES.md).

## 11. Compliance with this policy

Breach of this policy by a team member is a disciplinary matter. Technical
deviation from this policy requires a documented, time-boxed exception approved
by the accountable owner and recorded with a remediation date.

## 12. Review

This policy is reviewed at least annually and after any material incident,
architecture change or new provider integration.

