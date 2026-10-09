# Hero SVG orbit — owner revision, review only

This supersedes the earlier 24-assets-taking-centre proposal in Draft PR #485. The owner's latest request is a dominant BTC surrounded by seven named markets: ETH, AAPL, NVDA, XAU, WTI, EUR/USD, US500. The full 24-entry quote roster and quote-domain helpers remain unchanged; this is presentation only.

## Cause and correction

Production still has the old static-slot implementation; PR #485 has never been merged. The previous review implementation physically moved its meshes, but smoothstep between anchors decelerated to zero at every anchor. Embossed pseudo-logo illustrations also obscured brand identity.

The revised scene has eight stable local SVG identities. Apple/NVIDIA use recognizable Simple Icons paths; BTC/ETH retain the sourced CC0 glyphs without decorative plates. Bullion, barrel/drop, currencies and index bars are honest neutral pictograms, not fabricated company logos. Provenance: frontend/public/images/home-v0/asset-icons/SOURCES.md.

One requestAnimationFrame clock writes only translate3d/rotate/scale to eight DOM layers at at most 30fps. Each satellite has its own ellipse, phase and bounded speed modulation. Base circulation takes 28s; modulation periods differ per asset, so they remain spaced rather than lapping and obscuring each other. BTC remains dominant with a small central float. There are no keyframe stops, texture changes, per-frame React updates, WebGL context or GPU resource allocations.

Initial SVGs are readable before effects mount. IntersectionObserver, visibility and reduced-motion handlers control the same loop. Resume excludes paused wall time; unmount cancels RAF and both observers/listeners. Ordinary users see automatic motion. No pause control was added.

The background, globe, laptop, terminal, text, links and lower homepage remain unchanged. Mobile scene height now accommodates a real orbit instead of a single row.

## Reproduce

All browser checks use loopback read-only fixtures and deny external requests. No production writes, credentials, fake market data in application code, or added quote polling.

- node node_modules/jest/bin/jest.js --runInBand --testPathPattern=frontend/src/lib/__tests__/home
- npm run build --prefix frontend
- node scripts/qa-home-v0.cjs
- node scripts/qa-home-v0-motion.cjs
- HOME_V0_REFERENCE=docs/qa/home-v0-reference-correction/reference.png node scripts/qa-home-v0-reference.cjs
- HOME_QA_BASELINE_DIR=<previous PR build> node scripts/qa-home-v0-performance.cjs
- Repeat performance with --mobile.

HOME_QA_PLAYWRIGHT can select an installed module. CI uses full bundled Chromium via HOME_QA_BROWSER_CHANNEL=chromium and install --no-shell, without changing resource budgets.

Responsive QA checks every satellite's actual screen displacement, nine widths including 1920/1440/1366/430/390/360/320, seven languages, loaded icons, overflow, reduced motion, hidden/offscreen pause/resume, eight route unmounts with stopped RAF and bounded post-GC heap, and real login/register forms.

Motion QA records 34 unaccelerated seconds, actual PNG pixel differences, 0/.5/1/2/3/5/10/20/32/34 screenshots, every asset's coordinates, moving quote attachment and BTC dominance. Canvas absence is asserted: WebGL context loss can no longer freeze this scene.

CI uploads reports/video/screenshots as exact-head artifacts. The preserved reference comparison checks the unchanged backdrop, copy and laptop ordering; old fixed-medallion coordinates are deliberately not the new visual contract.

No merge/deploy. Owner visual approval remains required.
