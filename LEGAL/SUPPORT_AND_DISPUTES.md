# Support and Disputes

**Product:** PayChat · **Operator:** Braincade Holdings (Pty) Ltd
**Version:** 1.0-draft · **Legal review status: DRAFT — NOT REVIEWED BY COUNSEL**
**Last updated:** 2026-09-19

---

## 1. Support channels

| Channel | Detail | Hours |
|---|---|---|
| In-app | **Settings → Help → Contact support** | 24/7 submission |
| E-mail | `support@paychat.bw` | Monitored Mon–Fri 08:00–17:00 CAT |
| Telephone | +267 76 749 821 · +267 26 150 87 | Mon–Fri 08:00–17:00 CAT |
| Security issues | `security@paychat.bw` | Prioritised at all times |
| Privacy requests | `privacy@paychat.bw` | Mon–Fri 08:00–17:00 CAT |

Support hours and contact details are configured in
[`../config/commercial.json`](../config/commercial.json); the values above must
match that file.

## 2. What support can help with

1. Access and sign-in problems (including locked and suspended accounts).
2. Payment questions: status, pending transactions, failed transactions.
3. Disputes about a specific transaction, including refund requests.
4. Account information and security settings, session review and revocation.
5. Data-protection requests (routed to the privacy contact).
6. Reporting suspected fraud or an unauthorised transaction.

## 3. What support cannot do

1. Move money directly, or force a payment or refund that a Payment Partner has
   not confirmed.
2. Reveal a password, OTP, passkey or any credential.
3. Change a confirmed transaction's recipient, amount or currency.
4. Disclose another person's account or transaction information.
5. Commit to a partner's internal timelines or outcomes.

## 4. Response targets

| Priority | Situation | First response target | Resolution target |
|---|---|---|---|
| P1 | Suspected fraud, unauthorised transaction, account takeover | 1 hour (24/7) | Same business day assessment; containment immediately |
| P2 | Money in limbo — payment pending or status unknown | 4 business hours | 2 business days, subject to partner response |
| P3 | Cannot complete a payment, sign-in or verification problem | 1 business day | 3 business days |
| P4 | General enquiry, feature question, feedback | 2 business days | Not applicable |
| P5 | Privacy / data-subject request | 3 business days acknowledgement | 30 calendar days |

These targets are internal objectives for the current operating model. They do
**not** create a contractual service level for consumer users; contractual SLAs
are only created by a signed agreement and are framed in
[`SLA_FRAMEWORK.md`](SLA_FRAMEWORK.md).

## 5. Raising a dispute

1. **Identify** the transaction: date, amount, recipient and the PayChat reference
   shown on the receipt.
2. **Submit** the dispute through support with a description of what went wrong.
3. **Acknowledge** — you receive a reference and a priority.
4. **Investigate** — PayChat reads the authoritative status from the Payment
   Partner where the partner supports it, and reviews the audit trail
   (intent, confirmation, submission, provider response).
5. **Decide** — the outcome with reasons, in writing.
6. **Remedy** — where PayChat is at fault, the remedy is applied; where the
   partner is responsible, the dispute is referred to the partner and you are told
   which route applies.
7. **Escalate** — if unresolved, ask for escalation to a manager, then to the
   regulator or ombudsman where one has jurisdiction. **The correct escalation
   body for Botswana payments and consumer matters must be confirmed by counsel.**

## 6. Evidence we rely on

| Evidence | Source | Weight |
|---|---|---|
| Payment intent as stored before confirmation | PayChat database | Authoritative for what was instructed |
| Confirmation record (time, actor, authentication method) | PayChat database | Authoritative for authorisation |
| Provider submission and response | Provider record | Authoritative for settlement |
| Provider webhook events | Signed provider payload | Authoritative for status changes |
| Audit log entries | Append-only audit log | Supporting evidence |
| Chat transcript | Conversation store | Supporting evidence only |

A chat message alone does not establish that a payment settled.

## 7. Complaint handling record

Every dispute is recorded with: reference, priority, transaction reference,
description, evidence reviewed, decision, remedy, dates, and the responding
person. Records are retained per
[`DATA_RETENTION_POLICY.md`](DATA_RETENTION_POLICY.md).

## 8. Complaints about privacy

Handled per [`DATA_SUBJECT_RIGHTS.md`](DATA_SUBJECT_RIGHTS.md) and may be
escalated to the Information and Data Protection Commission.

## 9. Root-cause feedback

Disputes and support contacts are reviewed monthly. Recurring causes must produce
either a product fix or a documentation change — support volume is not treated as
inevitable.
