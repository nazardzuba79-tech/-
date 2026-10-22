# Desktop Futures: global header 40 → 48 px (2026-10-10)

Base: fresh `main` `a2290d4f26a1b2ddf71c045110a89f185fd968e6`. Branch `claude/futures-header-height`. Separate from the chart UX work (Issue #502); Draft only, no merge, no deploy, no production change.

## Why

The chart-priority pass (#494) set the Futures page's global header to 40px. The owner found the row too dense: the 34px account controls (currency, profile) sat 3px from both edges, the 32px wallet/deposit pills 4px, and the row read as part of the BTC/USDT instrument bar beneath it. Bybit's own header above Figma 19:103 is 48px (the extracted Container starts at y = 47.99 in the SVG/PNG), so 48px is the reference height, not a guess.

## What changed

- `frontend/src/pages/trade-terminal/FuturesBybitParity.css` — the existing desktop (≥ 901px) rule `#archive-terminal-preview.futures-terminal > .global-header`: `--exchange-header-height`, `height`, `min-height`, `flex-basis` 40 → 48px; navigation links `line-height` 40 → 48px so every link keeps a full-height hit area and stays centred. Nothing else in the header changes: 32px pills, 14px Inter, paddings, dropdown panels, sticky position and z-index 20 are as before.
- `scripts/qa-futures-figma-desktop.cjs` — the header assertion is 48px now (it was the one place that pinned 40); every other geometry assertion is unchanged.
- `frontend/src/pages/trade-terminal/FuturesFigmaDesktop.css` — one comment line.

The rule is scoped to the Futures terminal root at ≥ 901px: Spot, CFD, every other page and the phone layout (its own 52px header in `FuturesMobile.css`) are untouched by construction. The order book stays 286px, the ticket 300px, the account panel 160/200/44px.

## Measured in the browser (DOM, not CSS)

Playwright Chromium on the read-only proportions fixture; [dom-measurements.json](dom-measurements.json) holds every element rectangle.

| Viewport | Header before → after | Items centred (max offset) | Gap to instrument bar | Right-edge overflow | Chart area before → after |
| --- | --- | --- | --- | --- | --- |
| 1366 × 768 | 40 → 48 | 0 px | 4 px | none (12px padding kept) | 476 → 468 px (60.9% of the viewport) |
| 1440 × 900 | 40 → 48 | 0 px | 4 px | none | 608 → 600 px (66.7%) |
| 1707 × 900 | 40 → 48 | 0 px | 4 px | none (16px padding kept) | 608 → 600 px (66.7%) |
| 1920 × 1080 | 40 → 48 | 0 px | 4 px | none | 788 → 780 px (72.2%) |

Inside the 48px row: navigation links 48px tall (full-height hit area), wallet/deposit pills 32px (8px above and below), currency and profile 34px (7px), burger 34px at ≤ 1530px. No element crosses the header's top or bottom edge; the instrument bar starts 4px below it (the terminal's gutter), as in the reference.

The same measurements were repeated in all seven languages (ru, en, zh, es, hi, ja, ko) at the four widths and at 90%, 110% and 125% browser zoom (emulated as a CSS viewport of width/zoom with the matching device scale factor) at 1366/1440/1920: header 48px, items centred, no overflow, no document overflow in every case. Long labels (`Banking & Earn`, `Торговые боты`, `コピートレード`) keep the ≥ 12px gap the proportions guard requires.

## Before / after

- [1366](header-before-after-1366.png) · [1440](header-before-after-1440.png) · [1707](header-before-after-1707.png) · [1920](header-before-after-1920.png) — same fixture, same viewport; top row 40px, bottom row 48px.

## Guards

- `scripts/qa-futures-proportions.cjs --phase after --widths 1920,1707,1440,1366,390`: 0 violations (header item gaps, navigation/account overlap, every header dropdown inside the viewport at 1707/1920, mobile drawer at 390, chart/book/ticket/account checks).
- `scripts/qa-futures-figma-desktop.cjs`: 4/4 widths PASS with the 48px assertion (286px book, 300px ticket, 4px gutters, 160/200/44px account states, chart > 60% of the viewport, no overflow, no external requests, no financial writes).
- Jest header/terminal guards (`sharedHeaderStylesheetOwnership`, `futuresVisualPolish`, `terminalDesignSystem`, `spotCfdGraphite`, `terminalGraphite`): PASS. The full `frontend/src` suite result is recorded on the Draft PR.
- Locale note: in this container Chromium reports `navigator.language = en-US@posix` and the page logs `Invalid language tag`; the guards are run with `LANG=en_US.UTF-8`, as a normal desktop or the CI runner has. This is an environment artefact, not a page defect.

## Trade-off stated plainly

The chart plot loses 8px at every width. At 1366 × 768 the chart area is 468px, still above the 60% floor the desktop guard enforces (460.8px). 44px was considered and would cost 4px, but leaves the 34px controls with 5px of air and does not match the Bybit reference; 48px does both.
