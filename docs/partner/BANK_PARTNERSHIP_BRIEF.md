# Bank / Payment-Partner Brief

**Company:** Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
**Product:** PayChat
**Date:** 2026-09-19
**Status:** Codebase complete · Live integration **BLOCKED — no credentials exchanged**

---

## 1. Executive Summary

PayChat is a **payment orchestration and conversational interface platform**, not
a bank. It connects end users to regulated payment rails through chat — typing
or speaking natural-language commands in English or Setswana. Braincade is
seeking partnership with licensed banks and payment providers to enable
real-money flows on the Botswana market and the wider SADC region.

PayChat is **never** positioned as a bank. All funds are held and moved by the
partner's regulated infrastructure.

## 2. The Problem PayChat Solves for Partners

1. **Mobile-first adoption:** Most Botswana users live on mobile money. PayChat
   turns a payment rail into a conversational experience — increasing engagement
   without additional front-end development from the partner.
2. **Reduced integration friction:** A single generic HTTP adapter + a
   configuration-driven registry means partners configure their webhook URL,
   credentials, and capability flags. No bespoke integration code per partner.
3. **Shared risk surface:** PayChat performs server-side amount/recipient
   validation, idempotency, duplicate-prevention, and state-machine enforcement.
   Partners retain control of funds; PayChat never holds float.
4. **Local language + culture:** Setswana + English NLP and Pula-native flows
   remove friction for the Botswana market.

## 3. Partnership Models

| Model | Description |
|---|---|
| **Payment rail partner** | Your mobile money / bank / card scheme becomes a selectable payment method. Users pay from their existing accounts with you. |
| **Webhooks** | You deliver payment status callbacks. PayChat verifies the HMAC signature and applies outcomes through a strict state machine. |
| **Referrals / distribution** | PayChat can surface your product through the conversational interface in exchange for referral terms. |

## 4. What PayChat Needs From You

1. **API credentials** (client ID / secret, or equivalent) for your sandbox and
   production environments.
2. **Webhook endpoint** registered with PayChat, protected by the
   `SANDBOX_WEBHOOK_SECRET` / production webhook secret for HMAC verification.
3. **Capabilities confirmation** — which methods you support (payments,
   balance inquiry, refunds). PayChat discovers these from configuration; no
   code change is required when you add an endpoint.

## 5. Security & Compliance Posture (what partners inherit)

PayChat handles:
- All amount and recipient validation **server-side** — the client cannot
  alter a payment amount or recipient at confirmation time.
- **Webhook signature verification** over raw bytes; duplicate events are
  structurally impossible to double-apply.
- **Idempotency keys** on payment initiation.
- **Step-up authentication** (WebAuthn / biometric / password) for
  high-value or risky payments.
- **Full audit logging** of every payment lifecycle event.
- **Botswana Data Protection Act, 2018** alignment — see
  [`docs/partner/DATA_PROTECTION.md`](DATA_PROTECTION.md).

## 6. Integration Requirements

| Item | Your responsibility |
|---|---|
| Production API credentials | **Required** — not in this repository |
| Webhook URL + secret | **Required** — PayChat verifies HMAC-SHA256 |
| Capability declaration | Configuration on PayChat side |
| Settlement account (if merchant payouts) | **Required if** you want PayChat merchants to settle to your account |
| Regulatory licensing | **Required** — you must hold the applicable licence |

## 7. Honest Current State

| Aspect | Status |
|---|---|
| Provider-agnostic adapter | Implemented (1 adapter for all rails) |
| Your specific rail | Configured but awaiting credentials + webhook exchange |
| Live payment | **BLOCKED** |
| Sandbox simulation | Implemented in-process (test-only) |
| Certification (PCI DSS, SOC 2) | **Not yet obtained** |

## 8. Next Steps for Prospective Partners

1. Contact Braincade: **+267 76 749 821** (partnerships)
2. Exchange sandbox credentials and webhook secrets.
3. Run the provider-architecture test to verify configuration-only onboarding
   (`tests/provider-architecture.test.ts`).
4. Conduct a joint webhook signature exchange and end-to-end payment test.
5. Legal NDA + Data Processing Agreement (see `docs/partner/DATA_PROTECTION.md`).

## 9. Legal Disclaimer

PayChat is developed and operated by Braincade Holdings (Pty) Ltd, a company
registered in Botswana. PayChat is **not a bank** and does not hold a banking
licence. PayChat does not hold, custody, or move customer funds directly — all
money movement is performed by licensed third-party payment providers. Nothing
in this brief constitutes an offer, a regulated service, or a warranty of
regulatory approval.