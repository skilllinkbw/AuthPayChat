# Data Protection (Botswana)

**Company:** Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
**Product:** PayChat
**Status:** Documented controls · **Not certified** · Awaiting qualified legal review
**Last updated:** 2026-09-19

> **Important:** This document describes how PayChat is *designed and operated*
> with respect to Botswana data-protection requirements. It is **not** a
> certification, a regulator approval, or a legal opinion. Braincade has not been
> audited or certified by any data-protection authority. Compliance must be
> confirmed by qualified Botswana legal/privacy counsel before relying on this
> document commercially.

---

## 1. Regulatory Context

PayChat is operated from Botswana and processes personal data of users in
Botswana. The applicable instrument is the **Data Protection Act, 2018
(Act No. 32 of 2018) of Botswana** ("the Act") together with subsidiary
instruments, guidance issued by the Information and Data Protection Commission,
and any subsequent amendments.

| Obligation area | PayChat position | Status |
|---|---|---|
| Controller registration with the Commission | Registration to be completed by Braincade before commercial launch | **PENDING — external action** |
| Lawful basis documented | Consent at registration; contract performance for payments | Implemented (documented) |
| Processor agreements with partners/providers | DPA required per provider | **PENDING — contract action** |
| Records of processing | Data inventory maintained (see §3) | Implemented (documented) |
| Breach notification procedure | `LEGAL/DATA_BREACH_RESPONSE.md` | Implemented (documented) |
| Cross-border transfer safeguards | Deployment must remain in-region (see §6) | **CONFIGURATION DEPENDENCY** |
| Data-subject request handling | `LEGAL/DATA_SUBJECT_RIGHTS.md` | Implemented (documented) |

**Nothing in this table should be read as confirmation that Braincade has been
registered, approved, or certified.** Registration and regulator engagement are
external actions that no software change can complete.

## 2. Roles

| Party | Role under the Act |
|---|---|
| Braincade Holdings (Pty) Ltd | Data controller for PayChat account data |
| Payment providers / banks | Independent controllers or processors of their own account data |
| Hosting / infrastructure provider | Processor (under contract) |
| PayChat end user | Data subject |

## 3. What Personal Data PayChat Processes

Only what is required to operate a payment service (data minimisation):

| Category | Fields | Purpose | Retention |
|---|---|---|---|
| Identity | Display name, phone number (E.164) | Account identity, recipient resolution | Account lifetime + retention period |
| Authentication | Password hash (scrypt), WebAuthn public keys, session records | Authentication and step-up | Session TTL; credentials until removed by user |
| Transactional | Payment intents, amounts, currencies, counterparties, status, receipts | Execute, evidence and reconcile payments | Per retention policy |
| Device / security | Device label, platform string, IP-derived rate-limit keys | Abuse prevention, session visibility | Rate-limit windows; audit retention |
| Audit | Actor, action, target, timestamp, metadata | Security and accountability | Per retention policy |

PayChat **does not** store: full card numbers, PINs, CVVs, bank passwords, OTP
values, or provider account credentials. Card and account credentials are
handled by the licensed provider; PayChat stores at most a provider token or
account reference.


## 4. Data-Subject Rights

| Right | Implementation |
|---|---|
| Access | `GET /api/auth/me`, account, payment and audit endpoints; on-request export |
| Rectification | Profile update endpoints; support-assisted correction |
| Erasure | Deletion request path with legal-retention carve-outs (`LEGAL/DATA_RETENTION_POLICY.md`) |
| Objection / restriction | Support request; processing stopped where no legal obligation to continue |
| Portability | Structured export of account and transaction data on request |
| Complaint | Contact `privacy@paychat.bw`; escalate to the Commission |

Procedure detail: `LEGAL/DATA_SUBJECT_RIGHTS.md`.

## 5. Security Safeguards (technical)

- Transport: TLS/HTTPS enforced in production; cleartext disabled in the
  Android network-security config.
- At rest: passwords hashed with scrypt + per-user salt; refresh tokens
  encrypted; provider credentials held outside the application database.
- Access: server-side authorisation on every endpoint; ownership checks
  (`findOwned`) prevent cross-account access; PostgreSQL row-level-security
  policies restrict rows to their owner.
- Audit: security-sensitive events written to an append-only audit log.
- Secrets: environment/secret-manager supplied; never committed
  (`npm run verify:secrets` gate in CI).
- Minimisation: payment credentials never reach PayChat storage.

## 6. Cross-Border Transfers

The Act restricts transfers of personal data outside Botswana unless an
appropriate safeguard applies (adequacy, consent, contractual safeguards, or a
permitted derogation).

**Position:** production hosting, database, cache and backups must be deployed
in a Botswana or equivalent-adequacy region. If a partner requires
out-of-region processing, a documented transfer basis must be agreed in writing
before enablement.

**Status:** the deployment region is an infrastructure configuration decision and
is **not enforced by code**; it must be verified at deployment time.

## 7. Third Parties

Provider onboarding requires a Data Processing Agreement or equivalent
contractual safeguard before live qualification. See
[`THIRD_PARTY_DEPENDENCIES.md`](THIRD_PARTY_DEPENDENCIES.md).

## 8. Breach Handling

Detection → containment → assessment → notification (Commission and affected
data subjects where the threshold is met) → remediation → post-incident review.
Full procedure: `LEGAL/DATA_BREACH_RESPONSE.md` and
[`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md).

## 9. Legal Review Status

| Item | Status |
|---|---|
| Drafted by engineering/product | Complete (this document set) |
| Reviewed by qualified Botswana privacy counsel | **NOT DONE — required before launch** |
| Controller registration filed | **NOT DONE — required before launch** |
| DPAs executed with providers | **NOT DONE — required before live payments** |
| Certification obtained | **NONE CLAIMED** |

## 10. Contact

Privacy enquiries: `privacy@paychat.bw` · Security: `security@paychat.bw`
Braincade Holdings (Pty) Ltd · +267 76 749 821
