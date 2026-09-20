# Information Classification

**Company:** Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
**Product:** PayChat
**Last updated:** 2026-09-19

A single classification scheme applied to every PayChat artefact — source code,
data, documents, credentials and infrastructure configuration — with the handling
rules that follow from it.

---

## 1. Classification Levels

| Level | Label | Definition | Breach impact |
|---|---|---|---|
| **C4** | Restricted — Secrets | Cryptographic keys, provider credentials, live access tokens | Direct compromise of funds, accounts or data |
| **C3** | Confidential — Personal & Financial | Personal data, transaction data, audit records | Regulatory breach; harm to data subjects |
| **C2** | Internal | Source code, architecture, internal procedures, operational metrics | Commercial harm; aids attacker reconnaissance |
| **C1** | Public | Published product, marketing and legal notices | None |

## 2. Artefact Classification

| Artefact | Level | Handling rule |
|---|---|---|
| `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `INTERNAL_JOB_TOKEN` | **C4** | Secret manager only. Never committed, logged, printed in errors, or sent to clients. |
| Provider API credentials | **C4** | Secret manager only. Never stored in the DB or in source. |
| Webhook signing secrets | **C4** | Secret manager; rotate on partner change or suspicion. |
| Android release keystore + passwords | **C4** | Held by Braincade outside the repository; never committed (`.gitignore` covers `*.keystore`, `*.jks`). |
| `.env` files | **C4** | Git-ignored. `.env.example` contains names only, never values. |
| Password hashes / WebAuthn public keys | **C3** | Never returned in any API response. |
| Phone numbers, display names | **C3** | Returned only to the owning user and authorised administrators. |
| Payment intents, amounts, receipts, audit logs | **C3** | Owner-scoped; RLS-enforced in PostgreSQL. |
| Session records (device label, platform) | **C3** | Owner-scoped; visible to the user as "your sessions". |
| Source code (`apps/`, `packages/`) | **C2** | Private repository. Never published to a public remote. |
| `docs/partner/*` | **C2** | Disclosed under NDA to prospective partners. |
| Internal runbooks (incident, DR, BC) | **C2** | Internal + auditors under NDA. |
| Infrastructure / deployment configuration | **C2** | Restricted to operators; no secrets inline. |
| `LEGAL/*` notices shown in-product | **C1** | Published in the application. |
| Pricing, product overview, marketing | **C1** | Publishable. |
| This classification scheme | **C2** | Internal; disclose on request under NDA. |

## 3. Handling Rules by Level

### C4 — Restricted (Secrets)
- Stored **only** in a managed secret manager in production (AWS Secrets
  Manager, HashiCorp Vault, or equivalent).
- Injected as environment variables at process start; never written to disk.
- Never committed (`verify-secrets.ts` gate) and never logged.
- Rotation procedure recorded for each secret; rotation events are audit-logged.
- Access limited to the minimum number of operators.

### C3 — Confidential (Personal & Financial)
- Encrypted in transit (TLS) and, in production, encrypted at rest by the
  database/storage platform.
- Access is owner-scoped by server-side authorisation and database RLS; the
  service-role/database-owner credential is not used by user-facing request paths.
- Never included in client-side bundles, analytics payloads, or third-party
  requests other than the provider call that executes the payment.
- Retention per `LEGAL/DATA_RETENTION_POLICY.md`.
- Disposal: deletion or irreversible anonymisation at end of retention.

### C2 — Internal
- Held in a private repository with least-privilege access; branch protection on
  `main` with CI as the required gate.
- Shared externally only under NDA, and with the partner-assurance watermark that
  the material is current as of its stated date.
- Not to be posted to public issue trackers, forums, or pastebins.

### C1 — Public
- Approved by the company before publication; must remain factually accurate
  (no unverified partnership, licence or certification claims).

## 4. Labelling Convention

| Location | Convention |
|---|---|
| Documents | A `Status:` / `Confidentiality:` line in the header |
| API responses | Only C1/C3-for-owner fields; never C4 |
| Logs | Structured JSON; C4 values never interpolated |
| Audit records | C3; actor/target/action/timestamp/metadata |
| Repository files | C4 material is excluded by `.gitignore`, not merely labelled |

## 5. Access Model

| Role | Access |
|---|---|
| End user | Own C3 records only (via API, owner-checked) |
| Support operator | Read-only C3 needed for a support case, with audit trail |
| Platform administrator | C2 + operational C3 views (no C4 plaintext) |
| Release/DevOps engineer | C4 via secret manager; no direct C3 browsing |
| Third-party auditor | C2 + C3 under NDA and time-boxed access |

Administrative views are restricted to the operations console and are
audit-logged; there is no route that returns another user's C3 data to a
non-administrator.

## 6. Declassification and Disposal

1. Classification is set by the originating owner and reviewed at each release.
2. Declassification requires the owner's approval and a record of the decision.
3. Disposal of C3 material follows the retention schedule; disposal of C4 material
   requires confirmed revocation/rotation at the provider as well as deletion.
4. Backups containing C3 material inherit the schedule and must be expired by the
   same rules.

## 7. Review

This scheme is reviewed at each release and after any material change to data
flows, providers, or infrastructure. It is a company policy document — it is not
a certification or an external audit finding.
