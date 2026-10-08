# Sapphire circular market orbit — PR #473

The market sidebar is replaced by round ceramic/metal medallions on a compact perspective arc. The material reference is the **“One platform. 400+ global assets.”** scene observed on [Bybit](https://www.bybit.com/en/) on 2026-10-07. The original local licensed logos remain byte-identical; the circular presentation uses CSS.

Implementation commit: `c4b312ef5f1040b861db80c2dd585f29c5bd49da`.
Rejected-column baseline: `e4aeed256341b9c25063f90f4940c7ee22039cd6`.
Fresh main: `2f195cbe2f0f1c7ee31e2c9e887f7449a18cf34b`.
The current review HEAD and its CI status are recorded in [PR #473](https://github.com/nazardzuba79-tech/-/pull/473); older CI results do not validate the new HEAD.

Five coins are visible on desktop and at most three on mobile, including during transitions. The central coin is 1.5–1.7 times larger than its neighbours. All seven assets take the centre once in a 28-second cycle: a three-second hold and one-second transition. Sequential opacity fades hide the wrap and prevent a fourth mobile neighbour.

Only finite positive, fresh shared quotes render. Missing, malformed, sampled, closed or stale quotes have no price node and no repeated unavailable label. A stale BTC hero override falls back to the fresh shared ticker. Seven compositor animations retain hover/focus/manual, offscreen, hidden-tab and reduced-motion pause, with unmount cleanup and the queued-observer disposal guard.

## Evidence

All eight widths were visually reviewed by Codex. Desktop compositions clear the headline, CTA and laptop. Mobile places a compact 150px scene after the existing CTA and shortcuts.

| Desktop | Mobile, full hero |
| --- | --- |
| [1920](home-1920.png) | [430](home-430.png) |
| [1707](home-1707.png) | [390](home-390.png) |
| [1440](home-1440.png) | [360](home-360.png) |
| [1366](home-1366.png) | [320](home-320.png) |

[Actual 29-second browser recording](market-orbit-cycle.mp4) includes the full 28-second cycle. Prices in the screenshots and recording are deterministic QA fixtures. They are not production price claims.

[Current measurements](orbit-measurements.json): 38 browser cases / 15 checks PASS; four focused suites / 83 tests PASS; frontend TypeScript and production build PASS. Existing laptop-first-load and snapshot-reload checks also PASS. Browser/console errors, unknown API paths, denied egress and writes: **0**.

The same-environment fresh e4 baseline at 1440 and 390 has exactly the same market request paths as the candidate. Shared market hook, original Sapphire mount/style/art, headline/copy/CTA, terminal, tape, manifest and all seven SVGs are unchanged. No backend, Worker, listing, financial logic or production configuration changes.

## Bundle delta versus exact e4 baseline

Both source trees were built using the same local runtime and dependencies. Aggregate emitted JS gzip: **+72 bytes**. Aggregate CSS gzip: **−153 bytes**. Combined delta: **−81 bytes gzip**. Raw JS: −58 bytes; raw CSS: −411 bytes. Logo assets are unchanged. This is a bundle measurement, not a runtime CPU claim.

Static screenshot profiles use reduced motion. The active diagnostic ran during video recording and is not directly comparable to the non-recorded baseline; no CPU reduction or production Web Vitals claim is made. The unchanged main application produces the existing large-chunk build warning, and the legacy SSR copy test produces its existing `fetchPriority` warning.

`measurements.json` retains the prior column iteration; use `orbit-measurements.json` for this revision. Full local raw reports and compositor traces are under `output/home-market-platform/orbit-final/`.

## Changed implementation and QA files

- `frontend/src/pages/home/HomeMarketPlatformHero.tsx`
- `frontend/src/pages/home/home-market-platform.css`
- `frontend/src/pages/home/marketPlatformMotion.ts`
- `frontend/src/lib/__tests__/homeMarketPlatform.test.ts`
- `scripts/qa-home-market-platform.cjs`
- `scripts/qa-home-laptop-first-load.cjs`
- `scripts/qa-home-snapshot-reload.cjs`
- QA evidence in this directory and the existing first-load/reload report directories; append-only `docs/AI_HANDOFF.md` entry.

Review only. No PR merge or production deployment.
