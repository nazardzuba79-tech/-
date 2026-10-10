# Desktop Futures chart UX — Issue #502 (2026-10-10)

Base: fresh `main` `a2290d4f26a1b2ddf71c045110a89f185fd968e6`. Branch `claude/futures-chart-settings-502`; the head carries five follow-up commits pushed from the owner’s account on 2026-10-10 20:20 +0300 (`b995d041`…`412e52fa`, «isolate chart indicators, release hidden panes and cache math») and the test-pin fix that follows them (§7). Draft only; no merge, no deploy, no production change. Separate from the header-height PR (#503): this branch keeps #494's 40px header, 48px ticker, 286px book, 300px ticket, 4px gutters and 160/200/44px account states (measured below).

Design source: Figma 19:103 as exported to [figma-19-103.png](../futures-figma-desktop-20261010/figma-19-103.png) / [figma-19-103.svg](../futures-figma-desktop-20261010/figma-19-103.svg) (the Figma file itself was not reachable from this session; the exported node, its report and the owner's screenshot were the reference). The Figma extract fixes structure and measurements only; every indicator and setting below is backed by real computation or a real Lightweight Charts 5.2.1 option.

## 1. Indicator menu and catalogue

- The «Индикаторы» trigger shows the label and icon only — never a count, with one or four indicators active. The count is written to a screen-reader-only span (`chart.settings.activeCount`) and to `data-chart-indicators-active`; `.chart-menu-count` is gone from the markup, not hidden by CSS.
- The menu is a catalogue: a search field, «На графике» (every instance with show/hide, configure, remove) and the 15 indicators the chart computes. Clicking a catalogue row adds an instance with its defaults, clicking it again removes every instance of that kind; «+» adds another copy. Up to 12 instances.
- Real indicators now (`frontend/src/lib/indicators.ts`, `chartIndicators.ts`): SMA, EMA, WMA, VWAP (session, UTC day), Bollinger Bands, Supertrend — on the price pane; RSI, MACD, ATR, Stochastic, Stochastic RSI, OBV, ADX (+DI/−DI), CCI, Williams %R — each in its own pane with its own scale and reference levels (30/70, 20/80, 25, ±100, −80/−20). Volume stays the existing strip. The four indicators that existed keep their math and defaults (SMA 200, BB 20·2, RSI 14, MACD 12·26·9; the Spot MACD warm-up opt-in still rides the same gate).
- Every instance has real parameters (period, deviation, multiplier, fast/slow/signal, smoothing — with min/max/step), a colour per line, a line width (1–4) and visibility, edited in Settings → Индикаторы. Instances persist per browser and per market with field-by-field validation: the Futures chart in `voltex.chartIndicators.futures.v1`, the Spot chart in the original `voltex.chartIndicators.v1` (the follow-up commits; every store function takes a `market`, default `spot`); a browser that has never stored anything opens with SMA 200, as before.
- Data is computed only from the chart's own candles, once per candle change and once per parameter change; colour, width and visibility changes never recompute. Oscillators moved out of the main pane's bottom band on Futures (Spot/CFD keep their band). On the chart the legend prints the instance names (SMA 200, EMA 20, RSI 14, MACD 12 · 26 · 9).
- A hidden instance (the eye in the menu or the dialog) gives up its series and, for an oscillator, its pane: the Lightweight Charts table drops from 8 to 6 rows and gets them back on show. Each instance keeps its computed output, so a colour or width change repaints without recomputing (Supertrend’s per-point direction colours are remapped on the cached points). Follow-up commits; checked by the guard at every width.

Not implemented, on purpose: Ichimoku, Parabolic SAR and Pivot Points need session/calendar conventions the OHLCV feed does not carry reliably; they are not listed rather than listed half-working.

## 2. Drawing rail

- The Futures rail is 56px (Figma 19:103 draws 52px with 24px glyphs; VOLTEX's 28px TradingView glyphs read cramped in 52px). Keys are 56×38 with 24px glyphs and 2px between them; all tools, groups, flyouts and saved drawings are unchanged.
- The collapse handle is 22×48 (was 16×30), white on a lifted surface with a gold edge, a 40×56 hit area through a transparent halo (desktop only), `aria-expanded`, `aria-controls`, a discernible name, Enter/Space and a focus ring. It sits above Lightweight Charts' pane separators. Collapsing gives the plot the full 56px back (782 → 838px at 1440) without covering the plot; the state is remembered in `voltex.drawingRail.collapsed` and opens by default.

## 3. Chart settings

Four sections, as Bybit groups them. Every control maps to a real `applyOptions` call; the dialog previews live, «Отмена»/Esc/outside click revert, «Ок» keeps, «Сбросить» restores defaults (indicators included).

| Section | Controls | Lightweight Charts option |
| --- | --- | --- |
| Шкалы | Right price-scale digit colour (as the terminal / **#FFFFFF** / custom), time-scale label colour (same three), font size 10–16px, font (terminal / Inter / monospace), price-scale and time-scale visibility, scale lines + colour, ticks, linear/logarithmic, decimals (auto / 0–6) | `rightPriceScale.textColor`, `layout.textColor`, `layout.fontSize`, `layout.fontFamily`, `rightPriceScale.visible` / `timeScale.visible`, `borderVisible` + `borderColor`, `ticksVisible`, `rightPriceScale.mode`, series `priceFormat` |
| Оформление | Background, grid lines + colour + opacity, crosshair colour + style (solid/dashed/dotted), pair watermark, indicator labels on the chart, volume strip + opacity | `layout.background`, `grid.*.color` (rgba), `crosshair.*.style`, watermark primitive, legend, volume series colours |
| Свечи | Presets, body/border/wick colours and visibility, last-price line | candlestick series options |
| Индикаторы | Per instance: visibility, parameters, width, colours, remove; catalogue with search | indicator series |

Lightweight Charts paints the time axis, the crosshair labels and any price scale without a colour of its own in `layout.textColor`; only the right price scale has an independent `textColor`. The dialog says so under the two colour rows, so «time-axis colour» is honestly the chart's shared label colour and «price-axis colour» the override for the right scale. Canvas text cannot read a CSS variable, so the font choices are literal stacks.

Settings persist in the existing `voltex.chartSettings.v1` (`chartSettings.ts`), each new field validated with a backwards-compatible default; an older stored object loads unchanged. A price update never touches them: the data effect only re-applies the instrument's own precision when decimals are «auto».

## 4. Measured in the browser

`scripts/qa-futures-chart-ux.cjs` (new; read-only loopback fixture, external requests blocked, only the fixture's execution-session/quote setup POSTs): **121 assertions, 0 failed, 4 desktop widths + 390px phone sanity** (113 on the first head `f0a6684c`; the follow-up commits add the 8 pane-release checks) — [chart-ux-guard.json](chart-ux-guard.json).

| Check | 1366 | 1440 | 1707 | 1920 |
| --- | --- | --- | --- | --- |
| Trigger text with 1 and with 4 active indicators | «Индикаторы» | «Индикаторы» | «Индикаторы» | «Индикаторы» |
| Right price scale, default → #FFFFFF (neutral ≥225 px) | 0 → 244 | 0 → 428 | 0 → 428 | 0 → 428 |
| Light digits on the default scale (neutral ≥150 px) | 0 | 0 | 0 | 0 |
| After Ok, reload, symbol and interval change (white px) | 449 | 741 | 741 | 779 |
| Time scale after Ok (white px) | 260 | 259 | 559 | 558 |
| Rail width / handle | 56 / 22×48 | 56 / 22×48 | 56 / 22×48 | 56 / 22×48 |
| Plot width before → after collapse | 708 → 764 | 782 → 838 | 1048 → 1104 | 1262 → 1318 |
| Book / ticket / chart height = book height | 286 / 300 / 476 | 286 / 300 / 608 | 286 / 300 / 608 | 286 / 300 / 788 |
| Lightweight Charts table rows with 2 lower panes | 8 | 8 | 8 | 8 |
| Hiding RSI releases its pane → showing restores it (table rows) | 8 → 6 → 8 | 8 → 6 → 8 | 8 → 6 → 8 | 8 → 6 → 8 |

(Pixel counts are read from the price-scale canvas: neutral pixels ≥ 150 on every channel count as light digits, ≥ 225 as white; the default Futures axis tone #8b8b8e has none, the gold last-price tag is excluded by its hue.)

Existing guards on the same build: `qa-futures-proportions.cjs` 1920/1707/1440/1366/390 — 0 violations; `qa-futures-figma-desktop.cjs` 4/4 — header 40, chart 476/608/608/788, book 286, ticket 300, account 160/200/44; `qa-spot-cfd-terminal.cjs` (Spot/CFD phones 320–430) PASS — [guards.json](guards.json). Guards run with `LANG=en_US.UTF-8` (the container's empty locale makes Chromium log `Invalid language tag: en-US@posix`, an environment artefact).

## 5. Before / after

Same fixture, same viewport; left is `main`, right is this branch.

- Initial: [1366](initial-1366.jpg) · [1440](initial-1440.jpg) · [1707](initial-1707.jpg) · [1920](initial-1920.jpg)
- Indicator menu: [1366](indicator-menu-1366.jpg) · [1440](indicator-menu-1440.jpg) · [1707](indicator-menu-1707.jpg) · [1920](indicator-menu-1920.jpg)
- Settings → Шкалы (before: the old three-section dialog): [1366](settings-scales-1366.jpg) · [1440](settings-scales-1440.jpg) · [1707](settings-scales-1707.jpg) · [1920](settings-scales-1920.jpg)
- Rail collapsed: [1366](rail-collapsed-1366.jpg) · [1440](rail-collapsed-1440.jpg) · [1707](rail-collapsed-1707.jpg) · [1920](rail-collapsed-1920.jpg)
- After only: four indicators in panes [1440](after-indicators-on-1440.jpg) · [1920](after-indicators-on-1920.jpg); white 14px scales [1440](after-white-scales-1440.jpg) · [1920](after-white-scales-1920.jpg); final [1440](after-final-1440.jpg) · [1920](after-final-1920.jpg); phone [390](after-390-initial.jpg).

## 6. Figma 19:103 → implementation

| Figma | VOLTEX | Note |
| --- | --- | --- |
| Rail 52px, 24px glyphs, 36px pitch, no divider | 56px, 24px glyphs, 40px pitch, hairline dividers between groups | slightly wider on request; dividers kept for the TradingView grouping |
| Toolbar: timeframes, indicator icons, «Цена маркировки», TradingView Alert, camera, fullscreen | timeframes, chart type, «Индикаторы» catalogue, settings gear | Alerts, snapshot and fullscreen are not implemented and therefore not drawn |
| Price scale labels light grey | default #8b8b8e, white selectable | the owner's request |
| Chart heading «График / Обзор / Данные / Лента новостей» | «График» only | unchanged, outside this issue |

## 7. Validation

- `tsc -b && vite build` PASS; full `frontend/src` Jest: see the Draft PR for the exact count on the head SHA.
- Tests added/updated: `chartIndicators.test.ts` (indicator math on fixed candles, catalogue, schema, store); the three string-pinning suites that named the removed per-indicator refs now pin the catalogue path (`spotIndicators`, `spotChartPriceFormat`, `futuresVisualPolish`); the chart harness suites map the new `lib/chartIndicators` module the same way they map `lib/chartSettings`. No assertion was weakened; the locale digest exemption for `chart.settings.*` is used and the 12 `chart.indicator.*` names are registered as additive.
- Follow-up commits from the owner’s account (`b995d041`, `6c8b4a2e`, `7d4a5a91`, `0decd9fe`, `412e52fa`): per-market store, pane release on hide, cached indicator math, an isolation test and the 8 guard checks. Reviewed and kept as pushed: `DrawingMarket` and `IndicatorMarket` are the same union, `computeSupertrend`’s default down colour is the `#f6465d` the remap compares against, the dialog’s only caller passes `market`. Their one breakage was the `terminalGraphite` pin of the dialog’s JSX line, which now names the new line (`market={market}`), same intent.
- Spot/CFD: the catalogue is shared, the flat Spot toggles still drive the same four kinds, oscillators stay in Spot's band; `qa-spot-cfd-terminal.cjs` PASS. Mobile: the phone rail is the horizontal strip it was (390 checked); no mobile stylesheet changed except that the desktop-only halo is gated to ≥ 901px.

## 8. Known deviations and limits

- Lightweight Charts has one `layout.textColor` for the time axis and crosshair labels; a different colour for the time axis alone is not an option the library exposes.
- The handle covers 22×48px of the plot's left edge at 80% height in both states (the position the owner marked in 2026-09); it is above pane separators but still over the plot's first pixels.
- VWAP resets at the UTC day; exchange-session anchoring (e.g. a 00:00 UTC+8 day) is not offered.
- Indicator instances are stored per market since the follow-up commits (Futures and Spot lists are independent); the paint settings in `voltex.chartSettings.v1` stay shared between the two charts, as before.
- Figma MCP/API access was not available; measurements come from the exported SVG/PNG and the earlier report.
