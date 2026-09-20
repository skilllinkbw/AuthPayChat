# Service Level Framework

**Product:** PayChat · **Operator:** Braincade Holdings (Pty) Ltd
**Version:** 1.0-draft · **Legal review status: DRAFT — NOT REVIEWED BY COUNSEL**
**Last updated:** 2026-09-19

> **This is a framework, not an offer.** PayChat currently has **no measured
> production availability history**. No availability figure below should be
> presented to a customer or partner as achieved performance. A contractual SLA
> exists only where a signed agreement says so, and only after the measurement
> capability in §5 is in place.

---

## 1. Scope

| In scope | Out of scope |
|---|---|
| PayChat API and web/mobile client availability | Payment Partner outages |
| PayChat transaction initiation, confirmation and status | Mobile network or device faults |
| PayChat transaction history and receipts | The customer's own systems and network |
| PayChat security and incident response | Force majeure and planned maintenance in the published window |

## 2. Target availability (proposed)

| Service component | Proposed target | Basis |
|---|---|---|
| PayChat API | 99.5% monthly | Proposed; **not yet measured** |
| PayChat client | 99.5% monthly | Proposed; **not yet measured** |
| Payment execution | Governed by the Payment Partner | Partner-dependent; PayChat does not warrant partner availability |

Availability is measured as the percentage of one-minute intervals in a calendar
month during which the component responded successfully to the readiness probe,
excluding the published maintenance window and agreed force majeure.

## 3. Support targets

See [`SUPPORT_AND_DISPUTES.md`](SUPPORT_AND_DISPUTES.md) §4 for response and
resolution targets by priority.

| Priority | First response target |
|---|---|
| P1 (fraud, unauthorised transaction) | 1 hour, 24/7 |
| P2 (payment status unknown) | 4 business hours |
| P3 (cannot pay or sign in) | 1 business day |
| P4 (general enquiry) | 2 business days |

## 4. Planned maintenance

| Item | Value |
|---|---|
| Window | Sundays 01:00–04:00 CAT (Africa/Gaborone) |
| Notice | At least 48 hours for non-urgent work |
| Emergency work | As required to protect the Service or customer funds; notified as soon as practicable |

Values are configured in [`../config/commercial.json`](../config/commercial.json).

## 5. Measurement prerequisites (**not yet in place**)

A contractual SLA cannot be honoured credibly until these exist:

| Prerequisite | Status |
|---|---|
| External uptime monitoring with historical reporting | **NOT IMPLEMENTED** |
| Alerting with a 24/7 on-call rota | **NOT IMPLEMENTED** |
| Incident classification and reporting to customers | Documented; not operational |
| Monthly availability report generation | **NOT IMPLEMENTED** |
| Error-budget tracking and review | **NOT IMPLEMENTED** |
| Load testing to establish realistic capacity | **NOT PERFORMED** |

Engineering note: the API already exposes `/healthz` (liveness) and `/readyz`
(readiness). These are the correct probes to point monitoring at, but no
monitoring backend is configured in this repository.

## 6. Remedies (framework, for negotiated agreements only)

Where an enterprise agreement includes service credits, a typical structure
would be:

| Monthly availability achieved | Service credit |
|---|---|
| Below the committed target but ≥ 99.0% | 5% of the monthly fee |
| ≥ 98.0% and < 99.0% | 10% of the monthly fee |
| < 98.0% | 20% of the monthly fee |

Credits would be capped at 20% of the monthly fee for the affected month, be
claimed within 30 days, and exclude partner-caused outages and force majeure.
**These figures are a proposal for negotiation and must be approved by the owner
and counsel before being offered.**

## 7. Exclusions

1. Payment Partner outages or degradations.
2. Customer misconfiguration, misuse, or breach of the Acceptable Use Policy.
3. Third-party network, device or infrastructure failure outside our control.
4. Scheduled maintenance inside the published window.
5. Acts of God, civil unrest, or government action.
6. Free, trial or demonstration use.

## 8. Review

Targets are reviewed after the first quarter of measured production operation and
at least annually. Until measured data exists, this document records intent only.
