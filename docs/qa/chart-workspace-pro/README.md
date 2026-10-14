# Chart Workspace — working state for young listings, honest intervals, panes (2026-10-14)

Continuation of #519 on `main` `72f0a594`. Script: `scripts/qa-chart-workspace.cjs` (production bundle, loopback read-only fixture, Chromium). The fixture now serves the three test markets with the limits verified read-only on the real hosts the same day: AITH (managed listing on the market edge, ~21 h of history, 2 → ~22 USDT, a live 45 s lease on every read), NRX (edge, listed weeks ago), VTA (API host, 0.01 → ~10). Native `1m 5m 15m 1h 4h 1d 1w` (Monday-anchored week), HTTP 400 for every other code, at most 1000 bars, nothing before the listing.

- `before/` — the `main` `72f0a594` build, AITH/USDT at 1440: the owner's screenshots reproduced (`REPORT-before.md`, `report-before.json`).
- `after/` — this branch on the final tree, every section: **266 passed, 0 failed; 13 sections completed, 0 FATAL, 0 NOT_RUN** (`REPORT-after.md`, `report-after.json`, `manifest.json` with the sha256 of every file, 2026-10-14T14:30Z–14:36Z): desktop 1366/1440/1600/1707/1920 × Spot/Futures, AITH desktop + phone, the four contexts, panes, layout identity, sync, the 2 → 1 transition (Spot AITH 1440/1366, Futures BTC 1440, phone 390, CPU ×4), templates, go-to, snapshot, full screen, keyboard, menus, 1920 four panes, phones 320/360/390/430 + 768×1024 + 844×390, zoom 90–125 %, scenarios A/B/C and the hidden tab. Run on the working tree that is the commit carrying this folder, before it was committed (its `checkout` field shows the parent `fa76e844`). The four transition traces and videos are listed in the manifest and uploaded by CI; the Spot 1440 pair is kept in `transition/regression/on-fix/`. Evidence names never differ by case alone (`1min`, `1month`).
- `transition/` — the 2 → 1 → «К дате» failure of the CI `browser` job on `9a112675` (owner review 5518558556): reproduction on the original and the fixed toolbar with every painted frame, mutation and ResizeObserver pass recorded, the pass-by-pass trace of the fold, and the `transition` regression on a bundle with the original toolbar (25/28, the three `row-paints-once` FAIL) and on the fix (28/28). Cause and fix in `transition/README.md`.

## Performance counters (15 s windows, loopback fixture, Chromium)

| scenario | candle requests | all requests | new sockets | heap MB | canvases |
|---|---|---|---|---|---|
| A · one chart | 3 | 3 | 0 | 15 | 11 |
| B · chart + 3 compares | 3 | 4 | 0 | 15 | 7 |
| C · two charts | 4 | 4 | 0 | 17 | 18 |
| C · four charts (1920) | 7 | 18 | 0 | 19 | 32 |
| hidden tab · four charts | 0 | 0 | 0 | 19 | 32 |
| A · back to one chart | 3 | 3 | 0 | 17 | 11 |

| timing, ms | Futures 1440 | Spot 1440 |
|---|---|---|
| chart open (goto → candles) | 732 | — |
| timeframe switch 1m → 4h | 104 | 97 |
| first compare line | 1175 | 1195 |
| two charts open | 203 | 243 |
| four charts open (1920) | 285 | — |

Local numbers on this container; they say nothing about the Hetzner host.

## Defects reproduced on the baseline and fixed

| # | context · steps | expected | actual on `72f0a594` | cause in code | fix | regression |
|---|---|---|---|---|---|---|
| 1 | Spot AITH/USDT, 1440, timeframe strip and «▾» menu | 1m offered (the edge serves it), 3m built from 1m | «1м» greyed on the strip, «1м»/«3м» disabled in the menu (`before-aith-1440-tf-menu.png`) | `NATIVE_TIMEFRAMES['test-market'] = LEGACY_TIMEFRAMES` (no 1m) | `TEST_MARKET_TIMEFRAMES` = `1m 5m 15m 1h 4h 1d 1w`; one capability answer (`lib/chartCapabilities`) read by every surface; nothing unavailable is rendered | `chartTimeframes.test`, `chartCapabilities.test`; browser `aith.spot.1440.timeframes.*`, `contexts.*.nothing-disabled`, `aith.mobile.390.sheet-nothing-disabled` |
| 2 | AITH 1w, 1d | one or two bars at a readable width at the right of the plot | one weekly bar 193 px wide across the plot (`before-aith-1440-1w.png`) | `fitContent()` for ≤ `visible` bars | `initialLogicalRange()` (`lib/chartViewport`): ≥ 60 slots, bars at the right, 4 slots of padding | `chartViewport.test`; browser `*.readable-bars` (5–8 px) |
| 3 | AITH 1w/1d/1h, price axis | no tick below zero for a positive-price chart | axis down to −6 under bars 2 → 22; lowest bar at 70 % of the pane | the listing's chart had no `chartSettings`: creation-time bottom margin 0.3 (overlay volume) extrapolated by the library | `chartSettings` on `TestMarketTerminal` (volume strip, margins 0.1/0.06) + `safeBottomMargin()` clamp from the rendered edges on every pan/zoom, only for the automatic linear scale | `chartViewport.test`; browser `*.scale-non-negative` (AITH, VTA 1d/1w: bottom ≥ 0) |
| 4 | AITH toolbar | the chart settings gear as on BTC | none | same as 3 | same | `aith.spot.1440.settings-gear` |
| 5 | AITH 1h, legend | the SMA 200 says it has no value on 22 bars | «SMA 200» with no line, no note | no state | «мало данных: 22 из 200 свечей» (`indicatorMinBars`) | `aith.spot.1440.indicator-insufficient-state` |
| 6 | AITH, «Сравнить» → BTC | BTC in percent beside AITH | «Не удалось загрузить BTC/USDT» (request to `/test-assets/BTC-USDT/candles` → 404) | compare used the main chart's loader | each compared instrument reads its own source | `aith.spot.1440.compare.btc-from-spot-source` |
| 7 | AITH, layout 2 → pane BTC | BTC bars from Spot, every interval | pane `failed`, same wrong request; pane interval list without 1m/3m | pane took the main chart's source/loader | pane computes its own capabilities | `aith.spot.1440.layout.pane-own-source`, `panes.spot.1440.*` |
| 8 | AITH, 1Мес | one forming monthly bar from the listing | «Нет данных графика» | the aggregator dropped a leading bucket that does not open on the calendar boundary | a listing's first bucket is built from its first bar (as the server builds the listing's first daily bar) when the loader knows `historyStart` | `chartTimeframes.test` (listing bucket); `aith.spot.1440.1M.derived-from-1d-forming` |
| 9 | Futures, layout 2, «Синхронизировать таймфрейм» | every chart follows one interval | a checkbox with no effect (nobody published the event) | — | panes follow the main interval; a pane's pick moves the main chart | `synctf.futures.1440.sync-timeframe-is-real` |
| 10 | AITH 1w, time axis | a date under the lone weekly bar | «00:00:00» | the library picks a time-of-day label with no neighbouring tick | `timeTickLabel()`: a date for bars ≥ 1 day, HH:MM intraday | screenshot `after-aith-1440-1w.png` |
| 11 | Spot panes / compare | a listing can be opened beside BTC | test markets missing from the instrument list | the list read the venue snapshot only | live test markets added from the stores already held | `panes.spot.1440.late-answer-dropped` (SOL slow → AITH fast) |
| 12 | Spot AITH 1440 (and 1366, Futures 1440), 2 charts → 1 chart | the row settles once and «К дате» stays where it is | the row painted 3–5 different key sets over 0.3–1.6 s; «К дате» showed for a frame and moved into «Ещё»; the CI click timed out on it (found after the PR went up, owner review 5518558556) | the fold measured the squeezed strip, guessed «Ещё», relabelled after paint and restarted from a ResizeObserver callback | one fold per width in `ChartWorkspaceToolbar` (see `transition/README.md`) | `transition.*.row-paints-once` (fails 3/28 on the original toolbar, passes on the fix) |

Investigated and kept as correct: AITH 1d = 2 bars, 1w = 1 bar — the asset is one day old; the chart now shows that honestly instead of stretching it.

## Timeframes really available per context

| context | native | built from lower bars | hidden |
|---|---|---|---|
| Futures (Bybit linear via API / edge) | 1m 3m 5m 15m 30m 1h 2h 4h 6h 12h 1d 1w 1M | — | — |
| Spot BTC/ETH (Kraken, edge) | 1m 5m 15m 1h 4h 1d 1w | 3m ← 1m · 30m ← 15m · 2h, 6h ← 1h · 12h ← 4h · 1M ← 1d | — |
| AITH, NRX (edge), VTA (API) — the simulation | 1m 5m 15m 1h 4h 1d 1w | the same six | — |
| plain chart (`legacy`, no workspace toolbar) | 5m 15m 1h 4h 1d 1w | 30m 2h 6h 12h 1M | 1m 3m (never offered there) |

A built interval carries a dot and a tooltip naming its base bars; the menu explains the dot once at its foot. Production probes (read-only GET, 2026-10-14): edge `AITH-USDT` 1m → 200, 3m → 400 `unsupported_interval`; edge `NRX-USDT` 1w → 200; API `VTA-USDT` 1m → 200, 30m → 400.

## Tools verification matrix

| group | function | context | verified action | result | evidence |
|---|---|---|---|---|---|
| A views | График / Данные / Аналитика tabs | Spot, Futures, AITH; TradingView mode | switch views; data views disabled under TradingView | works | `*.data.window`, `*.analytics.panel`, `*.regression.tradingview-switch` |
| B compare | add up to 3, hide, remove, period chips, exit, relative strength | Spot BTC, Futures BTC, AITH + BTC | percent lines, max 3, exit restores candles; own source per instrument | fixed on AITH, works elsewhere | `*.compare.*`, `aith.spot.1440.compare.btc-from-spot-source` |
| C data window | hovered bar OHLCV, change, wicks, indicators | Spot, Futures, AITH 22 bars | ≥ 8 rows, UTC time, no requests on hover | works | `*.data.window`, `aith.spot.1440.data.window` |
| D analytics | period stats, volatility, relative strength | Spot, Futures, AITH «вся история» | blocks render over the short history | works | `*.analytics.panel`, `aith.spot.1440.analytics.all-history` |
| E chart types | candles, bars, hollow, Heikin-Ashi, line | Spot, Futures | each type selected and stored | works | `*.types.*` |
| F indicators & drawings | indicator menu, legend, rail, ruler, clear | Spot, Futures, AITH | menu inside viewport; legend's honest state on a short history; drawing rail present | fixed (legend), works | `*.menus.indicators`, `aith.spot.1440.indicator-insufficient-state`, `regression.terminal-intact` (rail) |
| G templates | built-in (scalping on a listing), save / rename / delete, reset | Spot, Futures, AITH | scalping applies 5m and offers 1m/3m on a listing | works | `*.presets.*`, `aith.spot.1440.presets.scalping-offers-1m-3m` |
| H go to date | loaded bar, future refused, history paging (Futures), before listing | Futures, Spot, AITH | an honest «not loaded» before the listing, no invented request | works | `*.goto.*`, `aith.spot.1440.goto.before-listing-honest` |
| I scale / full screen | reset, fit, latest, auto, log; full screen + Esc | Spot, Futures | works; clamp re-applied after reset | works | `*.menus.inside-viewport`, `*.fullscreen.toggle-escape` |
| K snapshot | PNG download / copy | Spot, Futures, AITH | real PNG > 10 KB | works | `*.snapshot.png`, `aith.spot.1440.snapshot.png` |
| L hotkeys | digits 1–9, , and ., Alt+…, Shift+F, Esc | Spot, Futures, AITH | digit 1 is 1m on a listing; keys ignored in inputs | works | `*.keyboard.*`, `aith.spot.1440.keyboard.digit-1-is-1m` |
| layout | 1/2/4, expand, phone tabs, «Торговать», sync cursor/time/timeframe | Spot, Futures, AITH, phone | main chart never remounted; pane's own instrument; sync timeframe real; 2 → 1 settles in one paint and «К дате» opens and answers | fixed (sync, transition), works | `*.layout.*`, `keep.futures.1440.*`, `synctf.futures.1440.*`, `futures.1920.layout.*`, `transition.*` |
| panes | loading / ok / empty / error+retry / stale | Spot (SOL slow → AITH, DOGE abort, NRX empty) | cleared at once, late answer dropped, retry recovers, stale dated | fixed | `panes.spot.1440.*` |

Hidden in a specific context and why: nothing in the workspace — every source serves all thirteen intervals natively or built; the plain (non-workspace) chart keeps its six and never shows 1m/3m. Blockers: Spot «К дате» cannot page history (the public Spot candle path ignores `endTime`, pre-existing, says so); compare and the data views do not apply to the TradingView iframe or the CFD chart (unchanged).
