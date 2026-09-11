# Copy Trading first-load verification

2026-09-11, Codex. Baseline: current main `cf933308ce2ef7d3023fb71ef95322a0ef3fab13`. Branch: `codex/copy-first-load`. No deployment or merge.

## What changed

The authenticated marketplace request now starts at direct entry before React mounts, or when the lazy Copy Trading route starts loading. Desktop and mobile navigation intent join the same session-scoped store request. Subscribing to the route reuses a completed prefetch within the existing 30-second freshness window instead of immediately fetching again.

Nazar and Ksenia already existed as local shells on main; the fix retains these records and their keys. Their names, initials, strategy, VIP identity and profile buttons appear in the first marketplace commit. Backend-only fields use reserved skeletons/dashes, never fabricated zero values. Profiles open before the response and reserve their chart and metric layout. Hydration updates the existing cards and open profile. Owner photos become visible after decode; initials remain until then. Ksenia's follower label reserves two lines to avoid a mobile font-wrap height change.

The existing curated policy remains: Nazar, then Ksenia, precede the ordinary sorted roster on leaderboard/top-performance views. They are extracted before sorting so unavailable metrics cannot influence their curated position. Other explicit sort/filter modes retain their semantics.

No backend, Prisma, financial calculation, fee, allocation, minimum investment (10,000), canonical history, trade generation or latest-ten-trades policy changed. Existing logout/session isolation, in-flight coalescing, last-good data, partial failure handling and 60-second refresh remain. No global financial cache was added.

## Controlled browser measurements

Production frontend builds from pristine main and the candidate were served locally with the real compiled marketplace router, auth middleware and CopyPerformanceService. Only persistence and unrelated account endpoints use isolated in-memory fixtures. Canonical service calculations run in a worker so they cannot block static asset delivery. Each named run starts with a cold service; persisted canonical state is reused. No production account data or credentials are in these artifacts.

Both variants use an explicit **4,000 ms response hold plus 800 ms route-chunk hold**, no browser cache, and the same 390,671-byte marketplace payload. These are controlled slow-load measurements, **not production network latency or native browser throttling**. Times below are milliseconds from document navigation, rounded. One run per variant/viewport is reported; these are not percentile estimates.

| Measurement | Main 1440 | Candidate 1440 | Main 390 | Candidate 390 |
| --- | ---: | ---: | ---: | ---: |
| Both owner shells / all 16 cards committed | 962 | 962 | 1,000 | 955 |
| Marketplace request starts | 1,010 | 55 | 1,002 | 57 |
| Response TTFB, including explicit hold | 5,191 | 5,239 | 5,200 | 5,217 |
| Total request duration | 5,194 | 5,241 | 5,232 | 5,220 |
| Both owners' live metrics committed | 6,243 | 5,327 | 6,261 | 5,318 |
| Marketplace requests in observation window | 1 | 1 | 1 | 1 |

The gain is earlier overlap with route loading: **915 ms desktop / 943 ms mobile earlier live metrics**. Backend cold projection was approximately 1.17–1.23 seconds in these runs, dominated by Nazar's approximately 0.95–0.99 seconds. An observed warm service refresh was 8.9 ms. Backend code was not optimized in this patch; the endpoint still waits for its sections. Initial state construction in earlier discarded setup runs cost more, so these numbers are not a claim about a new production database.

| Request scenario | Main | Candidate | Evidence |
| --- | ---: | ---: | --- |
| Cold route | 1 | 1 | Browser resources above |
| Pending prefetch plus StrictMode route mount | 1 | 1 | Real React/store regression test |
| Completed prefetch, route mount 5 seconds later | 2 | 1 | Same test run against pristine main and candidate |

All 16 card DOM nodes and their order survive hydration, with no duplicate owner cards or horizontal overflow at 1440 and 390. Candidate owner width/height is unchanged across hydration. Last-pending and hydrated positions match. The final mobile test reserves the previously wrapping Ksenia label; unrelated earlier font/header settlement is recorded separately, not attributed to response hydration.

Both profiles were also opened under an 8-second response hold. Ksenia opened at 1,048 ms and hydrated at 9,312 ms: same profile node and scroll position. Nazar's corresponding raw report is included. Real React tests additionally verify both profile/header nodes survive and hydration does not call scroll-to again.

Authenticated production at `https://voltextech.net/copy-trading` was inspected. Owner images were already small 256-pixel data URLs (18,767 and 25,427 characters); this patch does not change their transport or substitute catalogue photos. The available browser API did not expose production resource timing, so **production TTFB, exact avatar decode latency and production before/after gains remain unmeasured**. Local screenshots intentionally show owner initials from the fixture. No candidate was deployed.

## Validation

- Seven relevant suites, **89 tests passed**: first-load React/store behavior, marketplace payload, performance math, marketplace summary, financial isolation, promotion and verified badges.
- Route code-splitting suite: **8 passed**. Copy deposit UX behavior: **17 passed**.
- New first-load suite: **11 passed**. Against pristine main it produces four expected failures: missing skeleton behavior in the marketplace/both profiles and the completed-prefetch duplicate request. Pending request, session isolation and retained behavior remain covered.
- Frontend TypeScript build, backend TypeScript build, production Vite build and `git diff --check`: passed.
- Browser report verifier: passed at both widths; no captured page errors or overflow.
- Existing failures retained and independently reproduced on pristine main: one unchanged CopyButton normalization fingerprint in `copyDepositUx.test.ts`; four Windows path-separator assertions in `sharedHeaderStylesheetOwnership.test.ts`. These were not rewritten or hidden. The full repository suite was not rerun; no claim is made that every existing test passes.

Run the primary suites from repository root after installing root and frontend dependencies:

```powershell
node node_modules/jest/bin/jest.js --runInBand --modulePathIgnorePatterns='[.]qa-copy' --testPathPattern='copyFirstLoad|copyMarketplacePayload|copyPerformance.test|marketplaceSummary|CopyPerformanceIsolation|CopyPerformancePromotion|copyVerifiedBadge'
node scripts/verify-copy-first-load-qa.cjs docs/qa/copy-first-load/before-1440.json docs/qa/copy-first-load/after-1440.json
node scripts/verify-copy-first-load-qa.cjs docs/qa/copy-first-load/before-390.json docs/qa/copy-first-load/final-mobile.json
```

For browser reproduction, build backend and frontend, run `node scripts/qa-copy-first-load.cjs frontend/dist 4201`, then open `http://127.0.0.1:4201/copy-trading?run=review&delay=4000&chunkDelay=800`. The loopback-only harness installs a disposable local session and exports its measurements at `/__qa/report/review` after 20 seconds. Use distinct run names for cold runs. Profiles can be checked with `delay=8000`. The scripts are QA-only and are not imported by the production application.

## Evidence

- Desktop: [pending](final-desktop-pending.png), [hydrated](after-1440-hydrated.png); [main data](before-1440.json), [candidate data](after-1440.json).
- Mobile: [pending](final-mobile-pending.png), [hydrated](final-mobile-hydrated.png); [main data](before-390.json), [final candidate data](final-mobile.json).
- Nazar profile: [pending](profile-nazar-pending.png), [hydrated](profile-nazar-hydrated.png), [data](profile-nazar.json).
- Ksenia profile: [pending](profile-ksenia-pending.png), [hydrated](profile-ksenia-hydrated.png), [data](profile-ksenia.json).

Desktop pending screenshot uses a longer hold to allow inspection. It is visual evidence, not the timed desktop comparison. The desktop comparison predates the final two-line mobile label reservation; it already measured the same two-line desktop geometry. Final mobile evidence includes that last CSS change.
