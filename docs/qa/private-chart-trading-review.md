# Private candle trading review — 2026-09-14

Review-only addition to PR #80, `codex/private-trading-replay`. Main checked repeatedly by fetch: `e5ae1e4f62815a396662e268ffbba20d40b176be`; starting PR head `292bd18910ce0b8f765233f76f4775fe9f176c3c`. Existing work retained. No production migration, activation, merge or deployment.

## Delivered behavior

- Native VOLTEX chart selection supplies a completed BYBIT_LINEAR candle, contract and interval. Default Close and optional Open are server-resolved; the new model does not reinterpret existing V1 next-open scenarios.
- Long/Short, margin and leverage are the primary controls. Capital is prefilled from the existing private wallet. Date and price are read-only. TP/SL, capital and pricing point remain under Advanced. Calculation is debounced; explicit confirmation is required to persist a scenario.
- Trade markers, entry/TP/SL/liquidation levels, selection/details and Show Entry use chart data coordinates. Contract switches isolate overlays. Existing drawings and ordinary public charts remain separate.
- Close on chart evaluates the complete intermediate path and creates an append-only revision of the existing scenario, retaining its entry and capital reservation. Open scenarios refresh from checkpoints. History, executions, private copy view and cards share server results.
- Private account captions remain concise: profit is in USDT; fresh open snapshots can say Current price, frozen historical snapshots say Price plus timestamp, closed snapshots say Exit price. A compact simulation badge remains in the private terminal and exports.

## Browser evidence

Loopback-only preview: `http://127.0.0.1:4220/__qa/start`. Authentication and writes were restricted by the QA harness to the previously created isolated non-primary test database and pinned owner. Production matching, balances and public performance were not involved.

Actual browser flow, without entering a date/time:

1. Selected BTCUSDT 1h candle closing **2026-09-12 10:00 UTC**, Close **77,316.7**. Set capital **200 USDT**, margin **100 USDT**, leverage **10x**, TP **85,000**, SL **72,000**. Server contract rounding produced **0.012 BTC**. Explicit Open persisted the scenario and chart entry.
2. Private available capital changed **797.76880535 → 597.76880535** and reserve **200 → 400** (including an older 200-capital scenario). The server returned used margin approximately **93.24**, free scenario capital approximately **105.98**, and initial net result **4.79 USDT**. These are separate quantities, not a new deposit.
3. Show Entry located the saved candle. Incremental evaluation advanced the result timestamp while keeping the original entry unchanged.
4. Choosing an exit before entry was rejected; confirmation stayed disabled. No capital was reserved by that preview.
5. Chose a historical exit at **2026-09-14 06:00 UTC**, price **77,577.8**. Confirmed Close on the same scenario. Net result **1.9112649663432 USDT**, displayed **1.91 USDT / 2.05% ROI**. The wallet stayed **597.76880535 available / 400 reserved**: no duplicate reserve and no historical profit credit into live funds.
6. History and executions showed the saved entry and exit; private copy history included this scenario. Generated card displayed entry **77,316.7**, exit **77,577.8**, **1.91 USDT**, **2.05%**, and the historical timestamp.
7. Reload retained history and markers. Switching to 4h preserved time anchoring; selecting ETH removed BTC overlays. Escape cancelled the pending chart ticket. Mobile 390x844 used a full-width bottom sheet. Desktop advanced fields scroll inside the bounded popover.

The actual browser-rendered PNG is `private-trading/chart-flow/result-card.png`. Screenshots and a step-by-step MP4 assembled from actual browser frames accompany this report. The MP4 is an annotated sequence of captured UI states, not a continuous screen recording. The in-app browser exposes no usable native download-manager result; saved PNG bytes were read from the rendered image data URL, and OS download-manager behavior is not claimed.

## Automated validation

- Backend TypeScript: pass. Collector TypeScript/emitted build: pass. Frontend TypeScript/Vite production build: pass.
- Private backend/provider/API: **262 passed**, 8 suites; 12 PostgreSQL tests deliberately skipped in that run.
- Separate real isolated PostgreSQL integration run: **12/12 distinct cases passed**, five bounded batches. Includes rollback, concurrent confirmation/close, permission revocation, funding, historical escrow/advance and incomplete-data rejection.
- Frontend final focused chart/private suites: **184/184 passed**, 6 suites, 5.638s. Final Vite build: 7.01s. Long/Short, liquidation, completed Close entry risk boundary, ambiguous/incomplete data, double confirmation, stale calculations, cancellation, pan/volume/indicator exclusion, marker timeframe mapping and owner denial have regression coverage. The final review also added regressions for old-contract ticket cleanup and partial-close marker anchoring.
- Full candidate run: **3,287 passed / 88 failed / 29 skipped**, 3,404 tests, 214 suites (186 passed / 26 failed / 2 skipped).
- Existing pristine run of the **same exact current main**: **2,926 passed / 88 failed / 23 skipped**, 3,037 tests, 202 suites. Baseline was reused because fetched main was unchanged; it was not rerun for this addition.
- Exact failure-name comparison: **0 new failures, 0 new suite errors**. See `private-chart-trading-suite-comparison.json`, including source hashes and full failure identities. Final narrow UI follow-ups were covered by focused tests/build after the full run.

## Limits

- Only the pinned owner's enabled private account can use this mode. Export links also require access. No public copy rankings, follower trades or real funds are affected.
- OHLC/funding replay is a scenario, not proof of historical depth or executable liquidity. Missing or ambiguous paths fail closed; current incomplete candles cannot be confirmed as completed historical entries.
- Historical escrow remains isolated, with no return-to-live-profit action. Closed revisions preserve audit evidence. Current risk-tier/funding-interval assumptions remain versioned as documented in the model.
- Chart history loading is bounded to 10,000 bars and provider requests to 1,500 bars. Historical calculation concurrency/cache limits remain active. External TradingView is preserved; chart selection switches only the chart to VOLTEX.
- This report does not claim visual or execution parity 1:1 with Bybit, production readiness, or a deployed release.
