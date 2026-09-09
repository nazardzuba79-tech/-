# Copy Trading loading and performance — owner review

Branch: `codex/copytrading-loading-performance`. Base: `e51dccbc10a2ee6fe2189d9cc8b2c1daa02e0426` (current fetched `origin/main` at task start). No merge or deployment.

## Proven cause and request flow

Previously, `CopyTradingPage` started separate effects for Nazar, identities/Ksenia, and portfolio history. These requests were not a serial network waterfall. Ksenia's initial state was null, its Trader projection stayed undefined, and Marketplace built `[nazara, ...(ksenia ? [ksenia] : []), ...marketplaceTraders]`. Her card therefore did not exist until her response completed. Sorting and pagination then moved other cards and displaced the last first-page card. A local 2-second delay reproduced exactly one roster change; Ksenia appeared at 2251 ms.

Both identities now have synchronous shells and permanent first and second featured positions on the initial leaderboard. Metrics fill the same boxes. The frontend calls the additive authenticated `/api/v1/copy-trading/marketplace` endpoint. The route settles Nazar, Ksenia, and identity work concurrently and identifies failed sections independently. Individual endpoints remain available and unchanged.

Local cold strategy generation/projection is substantially more expensive than warm serialization. This is a measured contributor to response latency, but the production network/database portion of the reported 1–3-second delay was not measured. No production database was accessed. The proven cause of the late card insertion is the conditional frontend roster, not a claimed production networking diagnosis.

## Measurements

Real compiled routes, authentication and canonical services; local HTTP; in-memory database implementing the same scenario persistence interface; canonical clock fixed to 2026-09-08. Three serial samples per endpoint, including full response-body consumption. These small samples demonstrate behavior, not production latency percentiles.

| Endpoint | Before, ms | After, ms | After bytes |
|---|---:|---:|---:|
| Nazar | 723.18 / 7.54 / 8.72 | 672.67 / 5.14 / 5.29 | 371560 |
| Ksenia | 361.76 / 5.08 / 7.66 | 362.98 / 12.32 / 16.43 | 366462 |
| Identities | 6.11 / 14.54 / 15.93 | 11.43 / 3.64 / 4.09 | 248 |
| Portfolio history, 90d | 20.12 / 14.85 / 16.19 | 13.82 / 6.62 / 21.06 | 74 |
| Marketplace aggregate | N/A | 15.86 / 15.90 / 11.35 | 738342 |

The first Nazar/Ksenia sample starts with no stored scenario; subsequent samples use the existing process cache. Aggregate samples above follow the individual calls, so their strategy caches are warm. A separate aggregate request with a fresh process cache and already-persisted in-memory scenario rows took **571.15 ms**. No claim is made that the unchanged individual services became faster; sample differences include runtime noise.

Initial marketplace HTTP requests: **3 → 1**. Including the separate eligibility request: **4 → 2**. Shared application auth, support, ticker and static assets are excluded from both counts.

| Production-build browser case, 1440px | Structure, ms | Nazar values, ms | Ksenia values, ms | Roster changes |
|---|---:|---:|---:|---:|
| Before, normal | 129 | 227 | 216 | 1 |
| Before, Ksenia delayed 2 s | 153 | 227 | 2251 | 1 |
| After, normal | 354 | 776 | 776 | 0 |
| After, Ksenia delayed 2 s | 90.6 | 2189.9 | 2189.9 | 0 |
| After, both delayed 2 s | 110.2 | 2203.4 | 2203.4 | 0 |

All browser first visits start with an empty frontend memory store and a warm server strategy cache. Before used local headless Edge; after used the managed Chromium browser. Asset caches and browser drivers differ, so normal elapsed times are not an apples-to-apples speedup claim. The robust result is immediate presence of both shells and **zero response-driven roster/geometry changes**, including delayed responses. The aggregate waits for its slowest section, so the slow-Ksenia case deliberately delays Nazar's *values* too; both cards are already rendered.

On same-document navigation away and back, both last-good ROI values remained visible despite a forced HTTP 500 on revalidation. The instrumentation keeps first-document timestamps, so this is an observed retention result, not a fabricated navigation-to-paint measurement. The store tests independently prove synchronous last-good access. Focus prefetch was also exercised: values were observed 35.3 ms after the roster appeared; one intent fetch plus a later mount revalidation occurred. This is a single observation, not a statistical prefetch benchmark.

## Store, freshness and traffic

`CopyMarketplaceStore` is an injectable module singleton consumed through `useSyncExternalStore`. It stores one snapshot in memory only, scoped to the current auth token. No new localStorage/sessionStorage persistence. Login changes clear the snapshot, abort previous work, and ignore late responses from the prior session.

One in-flight fetch is shared across subscribers, focus and intent prefetch. There is one ref-counted 60-second refresh timer while mounted, with polling skipped while the document is hidden. It is removed with the last subscriber, as is the focus listener. A 15-second abort timeout bounds a stalled fetch. A 1-second guard collapses mount/focus bursts; hover/focus prefetch has a 30-second cooldown. Unrelated pages do not poll Copy Trading. Returning after the burst window revalidates without clearing values.

Runtime validation rejects malformed individual sections before projection and formatting, without numeric coercion. Last-good values and per-section `fetchedAt` survive failures. Missing data remains unavailable, including unopened Ksenia profile charts, trades and metrics. Valid provider zeros remain zeros. Economic snapshots older than the current UTC day and identities older than 60 seconds are marked stale; a reserved status line exposes stale/unavailable state, with fetched times in its tooltip. The frozen Sept 8 fixture shown in a Sept 9 browser intentionally triggers the stale label in screenshots.

## Existing backend cache — reused without changes

`CopyPerformanceService` already has a two-strategy response cache and one pending promise per strategy. Responses depend on immutable approved seeds, persisted canonical history, and the UTC day. Intraday reads reuse the projection; the next UTC day advances the persisted history and refreshes it. A waiter rechecks the day after awaiting a pending task, including a midnight crossing. Optimistic database revisions protect persisted history across processes. Clock rollback never truncates history.

No Redis, new service, new cache layer or infrastructure was added. An expired response remains stored on an error but is not represented by the endpoint as a successful current-day result; the frontend retains and labels its own last-good data. Identities remain fresh database reads because owner avatar/KYC can change within a day. Coalescing is per server process, not distributed.

**100 concurrent aggregate requests**, starting with a fresh service cache and persisted in-memory rows: **100 HTTP 200 responses in 994.36 ms; exactly 2 scenario reads**, one per strategy. Thus 100 requests do not produce 100 modeled projections per strategy. Identity/auth reads and JSON serialization still occur per request. Focused service tests separately cover both strategies' same-day reuse, midnight expiry, concurrent collapse and recovery after a failed read.

## Preserved product behavior

The $10,000 eligibility threshold and `portfolio-history?range=90d` source are unchanged. Wallet overview computes a live valuation with different semantics from the latest persisted portfolio snapshot, so it was not substituted without equivalence. Copy execution, fee values, ROI, AUM, followers, trade history, canonical engine/configuration/seeds, identity verification rules and approved avatar assets are unchanged.

Owner avatar boxes now retain their original dimensions and synchronous initials, with the same approved image overlaid only after load. Failed images cannot flash a broken icon. Loaded profile charts and metrics keep their original branches; new guards prevent Ksenia's unloaded shell from reaching demo fallbacks. Copy is unavailable until the backend supplies its fee, using the existing Nazar loading guard for Ksenia as well.

## Tests and browser QA actually run

- Backend `tsc --noEmit`: PASS. Frontend `tsc -b`: PASS.
- Production Vite build: PASS, 5670 modules; JS 1599.64 kB (gzip 519.81), CSS 337.76 kB (gzip 58.43). Existing large-chunk warning remains. The sandbox rejected native esbuild named-pipe creation with EPERM. The build used the same esbuild 0.21.5 WASM transforms in-process, actual Vite/React configuration, with the optional mapped-drive probe bypassed via `preserveSymlinks` in this npm checkout. No project dependency, lockfile or Vite configuration changed. Browser QA uses that production bundle. The ordinary native build still needs an unrestricted environment.
- Focused tests: **47/47**, across `copyMarketplaceLoading.test.ts` (28), route `copyPerformance.test.ts` (9), and `CopyPerformancePromotion.test.ts` (10).
- Complete baseline Jest from exact base: **1918 passed / 1921**, 131/134 suites passed.
- Complete final Jest: **1955 passed / 1958**, 132/135 suites passed. **37 additional passing tests; exactly the same 3 baseline failures**.
- Both baseline and final have the same expected/received hash mismatch in `walletUxRefinement` (API source) and in `nazaraCardPresentation` / `avatarIdentityPresentation` (ProfilePerformanceChart). The existing failing expectations were retained. Intentional loading-only changes receive explicit narrow normalization; other intentionally changed source fingerprints were refreshed with reasons, and new behavioral checks cover the changed paths. Canonical preservation checks pass.
- `git diff --check`: PASS.

Production browser widths **1920 / 1440 / 1366 / 1280 / 1024 / 768 / 430 / 390** all passed: same initial/final card boxes and roster, both featured cards present initially, no horizontal overflow, no JavaScript errors. Normal structure/value times at those widths respectively: 100.3/178.3, 354/776, 98.9/207, 95/186.6, 76.9/145.1, 74.7/140.8, 120.2/216.1, 124.5/265.4 ms. Both strategy values arrived together in every normal case.

At 1440: normal, slow Ksenia, slow all, Ksenia failure, Nazar failure, identities failure, all strategy failures, forced HTTP 500, malformed payload, repeat navigation with failed refresh, and focus prefetch were exercised. Missing strategies show dashes while successful peers remain populated. Card geometry and order remain stable. Normal console warning/error log was empty; forced HTTP failures may produce expected browser resource-error entries, with no application exception. Full-document CLS was 0 in the slow/failure cases and 0.001532 in the normal 1440 run; card boxes were unchanged, so this is not a zero-global-CLS claim. Repeat navigation recorded an additional tiny non-card shift (0.000002).

Evidence supplied with the handoff: `before-measurements.json`, `after-measurements.json`, `browser-qa.json`, `test-results.json`, and the requested `copy-loading-initial-1440.png`, `copy-loading-loaded-1440.png`, `copy-loading-390.png`. Mobile screenshot is a 390px viewport scrolled to both featured cards. Metrics were captured before screenshots to avoid full-page screenshot resizing artifacts.

Reproduction: install locked root/frontend dependencies; generate Prisma client; compile backend and build frontend; run the applicable Jest suite. `QA_MEASURE_ONLY=1 node scripts/qa-copy-loading.cjs after <output-dir>` measures real local HTTP endpoints without browser dependencies. `QA_SERVE_ONLY=1` starts a loopback QA server for a managed browser; visit its printed URL plus `/qa/normal` or other listed scenarios. Without either flag, the harness supports a locally installed Playwright via `QA_PLAYWRIGHT_MODULE`. It never connects to production data and rejects non-read HTTP methods.

**Business logic touched: NO. Ready for owner review: YES.** Remaining limits: three established baseline test failures, unmeasured production network/database latency, and ordinary native build verification outside this Windows sandbox. No merge. No deploy.
