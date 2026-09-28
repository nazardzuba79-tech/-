# NRX / NEURIX — review only

Base: `9511ce037993d65fa375da6a4bc5d1c5675922ad` (fresh `origin/main`).
Branch: `codex/nrx-investor-market`.
Primary implementation commit: `4091253a8035684a2ed431e90f7b92388dc27eb6`; review follow-up confines GET/HEAD redirects to public market routes.

The owner clarified that this is a prototype presentation for informed early-stage investors. Generated public market activity is not an execution ledger or evidence of customer trading.

## Market and account boundaries

- NEURIX / NRX / NRX/USDT; initial price **0.80 USDT**.
- Listing: **03.10.2026, 13:00 UTC / 16:00 МСК**. Edge/server time is authoritative. Query-string clocks cannot list production early.
- Existing `voltex-market-edge` now bundles the **same** VTA simulation and depth modules. No copied growth formula, external NRX venue, database binding, scheduled handler, cron or background market generator.
- NRX metadata/state, ticker/statistics, candles, order book and completed-tick tape go directly to `https://market.voltextech.net`. No Render or venue fallback on an edge error. Render redirects legacy NRX public URLs to the edge without generating the market. VTA's existing Render endpoints and listing configuration are preserved.
- Rendering and browser refreshes are demand-driven. An unlisted NRX store sleeps until the listing boundary; open terminal data uses the existing active-view cadence. This does not add a backend polling job.
- The normal Spot form, order families and account APIs remain in use. Its one guard exception lets listed NRX reach the standard backend instead of inheriting VTA's private-sale restrictions. No custom NRX order form or forced BUY refusal.
- **Matching still uses actual resting Spot orders. Display depth/tape is not executable liquidity.** No bot orders, artificial fills, counterparty funds or guaranteed sale proceeds are created. A market BUY with no real ask retains the standard no-liquidity response; normal insufficient-balance handling applies when reserving funds.
- Render still owns authenticated balances, placement/cancellation, conditional triggers and settlement. Conditional NRX reference prices use the same canonical simulation locally, not client prices or venue tickers. The existing conditional-order watcher is reused unchanged apart from price routing.
- Futures, liquidation, margin, funding, matching-engine source, VTA sale accounting, schema and deposit/withdrawal support are not changed. NRX does not gain withdrawal or Futures-collateral support.

## Owner allocation — NOT executed in production

The latest owner instruction selected the **ordinary Spot ledger**, not a separate demo balance.

`allocateNrxOwner(db, verifiedOwnerId)` is an explicit maintenance function, not an HTTP endpoint, startup task, registration hook or migration. It prepares **31,250 NRX** in `Balance`; `31,250 × 0.80 = 25,000 USDT` initial valuation. It never debits/credits USDT. The value subsequently follows the canonical NRX price and is not a USDT cash credit or guaranteed redemption value.

The transaction requires an existing ADMIN owner ID, takes an advisory lock, uses a single global allocation receipt, rejects unexplained existing NRX inventory, and is idempotent under concurrent/repeated calls, including after inventory has been traded. An allocation for a different owner requires manual review. No user ID or production connection is guessed.

The ordinary wallet values prelisting inventory at the configured listing price and live inventory at the canonical price. An external token with a colliding ticker cannot override NRX valuation. Existing VTA account scope is not merged into this real Spot balance.

**Production allocation remains pending explicit approval and a verified owner ID.** Tests created the exact balance only inside a new disposable loopback PostgreSQL cluster. Ksenia was not seeded: the copy-trader identifier is not sufficient evidence of an account identity; no production user lookup was performed.

## Verification

- Backend TypeScript build; frontend TypeScript and production Vite build passed. Existing >500 kB chunk advisory remains.
- 261 targeted unit/preservation tests passed in 19 suites: NRX, VTA simulation/depth/API, normal Spot orders and conditional orders, wallet pricing, matching engine, private VTA/DemoTrading, mobile layout, Futures header/API/book preservation, and Copy Trading critical path/CI coverage. Existing API/book fingerprints remain pinned; only the explicit NRX transport branches and optional book title are normalized out. Public GET/HEAD redirects do not intercept account routes.
- All **8** disposable PostgreSQL integration tests passed (269 Jest tests total). They cover exact allocation/no USDT debit/no airdrop, concurrency/idempotency, denied allocations, ordinary insufficient balances, actual counterparty matching, prelisting rejection, standard conditional/OCO handling, and a real conditional-trigger settlement against a funded resting order.
- Initial PR CI exposed the optional book-title fingerprint and a missing import-coverage path. The follow-up preserves the existing fingerprint, adds the NRX path to both Copy regression triggers, and makes the coverage parser CRLF-safe; no Copy/Futures business logic changed. These guards now pass locally and are included in the NRX workflow. Final remote CI status must be checked separately before any release.
- Actual bundled Worker runs in an edge-like runtime with all network IO forbidden. NRX metadata, boundary, candles, book, tape and ticker pass; no Node environment/Prisma dependency is bundled. Existing market-edge contract script also passes.
- Browser QA uses the production frontend bundle plus the real NRX handler with an injected **local-only** clock. All outside network requests and WebSockets are blocked, account data is fixture-only, and the single ordinary Spot submission at each width returns a synthetic insufficient-balance response. It creates no real account/order/deposit.
- 1440/390 QA checks Markets, exact listing time, standard BUY/SELL/form, real server-boundary transition without reload, visible canonical chart/book/tape, normal localized insufficient balance, no horizontal overflow, no page exceptions and no visible demo/test wording. Later chart screenshots advance the fixture to six hours after listing; they are not production screenshots.

Evidence: [browser report](qa/nrx-market/report.json), [Markets](qa/nrx-market/markets-1440.png), [before listing](qa/nrx-market/before-1440.png), [after listing](qa/nrx-market/after-1440.png), [mobile](qa/nrx-market/after-390.png), [tape](qa/nrx-market/trades-1440.png).

## Release restrictions

Merged: **NO**. Deployed: **NO**. Production data changed: **NO**.
Owner seeded allocation executed in production: **NO**.
External venue dependency added for NRX: **NO**.
Customer-visible demo wording present in verified NRX surfaces: **NO**.

This is a review PR, not a live listing. Edge endpoints and frontend routing must be published together only after owner approval. The Cloudflare deployment workflow remains explicitly gated; no deployment was triggered. Run the separately approved allocation only after verifying the owner account. Do not represent the reviewed implementation as already operating in production.

## Exact changed files (including QA evidence and handoff)

- `.github/workflows/copy-trading-card-regression.yml`
- `.github/workflows/deploy-market-edge.yml`
- `.github/workflows/nrx-market.yml`
- `docs/AI_HANDOFF.md`
- `docs/NRX_REVIEW.md`
- `docs/qa/nrx-market/after-1440.png`
- `docs/qa/nrx-market/after-390.png`
- `docs/qa/nrx-market/before-1440.png`
- `docs/qa/nrx-market/before-390.png`
- `docs/qa/nrx-market/boundary-1440.png`
- `docs/qa/nrx-market/boundary-390.png`
- `docs/qa/nrx-market/markets-1440.png`
- `docs/qa/nrx-market/markets-390.png`
- `docs/qa/nrx-market/report.json`
- `docs/qa/nrx-market/trades-1440.png`
- `frontend/src/assets/neurix-icon.svg`
- `frontend/src/assets/neurix-logo.svg`
- `frontend/src/assets/neurix-monochrome.svg`
- `frontend/src/components/CryptoIcon.tsx`
- `frontend/src/components/NrxBookTabs.css`
- `frontend/src/components/NrxBookTabs.tsx`
- `frontend/src/components/OrderBookPanel.tsx`
- `frontend/src/components/OrderForm.tsx`
- `frontend/src/components/TestMarketTerminal.tsx`
- `frontend/src/lib/__tests__/futuresTickerHeader.test.ts`
- `frontend/src/lib/__tests__/futuresUiPolish.test.ts`
- `frontend/src/lib/__tests__/copyTradingCiCoverage.test.ts`
- `frontend/src/lib/__tests__/nrxMarket.test.ts`
- `frontend/src/lib/__tests__/testMarkets.test.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/lib/nrxMarket.ts`
- `frontend/src/lib/spotPublicMarket.ts`
- `frontend/src/lib/testMarketStore.ts`
- `frontend/src/lib/testMarkets.ts`
- `frontend/src/lib/useMarketData.ts`
- `frontend/src/pages/TradePage.tsx`
- `frontend/src/pages/markets-bolt/TestMarketsStrip.tsx`
- `scripts/qa-nrx-market.cjs`
- `scripts/test-nrx-edge.cjs`
- `scripts/test-nrx-postgres.cjs`
- `src/api/routes/testMarkets.ts`
- `src/services/OrderService.ts`
- `src/services/PriceWatcherService.ts`
- `src/services/WalletPortfolioService.ts`
- `src/services/testMarkets/__tests__/nrxPublic.test.ts`
- `src/services/testMarkets/__tests__/nrxSpot.pg.test.ts`
- `src/services/testMarkets/neurix.ts`
- `src/services/testMarkets/nrxAllocation.ts`
- `src/services/testMarkets/nrxPublic.ts`
- `src/services/testMarkets/nrxSpot.ts`
- `src/services/testMarkets/testAssetConfig.ts`
- `src/services/testMarkets/testMarketService.ts`
- `src/services/testMarkets/testMarketSimulation.ts`
- `workers/market-edge/src/worker.ts`
- `workers/market-edge/wrangler.toml`
