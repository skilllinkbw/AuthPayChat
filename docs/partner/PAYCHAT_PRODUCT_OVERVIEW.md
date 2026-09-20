# PayChat Product Overview

**Product:** PayChat — Conversational Payments
**Company:** Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
**Status:** Production-grade codebase · Live provider integration: **BLOCKED — credentials not yet exchanged**

---

## 1. What PayChat Is

PayChat is a **payment orchestration and conversational interface** platform. Users
send, request, and receive money through chat — typing or speaking natural
language commands in English or Setswana.

PayChat is **not a bank**. It is a financial-technology layer that connects
users to regulated payment rails (mobile money, commercial banks, card networks)
through a single conversational interface. All funds are held and moved by
those provider rails.

## 2. Core Experience: Chat. Pay. Done.

1. A user types or speaks: *“Pay P50 Motakase”*
2. The NLP engine (`packages/nlp`) parses this into a structured payment intent,
   resolving the recipient from the user's contact list.
3. The recipient is confirmed; the user authenticates the payment (password,
   WebAuthn/biometric, or step-up as required by risk).
4. The payment is initiated through the user's chosen provider rail.
5. The provider confirms via a **signed webhook** — only then is the payment
   marked SUCCESSFUL and the recipient notified.

Payments are never confirmed by the client. The frontend never marks a payment
as successful.

## 3. Key Differentiators

| Differentiator | How PayChat delivers it |
|---|---|
| **Conversational UX** | English + Setswana NLP; voice support via SpeechRecognition |
| **Provider-agnostic** | One generic HTTP adapter + configuration-driven registry — add a rail by config, no code changes |
| **Payment security** | Server-side amount/recipient, HMAC webhooks, idempotency, state machine, unknown-outcome handling |
| **Botswana-first** | Pula, local mobile-money rails, Setswana + English, Botswana company registration |
| **Step-up auth** | WebAuthn/passkey + biometric for high-value payments |
| **No fake balances** | Balances are provider-reported, cached with staleness and availability flags |

## 4. Supported Flows

- Chat-command payments (text + voice)
- Payment requests
- Payment links (signed, expiring)
- QR payments (merchant-displayed, customer-scanned)
- Balance refresh (provider-reported)
- Transaction history / receipts
- Merchant console (onboarding, transactions, settlement, refunds)
- WebAuthn / passkey enrollment and authentication
- Password + biometric step-up for payments

## 5. Geographic and Language Scope

- **Primary market:** Botswana (BWP, Setswana, English)
- **Adjacent market:** SADC region (ZAR, additional languages via i18n)
- **Rails:** Orange Money, MyZaka, Smega, AuthePay, Bank A/B/C, card schemes

## 6. Deployment Model

- **Single-tenant or multi-tenant** via the same codebase
- **Embedded SQLite** (default — single node) or **PostgreSQL** (managed/scale-out)
- **Optional Redis** for shared rate-limiting/locking; degrades to in-process when absent
- **Android** via Capacitor 8 (package `bw.co.braincade.paychat`)

## 7. Company and Contact

**Braincade Holdings (Pty) Ltd**
- Registration: BW00001951757
- Address: Gaborone, Botswana
- Contact: +267 76 749 821

---

## Implementation Status Legend

| Status | Meaning |
|---|---|
| **Implemented** | Code is complete and verified by tests |
| **Configured, awaiting credentials** | Provider adapter exists; live integration requires external provider credentials and webhook signature exchange |
| **Planned** | Architecture designed; not yet implemented |
| **Requires approval** | External bank/provider, legal, or regulatory approval |
| **Requires certification** | Independent certification (e.g., PCI DSS, SOC 2) not yet obtained |