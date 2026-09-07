# Crypto Card visual consistency — owner review

Date: 2026-09-07. Branch: `codex/crypto-card-visual-consistency`.
Baseline: `ded37e7ae4595569fa7210a5675df11e6acf8e20` (approved Futures release plus repair of dangling imports following the owner's label-file deletions).

## Scope and preservation

- Homepage and its shared login/register presentation now render Black Signature through `VoltexCard` and one exported `CARD_MASTER` mapping. No active frontend reference to the obsolete `/cards/voltex-card-dark.png` or old precomposed phone/card scenes remains. Historical unused binaries are not deleted.
- Both approved master PNGs remain byte-identical. Titanium/Black Signature comparison, prices, fees, cashback, limits, application controller, eligibility, KYC, backend and other products are unchanged.
- New blank smartwatch photography and exact Black Signature master are separate SVG image layers. The complete master is inserted at x=384, y=462, width=486, height=486*996/1580 in a 1254-square scene, inside the empty display. No generated card lettering, mask, clip or perspective transformation touches this card layer. Mobile crops only lateral empty studio space.
- Final CTA uses the same master. POS keeps the existing approved hand mask/projection and shares the master mapping. ATM uses the original supplied hardware photo without the misleading floating card overlay.
- Homepage benefit text is unchanged. Proper Apple Pay artwork replaces the homemade mark; existing installed OpenAI brand icon matches the AI benefit; detailed SVG global-payment, ATM and biometric-security icons replace generic benefit symbols. No package/dependency or new user-facing copy.

## Assets / provenance

- `frontend/public/cards/crypto-card-final/voltex-smartwatch-scene.png`: generated with the built-in image generation tool under the imagegen skill; SHA256 `da2478a366d97498fb698cdb5b3f2f3663c7d4691e9accbd42553eb9fd14427e`.
- `frontend/public/cards/crypto-card-final/apple-pay-mark.svg`: unchanged official `Apple Pay Mark/SVG/Apple_Pay_Mark_RGB_041619.svg` from https://developer.apple.com/apple-pay/marketing/Apple-Pay-Mark.zip ; guidelines https://developer.apple.com/apple-pay/marketing/ . SHA256 `66baf110b86c1f1ae01a0e28985970d3827465e6aba6be54d5142a6d1eaa803c`. Rendered with its original proportions and no effects/recoloring.
- Unchanged Black Signature SHA256: `494de1377e5fb5ae1108398a1788cd6b98981215b6315edc4aea0cc54f4a3ad1`.
- Unchanged Titanium SHA256: `b4d69e2b18dd4459127ecedcd21876a569275bc83e9878a54466dfc6737195f8`.

### Watch generation prompt

Use case: product-mockup. Project asset: premium dark luxury fintech website hero. Generate a photorealistic studio render of one unbranded premium rectangular smartwatch, viewed EXACTLY straight on from the front (no rotation, no perspective distortion), centered on a seamless nearly-black #08090b background. Square canvas. The entire hardware and dark graphite wrist strap are visible with safe margins on all sides, no crops. Oversized brushed graphite titanium case, rounded rectangular corners, precise dark glass, one subtle crown on the right, elegant premium industrial design, no Apple logo or any hardware branding. The front case occupies approximately 62% of image width, centered at (50%,50%); large completely empty flat pitch-black display inside occupies roughly 50% of image width and 51% image height. Straight horizontal and vertical screen edges, rounded corners. This is an empty display intended for deterministic insertion of a real approved VOLTEX payment card later in website code. DO NOT draw any card, payment logo, numbers, lettering, interface, clock, icons or UI on the screen. Display must be uniformly dark and completely unobstructed. Premium softly lit brushed metal edges, restrained warm champagne highlights on the left and cool silver reflections on the right, shallow pool of realistic shadow below, no loud neon. Refined high-end product photography, exceptional material fidelity and crisp detail. Strap dark graphite matte, sophisticated clean grooves, no hands, no people, no fingers, no ATM, no additional objects, no watermarks, no text. Balanced precise frontal product composition, not a floating distorted perspective object.

## Validation

- Frontend TypeScript PASS. Full frontend Jest: 33 suites / 512 tests PASS. Vite production build PASS, existing large-chunk advisory only. Final assets: `index-B65uMsJu.js`, `index-8M99hna7.css`.
- New tests render actual Homepage/card components, verify exact master references/proportions/screen containment, official asset hash and absence of obsolete active artwork references. Existing business/canonical-data preservation checks remain. Only approved visual source fingerprints and asset list changed.
- Built-app browser: Homepage and Card at 1920/1440/1280/1024/768/390/375, no page-level horizontal overflow or broken images. Desktop/mobile screenshots shown, plus Titanium/Black Signature comparison. Shared login/register artwork and POS checked. No console errors observed. Existing application controller shows the correct verification state for the local unverified account.
- Local preview: http://127.0.0.1:4186/card . Loopback-only QA account, no production credentials/database; private writes denied. QA server/output are untracked and excluded from the commit.
- Owner reviewed screenshots and subsequently authorized this Card release. Remote main was re-fetched; the only intervening change was internal documentation `2f7051e`, preserved by fast-forward. Card deployment still requires LIVE/browser verification after push. The separate approved Futures release was independently verified LIVE on frontend and backend at `ded37e7`. The next Homepage two-card/phone request is excluded from this release.
