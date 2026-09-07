# Crypto Card payment / CHF correction — 2026-09-07

Owner preview only. No push, main modification, Render action or deployment.
Branch: `codex/card-payment-chf-correction`.
Starting main: `bd41a81fb87adb9dec812c77d476e983e52e046b` (freshly fetched; preserves owner copy cleanup after a97cb677).

## Latest owner correction — original photo restored

Supersedes the ruby image choice documented below. Following the owner's rejection of AI-edited photo details, the active image is now the exact supplied `ChatGPT Image 7 сент. 2026 г., 12_59_33.png`, copied byte-for-byte as `voltex-watch-wrist-original.png`. SHA256 `e853ff967008a4d1661ca029fbacb8b0a2531bc9fc4657b18922e760fea3f16b` matches the owner file. Original red CHF, Swiss cross, wrist/watch and all ten badges are intact. SVG viewport `516 80 928 925` omits only the old left baked-in slogan; no photo pixels were edited or stretched. Exact live slogan is unchanged. Shared Homepage/Card mount uses this original.

ATM card placement is now `translate(501 379) rotate(-3)` with width 208 and unchanged master ratio. The foreground mask is not applied to the ATM card: all four edges and the Mastercard corner remain visible, with the real fingertip meeting the lower-right edge. POS and physical master PNGs are unchanged from `04cc0fb`.

Validation: TypeScript PASS; 3 Card suites / 26 tests PASS; production build PASS (`index-7a2ydEha.js`, unchanged `index-DGycu1bW.css`). Browser screenshots at 1440 desktop and 390 mobile show the original watch photo and complete ATM card; no page overflow or console errors. Tests lock the original image hash and absence of the ATM face mask. Previous full-suite baseline limitations below still apply; unrelated Copy files remain untouched.

Light-ruby and cherry-red AI variants were rejected and are not referenced by the app. Light variant is retained only in untracked `outputs/voltex-watch-wrist-light-ruby-rejected.png`; cherry variant remains in generated_images. No push/deploy or main/production changes. Owner review only.

## Narrow visual change

- `CardScene.tsx`: remove the ATM no-card early return; reuse the exact approved `CARD_MASTER.black` as a controlled SVG layer in both POS/ATM photographs. Original background/hand pixels and both physical master files are unchanged. A source-space finger mask keeps only a small natural grip in front of the card. Master face viewport `106 78 1369 834` includes all card edges, with uniform scaling and rigid rotation (no anisotropic sizing/skew). POS positioning exposes the chip above the thumb; ATM card remains clearly in front of the NFC device, not swallowed by it.
- `WatchCardVisual.tsx`: only active image path and technical comment change. Same viewport, layout, round badges, watch composition and exact live slogan `Трать крипту по всему миру`. Shared Homepage/Card artwork stays consistent; no unrelated page code edited.
- New sibling asset: `frontend/public/cards/crypto-card-final/voltex-watch-wrist-ruby.png`, 1448×1086, SHA256 `e4814c093ff27b9ad8d2f0a5a44ba7ea6fab5b1c67ddd539bbc373bac4a1b22e`. Existing neutral-CHF image retained non-destructively. CHF is deep ruby, white cross/CHF retained, restrained rim; fiat USD/EUR/CHF/GBP/RUB left and BTC/ETH/USDT/TON/USDC right. No BNB/XRP added.
- No business rules, prices/limits/cashback, eligibility/KYC, application logic, API, DB, backend, physical masters, page CSS, copy or unrelated products changed.

## Checks actually run

- TypeScript: PASS. Production Vite build: PASS (existing chunk-size advisory). Assets `index-6If6dR_2.js` / unchanged `index-DGycu1bW.css`.
- Three targeted Crypto Card suites: PASS as part of the full run, including two added POS/ATM render/ratio/master/mask assertions and frozen master hashes.
- Full frontend: 31 suites PASS / 2 FAIL; 512 tests PASS / 2 FAIL. The two failures are pre-existing stale `ProfilePerformanceChart` source fingerprints in `avatarIdentityPresentation.test.ts` and `nazaraCardPresentation.test.ts` after owner cleanup already on bd41a81. Their tested Copy source, tests and helper have no diff against starting main. Expected old `68921d09…`, actual `db61fb5e…`. Left unrelated Copy files/tests untouched. The Card promotion test's two other stale baseline hashes were synchronized to bd41a81, not application changes.
- Actual built app at `http://127.0.0.1:4186/card`: desktop 1440 and mobile 390 screenshots of watch, POS and ATM shown inline. All ten badges/watch/card visible, CHF ruby, chip/branding clear; natural finger overlap only. No horizontal overflow or console errors.
- Additional responsive DOM bounds checks 1920/1280/375: no page overflow; hero within page; both complete card viewports inside their scene frames. Viewport override reset; preview left open. Existing read-only loopback fixture only, no production credentials or writes.
- `git diff --check`: PASS. Approved master PNGs unchanged. Await owner visual approval before any promotion/deploy.

## Image edit provenance / exact prompt

Mode: built-in image_gen (not CLI). Edit target: existing project `voltex-watch-wrist-final.png`, inspected before editing. Generated output: `C:/Users/nazar/.codex/generated_images/01a060bd-16d9-7380-b969-23b4b486c3da/exec-e9cb2804-7433-4c16-82fd-99cabfc29c75.png`, copied into the project as the ruby sibling asset. Physical card compositing is repo-native SVG, not an AI-redrawn card.

```text
Use case: precise-object-edit. Image 1 is the exact EDIT TARGET, a finished VOLTEX wrist/watch website visual. Make ONLY ONE localized color correction: the circular CHF badge at the middle-left (center approximately x600,y465 in the 1448x1086 original) currently has a neutral gray/black face and a white rim. Restore a clearly visible DEEP SWISS RUBY / burgundy red face, softly lit rich wine-red glass/enamel, not neutral gray. Keep its white 'CHF' lettering and red Swiss flag inset with crisp white cross EXACTLY as they are. The rim should have a restrained pale red/champagne highlight and very subtle ruby glow, NOT bright alert-red neon, NOT a warning halo. It must immediately read as Switzerland/CHF in premium dark red. Preserve its perfectly round shape, size, position and all badge geometry. Everything else MUST remain unchanged: same framing, dark luxury background, elegant light-skinned feminine wrist and fingers, orange woven watch strap, watch geometry, existing complete black VOLTEX rainbow-ring card INSIDE watch, its branding/chip/edges, every other badge color/position/text. Fiat badges LEFT exactly USD/EUR/CHF/GBP/RUB and crypto RIGHT exactly BTC/ETH/USDT/TON/USDC. No new text, slogan, elements, BNB, Binance or XRP. Do not regenerate the composition. Preserve original 1448x1086 canvas and all details outside the CHF badge. Output the complete edited image.
```
