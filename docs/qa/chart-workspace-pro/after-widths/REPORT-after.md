# Chart workspace QA — after

Build: /tmp/claude-0/-home-user--/3aa28e0f-5e9a-5b55-a5ca-126a4a881276/scratchpad/wt-cw2/frontend/dist
Checks: 32 passed, 0 failed

| check | result | detail |
|---|---|---|
| geometry.futures.1600.loaded | PASS | {"opened":897,"chartState":"candles","errors":[]} |
| geometry.futures.1600.no-overflow | PASS | {"vw":1600,"scrollWidth":1600} |
| geometry.futures.1600.two-rows | PASS | {"toolbar":{"x":16,"y":154,"w":974,"h":28},"heading":{"x":4,"y":112,"w":998,"h":36},"views":{"x":20,"y":124,"w":189,"h":22}} |
| geometry.futures.1600.features-inside | PASS | {"visible":["timeframes","compare","layout","tools","scale","fullscreen","more"],"clipped":[]} |
| geometry.futures.1600.quick-timeframes | PASS | {"quick":["1m","5m","15m","1h","4h","1d","1w"],"dense":null} |
| geometry.spot.1600.loaded | PASS | {"opened":908,"chartState":"candles","errors":[]} |
| geometry.spot.1600.no-overflow | PASS | {"vw":1600,"scrollWidth":1600} |
| geometry.spot.1600.two-rows | PASS | {"toolbar":{"x":278,"y":154,"w":748,"h":28},"heading":{"x":266,"y":112,"w":772,"h":36},"views":{"x":282,"y":124,"w":189,"h":22}} |
| geometry.spot.1600.features-inside | PASS | {"visible":["timeframes","compare","scale","fullscreen","more"],"clipped":[]} |
| geometry.spot.1600.quick-timeframes | PASS | {"quick":["1m","5m","15m","1h","4h","1d","1w"],"dense":null} |
| futures.1440.regression.terminal-intact | PASS | {"form":true,"formVisible":true,"book":true,"rail":true,"tv":["VOLTEX","TradingView"]} |
| futures.1440.regression.tradingview-switch | PASS | {"iframe":false,"dataDisabled":true,"form":true,"back":"candles"} |
| futures.1440.errors | PASS | [] |
| spot.1440.regression.terminal-intact | PASS | {"form":true,"formVisible":true,"book":true,"rail":true,"tv":["VOLTEX","TradingView"]} |
| spot.1440.regression.tradingview-switch | PASS | {"iframe":false,"dataDisabled":true,"form":true,"back":"candles"} |
| spot.1440.errors | PASS | [] |
| mobile.futures.768x1024.loaded | PASS | {"chartState":"candles","overflow":false,"errors":[]} |
| mobile.futures.768x1024.phone-row | PASS | {"h":44,"quick":7,"sheet":true,"rows":1,"stripScrolls":false,"menuKeyVisible":true,"clipped":[]} |
| mobile.futures.768x1024.sheet | PASS | {"sheet":{"id":"phone-sheet","x":0,"y":384,"w":768,"h":640,"vw":768,"vh":1024,"inside":true},"sheetItems":["menus","layout","tools","presets","goto","scale","snapshot","fullscreen","fullscreen"]} |
| mobile.futures.768x1024.order-form-reachable | PASS | {"visible":true} |
| mobile.spot.768x1024.loaded | PASS | {"chartState":"candles","overflow":false,"errors":[]} |
| mobile.spot.768x1024.phone-row | PASS | {"h":44,"quick":7,"sheet":true,"rows":1,"stripScrolls":false,"menuKeyVisible":true,"clipped":[]} |
| mobile.spot.768x1024.sheet | PASS | {"sheet":{"id":"phone-sheet","x":0,"y":384,"w":768,"h":640,"vw":768,"vh":1024,"inside":true},"sheetItems":["menus","layout","tools","presets","goto","scale","snapshot","fullscreen","fullscreen"]} |
| mobile.spot.768x1024.order-form-reachable | PASS | {"visible":true} |
| mobile.futures.844x390.loaded | PASS | {"chartState":"candles","overflow":false,"errors":[]} |
| mobile.futures.844x390.phone-row | PASS | {"h":44,"quick":7,"sheet":true,"rows":1,"stripScrolls":false,"menuKeyVisible":true,"clipped":[]} |
| mobile.futures.844x390.sheet | PASS | {"sheet":{"id":"phone-sheet","x":0,"y":70,"w":844,"h":320,"vw":844,"vh":390,"inside":true},"sheetItems":["menus","layout","tools","presets","goto","scale","snapshot","fullscreen","fullscreen"]} |
| mobile.futures.844x390.order-form-reachable | PASS | {"visible":true} |
| mobile.spot.844x390.loaded | PASS | {"chartState":"candles","overflow":false,"errors":[]} |
| mobile.spot.844x390.phone-row | PASS | {"h":44,"quick":7,"sheet":true,"rows":1,"stripScrolls":false,"menuKeyVisible":true,"clipped":[]} |
| mobile.spot.844x390.sheet | PASS | {"sheet":{"id":"phone-sheet","x":0,"y":70,"w":844,"h":320,"vw":844,"vh":390,"inside":true},"sheetItems":["menus","layout","tools","presets","goto","scale","snapshot","fullscreen","fullscreen"]} |
| mobile.spot.844x390.order-form-reachable | PASS | {"visible":true} |

## Performance

| measure | value |
|---|---|
| geometry.futures.1600.chart | {"x":60,"y":188,"w":862,"h":390} |
| geometry.spot.1600.chart | {"x":322,"y":188,"w":636,"h":412} |
