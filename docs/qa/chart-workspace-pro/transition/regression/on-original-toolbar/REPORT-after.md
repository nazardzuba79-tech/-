# Chart workspace QA — after

Verdict: **FAILED** · checks 25 passed, 3 failed · sections 1 completed, 0 fatal, 0 not run, 12 not selected

Build: /tmp/claude-0/-home-user--/3aa28e0f-5e9a-5b55-a5ca-126a4a881276/scratchpad/cw2-dist-oldtoolbar
PR head: — · checkout: fa76e844d69a2c924df5c820935387c43d28e3cb · base: — · ref: claude/peaceful-volta-h5zw7g-chart-workspace-2 · run: local
Started 2026-10-14T14:19:06.815Z · finished 2026-10-14T14:19:58.376Z · args: --dist ../cw2-dist-oldtoolbar --out ../cw2-qa-trans-old --phase after --only transition

## Sections

| section | status | checks | failed | where it stopped |
|---|---|---|---|---|
| geometry | NOT_SELECTED | — | — |  |
| aith | NOT_SELECTED | — | — |  |
| contexts | NOT_SELECTED | — | — |  |
| panes | NOT_SELECTED | — | — |  |
| keep | NOT_SELECTED | — | — |  |
| synctf | NOT_SELECTED | — | — |  |
| transition | COMPLETED | 28 | 3 |  |
| interactions.futures | NOT_SELECTED | — | — |  |
| interactions.spot | NOT_SELECTED | — | — |  |
| layout4 | NOT_SELECTED | — | — |  |
| mobile | NOT_SELECTED | — | — |  |
| zoom | NOT_SELECTED | — | — |  |
| perf | NOT_SELECTED | — | — |  |

## Checks

| check | result | detail |
|---|---|---|
| transition.spot.AITH.1440.loaded | PASS | {"opened":1240,"errors":[]} |
| transition.spot.AITH.1440.layout-2-complete | PASS | {"layout":"2","panes":["ok"],"tabs":0} |
| transition.spot.AITH.1440.layout-1-complete | PASS | {"layout":"1","panes":0,"kept":true,"chart":"candles"} |
| transition.spot.AITH.1440.row-paints-once | FAIL | {"painted":["+0ms [compare layout goto scale fullscreen more] [15m 1h 1d]","+113ms [compare scale fullscreen more] [1m 5m 15m 1h 4h 1d 1w]","+206ms [fullscreen more] [1m 5m 15m 1h 4h 1d 1w]","+298ms [more] [1m 5m 15m 1h 4h 1d 1w]"],"flickered":["compare","layout","goto","scale","fullscreen"]} |
| transition.spot.AITH.1440.goto-opens | PASS | {"via":"more","menu":"more"} |
| transition.spot.AITH.1440.goto-answers | PASS | {"status":"История за эту дату не загружена","paged":0} |
| transition.spot.AITH.1440.errors | PASS | [] |
| transition.spot.AITH.1366.loaded | PASS | {"opened":1028,"errors":[]} |
| transition.spot.AITH.1366.layout-2-complete | PASS | {"layout":"2","panes":["ok"],"tabs":0} |
| transition.spot.AITH.1366.layout-1-complete | PASS | {"layout":"1","panes":0,"kept":true,"chart":"candles"} |
| transition.spot.AITH.1366.row-paints-once | FAIL | {"painted":["+0ms [compare layout fullscreen more] [15m 1h 1d]","+102ms [compare more] [1m 5m 15m 1h 4h 1d 1w]","+291ms [layout more] [1m 15m 1h 4h 1d]","+526ms [fullscreen more] [1m 5m 15m 1h 4h 1d 1w]","+620ms [layout more] [1m 15m 1h 4h 1d]","+738ms [fullscreen more] [1m 5m 15m 1h 4h 1d 1w]","+83 |
| transition.spot.AITH.1366.goto-opens | PASS | {"via":"more","menu":"more"} |
| transition.spot.AITH.1366.goto-answers | PASS | {"status":"История за эту дату не загружена","paged":0} |
| transition.spot.AITH.1366.errors | PASS | [] |
| transition.futures.BTC.1440.loaded | PASS | {"opened":1166,"errors":[]} |
| transition.futures.BTC.1440.layout-2-complete | PASS | {"layout":"2","panes":["ok"],"tabs":0} |
| transition.futures.BTC.1440.layout-1-complete | PASS | {"layout":"1","panes":0,"kept":true,"chart":"candles"} |
| transition.futures.BTC.1440.row-paints-once | FAIL | {"painted":["+0ms [compare layout tools goto scale fullscreen more] [15m 1h 1d]","+78ms [compare layout goto scale snapshot fullscreen more] [1m 5m 15m 1h 4h 1d 1w]","+182ms [compare layout fullscreen more] [1m 5m 15m 1h 4h 1d 1w]"],"flickered":["tools","goto","scale","snapshot"]} |
| transition.futures.BTC.1440.goto-opens | PASS | {"via":"more","menu":"more"} |
| transition.futures.BTC.1440.goto-answers | PASS | {"target":1790740800,"range":{"from":1790485200,"to":1791064800},"stillOpen":0} |
| transition.futures.BTC.1440.errors | PASS | [] |
| transition.phone.spot.AITH.390.loaded | PASS | {"opened":1510,"errors":[]} |
| transition.phone.spot.AITH.390.layout-2-complete | PASS | {"layout":"2","panes":[],"tabs":2} |
| transition.phone.spot.AITH.390.layout-1-complete | PASS | {"layout":"1","panes":0,"kept":true,"chart":"candles"} |
| transition.phone.spot.AITH.390.row-paints-once | PASS | {"painted":["+0ms [compare] [1m 15m 1h 4h 1d]"],"flickered":[]} |
| transition.phone.spot.AITH.390.goto-opens | PASS | {"via":"phone-sheet","menu":"phone-sheet"} |
| transition.phone.spot.AITH.390.goto-answers | PASS | {"status":"История за эту дату не загружена","paged":0} |
| transition.phone.spot.AITH.390.errors | PASS | [] |

## Performance

| measure | value |
|---|---|

## Page errors

None.

## Evidence

12 files, 6.0 MB, sha256 per file in `manifest.json`. Case clashes: none. Screenshots reported but missing: none.
