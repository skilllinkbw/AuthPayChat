# Cookie and Tracking Notice

**Product:** PayChat · **Controller:** Braincade Holdings (Pty) Ltd
**Version:** 1.0-draft · **Legal review status: DRAFT — NOT REVIEWED BY COUNSEL**
**Last updated:** 2026-09-19

---

## 1. Principle: no tracking by default

PayChat uses **no advertising cookies, no third-party analytics cookies, and no
cross-site tracking pixels**. There is currently nothing in the product that
requires a cookie-consent banner, because no non-essential storage is used.

If analytics or third-party scripts are ever introduced, this notice must be
updated **before** they are enabled, and a consent mechanism must be implemented
for non-essential storage.

## 2. Storage actually used

| Storage | Type | Purpose | Contents | Lifetime | Essential? |
|---|---|---|---|---|---|
| Access token | Client session storage | Authenticate API requests | Signed JWT (no personal data beyond user id/role claims) | 15 minutes | Yes |
| Refresh token | Client secure storage | Obtain new access tokens | Opaque token, encrypted at rest server-side | Rotation on use; expiry per policy | Yes |
| Language preference | Local storage | Remember selected interface language | Language code (`en`, `tn`) | Until cleared | No (convenience) |
| Theme preference | Local storage | Remember light/dark selection | `light` / `dark` | Until cleared | No (convenience) |
| Server sessions | Server-side database record | Session management, device list, revocation | Device label, platform, timestamps, token hash | Until expiry or revocation | Yes |

No cookie is set by the web client for authentication. Authenticated API calls
use an `Authorization: Bearer` header, which removes the classic CSRF attack
surface.

## 3. Why these are essential

- Tokens are required to keep you signed in and to authorise your requests. They
  cannot be disabled while using the Service.
- Preference entries simply remember your own choices on your own device. They
  are not shared with us and are not used for tracking. You can clear them at any
  time through your browser or OS settings; the Service will fall back to
  defaults.

## 4. Third parties

PayChat does not embed third-party analytics, advertising, social or tracking
scripts. Payment Partners are engaged server-side and do not receive tracking
identifiers from your browser as a result of merely using PayChat.

## 5. Mobile application

The Android application is a thin wrapper around the PayChat web client. It uses
the same storage model described above and requests only the `INTERNET`
permission. It contains no advertising SDK and no analytics SDK.

## 6. Do Not Track and Global Privacy Control

Because no cross-site tracking occurs, there is no tracking behaviour to disable
in response to these signals. We will honour such signals if tracking is ever
introduced.

## 7. Changes

Material changes will be notified in the application and this notice will be
re-issued with a new version number and effective date.
