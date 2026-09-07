# Crypto Card wrist-reference visual — 2026-09-07

Owner review only. Production/main remain at `a61c73abf249a8b1e1f3698dbb73af3122a33101`.
Feature branch: `codex/card-watch-reference-final`.

## Asset and provenance

- Mode: built-in image_gen, precise edit of the owner-supplied image, not a new composition.
- Reference/edit target: `C:/Users/nazar/Downloads/ChatGPT Image 7 сент. 2026 г., 12_59_33.png`.
- Generated source: `C:/Users/nazar/.codex/generated_images/01a060bd-16d9-7380-b969-23b4b486c3da/exec-f7d3468c-1360-4ffa-865e-a34ba41a131b.png`.
- Versioned output: `frontend/public/cards/crypto-card-final/voltex-watch-wrist-final.png`.
- PNG: 1448 × 1086; SHA256 `ac18b001ae9bb5f370efae95953c7d6deda508679882b4220b7b687e41b39013`.
- CHF changed to graphite/silver, retaining its small Swiss flag. Original external wordmark/slogan removed so the exact owner-approved slogan is readable live HTML on both pages.
- Shared SVG viewport `480 80 960 925` trims unused surrounding background only. No perspective/skew, alternate mobile crop, masking or unequal image scaling. The full watch/display/card and all ten badges remain inside it.
- Fiat left: USD / EUR / CHF / GBP / RUB. Crypto right: BTC / ETH / USDT / TON / USDC. No BNB/XRP in the hero artwork.
- Exact shared heading: **Трать крипту по всему миру**. Other copy/translations remain unchanged.
- Previous Homepage two-card/phone component retired. Previous standalone watch hero is no longer mounted. Physical product masters, auth artwork and final application CTA remain unchanged.

## Validation

- Frontend TypeScript: PASS.
- Full frontend Jest: **33 suites / 514 tests PASS**.
- Production Vite build: PASS; pre-existing large-chunk advisory only.
- Built files: `index-BKLRsdep.js`, `index-DGycu1bW.css`.
- Actual local built-app browser QA on both Homepage and /card: **1920, 1440, 1280, 1024, 768, 390, 375**.
- Each width: exact visible slogan, new image present, image bounds inside page, no horizontal page overflow. SVG layout aspect-ratio discrepancy below 0.01 CSS px (normal subpixel rounding), preserving round badges.
- Visual inspection: entire watch/card and ten badges visible, correct left/right placement, neutral CHF, no distorted card or old hero. Desktop and mobile screenshots shown inline to owner for both pages.
- Browser error logs: none on either page. Preview is loopback-only, using the existing isolated test session; no production account/DB/API writes.
- Business/data/auth/KYC/eligibility/fees/limits and unrelated products preserved. Existing source fingerprints continue to test those boundaries.
- **Not deployed. Await owner approval.**

## Exact image-generation prompt

```text
Use case: precise-object-edit. Asset type: VOLTEX website hero photograph, edited from the supplied owner-approved image.
Image 1 is the EDIT TARGET and exact composition/lighting/identity reference. Preserve the premium smartwatch on the light-skinned feminine wrist, orange woven strap, dark luxury environment, bracelet, natural anatomy, current black VOLTEX rainbow-ring payment card fully inside the watch, its entire readable face and proportions, and the same framing. Do NOT redesign the scene or create a different watch photograph.
Make ONLY these targeted corrections:
1) Remove ALL standalone promotional typography on the left: remove the large external VOLTEX wordmark and the entire old Russian slogan. Reconstruct that area with the same dark luxury background. The exact new slogan will be rendered as live website text outside this image, so do NOT put any slogan or standalone wordmark anywhere in the image. Preserve VOLTEX lettering ON THE CARD.
2) The CHF badge must have a dark graphite/charcoal face and restrained champagne/silver perimeter, NOT red, NOT a warning ring, NOT aggressive red glow. Keep crisp white CHF text and a small correct Swiss red flag with white cross as an inset flag only.
3) Keep EXACTLY FIVE FIAT badges on the LEFT of the watch: USD with $ + USA flag, EUR with € + EU flag, CHF with CHF + Swiss flag, GBP with £ + UK flag, RUB with ₽ + Russian flag. Preserve their current arrangement/positions along the left arc. Each badge is a perfect front-facing CIRCLE, equally sized, crisp, NOT an ellipse or perspective-squashed coin. Each has code/symbol AND its proper flag.
4) Keep EXACTLY FIVE CRYPTO badges on the RIGHT: BTC orange Bitcoin, ETH violet Ethereum diamond, USDT green Tether, TON blue TON diamond, USDC blue USDC dollar-circle. Preserve full-color recognizable logos and their current right-side positions. Perfect front-facing circles with consistent size and restrained premium luminous rims.
No extra badges. NO BNB, Binance, XRP, extra text, unrelated logos, new objects or layout. No new hand/fingers or altered anatomy. Keep all ten badges and the complete smartwatch display/card safely within the canvas. Preserve quality, sharpness, realistic materials and light. Match the original closely, not a fresh reimagination.
```
