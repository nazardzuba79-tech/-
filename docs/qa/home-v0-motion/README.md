# Hero physical orbit — review only

Base: 5db75c5fb29870b38624db265503531fe943f024. No production publication is authorized. Owner must review the real animation before merge/deploy.

## Root cause

- The former renderer attached eight groups to fixed X/Y anchors and exchanged front/back maps. Its 3px bob was not orbital movement.
- The 1.6s slot scheduler revisited the centre every 12.8s. With 24 instruments and eight fixed slots, only BTC/SOL/DOGE reached the centre, even though the old all-visible-roster test passed.
- Context loss disabled the renderer permanently: there was no context-restored listener.
- Baseline browser evidence: all eight slot displacements were 0px; real loss/restore left ready=false, active=false with normal motion enabled.

## Change

Each of the 24 identities owns a permanent textured mesh and DOM quote. A single active-time clock moves X/Y/Z, perspective scale and restrained rotation along the original anchors. Each asset reaches centre every three seconds; the full period is 72s. At most eight desktop/four mobile objects are visible. Hidden roster members enter/exit through the rear gate. Quotes follow their objects; rear labels fade behind nearer medallion faces.

All moving geometry is redrawn transparently, without retained scissor rectangles. The renderer retains its 30fps limit, DPR caps (desktop 1.5/mobile 1), lazy visibility startup and GPU disposal. Restoration preserves phase and still obeys offscreen/hidden/reduced-motion guards. Responsive remounts reset label DOM so old desktop visibility cannot leak into mobile. The Hero medallion Pause/Play control and its CSS are removed; unrelated ticker-tape controls remain unchanged.

No artwork, text, CTA, lower-page content, data sources or pricing logic changed. Quote helpers are byte-identical after line-ending normalization. Approved background SHA256: d88c656c6f8ef003428f344a238cee525abb6969f8927c4a535da6b21fc7836a.

## Reproduce and review

All browser scripts serve loopback fixtures, deny external traffic and perform no production writes. Prices in recorded browser evidence are isolated QA fixtures, never production code. Missing stock quotes remain an em dash.

Set HOME_QA_PLAYWRIGHT to an installed Playwright module if not on the default module path.

- node node_modules/jest/bin/jest.js --runInBand --testPathPattern=frontend/src/lib/__tests__/home
- npm run build --prefix frontend
- node scripts/qa-home-v0-motion.cjs
- node scripts/qa-home-v0.cjs
- node scripts/qa-home-v0-reference.cjs
- HOME_QA_BASELINE_DIR=<fresh main build> node scripts/qa-home-v0-performance.cjs
- Repeat the paired performance command with --mobile.

The motion script records an unaccelerated 75+ second video, 26 centre samples (BTC through all 24 and continuation), 0/3/10s screenshots, actual WebGL pixel differences and context restoration. It does not accelerate RAF. Coordinate assertions cover BTC and a side medallion; screenshots/video independently show the actual objects. Local complete-cycle run: 75.663s, 42.84% of WebGL-layer pixels changed from 0s to 3s; context loss/recovery preserved phase and respected reduced motion. TypeScript/Vite and 176 Homepage tests passed locally.

The responsive script covers 1920/1440/1366/430/390/360/320 plus intermediate widths, seven languages, offscreen/hidden/reduced-motion, full mobile cycle, eight route remounts, bounded post-GC heap, login/register, fallback and restoration. The deliberately missing global-summary fixture already retries every 60 seconds; the long-cycle check permits only that existing retry, never quote requests from the animation. The reference script still checks all eight approved anchor coordinates at reduced-motion time zero.

CI uploads output/home-v0/{updated,reference,motion} as an exact-head artifact. Paired performance reports live in output/home-v0/performance*.json; compare medians from alternating baseline/candidate runs with both scenes actively rendering. SwiftShader figures are software-browser evidence, not physical GPU/mobile certification. Existing large-bundle and React SSR fetchPriority warnings are outside this change.
