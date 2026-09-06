# Copy Trading avatar identity refinement — 2026-09-06

## Scope and baseline

Starting review: `d66f01ad86823069d03fc647c26363122dcf8feb`, explicitly fetched by refspec (the clone's default fetch only refreshes codex-test). Feature: `codex/copytrading-avatar-realism`. Existing voltex-review manifest and actual browser confirmed the prerequisite corrected Performance V8 before edits.

Presentation only. No financial/business catalogue data, ranking, identity alias, eligibility, copy/account behavior, source of real photos, chart source, CSS, main, production or Render configuration changes. Existing synthetic-data disclosures retained.

Nazar remains the sole real-owner photo slot, obtained through the unchanged FeaturedAvatarContext. This frontend-only review intentionally supplies no account data, so **live review currently shows its existing N fallback**, not the owner's actual uploaded photo. Owner-photo priority at both card/profile sizes is verified by the actual Avatar component and actual context hook with a safe URL fixture; no real user photo was fetched, edited or fabricated. Ksenia is absent and untouched.

## Exact catalogue mix

30 secondary fictional aliases: mascot8 (26.7%), digital5 (16.7%), portrait5 (16.7%), abstract5 (16.7%), initials7 (23.3%). No category controls business data. Existing first eight ordinary ranked cards and first eight roster entries both include all five categories.

| Trader | Identity category | Primary asset |
| --- | --- | --- |
| QuantEdge | Initials | QE |
| RedDotCapital | Digital | red-glass-mask.webp |
| SakuraQuant | Fictional portrait | sakura-ink.webp |
| SeoulSigma | Fictional portrait | seoul-cyber.webp |
| MeridianFX | Initials | MF |
| MoonRabbit | Mascot | moon-rabbit.webp — unchanged |
| NordicEdge | Abstract | mountain — unchanged |
| VedaCapital | Initials | VC |
| PandaBlock | Mascot | panda-block.webp — unchanged |
| KopiTiam | Mascot | coffee-creature vector |
| AtlasVolt | Digital | chrome-visor vector |
| HanRiver | Abstract | river — unchanged |
| OrionByte | Abstract | constellation — unchanged |
| TigerBourse | Mascot | sleepy-tiger vector |
| YuanFlow | Mascot | otter-break.webp |
| KiwiChain | Mascot | kiwi-bird vector |
| RhineDelta | Abstract | delta — unchanged |
| NexaTrade | Initials | NX |
| AlphaKite | Digital | prism-face vector |
| IberiaQuant | Initials | IQ |
| Zenya | Fictional portrait | ink-reader vector |
| BlueLionSG | Fictional portrait | coral-editor vector |
| ChakraTrade | Initials | CT |
| SandboxAlpha | Digital | pixel-sentinel vector |
| DragonTick | Mascot | pixel-dragon vector |
| AsianWhale | Fictional portrait | aqua-pilot vector |
| TurboLeverage | Digital | neon-orbit vector |
| NightOwlFX | Mascot | moon-owl vector |
| VoltHunter | Initials | VH |
| DeltaOne | Abstract | reused zen vector |

6 primary rasters /17 primary original vectors /7 intentional initials. The two previously generated photographic-looking fictional portraits are no longer mapped. Their files remain preserved; no asset deletion was needed. Four new imagegen derivatives total24,448bytes; all six active WebPs total40,590bytes (12,920bytes above the previous four). Each192×192; largest9,514bytes. All use lazy loading and async decoding. Original vectors add no requests or dependency. Prompts/provenance in `frontend/public/copy-trading/avatars/PROVENANCE.md`.

All assets local; no third-party avatar API, social/exchange photo, celebrity, real-person reference or known NFT/meme artwork introduced. New digital/portrait/mascot artwork has distinct compositions/media rather than a uniform face template. Initials use existing letters on understated neutral fills.

Resolution stays in the existing Avatar + getTraderVisual + TraderAvatarArt architecture: Nazar real context photo → existing initials if unavailable/failed; fictional local image → configured original vector on failure → existing initials when no art configured. No fictional mapping exists for VX-001, Ksenia or unknown real account IDs. A changed owner URL retries normally. Component geometry is unchanged during loading/failure.

## Financial and design conservation

Complete canonical public response JSON SHA-256, independently captured before edits and asserted after:

- Baseline UTC2026-09-05: `5c960e5e203c3bc9d61e615efd4aa40f6c11e1f989af86308133d2b8a2e1ace2`
- Runtime UTC2026-09-06: `2fc5e762cfd2f489ba05a98dc483cd826990bc30d4121dfc9260a892ec436bb2`

Includes full trades/daily/weekly/monthly analytics, equity, follower/cashflow economics and AUM. Existing append-only clock test passes. Baseline471/434wins/34losses/3BE →92.7%, DD5.79%; currentSep6 naturally472/435wins →92.8%, as already approved. No economics correction in this task.

Whole CSS, trader business data and demoPerformance fingerprints match starting state. Components.tsx excluding only Avatar is source-identical. Existing yellow function guards pass; actual1440px ALL chart DOM paths and readouts before/after compare exactly equal.

## Local validation

- Backend TypeScript: PASS.
- Frontend TypeScript: PASS through both existing build workflows.
- Jest: 7suites /42tests PASS (traderVisuals, avatarIdentityPresentation, nazarProfileCorrection, nazaraCardPresentation, dailyReturnChart, syntheticSimpleReturnPresentation, ReviewCalendarClock).
- Production build: PASS,5641modules; isolated review: PASS,5605modules. Existing >500kB chunk advisory retained, no suppressed check.
- Actual built UI at http://127.0.0.1:4178/copy-trading.
- 1920/1440/1366/1280/1024/768/430/390/375: no page horizontal overflow; card IDs/order, width/height and avatar dimensions match pre-edit browser snapshots. Settled rechecks used at1280/1024 because initial viewport resize raced layout. No CSS change to compensate for the harness.
- Desktop1440: Nazar and all first12 ordinary identities inspected across rows, plus second-page vector identities. Mobile390: Nazar fallback, QuantEdge initials, RedDotCapital digital, NordicEdge abstract and YuanFlow mascot visibly inspected. Images loaded; no badge/text collision or stretched/broken crop.
- Favorites add/list/profile/remove verified for RedDotCapital; original empty state restored. Card/profile raster source exactly equal. Actual Avatar SSR verifies all30secondary identities at both sizes. No real following subscription or execution invoked.
- Browser warning/error logs empty. Profile yellow paths/readouts compare exactly equal to starting live staging.

## Delivery boundary

Only the existing `claude/review-ready` → `voltex-review` automatic deployment. No service creation/configuration/env/domain update. This document records completed local checks; final delivery additionally requires Render live SHA, public manifest/HTTP/financial hash and actual staging browser verification. See final task report for the verified deployment SHA and result.
