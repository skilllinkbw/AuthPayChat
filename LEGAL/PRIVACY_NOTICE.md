# PayChat Privacy Notice

**Data controller:** Braincade Holdings (Pty) Ltd, Registration No. BW00001951757
**Product:** PayChat
**Version:** 1.0-draft · **Legal review status: DRAFT — NOT REVIEWED BY COUNSEL**
**Last updated:** 2026-09-19

> This notice must be reviewed by qualified Botswana privacy counsel before it is
> published. It is written to align with the Botswana Data Protection Act, 2018
> but is not a certification of compliance.

---

## 1. Who we are

Braincade Holdings (Pty) Ltd is the data controller for personal data processed
through PayChat. Contact: `privacy@paychat.bw`.

## 2. Data we process

| Category | Examples | Why we process it | Lawful basis |
|---|---|---|---|
| Account identity | Display name, phone number | Create and secure your account; resolve recipients | Contract; consent |
| Authentication | Password hash, passkey public keys, session and device records | Authenticate you; protect your account | Contract; legitimate interest (security) |
| Transaction data | Payment intents, amounts, currency, recipient, status, receipts | Execute, evidence, reconcile and support payments | Contract; legal obligation |
| Security and audit | Login events, failed attempts, permission changes, payment events | Detect abuse, investigate incidents, meet audit obligations | Legitimate interest; legal obligation |
| Support | Messages you send to support | Resolve your query | Contract; legitimate interest |
| Technical | IP-derived rate-limit keys, client platform | Abuse prevention, service reliability | Legitimate interest (security) |

We do **not** collect card numbers, CVVs, PINs, bank passwords or OTP values.
Those are handled by the relevant Payment Partner.

## 3. How we use data

We use personal data only to:

1. provide, operate and secure the Service;
2. execute and evidence payments you instruct;
3. prevent, detect and investigate fraud, abuse and security incidents;
4. meet legal, regulatory, audit and record-keeping obligations;
5. provide support and resolve disputes;
6. improve reliability and usability using aggregated, non-identifying metrics.

We do **not** sell personal data and we do **not** use personal data for
third-party advertising.

## 4. Who we share data with

| Recipient | What is shared | Purpose |
|---|---|---|
| Payment Partners (banks, mobile-money and card providers) | The minimum needed to execute your instruction | Execute the payment you confirmed |
| Infrastructure providers (hosting, database, cache) | Stored data under contract | Operate the Service |
| Professional advisers / auditors | As required, under confidentiality | Audit, legal and compliance |
| Regulators or law enforcement | As legally required | Legal obligation |

Any provider processing personal data on our behalf must be under contract with
appropriate confidentiality and security obligations.

## 5. International transfers

PayChat is intended to be operated from Botswana. Where data must be processed
outside Botswana, we will only do so with a lawful transfer basis. See
[`../docs/partner/DATA_PROTECTION.md`](../docs/partner/DATA_PROTECTION.md) §6.

## 6. Retention

Data is kept only as long as necessary. The schedule is in
[`DATA_RETENTION_POLICY.md`](DATA_RETENTION_POLICY.md). Transaction and audit
records are retained for the periods required for financial record-keeping and
dispute handling.

## 7. Security

Technical and organisational safeguards are summarised in
[`INFORMATION_SECURITY_POLICY.md`](INFORMATION_SECURITY_POLICY.md) and
[`../docs/partner/SECURITY_OVERVIEW.md`](../docs/partner/SECURITY_OVERVIEW.md).
In summary: encryption in transit, hashed credentials, encrypted refresh tokens,
server-side authorisation, database row-level security, rate limiting, audit
logging and secrets held outside the codebase.

No system is perfectly secure. If a breach affecting your rights occurs, we will
follow [`DATA_BREACH_RESPONSE.md`](DATA_BREACH_RESPONSE.md) and notify you and
the Information and Data Protection Commission where required.

## 8. Your rights

You have the right to access, correct, delete, restrict or object to processing
of your personal data, and to request portability. See
[`DATA_SUBJECT_RIGHTS.md`](DATA_SUBJECT_RIGHTS.md) for how to exercise them.

## 9. Storage and tracking in your browser and app

See [`COOKIE_AND_TRACKING_NOTICE.md`](COOKIE_AND_TRACKING_NOTICE.md).

## 10. Children

The Service is not intended for anyone under 18. We do not knowingly process the
data of minors.

## 11. Automated decision-making

PayChat applies automated risk rules (for example, value and velocity checks) to
decide whether extra verification is required before a payment. These rules can
require additional verification but do not by themselves determine your
eligibility for the Service. You may ask for a human explanation of a decision
by contacting `privacy@paychat.bw`.

## 12. Changes

We will notify material changes in the application. The version and effective
date are shown at the top of this notice.

## 13. Complaints

Contact `privacy@paychat.bw` first. You may also complain to the Information and
Data Protection Commission of Botswana. **The Commission's current contact
details and complaint procedure must be confirmed by counsel before
publication.**
