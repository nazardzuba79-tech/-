# Approved Analytics design with real data

Base: `05872e14ce191438527b699f32aed8def5083c61` (fresh main, fetched again before publication).
Visual reference: `origin/analytics-mp` at `abae425895fba0d44f4e4addd2e4250ec4a9e91e`, including `_reference/V0_FINAL_REFERENCE.md`.
Candidate branch: `codex/analytics-approved-live`.

## Visual transfer and boundaries

The scoped stylesheet transcribes the approved canvas (#F3F4F5), square white panels, thin #E3E4E7 borders, gold #C08A18 accents, dark summary/regime bands, Inter typography, 1560px shell, 24px gutters and 16px grids. The existing Nav, Footer, authentication shell and every other route remain unchanged.

| Archive composition | Real implementation |
| --- | --- |
| SummaryStrips | Market cap, volume, change, dominance, sentiment; separate native VOLTEX derivatives band |
| MarketRegime | Same dark split composition with measured market change and actual readings; no invented risk classification |
| MarketNarrative | Three factual summary columns; no synthetic trading narrative or recommendation |
| LiquidationMap | Actual observed 4h/12h/24h price buckets, long/short totals, largest event, partial coverage |
| LargeLiquidationsTable | Actual recent events, timestamps, direction, execution price and USD notional |
| DerivativesPanels | Covered OI, contract funding, global/top-account/top-position ratios |
| PriceOpenInterest | Existing gateway's real hourly reference candles; current native OI; no fabricated OI history line |
| FundingRates | Contract-level rates with each reported interval and next settlement timestamp |
| StructurePanels | Native mark/index/basis, realized volatility, perpetual basis, IV and dated futures curve |
| MarketContextPanels | Real correlations, sentiment gauge, weighted sector rotation |
| FlowPanels / LiquidityStructure / synthetic scores | Hidden: no ETF/address attribution/latent liquidity sources are configured |

No imports from archive `src/data/*`, seeded values, generated liquidity walls, synthetic heatmaps or client-side provider requests. Provider metadata and unavailable-reason prose are not rendered. BTC/ETH IV and dated futures use typed sections; SOL/XRP missing sections remain dashes. USD open interest is labelled USD; BASE values carry their asset.

The asset switch retains the last coherent panel layout with its old echoed asset label while the new selection loads. The shared store queues the latest asset if a request is already in flight, discards obsolete responses, and still uses one 30-second snapshot timer.

## Validation

- Exact frontend/backend lockfile dependencies installed in the isolated worktree.
- Local Prisma type generation only; no database access or migration.
- Backend TypeScript: PASS.
- Frontend TypeScript + Vite production build: PASS.
- Focused tests: **136 passed, 8 suites**:
  - Analytics frontend contract/rendering/store: 41.
  - AnalyticsDataService.
  - Analytics API route/auth.
  - DerivedAnalytics.
  - AnalyticsSeparation.
  - LiquidationStreamService.
  - DeribitAnalyticsService.
  - MarkPriceService.
- Verifier script syntax and git diff whitespace checks: PASS.
- CI now includes the frontend contract/rendering suite and Analytics API/gateway regressions.
- One stale backend test expectation still listed the three already-implemented PR #69 sections as unsupported. Updated only that test, leaving backend runtime unchanged.

Commands:

```text
npx prisma generate
npm run build
npm --prefix frontend run build
npm test -- --runInBand --silent frontend/src/lib/__tests__/analyticsLive.test.ts src/services/analytics/__tests__ src/services/__tests__/AnalyticsDataService.test.ts src/api/routes/__tests__/analytics.test.ts src/futures/__tests__/MarkPriceService.test.ts
node --check scripts/qa-analytics-readonly.cjs
git diff --check
```

## Browser QA and its limits

The local production bundle was exercised at `http://127.0.0.1:4197/analytics`, using `scripts/qa-analytics-readonly.cjs`. This server runs the unchanged public gateway/Analytics services. It binds only loopback, accepts only GET/HEAD and cannot reach a database. Only its local identity is a fixture; **market metrics are real public responses, not fixtures**. A local POST check returned 405. No requests to trading/account/order/private provider endpoints were performed.

- Desktop 1440x1000, tablet 768x1024, mobile 390x844: panels stay within the viewport; no horizontal document overflow. Wide tables have their own horizontal scrolling; charts scale to panel width.
- BTC, ETH, SOL, XRP switch successfully and update OI/funding/basis/positioning/volatility/reference candles. BTC/ETH IV and dated futures populated; SOL/XRP showed dashes.
- 4h, 12h, 24h controls work; current local collection is explicitly partial.
- Actual BTC/ETH liquidation events arrived during observation. Example observed ETH event: 2504.46 execution price / USD75.13 notional; no event was generated locally. Initial zero-event periods showed zero totals, while unavailable largest events stayed dashes.
- Multiple 30-second snapshots arrived and displayed changing OI/volatility/funding. Timestamp/availability observations are in `public-feed-observation.json`.
- One price chart SVG per selected asset; no duplicate instances. Console inspection found no JavaScript errors.
- Unavailable native VOLTEX metrics were dashes in the local harness. Native contract values and real zero vs missing are covered by rendering/API tests, **not a production browser session**.
- Production `/analytics` redirected to login. Authenticated production comparison could not be completed without the owner's session; no credentials were requested in chat, extracted, or bypassed. Production DB/auth/backend were untouched.
- New labels have Russian and English copy; other existing locale translations remain intact and the added labels currently fall back to English.

## Missing data

1. Latent liquidation heatmap / liquidity walls.
2. ETF and labelled on-chain exchange/whale flows.
3. Historical open-interest time series.

## Publication

No merge or deployment requested. Every candidate commit uses `[CF-Pages-Skip]` so GitHub publication does not trigger a Cloudflare Pages preview deployment. This is the documented [Pages commit-message skip control](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/#skipping-a-build-via-a-commit-message). Main and production configuration remain unchanged.
