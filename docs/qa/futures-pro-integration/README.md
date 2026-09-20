# Futures design + Pro integration — owner review

Date: 2026-09-20. Draft PR: https://github.com/nazardzuba79-tech/-/pull/158

No merge and no deployment were performed. The original design worktree and port 4234 preview were preserved. All interactive order checks here used isolated local synthetic accounts, not a production account.

## Sources

| Purpose | Exact commit |
|---|---|
| Fresh main, fetched again after implementation | `ac2d5836a0c5c2ca84814a4b9db36ea684e5d619` |
| Approved local archive design source | `f1836a74c93f58b66917d4b96f60a64c41c8d64f` |
| Design implementation in that source history | `3efe8135293eb0af452268140557715c3ab839ac` |
| Claude #157 source, still unmerged | `0a76da583e3557b72ce11f9a8726be7bd66acffa` |
| Integration code tested by all 11 CI workflows | `0066a611aa999a9250cc79aaa74d368cef59f0fd` |

New branch: `codex/futures-design-pro-integration`, based directly on fresh main. The subsequent documentation commit contains this report/screenshots and does not change runtime code. Use the PR head for the final review SHA.

## Integrated behavior and semantic ownership

| Overlap | Resolution |
|---|---|
| `FuturesPage.tsx`, terminal CSS, Nav, LanguageSwitcher | Approved archive navy/graphite/gold layout is the default Futures presentation. Existing native account controller and main's execution lifecycle remain. Both approved calculator buttons open one dialog. Desktop rail and bottom positions occupy separate grid regions; wide tables scroll internally. |
| `FuturesOrderForm.tsx`, OrderFamilyPresentation | Main's historical-candle payload, reduce-only targeting and engine execution retained. Claude calculator drafts fill fields without submitting, and clear unsent close targeting. Four tabs remain: Limit, Market, Stop, Take Profit. Unsupported execution types cannot submit. Entry TP/SL is capability-aware and part of the original order command, not a second protection write. |
| `futuresExecution.tsx`, `useNativeFuturesExecution.ts`, nativeReduceTarget | Native explicitly supports entry protection; the real adapter does not pretend to. Protection on unsupported/reducing tickets is rejected. Existing CLOSE path, identity checks and command ordering are retained. |
| `FuturesPositionsPanel.tsx`, protection cell, Close All | Approved compact row and equal buttons, real server values, three-decimal BTC display and existing position leverage editor retained. Native P&L card/export still uses its original service. Close All snapshots the reviewed exposure, confirms, closes sequentially through existing closePosition, guards duplicate clicks/changed positions and reports partial failures. |
| `PriceChart.tsx`, TerminalChart, chartTrading | Historical candle marker remains separate from the Entry horizontal line. Persisted native overlays remain visible with the entry picker off. Only OPEN positions and saved server protection are drawn; null/nonpositive/nonfinite LIQ is omitted. Native and non-native paths cannot draw duplicate entry lines. |
| `useNativeDemo.tsx`, nativeDemoApi, native service/projection | Main's compact live transport and lazy history retained. One optional immutable candle anchor per OPEN position is carried in the projection, derived during normal atomic commits, not by live reads. This restores markers after reload without periodic journal downloads. Older projections are accepted; anchors populate on the next ordinary command commit. |
| Native routes/service and private trading math | Claude's authenticated read-only quote endpoint and inverse helpers are added to current main. Existing order/settlement/freshness/CAS/shared scheduling code is preserved. Calculator reuses quoteOrderCost, calculatePosition, liquidationPrice, linearPnl, roiPercent, fundingCashflow and closePositionAllocation; no second frontend financial implementation. |
| FuturesTickerBar, status, turnover | Real Mark and Index share a compact labeled cell; full 24h turnover formatting retained. VOLTEX OI/funding sources remain distinct from external venue data. Status comes from existing depth transport; no invented RTT. |
| Translations/tests/browser QA | Claude calculator/status strings combined with approved design strings across existing locales. Regression selectors recognize the approved P&L icon while retaining real PNG export checks. Compact rows deliberately omit duplicate approximate USD lines; authoritative amount and unit are still checked. Geometry accepts only intended internal scroll, with strict page overflow and panel separation checks. |

## Validation

- Backend TypeScript/build, collector TypeScript and frontend TypeScript/production build: PASS locally and in CI.
- Broad integration suite: **82 suites, 1,536 tests PASS**. Its DB-less job reports **33 PostgreSQL-gated tests skipped**; those cases are covered by the separate disposable PostgreSQL workflow, not counted as passing in that job.
- `calculatorMath`: **34 PASS**; `nativeQuoteReadOnly`: **17 PASS**. Quote proof forbids mutating repository methods and checks that account, history and live projection are not read or written.
- Futures Pro: **27 PASS**; Close All: **6 PASS**; latest focused terminal follow-up: **105 PASS**.
- #152: historical ENTRY/current near-live valuation, partial/reduce-only close, Isolated/leverage, TP/SL/OCO, idempotency, expiry rollback, reconciliation and shared scheduling regressions PASS. Existing financial formulas and LIVE authorization/freshness guards remain unchanged.
- #156: projection **6 PASS**, compact live/no-write behavior, lazy history and native live policy PASS. Isolated local PostgreSQL run: **30 tests, 4 suites PASS**. CI private trading/replay: **722 tests, 33 suites PASS**, with disposable PostgreSQL and before/after capacity job PASS. Existing production egress measurements are unchanged; this task makes no new production traffic measurement claim.
- Native CI: **242 unit tests PASS**, **30 interactive browser checks PASS**, **58 large-number/card checks PASS**. Real P&L dialog and 1080×1215 PNG export checks remain enabled for desktop and phone.
- All **11** PR CI workflows passed on the code commit above. Exact run links and conclusions are in [ci-results.json](ci-results.json).

## Browser evidence

Manual responsive QA used 1920×1080, 1440×900, 1366×768 and 390×844. No page-level horizontal overflow or NaN/undefined was observed. Desktop bottom-panel right edge exactly meets the trading-rail left edge (1570, 1114 and 1040px respectively). Internal positions scrolling at narrower widths is intentional. Mobile stacks the panels and retains internal table scrolling. The calculator sits above mobile navigation/support; its fields/results scroll inside the dialog and its apply button stays reachable.

Public-price local review: historical BTC entry **80,049.20**, quantity **0.002**, selected 1h candle closing 2026-09-18 13:00 UTC. Reload preserved entry and candle marker while near-live Mark/P&L changed. Atomic entry protection 85,000/70,000 appeared in the position editor. Updating/saving it to **TP 82,000 / SL 76,000** displayed both lines without changing the candle scale. Server LIQ was null on this Cross account, so no LIQ line appeared; non-null line sourcing/render guards are covered by regression tests.

Calculator: all four tabs inspected; LONG/SHORT, quantity/leverage, fees and target ROI exercised. SHORT 80,000→79,000, 0.010 BTC, 10x returned gross 10.00 / net 9.13 USDT with opening/closing fees. Applying values only filled the order ticket and did not change positions. Both launch buttons use the same calculator.

Close All: cancellation preserved the public-review position. On a separate local fixture, confirmation closed **1 / 1**, left zero open positions and disabled the empty-account trigger. Partial failure, changed exposure and duplicate submission are covered by component/execution tests.

The local review server supplies public candles/ticker prices and synthetic demo capital. It does not expose production Index/OI/funding/top-capitalization endpoints, so those fields correctly show unavailable rather than fabricated values. Production data hooks remain wired to their existing authoritative endpoints. This is local/CI acceptance, not a new production acceptance run.

## Screenshots

- [1920×1080 terminal](terminal-1920.png)
- [1440×900 terminal](terminal-1440.png)
- [1366×768 terminal](terminal-1366.png)
- [Mobile terminal](terminal-mobile.png)
- [Calculator](calculator-1920.png)
- [Mobile calculator](calculator-mobile.png)
- [Close All confirmation](close-all-confirm-1920.png)

Next step: owner review of draft PR #158. Merge and deployment remain explicitly unauthorized.
