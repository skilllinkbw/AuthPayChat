# Intellectual Property Ownership

**Company:** Braincade Holdings (Pty) Ltd, Registration No. BW00001951757
**Product:** PayChat
**Version:** 1.0-draft · **Legal review status: DRAFT — NOT REVIEWED BY COUNSEL**
**Last updated:** 2026-09-19

---

## 1. Ownership

1.1 All intellectual property in the PayChat product — including source code,
architecture, database schema, API design, conversational command grammar, user
interface, written documentation and brand assets — is owned by **Braincade
Holdings (Pty) Ltd**, except for third-party components identified in
[`OPEN_SOURCE_LICENCES.md`](OPEN_SOURCE_LICENCES.md) and
[`../docs/partner/THIRD_PARTY_DEPENDENCIES.md`](../docs/partner/THIRD_PARTY_DEPENDENCIES.md).

1.2 Where work was produced by a contractor or contributor, ownership must be
assigned to Braincade in writing. **A written IP assignment must exist for every
contractor and contributor. The status of these assignments is not recorded in
this repository and must be confirmed by the owner.**

## 2. Copyright Notice

The following notice applies to all proprietary PayChat source and documentation:

```
Copyright (c) Braincade Holdings (Pty) Ltd. All rights reserved.
PayChat is a proprietary product of Braincade Holdings (Pty) Ltd.
Unauthorised copying, distribution, modification or disclosure is prohibited.
```

## 3. Third-Party Components

3.1 PayChat uses open-source software under the licences recorded in
[`OPEN_SOURCE_LICENCES.md`](OPEN_SOURCE_LICENCES.md). All such components remain
the property of their respective authors.

3.2 Braincade does **not** claim ownership of any third-party open-source code,
library, framework or asset.

3.3 No third-party source code is vendored into this repository. Dependencies are
consumed as packages so that their own licence notices remain intact.

3.4 Licence obligations (attribution, notice retention, and any licence text
reproduction requirement) must be satisfied in distributed artefacts. See
[`OPEN_SOURCE_LICENCES.md`](OPEN_SOURCE_LICENCES.md) §4 for the current gap.

## 4. Proprietary Technology Notice

Confidential and proprietary elements include, without limitation:

1. the payment orchestration logic and its state machine;
2. the provider-agnostic adapter and provider registry design;
3. the conversational payment command grammar, intent parsing and language
   handling;
4. the risk rules and step-up eligibility logic;
5. the reconciliation design;
6. the database schema and row-level-security policies;
7. this documentation set and the Partner Assurance Pack.

These were independently developed by Braincade for PayChat. **No patent, design
registration or utility model has been filed or granted for any of them, and
none is claimed.** Whether to seek registered protection is a business decision
for the owner, to be taken with counsel.

## 5. Confidential Information

| Category | Examples | Handling |
|---|---|---|
| Source code | All of `apps/`, `packages/`, `tests/`, `scripts/` | Private repository; disclosed only under NDA |
| Architecture & threat model | This document set, `docs/partner/*` | NDA for external disclosure |
| Security control detail | `SECURITY_OVERVIEW.md`, `RISK_AND_CONTROLS.md` | NDA; caution with specific bypass detail |
| Commercial terms | Pricing, partner terms, `config/commercial.json` | Internal + restricted external disclosure |
| Credentials | Keys, tokens, provider secrets | Never disclosed; secret manager only |
| Test credentials and fixtures | Development-only fixtures | Must never be used in production |

Obligations: use only for the permitted purpose; do not copy or redistribute
without written approval; return or destroy on request; report any suspected leak
to `security@paychat.bw`.

## 6. Source-Code Protection

| Control | Status |
|---|---|
| Private repository | Yes |
| Protected `main` branch with required CI | Yes (GitHub Actions) |
| Secret-scanning gate in CI | Yes |
| No secrets committed; `.env` git-ignored | Yes |
| Access limited to named contributors | Yes |
| Contributor confidentiality undertakings | **To be confirmed by owner** |
| Written IP assignment from contributors | **To be confirmed by owner** |
| Trade-secret register maintained | **Roadmap** |
| Code-signing / provenance attestation | **Roadmap** |

## 7. Brand

Trademark, logo and brand-asset rules are in
[`TRADEMARK_AND_BRAND.md`](TRADEMARK_AND_BRAND.md).

## 8. Enforcement

Suspected infringement, unauthorised disclosure or misuse of PayChat
intellectual property should be reported to `security@paychat.bw` for assessment.
Enforcement strategy is a decision for the owner with counsel; this document does
not constitute legal advice and creates no legal conclusion.

## 9. Open Items for the Owner

1. Confirm written IP assignments exist for all contributors and contractors.
2. Decide whether to register any trademark for the PayChat name and logo.
3. Confirm the copyright ownership line to be shown in the product's about screen
   and in distributed artefacts.
4. Confirm the correct legal entity and registration wording for all notices
   (the registration number BW00001951757 is used consistently across the
   repository and should be verified against the certificate of incorporation).
