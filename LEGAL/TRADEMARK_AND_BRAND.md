# Trademark and Brand Assets

**Owner:** Braincade Holdings (Pty) Ltd, Registration No. BW00001951757
**Product:** PayChat
**Version:** 1.0-draft · **Legal review status: DRAFT — NOT REVIEWED BY COUNSEL**
**Last updated:** 2026-09-19

---

## 1. Trademark status — important

**No trademark registration has been applied for or granted** for "PayChat",
"Braincade", the PayChat mark, or any associated logo. The symbols ™ and ® must
**not** be used in the product, documentation or marketing until a registration
is actually obtained (® in the relevant jurisdiction) or an application is filed
(™, and then only in the jurisdiction where the application is pending).

The names and marks are used as unregistered brand identifiers. Whether to seek
registration is a decision for the owner with counsel.

## 2. Authoritative brand assets

These are the **official** assets for the product. There is no other approved
logo, and no AI-generated or placeholder mark should ever be substituted.

| Asset | Path | Use |
|---|---|---|
| **Primary logo (authoritative)** | `apps/web/public/paychat-logo.png` | Sign-in, dashboard header, documents, splash |
| Vector logo | `apps/web/public/paychat-logo.svg` | Where scalable vector is required |
| Brand mark | `apps/web/public/paychat-mark.png` | Compact spaces, avatars, favicon source |
| Favicon | `apps/web/public/favicon.png` | Browser tab and metadata |
| Android launcher icons | `android/app/src/main/res/mipmap-*/ic_launcher*.png` | Device launcher (all densities) |
| Android adaptive icon foreground | `android/app/src/main/res/mipmap-*/ic_launcher_foreground.png` | Adaptive icons (API 26+) |
| Android adaptive icon background | `android/app/src/main/res/values/ic_launcher_background.xml` | Adaptive icon background colour |

### Generation, not re-design

The Android launcher icons are **derived from the official favicon**, not redrawn.
`scripts/gen-launcher-icons.ps1` crops the visual bounding box of the mark,
scales it with high-quality bicubic interpolation, and renders it on the brand
background for every density (legacy, round and adaptive foreground).

**Rule:** if the logo ever changes, update `apps/web/public/favicon.png` and
re-run `scripts/gen-launcher-icons.ps1`. Do not edit the generated PNGs by hand.

## 3. Brand colours

| Role | Value | Notes |
|---|---|---|
| Primary blue | `#0B3B8C` | Used as the launcher background and the primary action colour |
| Surface / background | As defined in `apps/web/src/styles.css` | Design-token driven; do not hardcode elsewhere |
| Text | As defined in the design tokens | Must meet WCAG AA contrast against its background |

Colours are defined once as design tokens in the stylesheet. New colours must be
added as tokens rather than written inline, so that the brand stays consistent.

## 4. Where the logo must appear

| Surface | Requirement |
|---|---|
| Sign-in / registration screen | Primary logo, centred, undistorted |
| Dashboard / application header | Brand mark or logo at a size that does not compete with content |
| Splash screen (Android) | Official mark on the brand background |
| Launcher icon (Android) | Official mark, all densities |
| Favicon and page metadata | Official favicon |
| Receipts and exported documents | Logo in the document header where the format allows |
| Partner-facing documents | Logo on the cover or header of each document |

## 5. Rules for using the marks

**Do**

1. Use the official asset files, unmodified.
2. Keep proportions intact; scale uniformly.
3. Leave clear space around the mark of at least the height of the mark's "P"
   stroke.
4. Place the logo on a background with sufficient contrast.
5. Refer to the product in text as **PayChat**.

**Do not**

1. Redraw, trace, recolour, rotate, skew, stretch or crop the mark.
2. Add effects: shadows, bevels, gradients, glows, outlines.
3. Place the logo on a busy photograph or a low-contrast background.
4. Combine the mark with another company's mark to imply a partnership that does
   not exist.
5. Use the mark to imply that Braincade is a bank, is licensed by a regulator, or
   is endorsed by any institution, unless a written approval says so.
6. Use the marks in a way that suggests sponsorship, affiliation or endorsement
   without a written agreement.
7. Use a third-party or AI-generated mark as a substitute.

## 6. Partner and third-party use

A bank, payment provider or merchant may display the PayChat mark **only** under a
written agreement, and only in the form approved by Braincade. Unauthorised use
must be reported to `security@paychat.bw`.

Conversely, PayChat must not display a partner's mark unless the partner has
approved its use. **No partner logo is currently displayed anywhere in the
product, because no partner agreement exists.**

## 7. Third-party marks

No third-party logo, brand asset or trademark is bundled in this repository. The
product intentionally does not display provider logos, so that no endorsement is
implied. If provider logos are added later, each requires written permission and
must be listed in [`OPEN_SOURCE_LICENCES.md`](OPEN_SOURCE_LICENCES.md) §5.

## 8. Asset inventory and integrity

| Check | Status |
|---|---|
| Single authoritative logo per surface | Yes |
| Generated derivatives reproducible from source | Yes (`scripts/gen-launcher-icons.ps1`) |
| No placeholder or AI-generated mark in the product | Yes |
| Consistent mark across web, favicon and launcher | Yes |
| Written brand guidelines published | This document |
| Trademark registration | **NONE — not filed** |

## 9. Open items for the owner

1. Decide whether to file a trademark application for the PayChat name and mark.
2. Confirm the copyright/ownership notice wording to display in the product's
   about screen.
3. Confirm whether the business name and registration number on the brand assets
   and documents match the certificate of incorporation.
