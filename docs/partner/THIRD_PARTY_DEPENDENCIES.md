# Third-Party Dependencies

**Company:** Braincade Holdings (Pty) Ltd (Reg. No. BW00001951757)
**Product:** PayChat
**Last updated:** 2026-09-19

This inventory lists the **external services** PayChat depends on and the
**software libraries** it links against, with licence and supply-chain notes.

Status key: **IMPL** implemented · **CFG** configuration required ·
**EXT** external party required · **OPT** optional · **PLAN** planned.

---

## 1. Runtime Service Dependencies

| Dependency | Role | Required? | Status | Notes |
|---|---|---|---|---|
| Node.js ≥ 20.11 | API runtime | Yes | IMPL | Declared in `package.json` `engines` |
| PostgreSQL | Managed production database | Recommended | CFG | Migrations in `apps/api/src/db/postgres/`; RLS enabled |
| SQLite (`better-sqlite3`) | Embedded database for dev/test | Default | IMPL | `DATABASE_PATH`; no server required |
| Redis | Shared rate limiting, locks, cluster-safe state | Optional | OPT | `REDIS_URL`; in-process fallback exists |
| Payment provider API (bank / mobile money / card) | Real money movement | Yes for live | **EXT** | No provider is contracted; no credentials exist |
| Transactional e-mail / SMS provider | Account communications | Optional | **PLAN** | Not integrated |
| Push notification service | Mobile notifications | Optional | **PLAN** | Not integrated; in-app inbox only |
| Object storage (receipts/exports) | Long-term document retention | Optional | **PLAN** | Not integrated |
| Secret manager (AWS Secrets Manager / Vault / equivalent) | Production secrets | Yes for production | **EXT/CFG** | Must be provisioned at deployment |
| TLS certificate authority | HTTPS in production | Yes for production | **CFG** | Not part of the repo |
| Error/log aggregation backend | Operational observability | Recommended | **PLAN** | Structured JSON logs emitted; no backend configured |

## 2. Direct Library Dependencies

Versions below are the **installed** versions resolved by `package-lock.json`
at the time of writing. Licences were read from each package's own
`package.json`.

### Runtime (production)

| Package | Version | Licence |
|---|---|---|
| fastify | 5.12.3 | MIT |
| zod | 3.25.76 | MIT |
| better-sqlite3 | 13.0.3 | MIT |
| pg | 8.23.0 | MIT |
| ioredis | 6.0.0 | MIT |
| qrcode | 1.5.4 | MIT |
| react | 18.3.1 | MIT |
| react-dom | 18.3.1 | MIT |
| react-router-dom | 7.18.3 | MIT |
| @simplewebauthn/server | 13.3.3 | MIT |
| @simplewebauthn/browser | 13.3.0 | MIT |
| @capacitor/core | 8.5.1 | MIT |
| @capacitor/android | 8.0.0 | MIT |
| @capacitor/cli | 8.5.1 | MIT |
| @capacitor/splash-screen | 8.0.0 | MIT |
| @types/pg | 8.23.1 | MIT |
| @types/qrcode | 1.5.6 | MIT |

### Development / build

| Package | Version | Licence |
|---|---|---|
| typescript | 5.9.3 | Apache-2.0 |
| vite | 6.4.3 | MIT |
| vitest | 3.2.7 | MIT |
| esbuild (via build script) | resolved by lockfile | MIT |
| tsx | 4.23.13 | MIT |
| eslint | 9.39.5 | MIT |
| @eslint/js | 9.39.5 | MIT |
| typescript-eslint | 8.69.0 | MIT |
| @types/node | 22.20.1 | MIT |
| @types/react | 18.3.31 | MIT |
| @types/react-dom | 18.3.7 | MIT |
| @types/better-sqlite3 | 7.6.13 | MIT |
| @vitejs/plugin-react | 4.7.0 | MIT |
| concurrently | 9.2.4 | MIT |

All licences above are permissive (MIT / Apache-2.0). No copyleft (GPL/AGPL)
licence is present in the direct dependency set.

## 3. Transitive Dependencies and Licence Verification

- The repository does **not** vendor third-party source code.
- A full SBOM including transitive licences should be generated at release time
  (`npm sbom --sbom-format cyclonedx` against the lockfile) and archived with the
  release. This has **not** yet been archived.
- `npm run verify:deps` runs `npm audit` at high severity for production
  dependencies and is part of CI.
- Where a bundled dependency is compiled into the API bundle, the build uses
  `--packages=external` so runtime dependencies are not inlined; their licence
  notices are therefore satisfied by `node_modules` distribution.

## 4. Assets and Third-Party Content

| Asset | Origin | Licence / rights |
|---|---|---|
| PayChat logo, mark, favicon (`apps/web/public/`) | Braincade Holdings (Pty) Ltd | Proprietary — owned by Braincade |
| Android launcher icons (`android/app/src/main/res/mipmap-*`) | Generated from the PayChat favicon by `scripts/gen-launcher-icons.ps1` | Proprietary — owned by Braincade |
| React / Fastify / Capacitor brand assets | Not used | n/a |
| Fonts | System font stack only; no webfont or third-party font licence | n/a |
| Icons | Inline SVG/Unicode glyphs authored in-repo | n/a |
| Stock photography / illustrations | None used | n/a |

No third-party trademarks are used to imply endorsement. See
`LEGAL/TRADEMARK_AND_BRAND.md`.

## 5. Supply-Chain Controls

| Control | Status |
|---|---|
| Lockfile committed (`package-lock.json`) | Yes |
| Deterministic installs (`npm ci`) in CI | Yes — `.github/workflows/ci.yml` |
| Dependency vulnerability gate | Yes — `npm audit` step |
| Secret scanning gate | Yes — `npm run verify:secrets` |
| Automated dependency updates | **PLAN** — no Dependabot/Renovate config |
| Provenance / signature verification of packages | **PLAN** — no attestation pipeline |

## 6. Provider Onboarding Dependencies

Adding a payment provider requires, from the provider:

1. Sandbox and production API credentials (client ID/secret or equivalent).
2. An HTTPS base URL and API specification.
3. A webhook endpoint registration plus a shared HMAC secret.
4. Written confirmation of supported capabilities (payments, balance, refunds).
5. A signed Data Processing Agreement and service terms.

No provider has supplied the above. The integration layer is implemented and
provider-agnostic — see [`PARTNER_ONBOARDING.md`](PARTNER_ONBOARDING.md).

## 7. Statement

PayChat does not claim ownership of any third-party software. All third-party
components remain the property of their respective authors and are used under
the licences stated above.
