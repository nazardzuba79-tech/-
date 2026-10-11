# Stocks integration — owner review only

Date: 2026-10-10. Fresh main: `e7c6fea3532ea78ff1e3d8287dc592ba2b82641a` (merged Desktop Futures #494).

Integration branch: `codex/stocks-integration-20261010`. It preserves the ancestry and functionality of #492 (`9dae03c37a51edf5734aac570ba1173b9d3ce8eb`) and #496 (`f1f278d6356a95f6dcec19255c44122ac4cb5d21`). The first integration commit is `94c38de7393f866279153f0711e3b1beeb90b0ca`; the exact final review SHA and CI status are recorded on the new Draft PR.

## Integration boundaries

- The only merge conflict against main was the additive `docs/AI_HANDOFF.md` history; both sides were retained.
- The Stocks engines, provider adapters and Professional B components are unchanged from #496. No duplicate terminal was introduced.
- Desktop Futures, TradePage, PriceChart, SpotOrdersView, FuturesOrdersPanel, DepositModal and global `index.css` match main. No Admin, production API, database or financial engine changes.
- The inherited mobile Trading chooser's styles moved from global `index.css` into `pages/stocks/stockNavigation.css`, eagerly imported by `App`. Shared-header ownership and Copy Trading dependency gates remain intact.
- Claude #495 was inspected read-only at `825f311a2d4acd6a915308c403199b8e9ea43046`. Its branch/worktree/files were not edited or merged. The shared locale additions already present in #492 only add Stocks text. A prospective `merge-tree` check merges those locale/integrity files cleanly; only the append-only handoff would need combining. All Claude-owned layout/component files remain exactly as main.
- Existing preview servers and ledgers on 4438/4439 remain untouched. The integration uses its own copy on 4440.

## Validation

| Check | Result |
| --- | --- |
| Frontend TypeScript (`tsc -b`) | PASS |
| Enabled and default-off local production builds | PASS |
| Complete frontend Jest, built assets present | **4129 PASS / 244 suites; zero failures, skips or todos** |
| Both isolated simulator engines / HTTP / source gates | **52 PASS** |
| Desktop 1366×768, 1440×900, 1707×900, 1920×1080 | PASS; zero horizontal page overflow |
| Mobile Stocks 320, 360, 390, 430 × 844 | PASS; zero horizontal overflow, tabs and ticket controls accessible |
| Real local paper cycles and independent reconciliation | PASS |
| Read-only local load smoke, 200 requests / concurrency 8 | PASS; zero errors, p95 4.77 ms, RSS about 90.9 MB |
| Final-head GitHub regression/browser/resource workflows | Status recorded on the Draft PR; no waiver |

The first full local run exposed Windows CRLF differences in source-text/hash assertions, plus a shared-header CSS ownership mistake. Checkout bytes were normalized to the existing Git LF blobs, and the stylesheet import was moved to App. No protected code, assertions, hashes, workflow conditions or tests were weakened. A subsequent complete run with the normal `frontend/dist` build location passes all 4129 tests. The existing Vite >500 kB chunk advisory remains.

The local load smoke made no extra provider requests, changed no orders/fills and is not a production capacity certification. Bounded CPU/memory/disk and paired-resource experiments remain the existing GitHub CI gates, using disposable fixtures, not production systems.

## Browser evidence and accounting

The loopback preview uses real provider responses for market data and a separate JSON paper ledger. It has no exchange/broker order adapter or production wallet dependency.

- Tested AAPLX/USDT Market buy, partial sell, full close; a marketable Limit filled after a verified quote; a waiting Limit reserved funds and released them on cancellation.
- Tested USDC buy/close with observed `USDCUSDT` FX, rather than assuming USD parity.
- Tested the mobile buy/partial-close/full-close cycle and desktop/mobile history/positions access.
- Tested page reload persistence, native source identity switching (Bybit AAPLX vs Binance AAPLB), chart intervals and all existing indicator options (None/MA/EMA/RSI/MACD/BB).
- All **22 original fills and 25 original orders** are unchanged. The integration added 15 fills and 18 orders. BigInt reconciliation independently checks notional rounding, fees, cash, realized PnL, FX age, unique fills and zero final positions/reserves. No balance adjustment or history reset was performed.
- Final paper balances: **9999.72020000 USDT**, **9999.96522785 USDC**; realized totals: **−0.27980000 USDT**, **−0.03477215 USDC**.
- An early long browser capture evicted older events and is not used as complete evidence. A complete short repeated cycle was captured without truncation: seven POSTs, all to `127.0.0.1:4440/__stocks_global/orders` or `/cancel`; zero external writes. Final console errors: none.
- A SBER Market order was disabled. A user-priced SBER Limit could wait with a reserve, but did not execute or open any position without MOEX/FX verification; cancelling released its entire reserve. No MOEX fill exists in the review ledger.

## Real sources and limitations

The finite source probe at 2026-10-10 08:36 UTC verifies exact provider/symbol/currency identities and candles for 20 US tokenized instruments. Ten passed execution freshness at that instant; ten were correctly blocked as stale. Both AAPLX and AAPLB returned actual candles for 1m/5m/15m/30m/1h/4h/1D. Availability is a snapshot, not a guarantee of later tradability.

All 20 MOEX candidates, including SBER, remain **SOURCE_DNS_UNAVAILABLE** on this machine. The separate RUB FX probe is **SOURCE_UNAVAILABLE**; the USDC quote succeeded at an observed 1.00084000 USDT/USDC. Therefore no live SBER/RUB trading cycle or Russian-market readiness is claimed. Russian arithmetic, FX composition and closed-session gates are fixture-tested only. Unavailable data remains a dash/error, not fabricated candles or prices.

## Design and screenshots

The approved [Professional B Figma](https://www.figma.com/design/9gbmBfp0OSHTzLsnbBUnrZ/Untitled?node-id=31-3317) implementation from #496 is retained. The plot remains dominant and the account panel stays 112/120 px high. At 1366 the chart plot is 360 px high; at 1440 it is 492 px; at 1707 it is 486 px; at 1920 it is 666 px. Ticket scrolling keeps the order button accessible on the shorter screen.

- [Desktop 1366](desktop-1366.jpg), [1440](desktop-1440.jpg), [1707](desktop-1707.jpg), [1920](desktop-1920.jpg).
- [Mobile chart 320](mobile-chart-320.jpg), [360](mobile-chart-360.jpg), [390](mobile-chart-390.jpg), [430](mobile-chart-430.jpg).
- [Mobile ticket 390](mobile-form-390.jpg), [mobile position 390](mobile-position-390.jpg).
- Original Figma exports and before/after design comparison remain in `../stocks-figma-b-20261010/`.

The widget/native chart distinction, missing order-book depth, and source identity labels remain explicit. A physical phone/OS keyboard was not tested; mobile evidence is browser viewport testing.

## Launch assessment

**Suitable for this isolated local owner review; not yet ready for a public production demonstration.**

1. The global simulator intentionally binds to loopback and uses one paper ledger per process. Public hosting requires a separately reviewed authenticated per-user paper-account/storage boundary, origin/CSRF controls, persistence and operational limits. Pointing every production visitor at this ledger would not be safe isolation.
2. Public redistribution/commercial use rights for provider data have not been established. Public endpoint access alone is not approval. Review applicable [Bybit API terms](https://www.bybit.com/en/legal/service-specific-terms/API-Terms), [Binance market-data documentation](https://developers.binance.com/en/docs/products/spot/rest-api) and [MOEX ISS commercial/access conditions](https://www.moex.com/a8531) before any publication. No subscriptions or agreements were purchased/accepted.
3. MOEX/CBR availability, Russian history pagination and physical keyboard validation remain open. Russian instruments must stay unavailable where source/FX/session gates cannot be satisfied.

Local preview: `http://127.0.0.1:4440/stocks/BYBIT%3AAAPLXUSDT`.

**NO MERGE. NO DEPLOY.** No production, Hetzner, Neon, Cloudflare configuration, real balance or real order was changed. Publication remains an owner decision after the above blockers are addressed.
