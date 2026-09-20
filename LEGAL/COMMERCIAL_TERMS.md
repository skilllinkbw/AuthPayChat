# Commercial Terms Framework

**Provider:** Braincade Holdings (Pty) Ltd, Registration No. BW00001951757
**Product:** PayChat
**Version:** 1.0-draft · **Legal review status: DRAFT — NOT REVIEWED BY COUNSEL**
**Last updated:** 2026-09-19

> This is a commercial framework for merchant, business and enterprise customers.
> It is a draft for legal review and must not be published, quoted in pricing
> discussions, or relied upon until reviewed by qualified Botswana legal counsel
> and the owner has supplied the values marked `null` in
> [`../config/commercial.json`](../config/commercial.json). No price is stated in
> code or in this document.

---

## 1. Commercial Models

| Segment | Model | Configuration key |
|---|---|---|
| Consumer | Free at launch; per-transaction fee to be confirmed | `pricing.consumer` |
| Merchant | Monthly subscription plus basis-point transaction fee | `pricing.merchant` |
| Enterprise / financial institution | Quoted per engagement | `pricing.enterprise` |
| Provider pass-through fees | Charged at cost per the provider's published rate card | `pricing.providerFees` |

**Fee source of truth:** every fee, limit and period is resolved from
`config/commercial.json` at request time. Prices are never hardcoded in
application code, screens or documents. A price change is a configuration change.

## 2. Subscription and Billing

| Element | Position |
|---|---|
| Billing currency | BWP (see `currency`) |
| Billing interval | Monthly in advance, per signed agreement |
| Payment method for subscriptions | To be confirmed — must be collected through an approved provider rail |
| Invoicing | Invoice issued per billing period; VAT treatment to be confirmed |
| Dunning on failed payment | Service restrictions after a documented grace period; **grace period not yet set (`null`)** |
| Price changes | Notified in advance per the applicable notice period; configuration-driven |

The subscription billing mechanism is **not yet implemented in code**. Merchant
accounts are currently enabled operationally by an administrator flag
(`users.is_merchant`). Automated subscription charging is a **planned** item and
must not be represented to a customer as available.

## 3. Free / Trial Periods

Trial behaviour is configuration-controlled:

| Key | Meaning | Current value |
|---|---|---|
| `trial.enabled` | Whether a free period is offered | `false` |
| `trial.durationDays` | Length of the free period | `null` — owner to supply |

A trial must not be advertised while `trial.enabled` is `false`.

## 4. Merchant Onboarding

1. **Application** — the applicant supplies verified business details, a
   registered business name, a contactable principal and a settlement account.
2. **Verification (KYC/KYB)** — identity and business verification is performed
   through the payment partner or an approved screening provider. PayChat does not
   self-certify a merchant.
3. **Agreement** — these terms, the
   [Acceptable Use Policy](ACCEPTABLE_USE_POLICY.md) and the applicable partner
   terms are executed.
4. **Technical setup** — provider rail configuration, webhook secret exchange and
   a test transaction against the sandbox rail.
5. **Production enablement** — the merchant flag is enabled and the merchant is
   notified in writing.
6. **Ongoing** — periodic review, transaction monitoring and compliance with
   partner requirements.

Steps 1–6 are the documented process; steps 1–3 currently require manual effort by
Braincade and the partner. There is no self-service merchant onboarding flow in
the application.

## 5. Customer Onboarding

1. Download/access PayChat and create an account with a mobile number and a
   password meeting the minimum policy.
2. Account created, identity confirmed by phone-number ownership.
3. Optionally enrol a passkey/biometric for step-up confirmation.
4. Fund and transact through a linked provider rail.
5. Mobile-number change, credential reset and account closure are requested
   through support with verification.

**Account closure / cancellation:** a customer may stop using PayChat at any time
and request account closure through `support@paychat.bw`. Closure removes
authentication credentials and profile data, subject to the retention obligations
in [`DATA_RETENTION_POLICY.md`](DATA_RETENTION_POLICY.md) (transaction and audit
records are retained for their legal period). A merchant agreement terminates per
its own notice provisions; the merchant remains liable for fees incurred to the
termination date and for settlement of transactions already executed.

## 6. Fees, Settlement and Provider Charges

| Item | Position |
|---|---|
| PayChat service fee | Per `config/commercial.json`; disclosed before confirmation |
| Provider pass-through fee | Charged at cost; amount depends on the provider's rate card |
| Settlement to merchants | Executed by the payment partner on the partner's settlement cycle; PayChat does not hold or settle funds |
| Fee display | The fee, if any, must be shown on the confirmation screen before the customer authorises the payment |
| Fee reversal on failed payment | No PayChat fee is charged for a payment that did not complete |

## 7. Refunds, Reversals and Cancellation

Refund, reversal and chargeback mechanics are defined in
[`REFUNDS_AND_REVERSALS.md`](REFUNDS_AND_REVERSALS.md). Summary:

- Refund eligibility and timing depend on the provider rail that executed the
  payment; PayChat cannot reverse a payment the provider does not permit to be
  reversed.
- Merchant-initiated refunds are supported through the merchant console where the
  provider supports refunds.
- Cancellation of the service does not cancel transactions already submitted to a
  provider.

## 8. Service Levels

Availability targets, maintenance windows and support response targets are set in
[`SLA_FRAMEWORK.md`](SLA_FRAMEWORK.md) and parameterised in
`config/commercial.json` (`sla`, `support`). Service credits, if any, are only
payable under a signed SLA; no credit mechanism exists in the product today.

## 9. Service Limitations to Disclose

1. PayChat depends on third-party providers; provider outages interrupt payments.
2. Payments can remain in a **pending** state until the provider confirms them.
   PayChat does not report a pending payment as successful.
3. PayChat is not a bank and does not hold customer funds.
4. Availability of a given rail is configuration- and partner-dependent.
5. Where sandbox/demonstration mode is enabled, no real funds move.

## 10. Disputes, Governing Law and Amendment

- Complaints and disputes: [`SUPPORT_AND_DISPUTES.md`](SUPPORT_AND_DISPUTES.md).
- Governing law and jurisdiction are set out in
  [`TERMS_AND_CONDITIONS.md`](TERMS_AND_CONDITIONS.md) and require confirmation by
  counsel.
- These terms may be amended with notice to business customers as provided in the
  signed agreement; material changes require re-acceptance.

## 11. Open Items (Owner or Counsel Action Required)

| Item | Status |
|---|---|
| Publishable prices for consumer and merchant segments | **Not set** — `null` in configuration |
| VAT / tax treatment | **Not confirmed** |
| Subscription billing implementation | **Not implemented** |
| Trial offer | **Disabled** |
| Legal review of this framework | **Not done** |
| Partner-specific commercial terms | **Not executed** |

Nothing in this document constitutes a quotation, an offer, or a representation
that any pricing model is active.

