# Terminal presentation polish — 2026-09-13

Base: `af652a07d39278b28b1ed081d60c811bf96820b7` (current main fetched before implementation).

## Scope

Shared typography, graphite surfaces, form spacing/focus states, aligned Spot book columns and whole visible book rows. All order families, routes, financial handlers, errors and availability states remain. Native TradingView is retained; only its requested background color changes. CFD chart colors/data and local paper execution semantics are preserved. A compact localized practice label reflects that existing CFD implementation.

The shared finishing stylesheet deliberately has greater selector specificity than the older reference styles because Vite may emit shared CSS before route-specific chunks.

## Verification

- Frontend TypeScript + production build: PASS (`npm --prefix frontend run build`).
- Seven focused suites: candidate **193 passed / 21 failed / 214 total**; pristine exact-main **193 passed / 21 failed / 214 total**. Exact additional failure names: **none**.
- Suites: spotOrderBook, spotOrderEntry, terminalPresentation, cfdChartFallback, referenceBook, futuresTickerHeader, futuresOrderPanel.
- Existing failures: one Spot amount-format expectation mismatch; twenty CFD chart test harness failures (`import.meta` in the CommonJS dynamic loader). These failures were retained, not suppressed. Chart background expectations were updated for the intentional color change.
- `git diff --check`: PASS. Backend/full repository suite was not run for this frontend presentation change.

## Browser evidence and limits

- Read-only local preview: `http://127.0.0.1:4210/__qa/start`. Existing QA server blocks financial submissions and private account reads. Consequently local account/position unavailable states are expected; they are not evidence that production accounts fail.
- Spot at actual 1440px: ten 26px rows fit each 261px book side without partial rows; all five order families remain accessible, including OCO. Screenshots show real public quotes.
- Futures at actual 1440px: shared typography/form changes applied, left search and narrow book retained.
- CFD at measured 1440/1280/1024/390px: no horizontal page overflow; chart and order form render. The mobile form screenshot verifies the quote state, quantity, leverage and action remain accessible.
- Later viewport overrides stopped applying to the local Spot/Futures tab. Additional responsive Spot/Futures results are **not claimed**; mislabeled captures were discarded.
- TradingView's local Spot/Futures iframe returned empty body content during this run despite a correctly sized container. The existing production Futures tab still displayed its chart. Native TradingView rendering in this local build remains unverified; screenshots intentionally retain the actual empty state. No replacement/fabricated chart was added.
- No live financial actions, production deployment or merge performed.

Screenshots: `spot-1440.png`, `futures-1440.png`, `cfd-1440.png`, `cfd-1280.png`, `cfd-1024.png`, `cfd-390.png`, `cfd-mobile-form.png`.

## Follow-up: complete Futures discovery catalogue

- Public production reads on 2026-09-13: `/futures/config` returned 28 execution-listed symbols, while `/market/universe?type=linear_perpetual` contained 761 Trading, USDT-quoted and USDT-settled perpetuals (829 linear perpetuals across settlement assets). The panel incorrectly used the execution list as its discovery catalogue.
- Added one batched universe read with a 60-second refresh, retained last successful discovery on failure, and merged discovery with server-listed/in-flight symbols. No arbitrary market cap, synthetic symbols or prices. Added a compact catalogue count. Search, sorting and virtualized scrolling cover all 761 contracts.
- Server execution rules are unchanged. The terminal explicitly passes execution membership to the order form; both side buttons and Enter remain blocked for discovery-only instruments. Mark price clears on symbol change to avoid retaining the previous contract's price.
- Browser 1440px: count 761; full list scrollHeight 27,396px, viewport 740px; reached scrollTop 26,656px. ZRX search returned its actual contract, selecting it disabled both execution buttons, and clearing search restored all 761. Screenshot: futures-catalogue-761.png.
- Frontend TypeScript/production build PASS. Six focused suites: 112 pass / 1 fail / 113 total. The sole failure, futuresConfigDedup's Windows path separator assertion, was reproduced on pristine af652a0 (22 pass / 1 fail for that baseline suite). Existing API fingerprint still verifies all original methods; only the additive universe method is excluded from that fingerprint. Four added regression cases pass, including blocked BUY/SELL/Enter submissions for discovery-only contracts.
- Local preview continues to block private account reads and financial writes by design; no production accounts or deployments changed.
