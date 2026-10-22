# Hero three-ring revision — review only

The owner rejected the eight-asset proposal from merged PR #485 and clarified the new count: **20 distinct assets total**, including the central BTC. Desktop has BTC plus rings of 6/6/7; mobile has BTC plus 3/4/4 (12 total).

## Implementation

- Three concentric ellipses complete uninterrupted revolutions in 14, 19 and 25 seconds. The middle ring moves in the opposite direction. Equal angular spacing prevents bunching. The BTC centre stays fixed and larger.
- One existing active-time RAF updates only DOM transforms at 30 fps. Logos stay upright. No WebGL, canvas, Lottie, dependency, timer or quote polling was added. Reduced-motion, hidden-tab and offscreen pauses retain their cleanup/resume behavior.
- Resize uses fractional bounding width so SVG guides and DOM assets share the exact same centre; clientWidth rounded it by a fraction of a pixel.
- Twenty local SVG files use recognizable brand paths and neutral market symbols. Sources and license/trademark notes are in frontend/public/images/home-v0/asset-icons/SOURCES.md.
- Satellite tickers sit inside their badges, avoiding twenty overlapping external price labels. BTC retains its existing quote. All quote mapping, domain/status guards and the full original quote roster are unchanged.
- Background, globe, laptop, left copy/CTAs, other homepage sections and financial/backend behavior are preserved.

## Reproduce

All browser checks use loopback read-only fixtures, deny external requests, and record real time (no clock acceleration or simulated animation evidence).

- node node_modules/jest/bin/jest.js --runInBand --testPathPattern=frontend/src/lib/__tests__/home
- npm run build --prefix frontend
- node scripts/qa-home-v0.cjs
- node scripts/qa-home-v0-motion.cjs
- HOME_V0_REFERENCE=docs/qa/home-v0-reference-correction/reference.png node scripts/qa-home-v0-reference.cjs
- HOME_QA_BASELINE_DIR=<eight-asset-build> node scripts/qa-home-v0-performance.cjs
- Repeat performance with --mobile.

Set HOME_QA_PLAYWRIGHT to the installed Playwright module when needed. CI uses full Chromium. Screenshots, the real-time video, continuity samples and JSON reports are retained as an exact-head Actions artifact.

The browser gates check 20/12 unique loaded assets, 6/6/7 and 3/4/4 ring counts, visible first-second movement, every satellite completing a full revolution, continuous direction/spacing, upright logos, no badge collisions or clipping, nine viewport widths, seven languages, lifecycle cleanup and bounded post-GC heap. Unit tests additionally sample the full 6650-second relative-phase cycle.

Performance runs alternate baseline and updated builds on the same host and browser without changing resource limits. Mobile results mean viewport emulation; they do not certify physical phone hardware.

No merge, production deploy or production runtime changes are authorized.
