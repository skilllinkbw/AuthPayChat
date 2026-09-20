# Data Retention Policy

**Product:** PayChat · **Controller:** Braincade Holdings (Pty) Ltd
**Version:** 1.0-draft · **Legal review status: DRAFT — NOT REVIEWED BY COUNSEL**
**Last updated:** 2026-09-19

Retention periods below are the **operational default**. Minimum periods required
by Botswana financial-record-keeping and AML rules must be confirmed by counsel and
by each Payment Partner; where a partner requires a longer period, the longer
period applies to the records that partner needs.

---

## 1. Schedule

| Data | Retention | Basis | At end of period |
|---|---|---|---|
| Account profile (name, phone) | Life of account + 5 years | Contract, dispute and record-keeping | Delete or irreversibly anonymise |
| Password hash / passkey public keys | Until changed or account closed | Security | Delete |
| Sessions and refresh tokens | 30 days from issue, or until revoked | Security | Delete |
| Payment intents and transactions | 7 years | Financial record-keeping, audit, disputes | Retain (immutable record) |
| Receipts | 7 years | Proof of transaction | Retain |
| Ledger entries | 7 years | Integrity of financial records | Retain (immutable) |
| Webhook event records | 7 years (de-duplication id retained) | Replay defence + audit | Retain |
| Audit logs | 7 years | Accountability, incident forensics | Retain (append-only) |
| Notifications | 12 months | Service functionality | Delete |
| Chat messages | Life of the conversation; 24 months after last activity | Service functionality | Delete |
| Support correspondence | 3 years | Dispute handling | Delete |
| Device / rate-limit keys | Window of the limit (minutes to hours) | Abuse prevention | Automatic expiry |
| Backups | 35 days rolling | Recovery | Expire per backup schedule |

**Figures marked "5 years", "7 years" and "30 days" must be confirmed against the
applicable Botswana record-keeping requirements and each Payment Partner's
contract before go-live.** Where the code currently behaves differently from this
table, this table is the target state and the difference is tracked as a
remediation item.

## 2. Deletion and anonymisation

1. **Deletion** removes the record irreversibly from the live database; backups
   expire naturally on the rolling schedule.
2. **Anonymisation** removes or replaces direct identifiers so the record can no
   longer be associated with a data subject, while preserving the financial
   record's integrity.
3. Financial and audit records are ordinarily **not deleted early** even on
   account closure, because keeping them is required for record-keeping, dispute
   resolution and anti-fraud purposes. Where early erasure is requested, we delete
   what we lawfully can and explain what must be retained and for how long.

## 3. Legal holds

Where litigation, a regulator, or an investigation requires preservation, the
relevant records are placed on legal hold and are exempt from the normal schedule
until the hold is lifted. Holds are recorded with a reason, owner and review date.

## 4. Account closure

On closure request:

1. Authenticate the request and verify ownership.
2. Block new payment activity.
3. Resolve any pending or in-flight transaction to a terminal state.
4. Delete or anonymise non-retained data.
5. Retain financial, audit and webhook records for the statutory period.
6. Confirm the outcome to the data subject.

## 5. Backup expiration

Backups contain all of the above. Backups are encrypted, access-controlled, and
expire within the rolling window. A record deleted from live storage therefore
disappears from the live system immediately and from backups within the window.
Restores must not be used to reintroduce data that should have expired; the
retention schedule is re-applied after any restore.

## 6. Verification

| Control | Status |
|---|---|
| Schedule documented | Yes (this document) |
| Periods confirmed by counsel / partners | **NO — pending** |
| Automated purge job for expired non-financial data | **NOT IMPLEMENTED** |
| Manual closure procedure | Documented (this document) |
| Backup expiry configured | **NOT VERIFIED** — requires production infrastructure |

The absence of an automated purge job is a **known gap**. Until it exists, purge
must be performed as a documented manual operation and recorded in the audit log.
