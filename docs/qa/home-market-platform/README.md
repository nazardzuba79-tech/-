# Compact upward market column: isolated browser QA

The revised PR #473 keeps the original Sapphire globe, laptop, text, CTAs and live tape. Only its highlighted asset column changes: smaller cards with round dimensional medallions, five visible desktop rows and three mobile rows, moving upward through seven existing instruments.

**Browser QA: PASS.** Baseline: `8cbb74becc694ef29b90691d3f472390f2a1a413`. Product candidate: `36dc293069d1b693c1cc6857ef82be9b99abb207`, bundled as `index-CpmoccwL.js`. This is local review evidence, not production deployment; exact-head CI is reported separately by the PR.

A subsequent lifecycle-only fix prevents queued observer callbacks from restarting cancelled animations after unmount. Its actual-controller regression passes (15/15 tests in the column suite); the final production build passes as `index-BdLfCd-U.js`. The screenshots and timed samples below remain the unchanged visual candidate identified above.

## Method and measured cost

Both production bundles ran in fresh Chromium contexts: CPU 2× throttling, 40 ms latency, 10 Mbps download / 5 Mbps upload, 1× pixel ratio, same deterministic read-only fixtures and system-font fallback. External HTTP/WebSocket dispatch and writes were blocked. The original artwork and laptop chart/trades render before the measurement window.

One sample per viewport is recorded. Main-thread activity covers approximately four seconds with identical QA instrumentation; it is not total device CPU or production Web Vitals.

| Metric | Desktop 1440 baseline → column | Mobile 390 baseline → column |
|---|---:|---:|
| LCP | 3,852 → 3,912 ms | 1,104 → 1,164 ms |
| CLS | 0.000498 → 0.000094 | 0 → 0.000031 |
| Loaded JS, gzip | 201,181 → 201,707 bytes | 201,181 → 201,707 bytes |
| Encoded resource bodies | 4,582,939 → 4,599,743 bytes | 2,792,037 → 2,808,841 bytes |
| Requests / API reads | 27 / 9 → 34 / 9 | 26 / 9 → 33 / 9 |
| Main-thread activity / ~4 s | 332 → 543 ms | 82 → 304 ms |
| Script activity / ~4 s | 41 → 44 ms | 19 → 29 ms |
| Frame interval p95 | 16.7 → 16.7 ms | 16.7 → 16.8 ms |
| Frames over 50 ms in sample | 0 → 0 | 0 → 0 |
| Long tasks during load and sample | 2 / 108 → 2 / 121 ms total | 1 / 56 → 2 / 130 ms total |
| JS heap at sample end | 7,044,460 → 6,677,928 bytes | 6,941,196 → 6,529,816 bytes |

The animation adds measured main-thread activity on both profiles. Frame pacing remained stable, but this evidence does **not** support a zero-cost claim. The same nine API reads occur before and after; seven additional requests are local column SVGs, not new subscriptions or price polling.

Actual loaded-JS increase: **526 bytes gzip**. The isolated minified column bundle including local copy/format dependencies, with shared runtime/i18n/market-hook imports external, is **6,998 bytes gzip**; scoped CSS is **1,445 bytes gzip**. Seven SVGs total **10,586 bytes**. These meet the 50 KiB additional-JS and 400 KiB additional-decorative-asset budgets. The owner's original Sapphire bitmap is retained from the baseline, not counted as a new column asset.

## Checks actually run

- Screenshots and no horizontal overflow: 1920×1080, 1707×940, 1440×900, 1366×768 and 430/390/360/320 px mobile.
- Original artwork, heading, CTAs, tape and laptop visibility target retained. Heading and both main CTA bounds match the baseline within one pixel at every width.
- Five desktop / three mobile cards at measured resting positions. Zero overlap with actual text ranges, CTA text or laptop display. Unused whitespace inside broad text block boxes is not treated as painted text.
- Laptop fixture renders 48 valid candles and six trades. Canonical-pair metadata was corrected in QA transport for both baseline and candidate; product validation was preserved.
- Real 28-second upward cycle and wrap: ETH → SOL → XRP → ADA → BTC → GOLD → OIL → ETH. All seven instruments reach center; column and hero bounds stay fixed; each tile returns within three pixels of its starting position.
- Hover, keyboard focus, manual pause/resume, real scrolling offscreen and live reduced-motion changes freeze the column's actual Web Animations clocks. Original terminal/tape behavior remains separate.
- Slow/missing logos retain readable symbols and geometry with CLS below 0.01. Unavailable quotes keep a dash and localized explanation rather than a fabricated price.
- Actual EN/ES/中文/RU controls, keyboard pause, 200% CSS zoom and 720 CSS px reflow.
- Guest CTA preserves `/login?next=/trade`; original authenticated `/` redirect to Futures is unchanged.
- Fixture navigation Home → Spot → Futures → CFD → Home, then four remounts. Column animations disappear from terminals and on unmount. Each home remount has seven column animations, one existing global interval and eleven tracked document visibility listeners; counts do not grow.
- Final run: zero uncaught browser errors, console errors, unknown fixture APIs, external dispatches or write attempts.

The hidden-tab check explicitly fixtures `document.hidden` and dispatches `visibilitychange` in headless Chromium. The real application handler freezes all seven column clocks: **0 requests and 1.18 ms main-thread activity over two seconds**. This does not measure operating-system background scheduling. Offscreen behavior uses actual scrolling and IntersectionObserver.

## Evidence and reproduction

- [Compact raw measurements](measurements.json), [desktop](home-1920.png), [mobile](home-390.png).
- Full local screenshots/raw reports: `output/home-market-platform/baseline/` and `output/home-market-platform/column-after/`.
- Real 35.08-second recording, including the entire 28-second cycle: `output/home-market-platform/column-after/market-platform-cycle.mp4` (1440×900, 25 fps, H.264). Original WebM and eight cycle-phase images remain beside it.

Use existing locked repository dependencies and Playwright/Chromium. No application dependency was added.

```powershell
# First freeze a production build from the stated baseline SHA.
Push-Location frontend
node node_modules/vite/bin/vite.js build --outDir ../.home-hero-baseline-dist
Pop-Location
$env:QA_PLAYWRIGHT_MODULE = '<absolute path to playwright or playwright-core>'
$env:QA_CHROMIUM = '<absolute path to Chromium executable>'
$env:QA_PORT = '4208' # separate from the persistent review preview
$env:QA_HERO_MODE = 'baseline'
$env:QA_DIST = '.home-hero-baseline-dist'
node scripts/qa-home-market-platform.cjs

# Build the candidate and run the same profile plus behavior checks.
Push-Location frontend
npm.cmd run build
Pop-Location
$env:QA_HERO_MODE = 'after'
$env:QA_DIST = 'frontend/dist'
$env:QA_OUT = 'output/home-market-platform/column-after'
node scripts/qa-home-market-platform.cjs

# Persistent local preview, without Playwright.
node scripts/qa-home-market-platform-preview.cjs frontend/dist 4198
```

Review URL: `http://127.0.0.1:4198`. It binds only loopback, accepts GET/HEAD only and uses CSP to block nonlocal browser traffic. Its transport supplies deterministic API fixtures, canonical candle/trade pair metadata and local substitutes for old remote image/font fallbacks, without editing product files or the bundle. `GET /__hero-preview` exposes fixture-only status.

No merge, production deployment, production account, database or financial write is part of this QA.
