# PR480 visual correction — owner approval required

This is a **Draft / visual review**, not a release. Do not merge or deploy without
the owner's separate visual approval. PR480's published appearance was rejected.

## Provenance and scope

- Fresh main base: `b607fd68d997ecdda00217215c704c7a9dd72848`.
- Owner ZIP on disk is named `Дезайн головного.zip`, not `(1)`; its SHA-256
  matches the specified archive exactly:
  `1d58e8a6ec9bef34f3c0f9929dcb401d944f768c91a9aa6efe7c456af6cb4d68`.
- `reference.png` is the archive's unchanged `public/images/voltex-reference.png`.
- The existing Sapphire background is no longer used by this Hero.
- `frontend/public/hero/v0-reference-clean.png` is a built-in imagegen **edit of
  that reference**, removing baked navigation, text/CTA, ticker, coin faces and
  screen UI. It is not a newly composed scene. Original edited output is kept
  locally; no existing source photograph was overwritten.
- Background edit prompt: remove only baked UI and eight coins; retain exact
  1619×971 framing, globe, laptop, platform, orbit lights, reflections and palette;
  blank only the inner laptop screen; no replacement text, prices or objects.

## Geometry and comparison method

The reference header occupies y=0..60 and tape starts at y=876. Both are replaced
by existing functional components, not raster controls. Compare the decorative
Hero crop `[0,60,1619,816]` against the browser Hero **at the same scale**.
Full-page captures are also kept, with the real unchanged header and ticker.

- Globe, laptop, lighting and original pedestal are part of the cleaned plate.
- The redundant WebGL pedestal/beam was removed (and cannot cover the laptop).
- Eight coin centers/radii are taken verbatim from archive `coin-layout.ts`.
  Automated browser measurements check all 24 geometry values at 1920,1440,1366
  within 1 CSS pixel, including the actual displayed canvas alignment.
- Real terminal is projected onto measured reference screen corners:
  `(948,349),(1573,306),(1545,753),(899,724)`.
- Header height, live terminal content, actual prices and unavailable quotes
  intentionally differ from painted reference UI. Missing data is `—`.
- Comparison is geometric/visual, **not a claim that all raster pixels are equal**.
  Inpainted orbit background and permitted neutral corporate symbols differ.

## Medallion artwork and rights

Local SVG face textures replace canvas text discs. Bounded 256² textures, metal
gradients, relief glyphs, lathe rings and physical 3D cylinders/bevels are used.
No category labels are painted inside the coins. The same local artwork is the
WebGL-unavailable fallback. No image CDN or new quote requests are introduced.

BTC/ETH vector paths come from the primary upstream
[spothq/cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons),
published under [CC0-1.0](https://github.com/spothq/cryptocurrency-icons/blob/master/LICENSE.md).
Gold bars, oil drop, flag, index and processor/hexagonal ticker emblems are local
neutral illustrations. Apple/NVIDIA and other corporate logo permissions were
not established, so their official marks were **not** copied or invented.
These symbols do not announce trading availability or brand endorsement.

## Preserved behavior

24-instrument deterministic cycle; 8 desktop / 4 compact mobile slots; real
existing Spot/CFD snapshot owner; Pause/Play; reduced motion; hidden/offscreen
pause; cleanup/context-loss fallback; original Header, Login/Register, routes,
market tape, seven localized copies, lower homepage sections and financial code.

## Reproduce

```sh
npm ci --ignore-scripts
npm --prefix frontend ci --ignore-scripts
node node_modules/jest/bin/jest.js --runInBand --testPathPattern=frontend/src/lib/__tests__/home
npm --prefix frontend run build
HOME_QA_PLAYWRIGHT=/path/to/playwright node scripts/qa-home-v0.cjs
HOME_QA_PLAYWRIGHT=/path/to/playwright HOME_V0_REFERENCE=docs/qa/home-v0-reference-correction/reference.png node scripts/qa-home-v0-reference.cjs
```

Both browser harnesses block external requests and use local fixtures, never
production transactions. Screenshot prices are test fixtures, not live prices.
Exact-head CI retains full browser evidence. Paired performance uses the built
PR480 baseline and corrected build on the same Chromium software renderer;
it is not physical mobile/GPU telemetry.

## Verified results (2026-10-08, local candidate)

- Frontend TypeScript + Vite build PASS. 15 homepage suites / 173 tests PASS.
  Existing >500 kB bundle and React SSR `fetchPriority` warnings are retained;
  they are not new browser exceptions.
- Real Chromium: 1920 / 1707 / 1440 / 1366 / 1024 / 768 / 430 / 390 / 360 / 320;
  seven languages at desktop and 320; no document horizontal overflow.
- All 24 instruments observed on both desktop and mobile without duplicates or
  additional quote requests. Pause/Play, reduced-motion, hidden/offscreen pause,
  remount and forced WebGL-loss fallback verified. CTA route targets and real
  Login/Register forms remain available. No financial operation submitted.
- No browser exceptions or unexpected console errors. Network-denied fixtures
  deliberately block the existing external Google font/asset CDN; these blocked
  resource messages are retained in `browser-report.json`, not called app errors.
- `comparison-*.png`: LEFT unchanged reference crop, RIGHT actual running Hero,
  both displayed at identical geometric scale. `desktop-*.png` shows the original
  working header/tape too. `alignment.json` contains all measured coordinates;
  all coin center/diameter errors are below 0.1 CSS px, and the actual WebGL canvas
  matches the measured slot bounds. This does not mean pixel-identical artwork.
- `home-mobile-hero.png` shows the compact composition. Individual 430/390/360/320
  viewport captures and full responsive measurements are retained alongside it.
- Clean reference plate: 1,880,639 bytes; renderer remains lazy-loaded, bounded
  256-square local textures, no animation-triggered API requests. Only intersecting
  coins are submitted during partial redraw; redundant platform geometry removed.

Paired medians (3 samples each, 6-second warm window, same Chromium/SwiftShader):

| Metric | PR480 desktop → correction | PR480 mobile → correction |
| --- | --- | --- |
| Page FPS | 59.95 → 60.07 | 59.86 → 59.86 |
| Main-thread task time | 1.199s → 1.071s | 0.825s → 0.736s |
| JS heap | 10.33MB → 9.49MB | 9.81MB → 9.74MB |
| Warm tasks >50ms | 0 → 0 | 0 → 0 |
| Cold terminal ready | 1301ms → 1496ms | 1279ms → 1440ms |
| LCP | 496ms → 500ms | 400ms → 472ms |
| CLS | 0.000009 → 0.000058 | 0.000038 → 0.000179 |

Warm animation CPU is lower; cold readiness is modestly slower. These local
fixture samples are not a claim of field Core Web Vitals or physical GPU speed.
The paired harness now waits for **both** baseline and candidate WebGL readiness;
the earlier baseline initialization race is not counted as a successful sample.

Exact-head GitHub checks must pass on the final pushed commit. Green CI does not
authorize merge/deploy: the owner's separate visual approval is still required.

### Pre-existing header limitation, deliberately not changed

At 320px the existing Header clips its registration CTA/menu (CTA right edge
332.156px; menu x=340.156px). Paired fresh baseline/candidate browser measurements
are identical for every visible header link/button. Hero document overflow is 0,
but that does **not** imply the unchanged Header is perfect at 320px. Fixing the
Header would be a separately scoped change; this correction preserves it as asked.
