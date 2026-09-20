# Partner Onboarding Guide

**Company:** Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
**Status:** Implemented (configuration-based) · Live: BLOCKED — credentials required

---

## 1. Overview

A new payment-provider partner can be onboarded to PayChat **entirely through
configuration**. No core source code changes are required. This document
describes the onboarding procedure for partners and for PayChat platform
operators.

## 2. Prerequisites

Before onboarding, the partner must provide:

| Item | Description | Required |
|---|---|---|
| Partner display name | e.g. "Orange Money Botswana" | Yes |
| Provider ID | e.g. `orange_money_bw` (unique) | Yes |
| Country | ISO 3166-1 alpha-2 (e.g. `BW`) | Yes |
| Currency | ISO 4217 (e.g. `BWP`, `ZAR`) | Yes |
| Base URL | HTTPS endpoint for API calls | Yes |
| Credentials | Client ID / secret or equivalent | Yes |
| Webhook endpoint | URL for status callbacks | Yes |
| Webhook secret | Shared secret for HMAC | Yes |
| Capabilities | Balance, payments, refunds, QR | Yes |
| API spec | OpenAPI/Swagger or documentation | Yes |

## 3. Onboarding Steps

### Step 1: Partner delivers API credentials

The partner provides:
- Sandbox credentials (for testing)
- Production credentials (for live)
- Webhook signing secret
- API documentation

Credentials are stored in the **production secret manager** (AWS Secrets Manager
/ equivalent), never in the PayChat source code or database.

### Step 2: PayChat configures the provider

Configuration is done in one of three ways, in increasing priority:

1. **Built-in defaults:** `apps/api/src/providers/definitions.ts`
2. **Environment variable:** `PAYCHAT_PROVIDERS` (JSON array of definitions)
3. **Database:** `payment_providers` table (runtime-discoverable)

Example configuration entry:

```json
{
  "id": "orange_money_bw",
  "displayName": "Orange Money Botswana",
  "country": "BW",
  "currency": "BWP",
  "enabled": true,
  "transport": {
    "type": "http",
    "baseUrl": "https://api.orange.bw",
    "timeoutMs": 10000
  },
  "credentials": {
    "clientIdEnv": "ORANGE_CLIENT_ID",
    "clientSecretEnv": "ORANGE_CLIENT_SECRET"
  },
  "capabilities": {
    "getBalance": true,
    "initiatePayment": true,
    "refundPayment": true,
    "cancelPayment": false
  },
  "methods": ["card", "bank_transfer"],
  "webhook": {
    "signatureHeader": "X-Signature",
    "algorithm": "sha256"
  }
}
```

### Step 3: Configure environment variables

```bash
# Provider credentials (in production, use secret manager)
export ORANGE_CLIENT_ID="..."
export ORANGE_CLIENT_SECRET="..."

# Webhook secret (shared with provider)
export ORANGE_WEBHOOK_SECRET="..."

# Kill switch (optional)
# export PAYCHAT_PROVIDER_DISABLE=orange_money_bw
```

### Step 4: Run the provider-architecture test

```bash
npx vitest run tests/provider-architecture.test.ts
```

This verifies that:
- No provider names appear in core source
- The provider can be discovered via `GET /api/providers`
- Capabilities are reported correctly
- A live HTTP rail can be stood up in-process with zero code changes

### Step 5: End-to-end test

1. Register a test user
2. Connect the provider account (`POST /api/accounts/connect`)
3. Refresh balance (`POST /api/accounts/:id/balance/refresh`)
4. Create a payment intent
5. Confirm the payment
6. Verify the provider's webhook is received and processed
7. Verify the receipt and notification appear

### Step 6: Go-live checklist

- [ ] Sandbox webhook exchange successful
- [ ] Sandbox payment end-to-end (P0.01)
- [ ] Production webhook URL registered with provider
- [ ] Production credentials stored in secret manager
- [ ] Kill switch confirmed OFF
- [ ] Capabilities confirmed with partner
- [ ] DPA/SLA signed

### Step 7: Go-live

Remove the `PAYCHAT_DISABLE_SANDBOX` flag and switch `PAYCHAT_ENV` to
`production`. The provider becomes available to all users.

## 4. Removing or Disabling a Provider

```bash
# Disable (soft) — provider appears in registry but not to users
export PAYCHAT_PROVIDER_DISABLE=orange_money_bw

# Remove credentials — provider reports no capabilities
unset ORANGE_CLIENT_ID
unset ORANGE_CLIENT_SECRET
# The provider will advertise `enabled: false` and
# `capabilities.initiatePayment: false`
```

## 5. Testing

A brand-new provider can be tested by standing up a real HTTP server in-process
(see `tests/provider-architecture.test.ts` for an example that configures a
provider to point at a local HTTP server with zero code changes).

```bash
npx vitest run tests/provider-architecture.test.ts --reporter=verbose
```

## 6. Support

- Technical: eng@paychat.bw
- Business development: partnerships@paychat.bw
- Security: security@paychat.bw