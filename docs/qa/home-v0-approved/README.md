# Approved v0 homepage Hero

Owner-authorized frontend release, based on fresh main `824a91327a885e765656d87d01aeb593f2226741`. Does not merge the rejected PR #473 or the separate wallet PR #478.

## Source and scope

- Owner ZIP SHA-256: `1d58e8a6ec9bef34f3c0f9929dcb401d944f768c91a9aa6efe7c456af6cb4d68`.
- Adapted its eight-position medallion cluster, 24-instrument roster, metallic texture/rim treatment, staggered flips and three-level illuminated pedestal to the existing React/Vite homepage.
- The archive's full reference bitmap embeds a header, copy, prices and fake terminal controls. It is **not** used as a replacement page. The existing compatible globe/laptop artwork `sapphire-refined.png` and its real projected `SapphireTerminal` remain unchanged. Artwork SHA-256: `bbee1ce36198e2a1f7e025706add1abe6bd9259248ed8fe00e7727129b5cc16b`.
- No new market feed, timer, WebSocket, per-coin price request or trading catalogue. Quotes come only from the existing `useHomeMarket` snapshot. Spot and CFD domains remain distinct. Stocks and absent catalogue instruments show `—`, not demo prices or invented availability.
- Neutral locally rendered ticker engravings replace the archive's improvised corporate artwork; official logo rights were not established. This is the owner's explicitly permitted fallback. No external logo service is added.
- Header, seven localized copies, Router links, real terminal/book/chart/trades, tape and all lower homepage sections are preserved. No auth, wallet, trading, Admin, backend, database, Worker or deployment configuration changes.

## Reproduction and evidence

1. `npm ci` and `npm ci --prefix frontend`.
2. `npm run build --prefix frontend`.
3. `node node_modules/jest/bin/jest.js --runInBand --testPathPattern=frontend/src/lib/__tests__/home`.
4. Install Playwright in a disposable location; set `HOME_QA_PLAYWRIGHT` to its package directory, then `node scripts/qa-home-v0.cjs`.
5. For paired performance, place an unchanged main frontend build in `output/baseline-dist`; run `node scripts/qa-home-v0-performance.cjs`, then repeat with `--mobile`.

All recorded QA here uses deterministic fixtures with unknown API calls and external traffic denied. Screenshot prices are **test fixtures, not evidence of live production quotes**. Login/Register are opened without submitting credentials. Existing blocked external font/icon requests and anonymous 401s are recorded separately from JavaScript exceptions.

Browser matrix: 1920, 1707, 1440, 1366, 1024, 768, 430, 390, 360 and 320 px; all seven languages at desktop and 320 px. Assertions cover horizontal overflow, broken local images, desktop eight/mobile four slots, all 24 instruments on both full cycles, no duplicates or animation price requests, reduced motion, manual pause, offscreen pause, route remount and real WebGL context loss. Hidden-tab handling is tested by a deterministic visibility-state fixture, not claimed as an OS/minimized-window test.

Representative captures: [main before](before-1440.png), [updated 1440](home-1440.png), [updated 1920](home-1920.png), [mobile](home-mobile-hero.png), [WebGL fallback](home-webgl-fallback.png), [complete rotation video](rotation-cycle.webm). Full responsive/locale results: [browser report](browser-report.json). CI retains every screenshot/video on the exact tested PR head.

## Performance

Same-machine Chromium/SwiftShader, three baseline and three updated samples per viewport; six-second warmed samples. This is software WebGL, **not physical GPU or low-end phone telemetry**. `coldReadyMs` includes navigation to network idle and terminal readiness; it is not a pure first-data timestamp.

| Metric (median unless range) | Desktop main → updated | Mobile 390 main → updated |
| --- | --- | --- |
| LCP | 308 → 328 ms | 244 → 244 ms |
| Network-idle + terminal ready | 866 → 1026 ms | 881 → 1042 ms |
| Page RAF FPS | 59.89–60.11 → 59.67–60.00 | 59.96–60.03 → 59.93–60.00 |
| Main-thread task time / 6 s | 0.471 → 1.276 s | 0.073 → 0.743 s |
| JS heap | 6.49 → 9.19 MB | 6.98 → 10.67 MB |
| Warm long tasks | 0 → 0 | 0 → 0 |

Full samples, including cold long tasks: [desktop](performance.json), [mobile](performance-mobile.json). The 3D scene is not free: software rendering increases CPU and heap. Partial redraws keep unchanged coins/platform in the buffer; only the active coin area is redrawn, capped at 30 FPS with idle holds. The page/terminal remain at their own refresh rates. No per-frame React or DOM updates. Final antialiasing retains clean ring edges.

Three is lazy-loaded only when the scene is visible. Its chunk is about 133.1 kB gzip; total emitted JS increases about 134.2 kB gzip, while initial entry increases about 1.1 kB gzip. CSS increases about 0.8 kB gzip. No new raster bytes. The existing Vite large-chunk warning is retained, not suppressed.

Textures: 24 bounded 256×256 medallions plus a 128×128 glow, nine geometries. Estimated RGBA texture storage including mipmaps is about 8.1 MiB, excluding framebuffer/driver overhead; actual VRAM is not exposed by this browser. Context loss immediately reveals static medallions and cannot restart a broken renderer. Unmount releases RAF, observers, listeners, textures, geometry, materials and the WebGL context.

## Release gate

Local frontend build and home regression tests pass. Full frontend baseline implementation run: 4,032 tests / 234 suites passed; the final exact-head CI must rerun the current tests before merge. Build reports the known large-chunk warning; SSR tests report the existing React `fetchPriority` warning. No production claim is made by these fixture captures. After green review/CI, the owner's instruction authorizes one normal merge and its Cloudflare Pages frontend deployment; public asset fingerprints and functional read-only checks must then be verified separately.
