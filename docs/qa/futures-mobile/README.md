# Futures mobile workspace — draft, browser review outstanding

Base: fresh `origin/main` `2bc51d54a60a86778d9c50164291dd2f282c9239` (fetched and rechecked during this task).
Branch: `codex/futures-mobile-ux`.
Implementation: `3880230b0b2826af5e04bb39391ee28685599c2d`; final stylesheet follow-up: `e3e2b89a0392fb21d46debe2f6c5e630870397c3`.

No merge, deploy, production database access or production trade was performed.
This is **not READY FOR OWNER REVIEW**: the required visual/interactive browser matrix has not been completed.

## Changes

At widths up to 900px the approved default Futures terminal has Chart / Trade / Positions workspaces. The components remain mounted: changing workspaces does not create another order ticket, calculator, account subscription or financial command path.

- Compact header and pair/current-price/24h-percent row. The 24h disclosure exposes the existing mark/index/high/low/turnover/OI/funding fields without a permanent desktop statistics strip.
- Chart / Order Book secondary selector. Trades remains inside the existing book component. A price pick immediately opens Trade with the existing unsent picked-price draft.
- Bounded chart height, scrollable timeframe strip, More button for chart types/indicators, and touch-sized drawing controls. Existing native historical selection and Entry/TP/SL/LIQ overlays are retained.
- Cross/leverage appears above the existing four order-family tabs on mobile. Existing percentage presets, TP/SL, calculator, reduce-only and engine-provided values remain. Long/Short actions use larger sticky buttons.
- Existing position rows reflow into labelled cards. The same authoritative values and protection/close/leverage callbacks are used. Mobile protection values remain server values while the editor contains an unsaved draft.
- Limit Close and calculator handoff open Trade at the top without submitting. Manual workspace switches restore their previous page scroll offsets.
- Mobile-only safe-area spacing, 16px text inputs, scrollable calculator body, bounded dialogs, and visual-viewport keyboard inset handling.

## Preserved boundaries

No changes to backend source, financial math, execution adapters, `useNativeDemo`, `FuturesOrderForm`, `FuturesCalculator`, `FuturesReferenceBook`, or `FuturesCloseAllPositions`. Historical entry/current near-live valuation, close execution, CAS, rollback, idempotency, freshness, live projection, lazy history and executor/session code are untouched.

Existing desktop CSS files are unchanged. The new stylesheet only overrides existing elements inside `max-width:900px` (and the 359px refinement); outside those queries it hides only newly added mobile-exclusive elements. The scope regression passes. **Pixel stability is not verified without browser screenshots.**

## Verification

- Backend TypeScript (`tsc --noEmit`): PASS.
- Backend build (`npm run build`): PASS.
- Frontend TypeScript and production build (`npm run build --prefix frontend`): PASS.
- Broad local regression run: **1,542 passed, 0 failed, 33 skipped; 83 passed suites and 4 skipped suites**. Exact per-suite counts are in [test-results.json](test-results.json). The six new tests cover shared component identity, price/calculator/limit-close handoffs, scroll restoration/desktop no-scroll, CSS scope and authoritative protection display.
- Final stylesheet follow-up: scope/protection suite re-run, 2/2 PASS. Final frontend bundle rebuilt.
- `node --check scripts/qa-native-demo-browser.cjs` and `git diff --check`: PASS.

Selected results from the broad run:

| Suite | Passed | Skipped |
| --- | ---: | ---: |
| calculatorMath | 34 | 0 |
| nativeQuoteReadOnly | 17 | 0 |
| nativeHistoricalCurrent (#152 unit coverage) | 15 | 0 |
| nativeLiveProjection | 6 | 0 |
| nativeLiveHook / nativeLivePolicy | 10 | 0 |
| nativeLiveLimit | 8 | 0 |
| Futures Pro | 27 | 0 |
| chartTrading | 21 | 0 |
| Close All | 6 | 0 |
| futuresOrderPanel | 62 | 0 |
| nativeLivePostgres | 0 | 9 |

The 33 database-gated cases were skipped because no disposable PostgreSQL was available locally. They are not counted as passes. The repository's existing integration CI provisions PostgreSQL; its checks remain authoritative for that environment.

The existing native browser regression script was updated to select the visible mobile workspace before interacting. Financial assertions, readiness values, request guards and deadlines remain. Card overlap now measures both axes and all cell pairs; open mobile cards must fit without horizontal scrolling. This script was syntax-checked here, **not executed locally**.

## Browser QA and screenshots — blocked

The browser rejected the local HTTP preview with `ERR_BLOCKED_BY_CLIENT`. A local-file check was explicitly rejected by the browser URL policy (only HTTP/HTTPS allowed). No policy bypass, alternate browser control, external preview deployment or production test was used.

| Required viewport | Status |
| --- | --- |
| 1920×1080 | NOT RUN |
| 1440×900 | NOT RUN |
| 1366×768 | NOT RUN |
| 320×700 | NOT RUN |
| 390×844 | NOT RUN |
| 393×852 | NOT RUN |
| 430×932 | NOT RUN |
| 768px tablet | NOT RUN |

Outstanding at each mobile width: Chart, Trade, Positions, calculator, Order Book/price pick/Trades, TP/SL save, Market/Limit close, leverage dialog, Close All confirmation/partial failure, keyboard, safe area, overflow and scroll restoration. Desktop before/after screenshot comparison is also outstanding.

Requested screenshots **not produced**: `mobile-chart.png`, `mobile-trade.png`, `mobile-positions.png`, `mobile-calculator.png`, `mobile-orderbook.png`, `desktop-after.png`. No synthetic replacement images or screenshots from earlier PRs are presented as this change.

To continue locally: install backend/frontend dependencies, generate Prisma client, build both packages, then run `NATIVE_PREVIEW_FIXTURE=1 PORT=4178 node scripts/serve-native-demo-review.cjs`. Use the isolated fixture at `http://localhost:4178/futures`; never substitute production for this QA. The existing automated runner is `scripts/qa-native-demo-browser.cjs` (its Playwright dependency is configured by the existing CI).

## Changed files

- `frontend/src/pages/FuturesPage.tsx`
- `frontend/src/pages/trade-terminal/FuturesMobile.css`
- `frontend/src/components/FuturesTickerBar.tsx`
- `frontend/src/components/PriceChart.tsx`
- `frontend/src/components/FuturesPositionsPanel.tsx`
- `frontend/src/components/FuturesPositionProtection.tsx`
- `frontend/src/lib/__tests__/futuresFinalPolish.test.ts`
- `frontend/src/lib/__tests__/futuresMobileScope.test.ts`
- `frontend/src/lib/__tests__/futuresUiPolish.test.ts`
- `scripts/qa-native-demo-browser.cjs`
- `docs/qa/futures-mobile/README.md`
- `docs/qa/futures-mobile/test-results.json`
- `docs/AI_HANDOFF.md`

## Known limitations

Browser usability and desktop visual parity remain unverified, including actual iPhone keyboard behaviour. No claim of 10/10 quality or full acceptance is made. Open position cards are mobile-specific; history/orders retain their existing internally scrollable tables. Alternative legacy `terminalDesign` variants keep their existing presentation. No new fee estimate or unsupported financial control was introduced.
