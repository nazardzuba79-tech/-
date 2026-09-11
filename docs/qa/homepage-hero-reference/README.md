# Homepage hero — original reference implementation

Base: `0097d8b72ffb3c5e9f8537e4a9da267ac0586e0f` (freshly fetched `main`, including PR #29).
Implementation: `d89f741722b3ae5bb51408343721ecdc1627581d`; final motion/data correction: `e03da3269b8a42bf1fc9b75379d092c3d4751d22`.
Branch: `codex/homepage-hero-reference`. Review only: no merge or deployment.

## Result and comparison

![Reference left, browser implementation right](comparison-1920.jpg)

![1920 × 1080 viewport](desktop-1920.jpg)
![1440 × 900 viewport](desktop-1440.jpg)
![390 × 844 viewport](mobile-390.jpg)

These are actual browser captures of the production build, with received market data. The desktop app requests reduced motion from its browser; normal motion was separately verified through a local QA response transform, with no production-source changes. This transform only substitutes the media query, never data or application logic.

The screenshot API excludes the 10px scrollbar and proportionally downsamples its output (1910×1074, 1430×894, 380×822). The three export images above are resized to their requested viewport dimensions; original captures remain in the local output directory. No UI content was composited into a screenshot. The side-by-side comparison only places the owner's supplied reference beside the actual browser capture.

## Geometry and correction pass

First-pass comparison found compressed terminal columns due to stylesheet ordering, CTA ~30px too low, heading ~6% too narrow and an unwanted reserved tape gap. The correction moves the reference stylesheet last, fixes the display at 1000×680 before perspective projection, increases heading weight/width, tightens copy rhythm, removes the tape gap, and compacts the mobile layout.

Measured at the final 1920×1080 viewport (10px scrollbar): heading origin `(65.9,210.8)` vs reference approximately `(67,207)`; description y459 vs457; CTA y555.7 vs552; badges y638.1 vs632; asset group `(594,340.2)` vs approximately `(597,341)`; tape `(64,947)` vs approximately `(64,953)`. Text uses the repository font, not lettering baked into the image. The laptop silhouette starts approximately 15–18px higher than the reference while its base remains near the tape. Earth clouds/city-light distribution and small hardware details differ because the blank scene plates were derived from the reference. The composition, perspective, focal hierarchy and navy/blue/gold balance follow it closely.

Reference annotation boxes, numbers and arrows are omitted. Existing functional feature labels are used instead of asserting unverified institutional liquidity. Oil remains unavailable because the actual instrument catalog does not expose it. Its missing sparkline and price are intentional; real market truth takes precedence over reference numbers.

## Implementation and data

- A responsive WebP Earth/data-wave plate and a clipped laptop hardware plate establish the scene. A CSS `matrix3d` projects actual HTML onto the measured screen corners. The hardware image contains no prices, balances or terminal text; its source matte is excluded by a CSS polygon. It is not an alpha PNG.
- Existing public API methods supply tickers, actual 15-minute OHLC, depth, executions and reference XAU/USD quotes. The existing shared Kraken socket provides incremental live updates when the selected source is Kraken. Requests and subscription ownership stay in the homepage hooks.
- Unknown values show `—` or a localized unavailable state. Numeric zero stays `0`. No demo balances, fees, orders, synthesized candles or invented commodity prices. Last-good ticker quotes visibly disclose stale state after refresh failure.
- Eight thin SVG routes pulse over 22s; hub glow breathes over 7s; cards drift 4px over 15s; foreground light moves slowly. Pointer parallax is limited to a few pixels. Candles and price/depth flashes respond to received updates; executions retain stable keys. The tape repeats one quote group with one accessible link set.
- IntersectionObserver and document visibility pause decoration and release hero socket subscribers. Public ticker refresh remains shared with lower homepage sections; hidden tabs skip refresh. Hero snapshot/CFD work stops offscreen. Reduced motion disables decorative animation, transitions and pointer movement; tape becomes manually scrollable. Pausing the tape freezes its current transform without restarting it.
- No new dependencies, video, WebGL loop or generated frame sequence. Desktop loads 429,880 bytes of new scene images; mobile 246,632 bytes. Only one responsive Earth asset loads. New screenshot assets live under docs and are not part of the frontend bundle.

## Verification

Frontend TypeScript PASS (`node node_modules/typescript/bin/tsc -p frontend/tsconfig.json --noEmit`). Production Vite build PASS: 5,697 modules; eager JS ~418.9kB /144.4kB gzip; eager CSS ~122.8kB /25.4kB gzip. The local Windows runner uses the same Vite/React configuration with in-process esbuild WASM because child-process pipes are restricted; no repository tooling or dependencies were changed for that environment workaround.

All **49 hero tests pass** across `heroReferenceTerminal`, `homeHeroStream`, `homeHeroVisibility`, `homeLiveMarket`, `homeLiveRendering`, and `homeHeroCopy`. Coverage includes seven languages/CTA routes, unknown versus zero, actual executions/volume, stale/error recovery, stream ownership, visibility and pause behavior. An additional **76 Card preservation tests pass**. One unchanged Card production test still expects an obsolete eager App import; that assertion fails on main's lazy-loaded App, which this task does not modify. Full repository suite was not rerun. See `final-hero-tests.log` and `terminal-test-audit.md`.

Visual QA: 1920,1600,1440,1366,1280,1024,768,390 widths. At every width document scrollWidth equals clientWidth; the vertical scrollbar accounts for the 10px difference from innerWidth. Desktop copy and assets do not overlap the laptop. Tablet/mobile use text first and the laptop below; the compact 390 layout starts the product at y626 with its base near y850, continuing naturally below the fold. `responsive-contact-sheet.jpg` contains intermediate breakpoint captures.

Browser motion evidence: a route advanced from -587.878px to -126.892px; card drift and tape position changed; BTC and the leading received execution changed during the same observation. Global Pause yielded paused route/card/tape states. Offscreen: hero bottom -1296, motion inactive, route/tape paused, stream unsubscribed back to snapshot state. Tape Pause held exactly matrix translation -869.274px in two observations. Production reduced-motion verification found animation-name:none on all routes, halos, asset cards and tape. Hidden-tab ownership is covered by behavioral tests; the in-app browser kept both inspection tabs visibilityState=visible, so a browser-hidden state is not claimed.

## Asset provenance

Source: owner-supplied `ChatGPT Image 11 сент. 2026 г., 10_48_20.png`. Built-in imagegen edit mode was used with this reference, then lossily encoded to WebP. No third-party stock imagery was downloaded.

Background edit direction: retain the exact Earth camera, realistic continents/city lights, blue rim, gold lighting and lower financial-wave landscape; remove laptop, all UI/cards/logos/text/ticker/annotations/city labels and route overlays; preserve dark left copy space. Generated original: `exec-59728b8d-f054-46be-8dd2-2481930a263d.png`.

Hardware edit direction: isolate the original laptop geometry on the same 1672×941 canvas; retain premium black metal, keyboard and gold/blue reflections; replace display with blank #050c14; remove all other scene/UI/text. The requested transparency came back as an RGB matte, so the implementation clips it in CSS. Generated original: `exec-4f0dfdc9-d11c-4165-94aa-f59292761ccd.png`.

Delivered assets: `frontend/public/hero/earth-market-reference.webp`, `earth-market-reference-mobile.webp`, `laptop-reference.webp`. The original generated PNGs remain under the local Codex generated_images directory and are not bundled.

## Review and publication

Local production preview: http://127.0.0.1:4184/ . Normal-motion QA only: http://127.0.0.1:4185/ . These require the local preview processes; there is no hosted branch deployment for this task.

Every new published commit begins `[CF-Pages-Skip]` under Cloudflare's documented commit-message skip mechanism. The remote branch is created only at its final skip-marked tip. Repository workflows do not deploy this branch. No hosting configuration was changed.

Scope: see `changed-files.txt`. App/auth/routes, backend/DB, execution/economics, Futures/Copy/Wallet/Analytics/Card/KYC and the lower homepage components remain unchanged relative to the fetched main. Earlier unmerged homepage variants and PR #28 remain separate.
