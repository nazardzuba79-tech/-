# Market platform hero: isolated browser QA

The built candidate passes the requested browser checks. Baseline: `8cbb74becc694ef29b90691d3f472390f2a1a413`. Product candidate: `d5615337dcce8968ed24823087c30e5c6fad268d`. This is local review evidence, not a production deployment or production performance claim. Exact-head CI is reported separately by the PR.

## Method and measurements

The baseline production bundle was frozen before editing the hero. Both bundles ran in fresh Chromium contexts, with the same CPU 2× throttling, 40 ms latency, 10 Mbps download / 5 Mbps upload, 1× pixel ratio, viewport sizes and deterministic read-only fixtures. External HTTP and WebSocket traffic and all writes were denied before dispatch. Existing optional remote fonts used the same system-font fallback in both runs.

One timed run per viewport is recorded below. Main-thread activity covers an approximately 4-second visible window and includes the identical measurement instrumentation. It is not total device CPU. Browser timings are diagnostic samples, not production Web Vitals or a guarantee for every device.

| Metric | Desktop 1440 baseline → new | Mobile 390 baseline → new |
|---|---:|---:|
| LCP | 3,988 → 1,080 ms | 1,120 → 1,120 ms |
| CLS | 0.000094 → 0 | 0 → 0 |
| Loaded JS, gzip | 201,181 → 191,683 bytes | 201,181 → 191,683 bytes |
| Encoded resource bodies | 4,582,869 → 2,719,106 bytes | 2,791,967 → 2,719,106 bytes |
| Total browser requests | 27 → 32 | 26 → 32 |
| API reads | 9 → 9 | 9 → 9 |
| Main-thread activity / ~4 s | 652 → 301 ms | 124 → 224 ms |
| Script activity / ~4 s | 75 → 19 ms | 25 → 12 ms |
| Frame interval p95 | 16.8 → 16.8 ms | 16.8 → 16.7 ms |
| Frames over 50 ms during sample | 0 → 0 | 0 → 0 |
| Long tasks during load and sample | 1 × 110 → 1 × 57 ms | 1 × 56 → 1 × 94 ms |
| JS heap at sample end | 6,236,948 → 6,461,040 bytes | 6,643,668 → 5,735,568 bytes |

The mobile main-thread sample increased. The measured frame pacing remained stable, but this evidence does **not** support a claim of zero additional mobile CPU. The same nine market/API reads occurred before and after; the additional requests are local decorative assets, not market subscriptions. The initial existing homepage book/candle/trade reads were preserved with the shared market hook.

The isolated bundled/minified hero module is **2,167 bytes gzip** (shared React/router/icons/i18n dependencies excluded), scoped CSS is **2,124 bytes gzip**, and the seven startup SVG bodies total **8,662 bytes**. These meet the development budgets of 50 KiB additional JS and 400 KiB initial decorative assets. The complete loaded-JS comparison above includes the real application bundle.

## Browser checks actually run

- Production-bundle screenshots and horizontal-overflow checks at 1920×1080, 1707×940, 1440×900, 1366×768 and 430/390/360/320 px mobile widths.
- Real 28-second animation cycle: BTC → ETH → SOL → XRP → ADA → DOGE → LTC → BTC. Eight screenshots cover all center phases and the last-to-first return. Platform and hero bounds remain unchanged; each tile returns within 3 px of its initial measured position.
- Hover, keyboard focus, manual pause/resume, offscreen pause/resume and live reduced-motion changes. Actual Web Animations `currentTime` values freeze while paused. The reduced-motion scene retains the complete static composition.
- Keyboard activation of the pause control; guest CTA retains `/login?next=/trade`; actual EN/ES/中文/ RU language controls update the copy; 200% CSS zoom and a 720 CSS px reflow viewport do not introduce page overflow.
- Slow and missing local logos preserve layout and readable symbols, with CLS below 0.01 in those cases.
- Guest homepage and authenticated root behavior. The existing authenticated `/` redirect to Futures is preserved; this task did not introduce an authenticated homepage.
- Isolated navigation Home → Spot → Futures → CFD → Home, then four extra remounts. Hero animations are absent on terminals and after unmount. Every home remount has exactly seven animations, one existing global interval and ten tracked document visibility listeners; counts do not grow.
- Zero uncaught browser errors, console errors, unknown fixture API routes, external network dispatches or write attempts in the final run.

The hidden-tab check uses an explicit `document.hidden` / `visibilitychange` fixture in headless Chromium. The actual application handler pauses all seven animation clocks; the two-second hidden sample recorded **0 requests and 0.49 ms main-thread activity**. This verifies application lifecycle handling. It does **not** claim a measurement of operating-system background-tab scheduling. The offscreen test uses real scrolling and IntersectionObserver.

The fixture route gaps found while testing modern Spot/CFD routes were corrected only in the QA transport. Their original diagnostics remain in the local output directory; no product API or market behavior was changed to pass QA.

## Artifacts

- [Compact raw measurements and lifecycle evidence](measurements.json)
- [Final desktop screenshot](home-1920.png)
- [Final mobile screenshot](home-390.png)
- Full local matrix, cycle-phase screenshots and raw reports: `output/home-market-platform/{baseline,after}/`.
- Actual 31.64-second recording, including the complete 28-second cycle: `output/home-market-platform/after/market-platform-cycle.mp4` (1440×900, 25 fps, H.264); original WebM is retained beside it.

## Reproduce

Install the repository's existing locked dependencies and build the production frontend. The harness accepts normal Playwright installations or explicit runtime paths; no new application dependency is needed.

```powershell
# Before editing, retain a baseline production bundle from the stated baseline SHA.
Push-Location frontend
node node_modules/vite/bin/vite.js build --outDir ../.home-hero-baseline-dist
Pop-Location

$env:QA_PLAYWRIGHT_MODULE = '<absolute path to playwright or playwright-core>'
$env:QA_CHROMIUM = '<absolute path to Chromium executable>'
$env:QA_HERO_MODE = 'baseline'
$env:QA_DIST = '.home-hero-baseline-dist'
node scripts/qa-home-market-platform.cjs

# Build the candidate, then exercise the same profile plus all new behavior.
Push-Location frontend
npm.cmd run build
Pop-Location
$env:QA_HERO_MODE = 'after'
$env:QA_DIST = 'frontend/dist'
node scripts/qa-home-market-platform.cjs

# Standalone review preview, no Playwright required.
node scripts/qa-home-market-platform-preview.cjs frontend/dist 4198
```

The review URL is `http://127.0.0.1:4198`. The preview binds only loopback, accepts GET/HEAD only, serves deterministic fixture responses and uses CSP to block all nonlocal browser traffic. Its transport substitutes existing remote image/font fallbacks locally; application files and the production bundle on disk remain unchanged. A real browser check of this persistent preview observed the moving hero, zero browser errors and zero external requests. `GET /__hero-preview` exposes the fixture-only status.

No merge, production deployment, production account, database or financial write is part of this QA.
