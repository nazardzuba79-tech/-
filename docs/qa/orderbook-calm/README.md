# Futures order book — calm-cadence evidence

The owner's complaint was that the Futures order book "squeaks" once loaded,
and attached a 24.7 s capture of Binance Futures BTCUSDT as the target. This
directory holds the measurements that turned that into a number and then
showed the number was met.

## The instrument

`scripts/qa-orderbook-calm.cjs`. It drives the built app in Chromium against a
**seeded** replay socket, so before and after see byte-identical depth traffic
and any difference in the result is a difference in rendering, not in data.

Capture is CDP `Page.startScreencast`, which hands over the frames the
compositor actually painted. An earlier version of this harness used Playwright
`recordVideo` plus ffmpeg and had to be thrown away: the encoder's keyframes
register as whole-frame changes, so it reported 8 changed frames and a 99.8 %
peak on a region that never moved. Every run therefore includes a **control**
region that is required to read `bookChanges: 0` / `stillShare: 100`. A run
whose control is non-zero is not evidence and must be discarded.

Frames are resampled to a fixed 30 fps grid before differencing so that the
screencast's variable frame delivery cannot inflate or deflate the rate.

## The target, measured from the owner's video

    2.5 repaints per second · 425 ms mean gap · 2.82 % peak frame change

## Files

| file | what it is |
|---|---|
| `before.json` | baseline on `main`'s rendering, same seed |
| `diag.json`, `diag-book.png` | intermediate run, after removing the ease from `ReferenceFuturesTerminal.css` alone — barely moved, which is what pointed at a second declaration |
| `after.json`, `after-book.png` | final run |
| `after-dom.json`, `after-dom-book-*.png` | 15 s MutationObserver run, desktop and mobile: proves rows are never added or removed and the ladder height never changes |

## Result

Ladder (`byRegion.asks` / `byRegion.bids`), same seed, same window:

| | before | after | Binance |
|---|---|---|---|
| compositor frames in ~6 s | 249 | **28** | — |
| repaints/sec | 5.39 | **2.17** | 2.5 |
| mean gap | 186 ms | **452 ms** | 425 ms |
| still share | 82.0 % | **92.7 %** | — |
| control region | 0 | **0** | — |

`after.json.ladderContent` separately probes the DOM under rAF: 2.33 text
updates/sec and 2.33 bar updates/sec. Pixel cadence and content cadence now
agree, which is the point — before the fix the panel repainted at 4.22/s while
its content changed 2.33 times a second, and the surplus was pure animation.

`after-dom.json` shows `rowsAdded: 0`, `rowsRemoved: 0` and a single value in
`rowCounts` and `heights` at both widths: no row jitter, no reflow.

## Root cause

A CSS transition on the depth bars (`transition: transform .14s linear`) that
outlives the publish interval, so every publish started an animation the next
publish interrupted — a continuously repainting panel. It was declared in
**two** sheets, and removing it from `ReferenceFuturesTerminal.css` alone did
almost nothing (`diag.json`, 5.88/s) because `TerminalAccountPanel.css` is
imported last by `FuturesPage` and re-declared it.

Nothing in the data path was touched. `FLUSH_MS` moved 300 → 400 ms, which is
display coalescing only and is asserted as such by
`frontend/src/lib/__tests__/futuresDepth.test.ts`.
