# Fees and Pricing Architecture

**Product:** PayChat · **Operator:** Braincade Holdings (Pty) Ltd
**Version:** 1.0-draft · **Legal review status: DRAFT — NOT REVIEWED BY COUNSEL**
**Last updated:** 2026-09-19

---

## 1. Position on pricing

**Prices are not yet set.** No consumer or merchant price has been approved.
Nothing in this document constitutes a published price or an offer.

Pricing must not be hardcoded in application code. All price, limit, trial and
fee parameters are read from a single configuration artefact —
[`../config/commercial.json`](../config/commercial.json) — so that a commercial
decision can be applied without a code change or a redeployment of business
logic.

Where a value in that file is `null`, it is intentionally unset and **must be
supplied and verified by the owner** before it is displayed to a customer.

## 2. Fee model (framework)

| Customer segment | Charge basis | Status |
|---|---|---|
| Consumer | Optional subscription and/or per-transaction fee | **Not set** |
| Merchant | Monthly subscription plus a percentage of processed value | **Not set** |
| Enterprise / partner | Negotiated per engagement | Quoted, no published price |
| Payment Partner fees | Pass-through at cost, per the partner's rate card | **Partner-dependent** |

## 3. Disclosure rules

Every fee that affects a transaction must be disclosed **before** the user
confirms, in the confirmation step, showing:

1. the payment amount;
2. the PayChat fee, if any, as a separate line;
3. the PayChat fee plus any partner fee, if known; and
4. the total debited.

If a fee cannot be determined server-side, the payment must not be presented as
having a fixed total. Never display a fee that the server has not calculated.

## 4. Fee architecture in the product

| Requirement | Status |
|---|---|
| Central configuration file | Implemented (`config/commercial.json`) |
| Fee shown at confirmation | Implemented for configured fees |
| Fee never supplied by the client | Enforced server-side |
| Fee recorded on the transaction | Implemented (transaction fields) |
| Fee lines in receipts | Implemented |
| Fee schedule published in-app | **Roadmap** — must follow price approval |

## 5. Partner fees

A Payment Partner may charge its own fee. Where that fee is not known at
confirmation time, the confirmation screen must state that the partner's own
charges may apply and are set by the partner, rather than omitting the topic.

PayChat does not add partner fees to its own revenue unless a written agreement
says so.

## 6. Rounding and currency

1. Amounts are represented in **minor units** (for example, thebe for BWP) as
   integers. Floating-point money is not used.
2. Fees are calculated server-side and rounded to the nearest minor unit;
   half-up on the single rounding step, applied once.
3. Currency is an allow-listed value per transaction. PayChat performs **no**
   foreign-exchange conversion; a converted amount must come from a partner quote.

## 7. Changing prices

1. A change is made in `config/commercial.json` and reviewed like any other
   change.
2. Existing customers are notified before a price change takes effect.
3. A price change must not silently alter an already-confirmed transaction: the
   fee stored on the transaction at confirmation time is authoritative.
4. Historic receipts continue to show the fee actually charged.

## 8. Tax

Any applicable tax treatment (including VAT) must be confirmed by the owner's
accountant/tax adviser. PayChat does not presently compute tax on fees.

## 9. Trial and promotional periods

A trial or free period is **disabled** (`trial.enabled = false`). If enabled,
the duration must come from configuration and the customer must be told the date
the paid period begins before it begins.

## 10. Refunds of fees

Fee refund treatment follows
[`REFUNDS_AND_REVERSALS.md`](REFUNDS_AND_REVERSALS.md). Partner fees are
refundable only if the partner refunds them.
