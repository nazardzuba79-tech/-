# Desktop Futures — top zone (2026-10-11)

Base: fresh `main` `9226c30dbcee58c505a2895eb75583b6424bd162` (#507: 48px header + chart UX). Branch `claude/futures-top-zone-20261011`. Draft only; no merge, no deploy, no production change. Desktop Futures only (`#archive-terminal-preview.futures-terminal`, `min-width: 901px`); no trading, API, balance or backend code touched.

References: the owner's Bybit screenshot (2026-10-11) and Figma 19:103 ([PNG](../futures-figma-desktop-20261010/figma-19-103.png), [SVG](../futures-figma-desktop-20261010/figma-19-103.svg)).

## What was measured on main

The outer rows already match Figma 19:103: pair row bottom → plot top is 84px in both (4 gap + 40 tabs row + 40 toolbar), and the 48px header equals the Bybit header above the Figma frame (y = 47.99). The 48px header is not the cause and stays. The problems were inside the rows:

| Symptom | Cause (measured in the browser) |
| --- | --- |
| Pair-row text «under the panel» | The bar inherits a second, empty grid row and a 16px row gap from the shared ticker (`grid-template-rows` computed as `43px 0px`). Its content was centred in the top 43px of 48: labels started 2px under the bar's edge, 7px of empty bar below. In every width, zoom and language (37/37 cases). |
| Empty band above the chart | «График» sat 8px below the tile edge with an 8px pad between the word and its 2px underline; Figma puts the underline straight under a 22px label. With the toolbar under it, the row read as an empty strip. |
| Text cut by the toolbar | At 1920 the price scale's top tick label («85900.00») was painted half under the toolbar edge (85 text pixels in the top 6px of the scale). |
| Legend pushed down | The indicator legend was a boxed chip 32px down the plot, under «BTC/USDT · 1h»; Figma and Bybit print plain lines there. |
| Weak separation | Header `#17181e`, 4px black gutter, tiles `#101014`: the header had no edge of its own and the pair row's bottom edge had a contrast of 16/255 against the gutter. |

## Changes

| File | Change |
| --- | --- |
| `frontend/src/pages/trade-terminal/FuturesFigmaDesktop.css` | New block «Top zone, 2026-10-11» (≥901px, Futures root only): ticker `grid-template-rows: minmax(0,1fr); row-gap: 0` (content centred in 48px) and `box-shadow: inset 0 -1px 0 #222227` (1px rule under the pair row); Figma «Vertical Divider» 1×32px `#222227` between the pair and its price (`.pair-cluster::after`, centred in the 16px gap); «График» row 40 → 36px with `padding-top: 12px`, label box 22px with `padding-bottom: 0` so the 2px underline sits under the word; legend `top: 28px; left: 12px`, no box (transparent, no border/padding), 2px between lines. |
| `frontend/src/pages/trade-terminal/FuturesBybitParity.css` | Header rule (the existing Futures-only one): `box-shadow: inset 0 -1px 0 #2a2b31` — a 1px rule inside the 48px box. |
| `frontend/src/components/PriceChart.tsx` | Right price scale `entireTextOnly: desktopFutures` (Lightweight Charts 5.2.1: «show top and bottom corner labels only if entire text is visible»), only for the Futures terminal chart at ≥901px. |

Nothing else changes: header 48, pair row 48, 4px gutters, book 286, ticket 300, account 160/200/44, chart tile height, toolbar, rail, indicators, settings, white price scale, mobile and Spot/CFD.

## Browser QA (read-only loopback fixture, Playwright Chromium)

| Check | main | this branch |
| --- | --- | --- |
| Pair-row text air above / below (min, 1366–1920 × 90/100/110/125%, ru) | 2 / 7px (16/16 cases fail ≥3px) | 4.5 / 4.5px (16/16 pass) |
| Same in 7 languages (ru, en, zh, es, hi, ja, ko) × 1366/1440/1920 | 21/21 fail | 21/21 pass |
| «График» row / toolbar top / plot top (all cases) | 40 / 144 / 184 | 36 / 140 / 180 |
| Plot height, chart tile unchanged | 388 · 520 · 520 · 700 (1366 · 1440 · 1707 · 1920) | 392 · 524 · 524 · 704 |
| Legend box (1 indicator) | y 216, 32px tall chip | y 208, one 16px line under the title |
| Cut corner label on the price scale (text px in the top 6px) | 85 at 1920@90% and 1920@100%, 0 elsewhere | 0 in all 16 width × zoom cases |
| Page horizontal overflow | 0 | 0 |
| Spot 1440, CFD 1440, Futures 390, Spot 390 (pixel diff vs main) | — | 0 px each |
| Futures 768 (pixel diff vs main) | main vs main: 0–14 px (live ticker) | 14 px, same box as the main-vs-main noise |

At 110% and 125% on 1366/1440 the statistics row was already wider than the bar and scrolls sideways inside it (122/55px and 271/212px); unchanged and identical on main. Values are never truncated.

Repository checks on the implementation commit `7a46c644` (build of the same sources), guards with `LANG=en_US.UTF-8`:

- `tsc -b && vite build` — PASS.
- Jest `frontend/src` — 236/236 suites, 4082/4082 tests PASS (no test changed).
- `scripts/qa-futures-proportions.cjs --widths 1920,1707,1440,1366,390` — 0 violations.
- `scripts/qa-futures-figma-desktop.cjs` — 4/4 (header 48, pair row 48, book 286, ticket 300, chart = book height, gutters 4).
- `scripts/qa-futures-chart-ux.cjs` — 129 assertions, 0 failed (indicator catalogue, white price scale, settings persistence, rail, #494 geometry).
- `scripts/qa-spot-cfd-terminal.cjs` — PASS.

## Evidence

- Before/after, top 250px, same fixture and viewport: [1366](top-before-after-1366.png) · [1440](top-before-after-1440.png) · [1707](top-before-after-1707.png) · [1920](top-before-after-1920.png)
- Figma 19:103 / main / this branch at the reference width 1548: [figma-before-after-1548.png](figma-before-after-1548.png); 2x detail of the pair row, «График» and legend: [detail-2x-1548.png](detail-2x-1548.png)
- Raw numbers: [measurements.json](measurements.json)

## Deviations from Figma, kept on purpose

- «График» row is 36px (Figma 40): the owner asked for less idle space above the chart, and the live Bybit capture attached by the owner sits the tab label about 20px under the tile edge; 36 puts it at 23 (Figma 27). The plot gains 4px.
- Pair row stays 48px (Figma 56), as approved in #494. On 1366/1440 Russian labels still wrap to two lines — single-line labels need about 891px and the bar has 796/870px; values are never truncated (rule from the Figma pass).
- Figma's extra tabs (Обзор, Данные, Лента новостей), view switch and toolbar icons are not drawn: they have no implementation.
- The 1px rules (`#2a2b31` header, `#222227` pair row) are VOLTEX additions for the owner's separation request; Figma's own divider token `#222227` is reused.
