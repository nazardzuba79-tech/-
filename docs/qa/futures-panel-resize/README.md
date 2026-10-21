# Futures bottom panel: chart / account divider and scrolling positions (2026-10-21)

Owner's report (IOST/USDT, two open positions): «Позиции (2)» shows only the first row; the second is cut off and scrolling does not behave as expected. Bybit lets the trader scroll the positions and change the panel's height, the chart giving way.

**Scope: presentation only.** No order, close, TP/SL, funding, liquidation, P&L, margin, leverage, balance, API, auth, PostgreSQL, Spot, CFD, Stocks or listing logic changed. Base `main` `f81df788`.

## What was measured before (`before-*.png`, `before-report.json`)

Desktop (archive design, `#archive-terminal-preview.futures-terminal`), the approved Figma grid: account row **200px**, instrument row 56px (52px under 800px tall), chart `minmax(300px,1fr)`.

| Viewport | Scroll region (positions table) | Rows | Visible at once |
|---|---|---|---|
| 1440×900 | 122px tall, scrollHeight 168 (2 rows) / 372 (5 rows) | 68px each | 1 full row, the second cut |
| 1280×720 | 122px tall | 68px each | 1 full row |

The region itself does scroll (wheel over the table moves `scrollTop`; the page does not scroll, `pageH == innerH`), the headings are sticky, the «Закрыть как» column stays pinned. What the owner could not do was give the panel more height: there was no divider (`orders-resize-handle` present on Spot only).

## What changed

- `frontend/src/lib/futuresAccountPanelHeight.ts` — the height module: read/write of `voltex.futuresAccountPanel.v1` (same versioned-key convention as chart settings), clamp between **160px** and the ceiling that leaves the chart its **300px floor** (terminal height − instrument row − gaps − 300), and the `useFuturesAccountPanelHeight` hook (pointer drag with capture, ArrowUp/ArrowDown ±24px, double click back to the design default). `null` = design default; nothing is written until the trader moves the divider.
- `frontend/src/pages/FuturesPage.tsx` — `.terminal` gets `ref`, the `--futures-account-height` style and `data-account-height=user` only when a user height exists; the `orders-resize-handle` separator (role=separator, aria-valuemin/max/now) renders only on a desktop with the panel open.
- `frontend/src/pages/trade-terminal/TerminalAccountPanel.css` — divider styling (same geometry as Spot's), `[data-account-height=user]` grid rows for the archive and studio layouts, hidden on phones.
- i18n `futures.accountPanelHeight` in seven locales; `scripts/qa-futures-panel-resize.cjs`; unit test `futuresAccountPanelHeight.test.ts`; fingerprint and digest locks refreshed (`futuresUiPolish`, `i18nLanguageChunks`, `futuresFinalPolish` loader).

The approved defaults are untouched: 200px populated, 160px empty, 44px folded. The panel never changes height on its own: scrolling over the positions scrolls the rows; only a drag or the arrow keys on the divider change the height.

## What was measured after (`after-*.png`, `after-report.json`): 68/68 checks

| Check | 1440×900 | 1280×720 | 390×844 |
|---|---|---|---|
| Every row and its close button reachable by scrolling (2 and 5 positions) | PASS | PASS | PASS (cards, page scroll) |
| Wheel over the table scrolls rows; headings stay pinned | PASS | PASS | — |
| Horizontal scroll keeps «Закрыть как» on screen | PASS | PASS | — |
| Divider drag up: panel 200→360, chart 552→392, canvas re-laid out | PASS | panel 200→284 (ceiling), chart 376→300 | no divider |
| Two positions fully visible after enlarging | PASS | PASS | — |
| Height survives a reload; ArrowDown shrinks | PASS | PASS | — |
| Drag down stops at 160px, chart grows back; drag beyond the ceiling clamps at 460px / 284px with the chart at 300px | PASS | PASS | — |
| Five rows at the ceiling | all visible | scroll | — |
| Tabs «Открытые ордера», «Позиции», «История ордеров», «История позиций» | PASS | PASS | — |
| No horizontal page overflow, no desktop divider | — | — | PASS |

Rerun: `QA_PLAYWRIGHT_MODULE=<playwright> node scripts/qa-futures-panel-resize.cjs --label after` (fixture express server on `frontend/dist`, GET-only fixtures, no production call). `QA_MEASURE_ONLY=1 … --label before` takes the measurement without asserting.
