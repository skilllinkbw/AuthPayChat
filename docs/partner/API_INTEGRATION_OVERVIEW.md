# API Integration Overview

**Product:** PayChat API
**Company:** Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
**Base URL:** `https://api.paychat.bw` (production) · `http://localhost:4000` (dev)

---

## 1. Architecture

PayChat exposes a REST-like JSON API over HTTPS (Fastify 5). All endpoints
require authentication via a Bearer JWT access token, except `/api/auth/login`,
`/api/auth/register`, `/api/auth/refresh`, and `/healthz`/`/readyz`.

```
GET  /healthz                        Liveness
GET  /readyz                         Readiness (checks DB, provider registry)

POST /api/auth/register              Register new user
POST /api/auth/login                 Login (password)
POST /api/auth/refresh               Refresh access token
POST /api/auth/logout                Logout (revoke session)
GET  /api/auth/me                    Current user profile
GET  /api/auth/sessions              List sessions
POST /api/auth/sessions/revoke       Revoke session

POST /api/webauthn/register           Begin WebAuthn registration
POST /api/webauthn/register/verify
POST /api/webauthn/authenticate      Begin WebAuthn authentication
POST /api/webauthn/authenticate/verify
GET  /api/webauthn/credentials       List credentials

GET  /api/conversations              List conversations
GET  /api/conversations/:id/messages  Paginated message history
POST /api/conversations/:id/messages  Send message (may trigger payment)
POST /api/conversations/:id/messages/:id/read

POST /api/payments/intents            Create payment intent
GET  /api/payments/intents/:id        Get intent
POST /api/payments/intents/:id/confirm  Confirm + initiate
POST /api/payments/intents/:id/cancel
POST /api/payments/intents/:id/refund
GET  /api/payments/intents/:id/receipt

POST /api/payment-links               Create payment link
GET  /api/payment-links/:token        Preview link
POST /api/payment-links/:token/pay     Pay via link

POST /api/qr/generate                 Generate QR PNG
POST /api/qr/scan                     Resolve QR code
POST /api/qr/pay                      Pay via QR

GET  /api/accounts                    List connected accounts
POST /api/accounts                    Connect provider account
DELETE /api/accounts/:id              Disconnect account
POST /api/accounts/:id/balance/refresh
GET  /api/accounts/quote              Get payment quote

POST /api/merchant/onboard            Merchant onboarding
GET  /api/merchant/transactions       Transaction history
GET  /api/merchant/summary            Settlement summary
POST /api/merchant/reconcile         Reconcile
GET  /api/merchant/audit             Audit log

GET  /api/providers                   List available providers + capabilities
GET  /api/notifications               List notifications
POST /api/notifications/read-all      Mark all read

POST /api/internal/reconcile         Internal reconciliation (token-protected)

POST /api/webhooks/:provider           Provider webhook (HMAC-verified)
```

## 2. Authentication

```
POST /api/auth/login
Content-Type: application/json

{
  "phone": "+26771234567",
  "password": "your-password",
  "deviceLabel": "Chrome on Windows",
  "platform": "Mozilla/5.0 ..."
}

Response:
{
  "accessToken": "eyJhbGciOiJIUzI1Ni...",
  "refreshToken": "encrypted-refresh-token",
  "user": { "id": "usr_...", "displayName": "...", "phone": "+267..." }
}
```

Use the token in subsequent requests:
```
Authorization: Bearer <accessToken>
```

Access tokens expire in 15 minutes. Refresh with:
```
POST /api/auth/refresh
{ "refreshToken": "encrypted-refresh-token" }
```

Refresh tokens are single-use — reuse is detected and revokes all sessions.