# Refunds, Reversals and Chargebacks

**Product:** PayChat · **Operator:** Braincade Holdings (Pty) Ltd
**Version:** 1.0-draft · **Legal review status: DRAFT — NOT REVIEWED BY COUNSEL**
**Last updated:** 2026-09-19

> **Capability note.** PayChat can *request* a refund from a Payment Partner where
> the partner supports it. PayChat cannot itself move money. A refund is only
> complete when the partner confirms it. Where a provider does not support
> refunds, PayChat must say so clearly instead of offering a refund it cannot
> deliver.

---

## 1. Definitions

| Term | Meaning |
|---|---|
| **Refund** | A voluntary return of funds for a completed payment, initiated by the payer or the merchant |
| **Reversal** | A correction by the provider of a payment that should not have settled |
| **Chargeback** | A forced reversal initiated by the payer's bank or card issuer |
| **Recall** | A request by a provider to return funds after settlement |

## 2. What PayChat can do

| Capability | Status |
|---|---|
| Detect a payment that failed before settlement | Implemented |
| Detect a payment with an unknown outcome and reconcile it | Implemented |
| Request a refund from a provider that supports refunds | Implemented (provider capability dependent) |
| Display the true status of a refund request | Implemented |
| Force a reversal without provider confirmation | **Not possible by design** |
| Hold funds in escrow pending dispute | **Not implemented** |

## 3. Refund rules

1. A refund may be requested for a payment that is in a terminal, settled state.
2. A refund may not exceed the original payment amount.
3. Only one refund per payment unless the provider supports partial refunds, in
   which case the sum of refunds may not exceed the original amount.
4. A refund request is recorded as a **request** until the provider confirms it.
   The application must never show "refunded" before confirmation.
5. The payer's or merchant's PayChat fee treatment is set out in
   [`FEES_AND_PRICING.md`](FEES_AND_PRICING.md) §10.
6. Self-service refund requests are available for
   [`config/commercial.json`](../config/commercial.json) `refunds.selfServiceWindowHours`
   hours after settlement, after which a support request is required.

## 4. Reversal rules

1. A reversal is initiated by the provider or by PayChat's reconciliation job.
2. A reversed payment's status is updated from the provider record, never from a
   client request.
3. Where a reversal leaves the account short, the account is flagged and the
   outstanding amount is recorded. Recovery action must follow the applicable
   partner agreement.

## 5. Chargebacks

1. A chargeback is raised with the payer's bank or card issuer, not with PayChat.
2. PayChat will provide the transaction evidence it holds (intent, confirmation,
   receipt, audit trail) to the partner handling the chargeback.
3. PayChat does not decide the outcome of a chargeback and will not state an
   outcome that the partner has not confirmed.
4. Repeat chargebacks may result in account restriction under
   [`ACCEPTABLE_USE_POLICY.md`](ACCEPTABLE_USE_POLICY.md).

## 6. What a customer should know before confirming

The confirmation screen must make clear:

1. the recipient cannot be changed after confirmation;
2. a confirmed payment may be irreversible;
3. whether the provider supports refunds;
4. the evidence PayChat will hold if a dispute arises.

## 7. Handling a dispute

Follow [`SUPPORT_AND_DISPUTES.md`](SUPPORT_AND_DISPUTES.md). Support will:

1. identify the transaction by reference;
2. read the authoritative status from the provider where available;
3. explain the applicable route (refund, reversal, chargeback);
4. record the outcome and the date.

## 8. Record keeping

Every refund request, provider response and chargeback is recorded against the
transaction, with timestamps and actor, and is retained per
[`DATA_RETENTION_POLICY.md`](DATA_RETENTION_POLICY.md).

## 9. Open items

1. Each Payment Partner must confirm in writing whether it supports refunds,
   partial refunds and reversals — **not yet confirmed**.
2. The partner refund SLA must be recorded per partner.
3. Refund-fee treatment needs a commercial decision.
