# Compliance Checklist

**Company:** Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
**Product:** PayChat
**Last updated:** 2026-09-19

Status key:

| Code | Meaning |
|---|---|
| **IMPL** | Implemented in the codebase and verifiable by test or inspection |
| **DOC** | Documented policy/procedure; no code enforcement |
| **CFG** | Configured capability that requires deployment-time configuration |
| **EXT** | Requires an external party (bank, provider, regulator, auditor, counsel) |
| **PLAN** | Planned; not started |

> No item marked **EXT** can be completed by engineering. No certification,
> licence, registration or partnership is claimed anywhere in this repository.

---

## 1. Data Protection (Botswana Data Protection Act, 2018)

| # | Requirement | Status | Evidence / owner |
|---|---|---|---|
| 1.1 | Lawful basis for processing documented | DOC | `DATA_PROTECTION.md` §1 |
| 1.2 | Data inventory / records of processing | DOC | `DATA_PROTECTION.md` §3 |
| 1.3 | Data minimisation in the data model | IMPL | Migrations, `repositories.ts` |
| 1.4 | Purpose limitation | DOC | `LEGAL/PRIVACY_NOTICE.md` |
| 1.5 | Access control on personal data | IMPL | RLS policies, `findOwned`, RBAC |
| 1.6 | Encryption in transit | CFG | HTTPS + Android network-security config |
| 1.7 | Protection of credentials at rest | IMPL | scrypt hashing, encrypted refresh tokens |
| 1.8 | Data-subject access procedure | DOC | `LEGAL/DATA_SUBJECT_RIGHTS.md` |
| 1.9 | Data-subject erasure procedure | DOC | `LEGAL/DATA_RETENTION_POLICY.md` |
| 1.10 | Breach response + notification | DOC | `LEGAL/DATA_BREACH_RESPONSE.md` |
| 1.11 | Cross-border transfer safeguards | EXT / CFG | Deployment region decision |
| 1.12 | Processor / DPA agreements | EXT | Per provider, before live |
| 1.13 | Controller registration with the Commission | EXT | Braincade — before launch |
| 1.14 | Privacy notice published in-app | IMPL | `apps/web/src/screens/Privacy.tsx` |

## 2. Anti-Money Laundering / KYC

| # | Requirement | Status | Evidence / owner |
|---|---|---|---|
| 2.1 | Customer identification at onboarding | IMPL (partial) | Phone + name; document KYC delegated to provider |
| 2.2 | Sanctions / PEP screening | EXT | Provider or licensed screening vendor |
| 2.3 | Transaction monitoring | IMPL (basic) | `payments/risk.ts` velocity + amount rules |
| 2.4 | Suspicious-transaction reporting capability | PLAN / EXT | Requires nominated compliance officer + FIA process |
| 2.5 | Record keeping for AML purposes | DOC | `LEGAL/DATA_RETENTION_POLICY.md` |
| 2.6 | AML programme ownership | EXT | Requires appointment of a compliance officer |
| 2.7 | Independent AML audit | EXT | Not performed |

PayChat is **not** a reporting institution in its own right unless and until the
applicable regulator determines otherwise. AML obligations in a partner-rail
model are primarily borne by the licensed provider; this must be confirmed in
writing per partner. See [`AML_KYC_OVERVIEW.md`](AML_KYC_OVERVIEW.md).

## 3. Payment / Financial Services

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 3.1 | No custody of customer funds by PayChat | IMPL (by design) | Provider-held accounts only |
| 3.2 | Licensed rail for money movement | EXT | Partner licence required |
| 3.3 | Tariff / fee transparency | DOC | `LEGAL/FEES_AND_PRICING.md` |
| 3.4 | Complaint handling process | DOC | `LEGAL/SUPPORT_AND_DISPUTES.md` |
| 3.5 | Refund and reversal rules | DOC | `LEGAL/REFUNDS_AND_REVERSALS.md` |
| 3.6 | PCI DSS scope | EXT | Provider-side; PayChat stores no card data |

## 4. Security

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 4.1 | Authentication controls | IMPL | JWT + refresh rotation + scrypt + WebAuthn |
| 4.2 | Authorization / RBAC | IMPL | Route guards, ownership checks, RLS |
| 4.3 | Payment integrity controls | IMPL | Server-side amounts, idempotency, state machine |
| 4.4 | Webhook authenticity + replay defence | IMPL | HMAC-SHA256, `event_id` uniqueness |
| 4.5 | Audit logging | IMPL | `audit_logs`, `security/audit.ts` |
| 4.6 | Rate limiting / abuse control | IMPL | `security/rateLimit.ts` (Redis or in-process) |
| 4.7 | Secret management | IMPL / CFG | Env-var only; `verify:secrets` gate; production secret manager required |
| 4.8 | Dependency vulnerability review | IMPL | `npm audit` gate in CI |
| 4.9 | Penetration test / DAST | EXT | **Not performed** |
| 4.10 | Independent security certification (SOC 2 / ISO 27001) | EXT | **Not obtained** |

## 5. Operational

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 5.1 | Incident response runbook | DOC | `INCIDENT_RESPONSE.md` |
| 5.2 | Business continuity plan | DOC | `BUSINESS_CONTINUITY.md` |
| 5.3 | Disaster recovery plan + RPO/RTO targets | DOC | `DISASTER_RECOVERY.md` |
| 5.4 | Backup + restore verification | PLAN / CFG | Requires production infrastructure |
| 5.5 | Reconciliation of provider vs internal state | IMPL | `POST /api/internal/reconcile` |
| 5.6 | Support SLA | DOC | `LEGAL/SLA_FRAMEWORK.md` |

## 6. Blocking External Actions Before Go-Live

1. **EXT** — Execute provider/bank contracts and exchange live credentials.
2. **EXT** — Register as a data controller with the Botswana Information and Data
   Protection Commission.
3. **EXT** — Legal review of all `LEGAL/` documents by qualified Botswana counsel.
4. **EXT** — Appoint an AML/compliance officer if the regulator requires it.
5. **EXT** — Independent security testing (penetration test).
6. **CFG** — Deploy in-region production infrastructure with backups and a secret
   manager.
7. **EXT** — Generate and hold the Android release signing keystore.

## 7. Statement

This checklist is an internal engineering artefact. It records what is built,
what is documented, and what still requires a human, contractual, regulatory or
certification action. It is **not** a statement of regulatory approval.
