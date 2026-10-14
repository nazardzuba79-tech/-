# Chart workspace QA — before

Build: /tmp/claude-0/-home-user--/3aa28e0f-5e9a-5b55-a5ca-126a4a881276/scratchpad/cw-dist-before
Checks: 16 passed, 0 failed

| check | result | detail |
|---|---|---|
| geometry.futures.1366.loaded | PASS | {"opened":615,"chartState":"candles","errors":[]} |
| geometry.futures.1366.no-overflow | PASS | {"vw":1366,"scrollWidth":1366} |
| geometry.spot.1366.loaded | PASS | {"opened":599,"chartState":"candles","errors":[]} |
| geometry.spot.1366.no-overflow | PASS | {"vw":1366,"scrollWidth":1366} |
| geometry.futures.1440.loaded | PASS | {"opened":1329,"chartState":"candles","errors":[]} |
| geometry.futures.1440.no-overflow | PASS | {"vw":1440,"scrollWidth":1440} |
| geometry.spot.1440.loaded | PASS | {"opened":3845,"chartState":"candles","errors":[]} |
| geometry.spot.1440.no-overflow | PASS | {"vw":1440,"scrollWidth":1440} |
| geometry.futures.1707.loaded | PASS | {"opened":1239,"chartState":"candles","errors":[]} |
| geometry.futures.1707.no-overflow | PASS | {"vw":1707,"scrollWidth":1707} |
| geometry.spot.1707.loaded | PASS | {"opened":636,"chartState":"candles","errors":[]} |
| geometry.spot.1707.no-overflow | PASS | {"vw":1707,"scrollWidth":1707} |
| geometry.futures.1920.loaded | PASS | {"opened":572,"chartState":"candles","errors":[]} |
| geometry.futures.1920.no-overflow | PASS | {"vw":1920,"scrollWidth":1920} |
| geometry.spot.1920.loaded | PASS | {"opened":695,"chartState":"candles","errors":[]} |
| geometry.spot.1920.no-overflow | PASS | {"vw":1920,"scrollWidth":1920} |

## Performance

| measure | value |
|---|---|
| geometry.futures.1366.chart | {"x":60,"y":188,"w":628,"h":390} |
| geometry.spot.1366.chart | {"x":322,"y":188,"w":402,"h":412} |
| geometry.futures.1440.chart | {"x":60,"y":188,"w":782,"h":488} |
| geometry.spot.1440.chart | {"x":322,"y":188,"w":476,"h":412} |
| geometry.futures.1707.chart | {"x":60,"y":188,"w":968,"h":390} |
| geometry.spot.1707.chart | {"x":322,"y":188,"w":738,"h":412} |
| geometry.futures.1920.chart | {"x":60,"y":188,"w":1182,"h":390} |
| geometry.spot.1920.chart | {"x":322,"y":188,"w":886,"h":412} |
| before.chartOpenMs | 510 |
| before.A.one-chart | {"candleRequests":3,"allRequests":3,"newSockets":0,"socketsTotal":1,"heapMb":15,"canvases":11,"cpuTaskMs":0,"windowMs":15000} |
