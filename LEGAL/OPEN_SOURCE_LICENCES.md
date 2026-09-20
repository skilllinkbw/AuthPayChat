# Open Source Licence Inventory

**Company:** Braincade Holdings (Pty) Ltd
**Product:** PayChat
**Version:** 1.0-draft
**Last updated:** 2026-09-19

Inventory of open-source software used by PayChat, with the licence declared by
each package. **Braincade claims no ownership of any component listed here.**

---

## 1. Runtime dependencies

| Package | Version | Licence | Obligation |
|---|---|---|---|
| fastify | 5.12.3 | MIT | Notice |
| zod | 3.25.76 | MIT | Notice |
| better-sqlite3 | 13.0.3 | MIT | Notice |
| pg | 8.23.0 | MIT | Notice |
| ioredis | 6.0.0 | MIT | Notice |
| qrcode | 1.5.4 | MIT | Notice |
| react | 18.3.1 | MIT | Notice |
| react-dom | 18.3.1 | MIT | Notice |
| react-router-dom | 7.18.3 | MIT | Notice |
| @simplewebauthn/server | 13.3.3 | MIT | Notice |
| @simplewebauthn/browser | 13.3.0 | MIT | Notice |
| @capacitor/core | 8.5.1 | MIT | Notice |
| @capacitor/android | 8.0.0 | MIT | Notice |
| @capacitor/cli | 8.5.1 | MIT | Notice |
| @capacitor/splash-screen | 8.0.0 | MIT | Notice |

Type-only packages (`@types/pg`, `@types/qrcode`) are build-time declarations and
carry the same MIT terms.

## 2. Development and build dependencies

| Package | Version | Licence |
|---|---|---|
| typescript | 5.9.3 | Apache-2.0 |
| vite | 6.4.3 | MIT |
| vitest | 3.2.7 | MIT |
| tsx | 4.23.13 | MIT |
| eslint | 9.39.5 | MIT |
| @eslint/js | 9.39.5 | MIT |
| typescript-eslint | 8.69.0 | MIT |
| @vitejs/plugin-react | 4.7.0 | MIT |
| concurrently | 9.2.4 | MIT |
| @types/node | 22.20.1 | MIT |
| @types/react | 18.3.31 | MIT |
| @types/react-dom | 18.3.7 | MIT |
| @types/better-sqlite3 | 7.6.13 | MIT |

## 3. Licence obligation analysis

| Licence | Copyleft? | Source disclosure required? | Obligation |
|---|---|---|---|
| MIT | No | No | Retain the copyright notice and the licence text in distributed copies |
| Apache-2.0 | No | No | Retain notices; state changes if any; include the licence; patent grant |

**No GPL, LGPL or AGPL dependency is present in the direct dependency set.** No
licence in this inventory imposes a copyleft obligation on PayChat's proprietary
source code.

## 4. Current compliance position

| Requirement | Status |
|---|---|
| No third-party source vendored into the repository | Compliant — dependencies are consumed as packages |
| Dependency licences recorded | Compliant — this document |
| Runtime dependencies shipped as `node_modules` (not inlined) | Compliant — the API bundle is built with `--packages=external` |
| Attribution notice shown in the product's About screen | **NOT IMPLEMENTED** — see §5 |
| Full third-party notice file bundled with the API deployment artefact | **NOT IMPLEMENTED** — see §5 |
| Transitive-licence SBOM generated and archived per release | **NOT IMPLEMENTED** — see §5 |
| No GPL/AGPL contamination | Verified for direct dependencies; transitive verification pending via SBOM |

**Gap:** although MIT and Apache-2.0 require the licence text and copyright
notice to accompany distributed copies, PayChat does not yet ship a consolidated
third-party notices file, and the web client does not show an attribution screen.
Because `node_modules` is present in a server deployment the notices travel with
the dependency tree, but a consolidated notice artefact is the correct practice
and is required before distributing a bundled mobile artefact.

## 5. Remediation plan

1. Generate an SBOM per release: `npm sbom --sbom-format cyclonedx`.
2. Generate a consolidated `THIRD_PARTY_NOTICES.txt` from the licence texts of
   all production dependencies.
3. Ship that file with the API deployment artefact.
4. Add an **About → Open source licences** screen to the web client that displays
   the consolidated notice, since the mobile artefact bundles the client.
5. Add a CI check that fails if a new dependency introduces a non-permissive
   licence without a recorded decision.

## 6. Assets

| Asset | Origin | Rights |
|---|---|---|
| PayChat logo, mark, favicon | Braincade Holdings (Pty) Ltd | Proprietary |
| Android launcher icons | Generated from the PayChat favicon by `scripts/gen-launcher-icons.ps1` | Proprietary |
| Fonts | System font stack only | No third-party font licence |
| Icons | Inline SVG/Unicode authored in-repo | Proprietary |
| Photography, illustration, stock art | None used | n/a |
| Third-party logos displayed in the product | None displayed | n/a |

## 7. Verification method

Versions and licences above were read directly from each installed package's own
`package.json` in `node_modules` at the time of writing, cross-checked against the
declared ranges in the root, `apps/api` and `apps/web` manifests. This inventory
covers **direct** dependencies. Transitive dependencies are governed by the same
permissive families but must be enumerated by the SBOM step in §5 before the
mobile artefact is distributed.
