# Payment Architecture

**Product:** PayChat — Payment Orchestration
**Company:** Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
**Status:** Complete · Live: **BLOCKED — no external credentials**

---

## 1. Overview

PayChat uses a **provider-rail pass-through model**. Funds are never held
internally; balances shown are provider-reported balances cached with staleness
and availability flags. The system is a thin, security-hardened orchestration
layer between the user interface and the provider's API.

```
User (chat/Voice)
  │
  ▼
NLP (packages/nlp) — parses command, extracts amount + recipient + method
  │
  ▼
Payment Intent (CREATED) — stored, server-side amount/recipient, risk scored
  │
  ├─ Risk: velocity + new-device → step-up required (403)
  │
  ├─ Confirm → authenticate (password / WebAuthn / biometric)
  │   then Authorise & Initiate → provider.pay()
  │   │
  │   ├─ SUCCESSFUL → state machine: CREATED→PROCESSING→SUCCESSFUL
  │   │   → receipt, notifications (payer + recipient), chat message, audit
  │   │   → balance cache invalidated (stale)
  │   │
  │   ├─ FAILED → notifications, no money claimed moved
  │   │
  │   └─ Unknown (timeout/5xx) → PENDING + ledger row, NO success/failure claim
  │
  └─ Provider webhook → HMAC verify → state machine transition
      → duplicate events rejected (event_id PRIMARY KEY)
      → amount must match intent (server-side, immutable)
```

## 2. State Machine

```
CREATED → PROCESSING → SUCCESSFUL
              └──→ FAILED
              └──→ PENDING (unknown outcome — awaits reconciliation)
              └──→ EXPIRED (provider timeout, max attempts)
EXPIRED ← CREATED (15 min idle)
CANCELLED ← CREATED/PROCESSING
REFUNDED ← SUCCESSFUL
REVERSED ← SUCCESSFUL (provider-initiated)
```

- Transitions are **conditional writes** (`UPDATE … AND status = ?`) — two
  concurrent writers cannot lost-update each other.
- The entire transition (read → state check → guarded write → ledger insert)
  runs in a single SQLite/Postgres `IMMEDIATE` transaction.
- **The frontend never transitions state.** Only verified provider callbacks,
  the reconciliation job, or the orchestrator can.

## 3. Provider Abstraction

- **Contract:** `apps/api/src/providers/types.ts` —
  `PaymentProvider` interface: `quote`, `pay`, `getPaymentStatus`,
  `refundPayment`, `cancelPayment`, `processWebhook`, `getBalance`,
  `capabilities()`, `supports()`.
- **Adapter:** `apps/api/src/providers/generic.ts` — one configuration-driven
  HTTP adapter used by ALL rails (no provider-specific code).
- **Registry:** `apps/api/src/providers/registry.ts` — loads definitions from
  built-in defaults → `PAYCHAT_PROVIDERS` JSON → database rows (`payment_providers`),
  applies the `PAYCHAT_PROVIDER_DISABLE` kill switch.
- **Data:** `apps/api/src/providers/definitions.ts` — the ONLY place provider
  names appear. Core source contains no provider names (enforced by
  `tests/provider-architecture.test.ts`, 15/15).

## 4. Idempotency & Duplicate Prevention

| Layer | Mechanism |
|---|---|
| Intent creation | `Idempotency-Key` header → `idempotency_keys` table; duplicate returns same intent with `duplicate: true` |
| Confirm | Intent status must be `CREATED`; second confirm returns current status |
| Webhook | `webhook_events.event_id PRIMARY KEY`; payload hash check on reprocessing |
| QR pay | Token is single-use; second attempt → 409 |
| Payment links | Link is single-use; second attempt → 409 |

## 5. Webhook Security

- **Transport:** Raw-byte HMAC-SHA256 verification (`apps/api/src/providers/signature.ts`).
  The body parser is configured to provide raw bytes for the webhook route.
- **Replay:** `event_id` PRIMARY KEY in `webhook_events`; duplicate → rejected.
- **Amount lock:** Provider cannot change amount — verified against the stored
  intent before any transition.
- **Unknown reference:** Webhook for an unknown `provider_ref` → marked
  `unknown_reference`, NOT created, NOT successful.
- **Signature failure:** → `signature_invalid`, no state change.

## 6. Unknown-Outcome Handling (the hardest case)

When a provider times out or returns 5xx:
1. The orchestrator records the attempt (`payment_transactions`) with
   `status: PENDING, error_reason: 'initiate_error'`.
2. The intent moves to `PENDING` — **never** SUCCESSFUL or FAILED.
3. No receipt is created. No notification claims success or failure.
4. The reconciliation job (`POST /api/internal/reconcile`, protected by
  `INTERNAL_JOB_TOKEN`) polls stale payment statuses and resolves them:
  - Provider confirms → SUCCESSFUL
  - Provider rejects → FAILED
  - Still unknown after `maxAttempts` → EXPIRED
- A late FAILED callback for a payment already confirmed SUCCESSFUL is
  **ignored** (illegal transition, logged).

## 7. Balances

- Balances are fetched from the provider API and cached in `balance_cache`.
- Cache has `provider_status` (available/unavailable) and `as_of` timestamp.
- On successful payment, the cache is flagged `stale` — the UI refreshes from
  the provider rather than showing a confident, possibly-wrong number.
- **No cross-currency aggregation** (enforced by `packages/shared/src/money.ts`
  `sumSameCurrency`).

## 8. Security Controls

| Control | Implementation |
|---|---|
| Amount immutability | Server stores amount on intent; confirm uses stored value |
| Recipient immutability | Recipient captured on intent creation; resolved server-side |
| Account ownership | `repo.accounts.findOwned(userId, accountId)` — client cannot pay from another user's account |
| Currency match | Verified before initiation |
| Step-up | `RiskDecision` + `challenges` table → step-up token for high-value |
| Audit trail | `audit_logs` table — every payment lifecycle event |

## 9. Environment Configuration

| Variable | Purpose |
|---|---|
| `PAYCHAT_PROVIDER_DISABLE` | Kill switch — disables a provider without code change |
| `PAYCHAT_PROVIDERS` | JSON override for provider definitions |
| `PAYCHAT_WEBHOOK_BASE_URL` | Public URL for provider callback registration |
| `PAYCHAT_DISABLE_SANDBOX` | Hard-disabled in production |
| `RISK_STEP_UP_AMOUNT_MINOR` | Threshold for step-up (default: 50000 = P500) |
| `RISK_VELOCITY_MAX` | Max payments in the velocity window |
| `RISK_NEW_DEVICE_HOURS` | New-device risk window |