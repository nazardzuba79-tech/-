# CFD terminal migration — owner review

Starting `origin/main`: `bfaf5222585e7bf668e5e996a74d853040601fbd`.
Branch: `codex/cfd-terminal-migration`. No merge, deployment, production database access or real order.

## Scope and structure

The `/trade?market=cfd` branch of TradePage now renders `trade-terminal cfd-terminal`, retaining the existing Nav, static ticker and ConnectionBanner. A selected-instrument header shows only the actual symbol/name/reference price/24h change. The desktop workspace is instrument list → dominant TradingView chart → order form, with positions/history below. There is no order-book component or reserved order-book column.

At 1440px the columns measure **280 / 848 / 310px**. Below 1025px the instrument list becomes a bounded, scrollable top panel and chart/form share the next row. Below 768px chart and form stack, followed by the locally scrollable positions table. The chart remains at least 410px tall on mobile. The desktop submit button stays accessible in the scrolling form; mobile uses normal flow to avoid covering controls.

Gold displays two decimal places, USDJPY three, and EURUSD/GBPUSD/AUDUSD/USDCAD five. Formatting affects display only, never the raw price used for sizing or the API payload. The existing CFD disclaimer now correctly says 60 seconds in all seven languages, matching the unchanged polling interval.

CFD URL selection now resolves valid requested symbols against the real feed, falls back to XAUUSD or the first available instrument, and does not let ticker refreshes overwrite manual selection. Spot's JSX and its own selection/book lifecycle are preserved.

## Intentionally unchanged

- Backend source, Prisma schema/migrations and financial math are byte-unchanged.
- Dealer execution; MARKET only; ISOLATED only; opposite position must close before opening the other direction; existing tier/account-age/leverage/negative-balance rules.
- Shared leveraged USDT balance, existing open/close APIs and payloads, form sizing/calculation callbacks, positions/history polling and close callbacks.
- Twelve Data reference flow (`useCfdTickers` / `CfdMarketDataService`) and TradingView CDN/widget symbol/locale/autosize settings. Existing widget-supplied chart statistics remain TradingView's real data, not fabricated application metrics.
- Spot/Futures runtime, shared terminal stylesheet, global Nav/menu, funding, matching engine, Wallet/Card/Homepage/Copy/Analytics/Arbitrage.

## Exact changed files

- `frontend/src/pages/TradePage.tsx`
- `frontend/src/pages/trade-terminal/CfdTerminal.css` (new)
- `frontend/src/components/CfdTickerBar.tsx` (new)
- `frontend/src/components/CfdInstrumentList.tsx`
- `frontend/src/components/CfdChart.tsx`
- `frontend/src/components/CfdOrderForm.tsx`
- `frontend/src/components/CfdPositionsPanel.tsx`
- `frontend/src/lib/cfdPresentation.ts` (new)
- `frontend/src/lib/i18n.tsx` (only seven CFD disclaimer values)
- `frontend/src/lib/__tests__/cfdTerminal.test.ts` (new)
- `frontend/src/lib/__tests__/spotChartPriceFormat.test.ts` (normalize CRLF before the existing source assertion; no weaker assertions)
- `scripts/qa-cfd-terminal.cjs` (new, local-only QA server)
- `docs/CFD_TERMINAL_REVIEW.md` (this report)
- `docs/AI_HANDOFF.md`

## Validation

- Frontend TypeScript and production Vite build: PASS. Assets `index-C-DXciZe.js` / `index-CLeVt2Tm.css`; existing large-chunk advisory only.
- **23 Jest suites / 391 tests PASS**, including 24 new CFD frontend tests, all Spot frontend preservation suites, Futures frontend/backend, matching engine, Spot OrderService/recovery and CFD backend position/liquidation tests.
- CFD tests execute actual TSX callbacks with isolated hooks/API fixtures: mode shell, absent order book, deep links, invalid/subset fallback, switching/poll stability, provider states/retry, exact open payload, percent sizing, MARKET/ISOLATED labels, close/error/loading/history/liquidation status, formatting and unchanged chart mappings. Frozen hashes from starting main protect all pre-JSX form/positions logic and the complete Spot render branch.
- An existing Spot source assertion failed on Windows CRLF despite unchanged PriceChart. Normalizing only that test's input made the original assertion portable; no Spot runtime repair was needed.
- Diff and byte-preservation checks: PASS. Existing dirty `codex-test` Nav/ticker changes in another worktree were inspected and left untouched; they are not another CFD terminal migration.

## Real browser QA

Built app on loopback only, with unmodified public market-data GET responses and actual TradingView iframe. No production login, database connection, account mutation or real financial action. `qa-cfd-terminal.cjs` forwards no credentials and rejects **every** write before routing. An explicitly selected local position/balance fixture was used only to inspect percentage sizing and the close-error/history UI; no fake price/depth source was introduced.

| Viewport width | Page width | Chart width | Chart height |
| --- | --- | --- | --- |
| 1920 | 1920 | 1310 | 558 |
| 1440 | 1440 | 848 | 558 |
| 1366 | 1366 | 774 | 558 |
| 1280 | 1280 | 688 | 558 |
| 1024 | 1014 | 703 | 561 |
| 768 | 758 | 447 | 561 |
| 430 | 420 | 420 | 410 |
| 390 | 380 | 380 | 410 |

Height 900px for the width matrix; the 10px difference on scrolling pages is the scrollbar. No page-wide horizontal overflow, clipped form buttons or CFD order book at any width. Actual iframe widths match chart widths; the central widget resizes rather than leaving a blank fourth-column gap.

Browser checks passed: base CFD route, XAUUSD/EURUSD/USDJPY deep links, invalid fallback, instrument selection, mobile list scroll, Buy/Sell, keyboard leverage slider, quantity, all five sizing stops, loading/unconfigured/error/retry, positions/history, local-only close failure, RU/EN widget recreation, Nav Spot↔CFD and browser back/forward. Console error log empty at final inspection. Public GET failures were surfaced honestly; retry recovered the feed. Submission success/closing-pending behavior is covered by isolated callback tests, not a real financial transaction.

Fresh local artifacts (not committed): `outputs/cfd-terminal/cfd-desktop-1440.png`, `cfd-mobile-390.png`, `cfd-mobile-form-390.png`, and `browser-qa.json`. The mobile overview is a tall 390px-wide capture; the interaction/overflow QA used a 390×900 viewport. Preview server: `node scripts/qa-cfd-terminal.cjs`, then `http://127.0.0.1:4192/__qa/start?mode=live`.

READY FOR OWNER REVIEW: YES. Release requires separate owner approval; this branch has not been merged or deployed.
