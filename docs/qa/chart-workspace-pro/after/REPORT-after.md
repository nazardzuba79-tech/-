# Chart workspace QA — after

Verdict: **PASSED** · checks 266 passed, 0 failed · sections 13 completed, 0 fatal, 0 not run, 0 not selected

Build: /tmp/claude-0/-home-user--/3aa28e0f-5e9a-5b55-a5ca-126a4a881276/scratchpad/wt-cw2/frontend/dist
PR head: — · checkout: fa76e844d69a2c924df5c820935387c43d28e3cb · base: — · ref: claude/peaceful-volta-h5zw7g-chart-workspace-2 · run: local
Started 2026-10-14T14:30:23.770Z · finished 2026-10-14T14:36:24.567Z · args: --dist frontend/dist --out ../cw2-qa-full-final --phase after

## Sections

| section | status | checks | failed | where it stopped |
|---|---|---|---|---|
| geometry | COMPLETED | 50 | 0 |  |
| aith | COMPLETED | 31 | 0 |  |
| contexts | COMPLETED | 6 | 0 |  |
| panes | COMPLETED | 7 | 0 |  |
| keep | COMPLETED | 1 | 0 |  |
| synctf | COMPLETED | 1 | 0 |  |
| transition | COMPLETED | 28 | 0 |  |
| interactions.futures | COMPLETED | 39 | 0 |  |
| interactions.spot | COMPLETED | 39 | 0 |  |
| layout4 | COMPLETED | 2 | 0 |  |
| mobile | COMPLETED | 52 | 0 |  |
| zoom | COMPLETED | 4 | 0 |  |
| perf | COMPLETED | 6 | 0 |  |

## Checks

| check | result | detail |
|---|---|---|
| geometry.futures.1366.loaded | PASS | {"opened":841,"chartState":"candles","errors":[]} |
| geometry.futures.1366.no-overflow | PASS | {"vw":1366,"scrollWidth":1366} |
| geometry.futures.1366.two-rows | PASS | {"toolbar":{"x":16,"y":154,"w":740,"h":28},"heading":{"x":4,"y":112,"w":764,"h":36},"views":{"x":20,"y":124,"w":189,"h":22}} |
| geometry.futures.1366.features-inside | PASS | {"visible":["timeframes","compare","scale","fullscreen","more"],"clipped":[]} |
| geometry.futures.1366.quick-timeframes | PASS | {"quick":["1m","5m","15m","1h","4h","1d","1w"],"dense":null} |
| geometry.spot.1366.loaded | PASS | {"opened":752,"chartState":"candles","errors":[]} |
| geometry.spot.1366.no-overflow | PASS | {"vw":1366,"scrollWidth":1366} |
| geometry.spot.1366.two-rows | PASS | {"toolbar":{"x":278,"y":154,"w":514,"h":28},"heading":{"x":266,"y":112,"w":538,"h":36},"views":{"x":282,"y":124,"w":189,"h":22}} |
| geometry.spot.1366.features-inside | PASS | {"visible":["timeframes","layout","more"],"clipped":[]} |
| geometry.spot.1366.quick-timeframes | PASS | {"quick":["1m","15m","1h","4h","1d"],"dense":"1"} |
| geometry.futures.1440.loaded | PASS | {"opened":678,"chartState":"candles","errors":[]} |
| geometry.futures.1440.no-overflow | PASS | {"vw":1440,"scrollWidth":1440} |
| geometry.futures.1440.two-rows | PASS | {"toolbar":{"x":16,"y":154,"w":814,"h":28},"heading":{"x":4,"y":112,"w":838,"h":36},"views":{"x":20,"y":124,"w":189,"h":22}} |
| geometry.futures.1440.features-inside | PASS | {"visible":["timeframes","compare","layout","fullscreen","more"],"clipped":[]} |
| geometry.futures.1440.quick-timeframes | PASS | {"quick":["1m","5m","15m","1h","4h","1d","1w"],"dense":null} |
| geometry.spot.1440.loaded | PASS | {"opened":660,"chartState":"candles","errors":[]} |
| geometry.spot.1440.no-overflow | PASS | {"vw":1440,"scrollWidth":1440} |
| geometry.spot.1440.two-rows | PASS | {"toolbar":{"x":278,"y":154,"w":588,"h":28},"heading":{"x":266,"y":112,"w":612,"h":36},"views":{"x":282,"y":124,"w":189,"h":22}} |
| geometry.spot.1440.features-inside | PASS | {"visible":["timeframes","more"],"clipped":[]} |
| geometry.spot.1440.quick-timeframes | PASS | {"quick":["1m","5m","15m","1h","4h","1d","1w"],"dense":null} |
| geometry.futures.1600.loaded | PASS | {"opened":692,"chartState":"candles","errors":[]} |
| geometry.futures.1600.no-overflow | PASS | {"vw":1600,"scrollWidth":1600} |
| geometry.futures.1600.two-rows | PASS | {"toolbar":{"x":16,"y":154,"w":974,"h":28},"heading":{"x":4,"y":112,"w":998,"h":36},"views":{"x":20,"y":124,"w":189,"h":22}} |
| geometry.futures.1600.features-inside | PASS | {"visible":["timeframes","compare","layout","tools","scale","fullscreen","more"],"clipped":[]} |
| geometry.futures.1600.quick-timeframes | PASS | {"quick":["1m","5m","15m","1h","4h","1d","1w"],"dense":null} |
| geometry.spot.1600.loaded | PASS | {"opened":779,"chartState":"candles","errors":[]} |
| geometry.spot.1600.no-overflow | PASS | {"vw":1600,"scrollWidth":1600} |
| geometry.spot.1600.two-rows | PASS | {"toolbar":{"x":278,"y":154,"w":748,"h":28},"heading":{"x":266,"y":112,"w":772,"h":36},"views":{"x":282,"y":124,"w":189,"h":22}} |
| geometry.spot.1600.features-inside | PASS | {"visible":["timeframes","compare","scale","fullscreen","more"],"clipped":[]} |
| geometry.spot.1600.quick-timeframes | PASS | {"quick":["1m","5m","15m","1h","4h","1d","1w"],"dense":null} |
| geometry.futures.1707.loaded | PASS | {"opened":766,"chartState":"candles","errors":[]} |
| geometry.futures.1707.no-overflow | PASS | {"vw":1707,"scrollWidth":1707} |
| geometry.futures.1707.two-rows | PASS | {"toolbar":{"x":16,"y":154,"w":1081,"h":28},"heading":{"x":4,"y":112,"w":1105,"h":36},"views":{"x":20,"y":124,"w":189,"h":22}} |
| geometry.futures.1707.features-inside | PASS | {"visible":["timeframes","compare","layout","tools","goto","scale","snapshot","fullscreen","more"],"clipped":[]} |
| geometry.futures.1707.quick-timeframes | PASS | {"quick":["1m","5m","15m","1h","4h","1d","1w"],"dense":null} |
| geometry.spot.1707.loaded | PASS | {"opened":719,"chartState":"candles","errors":[]} |
| geometry.spot.1707.no-overflow | PASS | {"vw":1707,"scrollWidth":1707} |
| geometry.spot.1707.two-rows | PASS | {"toolbar":{"x":278,"y":154,"w":852,"h":28},"heading":{"x":266,"y":112,"w":876,"h":36},"views":{"x":282,"y":124,"w":189,"h":22}} |
| geometry.spot.1707.features-inside | PASS | {"visible":["timeframes","compare","layout","scale","fullscreen","more"],"clipped":[]} |
| geometry.spot.1707.quick-timeframes | PASS | {"quick":["1m","5m","15m","1h","4h","1d","1w"],"dense":null} |
| geometry.futures.1920.loaded | PASS | {"opened":687,"chartState":"candles","errors":[]} |
| geometry.futures.1920.no-overflow | PASS | {"vw":1920,"scrollWidth":1920} |
| geometry.futures.1920.two-rows | PASS | {"toolbar":{"x":16,"y":154,"w":1294,"h":28},"heading":{"x":4,"y":112,"w":1318,"h":36},"views":{"x":20,"y":124,"w":189,"h":22}} |
| geometry.futures.1920.features-inside | PASS | {"visible":["timeframes","compare","layout","tools","presets","goto","scale","snapshot","fullscreen"],"clipped":[]} |
| geometry.futures.1920.quick-timeframes | PASS | {"quick":["1m","5m","15m","1h","4h","1d","1w"],"dense":null} |
| geometry.spot.1920.loaded | PASS | {"opened":798,"chartState":"candles","errors":[]} |
| geometry.spot.1920.no-overflow | PASS | {"vw":1920,"scrollWidth":1920} |
| geometry.spot.1920.two-rows | PASS | {"toolbar":{"x":278,"y":154,"w":999,"h":28},"heading":{"x":266,"y":112,"w":1023,"h":36},"views":{"x":282,"y":124,"w":189,"h":22}} |
| geometry.spot.1920.features-inside | PASS | {"visible":["timeframes","compare","layout","tools","scale","fullscreen","more"],"clipped":[]} |
| geometry.spot.1920.quick-timeframes | PASS | {"quick":["1m","5m","15m","1h","4h","1d","1w"],"dense":null} |
| aith.spot.1440.loaded | PASS | {"opened":802,"errors":[],"last":{"path":"/market/test-assets/AITH-USDT/candles","interval":"1h","limit":520},"fixtureBars":{"1m":1000,"5m":259,"15m":87,"1h":22,"4h":6,"1d":2,"1w":1}} |
| aith.spot.1440.timeframes.nothing-disabled | PASS | {"strip":[{"tf":"1m","plan":"native","off":false},{"tf":"5m","plan":"native","off":false},{"tf":"15m","plan":"native","off":false},{"tf":"1h","plan":"native","off":false},{"tf":"4h","plan":"native","off":false},{"tf":"1d","plan":"native","off":false},{"tf":"1w","plan":"native","off":false}],"options |
| aith.spot.1440.timeframes.1m-native-3m-derived | PASS | {"strip":[{"tf":"1m","plan":"native","off":false},{"tf":"5m","plan":"native","off":false},{"tf":"15m","plan":"native","off":false},{"tf":"1h","plan":"native","off":false},{"tf":"4h","plan":"native","off":false},{"tf":"1d","plan":"native","off":false},{"tf":"1w","plan":"native","off":false}],"hints": |
| aith.spot.1440.1w.native-request | PASS | {"last":{"path":"/market/test-assets/AITH-USDT/candles","interval":"1w","limit":520},"state":"candles"} |
| aith.spot.1440.1w.readable-bars | PASS | {"widestBodyPx":5,"bodiesOnRow":1,"bars":1} |
| aith.spot.1440.1w.scale-non-negative | PASS | {"top":24.33594962616981,"bottom":0.6040734682519753,"paneHeight":412,"logical":{"from":-55,"to":4},"barSpacing":7.933333333333334} |
| aith.spot.1440.1d.native-request | PASS | {"last":{"path":"/market/test-assets/AITH-USDT/candles","interval":"1d","limit":520},"state":"candles"} |
| aith.spot.1440.1d.readable-bars | PASS | {"widestBodyPx":5,"bodiesOnRow":1,"bars":2} |
| aith.spot.1440.1d.scale-non-negative | PASS | {"top":24.33594962616981,"bottom":0.6040734682519753,"paneHeight":412,"logical":{"from":-54,"to":5},"barSpacing":7.933333333333334} |
| aith.spot.1440.1h.native-request | PASS | {"last":{"path":"/market/test-assets/AITH-USDT/candles","interval":"1h","limit":520},"state":"candles"} |
| aith.spot.1440.1h.readable-bars | PASS | {"widestBodyPx":5,"bodiesOnRow":1,"bars":22} |
| aith.spot.1440.1h.scale-non-negative | PASS | {"top":24.33594962616981,"bottom":0.6040734682519753,"paneHeight":412,"logical":{"from":-34,"to":25},"barSpacing":7.933333333333334} |
| aith.spot.1440.5m.native-request | PASS | {"last":{"path":"/market/test-assets/AITH-USDT/candles","interval":"5m","limit":520},"state":"candles"} |
| aith.spot.1440.5m.readable-bars | PASS | {"widestBodyPx":3,"bodiesOnRow":2,"bars":259} |
| aith.spot.1440.5m.scale-non-negative | PASS | {"top":23.690509972549034,"bottom":6.397364339828765,"paneHeight":412,"logical":{"from":139,"to":258},"barSpacing":4.1} |
| aith.spot.1440.1m.native-request | PASS | {"last":{"path":"/market/test-assets/AITH-USDT/candles","interval":"1m","limit":520},"state":"candles"} |
| aith.spot.1440.1m.readable-bars | PASS | {"widestBodyPx":3,"bodiesOnRow":23,"bars":1000} |
| aith.spot.1440.1m.scale-non-negative | PASS | {"top":22.616454556532346,"bottom":16.037793777764985,"paneHeight":412,"logical":{"from":400,"to":519},"barSpacing":4.166666666666667} |
| aith.spot.1440.settings-gear | PASS | {"gear":true,"legend":"SMA 200мало данных: 22 из 200 свечей","insufficient":1} |
| aith.spot.1440.indicator-insufficient-state | PASS | {"gear":true,"legend":"SMA 200мало данных: 22 из 200 свечей","insufficient":1} |
| aith.spot.1440.1M.derived-from-1d-forming | PASS | {"last":{"path":"/market/test-assets/AITH-USDT/candles","interval":"1d","limit":1000},"state":"candles","widest":5,"prices":{"top":24.33594962616981,"bottom":0.6040734682519753,"paneHeight":412,"logical":{"from":-55,"to":4},"barSpacing":7.933333333333334},"partial":" · Последняя свеча ещё формируетс |
| aith.spot.1440.compare.btc-from-spot-source | PASS | {"entry":"BTC/USDT+2,40%","value":"+2,40%","requests":["/api/v1/market/external/candles/BTC-USDT"]} |
| aith.spot.1440.layout.pane-own-source | PASS | {"state":"ok","pair":"BTC/USDT","options":["1m","3m","5m","15m","30m","1h","2h","4h","6h","12h","1d","1w","1M"],"last":"85,794.25","requests":["/api/v1/market/external/candles/BTC-USDT","/api/v1/market/external/candles/BTC-USDT"]} |
| aith.spot.1440.goto.before-listing-honest | PASS | {"open":true,"status":"История за эту дату не загружена","paged":0} |
| aith.spot.1440.data.window | PASS | {"rows":12,"text":"Данные свечиЗавершённая свечаВремя (UTC)2026-10-14 08:00Открытие12.60Максимум14.06Минимум12.48Закрытие13.98Объём19 410Изменение+1.3735Изменение, %+10,90%Тело1.3"} |
| aith.spot.1440.analytics.all-history | PASS | {"blocks":3,"text":"Аналитика периодаВидимый диапазонВся история1 день1 неделя1 месяцИзменение цены+19.78 (+968,69%)Максимум21.96Минимум2.0315Размах High–Low19.93 (980,85%)Сумма объёмов411 955Завершённых свечей21 + текущая (не завершена)Наибольший рост+30,68% · 2026-10-13 17:00На"} |
| aith.spot.1440.presets.scalping-offers-1m-3m | PASS | {"quick":["1m","3m","5m","15m","30m","1h"],"pressed":"5m","state":"candles"} |
| aith.spot.1440.keyboard.digit-1-is-1m | PASS | {"pressed":"1m","last":"/market/test-assets/AITH-USDT/candles?interval=1m&limit=520&listingVersion=7"} |
| aith.spot.1440.snapshot.png | PASS | {"size":25082} |
| aith.spot.1440.errors | PASS | [] |
| aith.mobile.390.sheet-nothing-disabled | PASS | {"opened":1020,"disabled":[],"count":13,"inside":true} |
| contexts.futures.BTC.nothing-disabled | PASS | {"opened":707,"strip":["1m:native","5m:native","15m:native","1h:native","4h:native","1d:native","1w:native"],"options":["1m:native","3m:native","5m:native","15m:native","30m:native","1h:native","2h:native","4h:native","6h:native","12h:native","1d:native","1w:native","1M:native"],"errors":[]} |
| contexts.spot.BTC.nothing-disabled | PASS | {"opened":785,"strip":["1m:native","5m:native","15m:native","1h:native","4h:native","1d:native","1w:native"],"options":["1m:native","3m:derived","5m:native","15m:native","30m:derived","1h:native","2h:derived","4h:native","6h:derived","12h:derived","1d:native","1w:native","1M:derived"],"errors":[]} |
| contexts.spot.NRX.nothing-disabled | PASS | {"opened":753,"strip":["1m:native","5m:native","15m:native","1h:native","4h:native","1d:native","1w:native"],"options":["1m:native","3m:derived","5m:native","15m:native","30m:derived","1h:native","2h:derived","4h:native","6h:derived","12h:derived","1d:native","1w:native","1M:derived"],"errors":[]} |
| contexts.spot.VTA.nothing-disabled | PASS | {"opened":664,"strip":["1m:native","5m:native","15m:native","1h:native","4h:native","1d:native","1w:native"],"options":["1m:native","3m:derived","5m:native","15m:native","30m:derived","1h:native","2h:derived","4h:native","6h:derived","12h:derived","1d:native","1w:native","1M:derived"],"errors":[]} |
| contexts.spot.VTA.1d.scale-non-negative | PASS | {"prices":{"top":11.658059197434266,"bottom":0.010157252725976772,"paneHeight":412,"logical":{"from":-39,"to":20},"barSpacing":7.933333333333334},"widest":5} |
| contexts.spot.VTA.1w.scale-non-negative | PASS | {"prices":{"top":11.658059197434266,"bottom":0.010157252725976772,"paneHeight":412,"logical":{"from":-53,"to":6},"barSpacing":7.933333333333334},"widest":5} |
| panes.spot.1440.opens-on-another-instrument | PASS | {"state":"ok","source":"spot-public","pair":"ETH/USDT","tf":"1h","shown":"3236.26","stale":null,"note":null,"bars":300,"last":3236.255211554749} |
| panes.spot.1440.switch-clears-at-once | PASS | {"state":"loading","source":"spot-public","pair":"SOL/USDT","tf":"1h","shown":null,"stale":null,"note":"Загрузка…","bars":0,"last":null} |
| panes.spot.1440.late-answer-dropped | PASS | {"quick":{"state":"ok","source":"test-market","pair":"AITH/USDT","tf":"1h","shown":"21.8168","stale":null,"note":null,"bars":22,"last":21.816811954064082},"late":{"state":"ok","source":"test-market","pair":"AITH/USDT","tf":"1h","shown":"21.8168","stale":null,"note":null,"bars":22,"last":21.816811954 |
| panes.spot.1440.error-then-retry | PASS | {"failed":{"state":"error","source":"spot-public","pair":"DOGE/USDT","tf":"1h","shown":null,"stale":null,"note":"Не удалось загрузитьПовторить","bars":0,"last":null},"recovered":{"state":"ok","source":"spot-public","pair":"DOGE/USDT","tf":"1h","shown":"0.119524","stale":null,"note":null,"bars":300," |
| panes.spot.1440.refresh-failure-is-stale-not-blank | PASS | {"state":"stale","source":"spot-public","pair":"DOGE/USDT","tf":"1h","shown":"0.119524","stale":"Не обновляется с 14:31","note":null,"bars":300,"last":0.11952441446676851} |
| panes.spot.1440.empty-answer-is-not-success | PASS | {"state":"empty","source":"test-market","pair":"NRX/USDT","tf":"1h","shown":null,"stale":null,"note":"Нет истории","bars":0,"last":null} |
| panes.spot.1440.errors | PASS | [] |
| keep.futures.1440.main-chart-never-remounted | PASS | {"before":{"from":400,"to":519},"after":{"kept":true,"token":"kept","form":true,"from":221,"to":519,"panes":0}} |
| synctf.futures.1440.sync-timeframe-is-real | PASS | {"follows":"15m","leads":{"main":"4h","pressed":"true"},"own":{"main":"4h","pane":"1h"}} |
| transition.spot.AITH.1440.loaded | PASS | {"opened":950,"errors":[]} |
| transition.spot.AITH.1440.layout-2-complete | PASS | {"layout":"2","panes":["ok"],"tabs":0} |
| transition.spot.AITH.1440.layout-1-complete | PASS | {"layout":"1","panes":0,"kept":true,"chart":"candles"} |
| transition.spot.AITH.1440.row-paints-once | PASS | {"painted":["+0ms [more] [1m 5m 15m 1h 4h 1d 1w]"],"flickered":[]} |
| transition.spot.AITH.1440.goto-opens | PASS | {"via":"more","menu":"more"} |
| transition.spot.AITH.1440.goto-answers | PASS | {"status":"История за эту дату не загружена","paged":0} |
| transition.spot.AITH.1440.errors | PASS | [] |
| transition.spot.AITH.1366.loaded | PASS | {"opened":914,"errors":[]} |
| transition.spot.AITH.1366.layout-2-complete | PASS | {"layout":"2","panes":["ok"],"tabs":0} |
| transition.spot.AITH.1366.layout-1-complete | PASS | {"layout":"1","panes":0,"kept":true,"chart":"candles"} |
| transition.spot.AITH.1366.row-paints-once | PASS | {"painted":["+0ms [layout more] [1m 15m 1h 4h 1d]"],"flickered":[]} |
| transition.spot.AITH.1366.goto-opens | PASS | {"via":"more","menu":"more"} |
| transition.spot.AITH.1366.goto-answers | PASS | {"status":"История за эту дату не загружена","paged":0} |
| transition.spot.AITH.1366.errors | PASS | [] |
| transition.futures.BTC.1440.loaded | PASS | {"opened":1102,"errors":[]} |
| transition.futures.BTC.1440.layout-2-complete | PASS | {"layout":"2","panes":["ok"],"tabs":0} |
| transition.futures.BTC.1440.layout-1-complete | PASS | {"layout":"1","panes":0,"kept":true,"chart":"candles"} |
| transition.futures.BTC.1440.row-paints-once | PASS | {"painted":["+0ms [compare layout fullscreen more] [1m 5m 15m 1h 4h 1d 1w]"],"flickered":[]} |
| transition.futures.BTC.1440.goto-opens | PASS | {"via":"more","menu":"more"} |
| transition.futures.BTC.1440.goto-answers | PASS | {"target":1790740800,"range":{"from":1790485200,"to":1791064800},"stillOpen":0} |
| transition.futures.BTC.1440.errors | PASS | [] |
| transition.phone.spot.AITH.390.loaded | PASS | {"opened":1281,"errors":[]} |
| transition.phone.spot.AITH.390.layout-2-complete | PASS | {"layout":"2","panes":[],"tabs":2} |
| transition.phone.spot.AITH.390.layout-1-complete | PASS | {"layout":"1","panes":0,"kept":true,"chart":"candles"} |
| transition.phone.spot.AITH.390.row-paints-once | PASS | {"painted":["+0ms [compare] [1m 15m 1h 4h 1d]"],"flickered":[]} |
| transition.phone.spot.AITH.390.goto-opens | PASS | {"via":"phone-sheet","menu":"phone-sheet"} |
| transition.phone.spot.AITH.390.goto-answers | PASS | {"status":"История за эту дату не загружена","paged":0} |
| transition.phone.spot.AITH.390.errors | PASS | [] |
| futures.1440.timeframes.1m-native | PASS | {"interval":"1m","store":"1m"} |
| futures.1440.timeframes.4h | PASS | {"ms":105,"t1":1791988350474} |
| futures.1440.timeframes.menu | PASS | {"menu":{"id":"timeframes","x":254,"y":188,"w":300,"h":701,"vw":1440,"vh":900,"inside":true,"via":"row"},"options":["1m","3m","5m","15m","30m","1h","2h","4h","6h","12h","1d","1w","1M"]} |
| futures.1440.timeframes.3m-native | PASS | {"url":"/api/v1/market/futures/candles/BTC-USDT?interval=3m&limit=520","plan3m":"native"} |
| futures.1440.timeframes.3m-chart | PASS | {"version":1,"timeframe":"3m","quickTimeframes":["1m","5m","15m","1h","4h","1d","1w"],"barType":"candles","compare":[],"comparePeriod":"all","layout":1,"panes":[{"pair":null,"timeframe":null},{"pair":null,"timeframe":null},{"pair":null,"timeframe":null}],"syncCursor":true,"syncTime":true,"syncTimefr |
| futures.1440.timeframes.1M | PASS | {"url":"/api/v1/market/futures/candles/BTC-USDT?interval=1M&limit=520"} |
| futures.1440.timeframes.favourites | PASS | {"quickPlus":["1m","5m","15m","30m","1h","4h","1d","1w"],"shownPlus":["1m","5m","15m","30m","1h","4h","1d","1w","1M"],"denseRow":false,"quickReset":["1m","5m","15m","1h","4h","1d","1w"]} |
| futures.1440.types.bars | PASS | {"present":1,"barType":"bars"} |
| futures.1440.types.hollow | PASS | {"present":1,"barType":"hollow"} |
| futures.1440.types.heikin | PASS | {"present":1,"barType":"heikin"} |
| futures.1440.types.line | PASS | {"present":1,"barType":"line"} |
| futures.1440.types.candles | PASS | {"present":1,"barType":"candles"} |
| futures.1440.compare.menu | PASS | {"id":"compare","x":468,"y":188,"w":340,"h":464,"vw":1440,"vh":900,"inside":true,"via":"row"} |
| futures.1440.compare.one | PASS | {"entries":1,"attr":"1","legend":true,"value":"+5,70%","main":"+0,84%","leftScale":true} |
| futures.1440.compare.three-max | PASS | {"three":{"entries":3,"options":0,"values":["+0,84%","+5,70%","+0,38%","+7,70%"]},"searchDisabled":true,"fourthOffered":0,"stillThree":3} |
| futures.1440.compare.period-hide-remove | PASS | {"period":"1w","hidden":true,"two":2} |
| futures.1440.compare.relative-strength | PASS | {"panel":true,"rs":true,"text":"BTC/USDT · Доходность+0,84%SOL/USDT · Доходность+0,38%Разница, п.п.+0,46Корреляция доходностей0,65Соотношение цен521,4961Не прогноз. По 520 общим точкам, доходности свеча к свече"} |
| futures.1440.compare.exit-restores | PASS | {"attr":null,"entries":0,"legend":false,"state":"candles"} |
| futures.1440.data.window | PASS | {"rows":12,"requestsDuringHover":0,"sample":"Данные свечиЗавершённая свечаВремя (UTC)2026-10-13 00:00Открытие83724.03Максимум84041.76Минимум83617.82Закрытие83926.48Объём25Изменение+202.46Изменение, %+0,24%"} |
| futures.1440.analytics.panel | PASS | {"blocks":3,"periods":["visible","all","1d","1w","1M"],"pressed":"true","sample":"Аналитика периодаВидимый диапазонВся история1 день1 неделя1 месяцИзменение цены+594.32 (+0,70%)Максимум89502.05Минимум76"} |
| futures.1440.layout.two | PASS | {"panes":["ok"],"layout":"2","tickets":1,"canvases":18,"ms":203} |
| futures.1440.layout.pane-own-instrument | PASS | {"paneReq":["1h","1h","1h","1h","1h","1h","15m"],"store":{"pair":"ETH/USDT","timeframe":"15m"}} |
| futures.1440.layout.sync-cursor | PASS | {"syncCursor":true} |
| futures.1440.layout.pane-trade-switches-terminal | PASS | {"before":"http://127.0.0.1:40371/futures?pair=BTC%2FUSDT","url":"http://127.0.0.1:40371/futures?pair=ETH%2FUSDT","hits":0} |
| futures.1440.layout.back-to-one | PASS | {} |
| futures.1440.presets.builtin-scalping | PASS | {"timeframe":"5m","indicators":["ema","ema","vwap","rsi"]} |
| futures.1440.presets.custom-save-rename-delete | PASS | {"saved":1,"renamed":"QA 25m · 4","afterDelete":0,"version":1} |
| futures.1440.presets.reset | PASS | {"timeframe":"1h"} |
| futures.1440.goto.loaded-bar | PASS | {"closedOk":true,"range":330} |
| futures.1440.goto.future-refused | PASS | {"futureWarn":"Дата в будущем"} |
| futures.1440.goto.history-honest | PASS | {"pagedRequests":2,"requestsBefore":26,"dialogStillOpen":0} |
| futures.1440.snapshot.png | PASS | {"file":"voltex_ETHUSDT_1h_2026-10-14_14-32.png","size":47264} |
| futures.1440.fullscreen.toggle-escape | PASS | {"attr":true,"shell":1440,"ticket":true,"afterEscape":false} |
| futures.1440.keyboard.escape-digits-inputs | PASS | {"closed":{"menu":false,"focus":"compare"},"digit":"15m","typed":"15m","focusVisible":{"tag":"BUTTON","feature":"fullscreen","outline":true}} |
| futures.1440.menus.inside-viewport | PASS | {"timeframes":{"inside":true,"x":254,"y":188,"w":300,"h":701},"compare":{"inside":true,"x":468,"y":188,"w":340,"h":464},"layout":{"inside":true,"x":580,"y":188,"w":280,"h":254},"tools":{"inside":true,"x":458,"y":188,"w":300,"h":704},"presets":{"inside":true,"x":458,"y":188,"w":300,"h":704},"goto":{" |
| futures.1440.menus.indicators | PASS | {"inside":true,"w":312} |
| futures.1440.regression.terminal-intact | PASS | {"form":true,"formVisible":true,"book":true,"rail":true,"tv":["VOLTEX","TradingView"]} |
| futures.1440.regression.tradingview-switch | PASS | {"iframe":false,"dataDisabled":true,"form":true,"back":"candles"} |
| futures.1440.errors | PASS | [] |
| spot.1440.timeframes.1m-native | PASS | {"interval":"1m","store":"1m"} |
| spot.1440.timeframes.4h | PASS | {"ms":98,"t1":1791988385723} |
| spot.1440.timeframes.menu | PASS | {"menu":{"id":"timeframes","x":516,"y":188,"w":300,"h":704,"vw":1440,"vh":900,"inside":true,"via":"row"},"options":["1m","3m","5m","15m","30m","1h","2h","4h","6h","12h","1d","1w","1M"]} |
| spot.1440.timeframes.3m-derived-from-1m | PASS | {"url":"/api/v1/market/external/candles/BTC-USDT?interval=1m&limit=720","plan3m":"derived"} |
| spot.1440.timeframes.3m-chart | PASS | {"version":1,"timeframe":"3m","quickTimeframes":["1m","5m","15m","1h","4h","1d","1w"],"barType":"candles","compare":[],"comparePeriod":"all","layout":1,"panes":[{"pair":null,"timeframe":null},{"pair":null,"timeframe":null},{"pair":null,"timeframe":null}],"syncCursor":true,"syncTime":true,"syncTimefr |
| spot.1440.timeframes.1M | PASS | {"url":"/api/v1/market/external/candles/BTC-USDT?interval=1d&limit=720"} |
| spot.1440.timeframes.favourites | PASS | {"quickPlus":["1m","5m","15m","30m","1h","4h","1d","1w"],"shownPlus":["15m","1h","4h","1d","1M"],"denseRow":true,"quickReset":["1m","5m","15m","1h","4h","1d","1w"]} |
| spot.1440.types.bars | PASS | {"present":1,"barType":"bars"} |
| spot.1440.types.hollow | PASS | {"present":1,"barType":"hollow"} |
| spot.1440.types.heikin | PASS | {"present":1,"barType":"heikin"} |
| spot.1440.types.line | PASS | {"present":1,"barType":"line"} |
| spot.1440.types.candles | PASS | {"present":1,"barType":"candles"} |
| spot.1440.compare.menu | PASS | {"id":"compare","x":583,"y":188,"w":340,"h":536,"vw":1440,"vh":900,"inside":true,"via":"row"} |
| spot.1440.compare.one | PASS | {"entries":1,"attr":"1","legend":true,"value":"+5,70%","main":"+0,84%","leftScale":true} |
| spot.1440.compare.three-max | PASS | {"three":{"entries":3,"options":0,"values":["+0,84%","+5,70%","+0,38%","+7,70%"]},"searchDisabled":true,"fourthOffered":0,"stillThree":3} |
| spot.1440.compare.period-hide-remove | PASS | {"period":"1w","hidden":true,"two":2} |
| spot.1440.compare.relative-strength | PASS | {"panel":true,"rs":true,"text":"BTC/USDT · Доходность+0,84%SOL/USDT · Доходность+0,38%Разница, п.п.+0,46Корреляция доходностей0,65Соотношение цен521,4961Не прогноз. По 520 общим точкам, доходности свеча к свече"} |
| spot.1440.compare.exit-restores | PASS | {"attr":null,"entries":0,"legend":false,"state":"candles"} |
| spot.1440.data.window | PASS | {"rows":12,"requestsDuringHover":0,"sample":"Данные свечиЗавершённая свечаВремя (UTC)2026-10-13 00:00Открытие83724.03Максимум84041.76Минимум83617.82Закрытие83926.48Объём25Изменение+202.46Изменение, %+0,24%"} |
| spot.1440.analytics.panel | PASS | {"blocks":3,"periods":["visible","all","1d","1w","1M"],"pressed":"true","sample":"Аналитика периодаВидимый диапазонВся история1 день1 неделя1 месяцИзменение цены+594.32 (+0,70%)Максимум89502.05Минимум76"} |
| spot.1440.layout.two | PASS | {"panes":["ok"],"layout":"2","tickets":1,"canvases":18,"ms":243} |
| spot.1440.layout.pane-own-instrument | PASS | {"paneReq":["1h","1h","1h","1h","1h","1h","15m"],"store":{"pair":"ETH/USDT","timeframe":"15m"}} |
| spot.1440.layout.sync-cursor | PASS | {"syncCursor":true} |
| spot.1440.layout.pane-trade-switches-terminal | PASS | {"before":"http://127.0.0.1:40371/trade?pair=BTC%2FUSDT","url":"http://127.0.0.1:40371/trade?pair=ETH%2FUSDT","hits":0} |
| spot.1440.layout.back-to-one | PASS | {} |
| spot.1440.presets.builtin-scalping | PASS | {"timeframe":"5m","indicators":["ema","ema","vwap","rsi"]} |
| spot.1440.presets.custom-save-rename-delete | PASS | {"saved":1,"renamed":"QA 25m · 4","afterDelete":0,"version":1} |
| spot.1440.presets.reset | PASS | {"timeframe":"1h"} |
| spot.1440.goto.loaded-bar | PASS | {"closedOk":true,"range":317} |
| spot.1440.goto.future-refused | PASS | {"futureWarn":"Дата в будущем"} |
| spot.1440.goto.history-honest | PASS | {"pagedRequests":0,"requestsBefore":25,"dialogStillOpen":1} |
| spot.1440.snapshot.png | PASS | {"file":"voltex_ETHUSDT_1h_2026-10-14_14-33.png","size":32756} |
| spot.1440.fullscreen.toggle-escape | PASS | {"attr":true,"shell":1440,"ticket":true,"afterEscape":false} |
| spot.1440.keyboard.escape-digits-inputs | PASS | {"closed":{"menu":false,"focus":"more"},"digit":"15m","typed":"15m","focusVisible":{"tag":"A","feature":"header-brand","outline":true}} |
| spot.1440.menus.inside-viewport | PASS | {"timeframes":{"inside":true,"x":516,"y":188,"w":300,"h":704},"compare":{"inside":true,"x":485,"y":188,"w":300,"h":704},"layout":{"inside":true,"x":485,"y":188,"w":300,"h":704},"tools":{"inside":true,"x":485,"y":188,"w":300,"h":704},"presets":{"inside":true,"x":485,"y":188,"w":300,"h":704},"goto":{" |
| spot.1440.menus.indicators | PASS | {"inside":true,"w":312} |
| spot.1440.regression.terminal-intact | PASS | {"form":true,"formVisible":true,"book":true,"rail":true,"tv":["VOLTEX","TradingView"]} |
| spot.1440.regression.tradingview-switch | PASS | {"iframe":false,"dataDisabled":true,"form":true,"back":"candles"} |
| spot.1440.errors | PASS | [] |
| futures.1920.layout.four | PASS | {"panes":["ok","ok","ok"],"overflow":false,"tickets":1,"ms":285,"heapBefore":14952448,"heapAfter":15619713} |
| futures.1920.layout.pane-expand | PASS | {"expanded":"2","width":1318} |
| mobile.futures.320x568.loaded | PASS | {"chartState":"candles","overflow":false,"errors":[]} |
| mobile.futures.320x568.phone-row | PASS | {"h":44,"quick":3,"sheet":true,"rows":1,"stripScrolls":false,"menuKeyVisible":true,"clipped":[]} |
| mobile.futures.320x568.sheet | PASS | {"sheet":{"id":"phone-sheet","x":0,"y":102,"w":320,"h":466,"vw":320,"vh":568,"inside":true},"sheetItems":["menus","layout","tools","presets","goto","scale","snapshot","fullscreen","fullscreen"]} |
| mobile.futures.320x568.order-form-reachable | PASS | {"visible":true} |
| mobile.spot.320x568.loaded | PASS | {"chartState":"candles","overflow":false,"errors":[]} |
| mobile.spot.320x568.phone-row | PASS | {"h":44,"quick":3,"sheet":true,"rows":1,"stripScrolls":false,"menuKeyVisible":true,"clipped":[]} |
| mobile.spot.320x568.sheet | PASS | {"sheet":{"id":"phone-sheet","x":0,"y":102,"w":320,"h":466,"vw":320,"vh":568,"inside":true},"sheetItems":["menus","layout","tools","presets","goto","scale","snapshot","fullscreen","fullscreen"]} |
| mobile.spot.320x568.order-form-reachable | PASS | {"visible":true} |
| mobile.futures.360x740.loaded | PASS | {"chartState":"candles","overflow":false,"errors":[]} |
| mobile.futures.360x740.phone-row | PASS | {"h":44,"quick":3,"sheet":true,"rows":1,"stripScrolls":false,"menuKeyVisible":true,"clipped":[]} |
| mobile.futures.360x740.sheet | PASS | {"sheet":{"id":"phone-sheet","x":0,"y":133,"w":360,"h":607,"vw":360,"vh":740,"inside":true},"sheetItems":["menus","layout","tools","presets","goto","scale","snapshot","fullscreen","fullscreen"]} |
| mobile.futures.360x740.order-form-reachable | PASS | {"visible":true} |
| mobile.spot.360x740.loaded | PASS | {"chartState":"candles","overflow":false,"errors":[]} |
| mobile.spot.360x740.phone-row | PASS | {"h":44,"quick":3,"sheet":true,"rows":1,"stripScrolls":false,"menuKeyVisible":true,"clipped":[]} |
| mobile.spot.360x740.sheet | PASS | {"sheet":{"id":"phone-sheet","x":0,"y":133,"w":360,"h":607,"vw":360,"vh":740,"inside":true},"sheetItems":["menus","layout","tools","presets","goto","scale","snapshot","fullscreen","fullscreen"]} |
| mobile.spot.360x740.order-form-reachable | PASS | {"visible":true} |
| mobile.futures.390x844.loaded | PASS | {"chartState":"candles","overflow":false,"errors":[]} |
| mobile.futures.390x844.phone-row | PASS | {"h":44,"quick":3,"sheet":true,"rows":1,"stripScrolls":false,"menuKeyVisible":true,"clipped":[]} |
| mobile.futures.390x844.sheet | PASS | {"sheet":{"id":"phone-sheet","x":0,"y":204,"w":390,"h":640,"vw":390,"vh":844,"inside":true},"sheetItems":["menus","layout","tools","presets","goto","scale","snapshot","fullscreen","fullscreen"]} |
| mobile.futures.390x844.compare-sheet | PASS | {"entries":1,"box":{"inside":true}} |
| mobile.futures.390x844.layout-tabs | PASS | {"tabs":2,"panes":0,"overflow":false} |
| mobile.futures.390x844.order-form-reachable | PASS | {"visible":true} |
| mobile.spot.390x844.loaded | PASS | {"chartState":"candles","overflow":false,"errors":[]} |
| mobile.spot.390x844.phone-row | PASS | {"h":44,"quick":5,"sheet":true,"rows":1,"stripScrolls":false,"menuKeyVisible":true,"clipped":[]} |
| mobile.spot.390x844.sheet | PASS | {"sheet":{"id":"phone-sheet","x":0,"y":204,"w":390,"h":640,"vw":390,"vh":844,"inside":true},"sheetItems":["menus","layout","tools","presets","goto","scale","snapshot","fullscreen","fullscreen"]} |
| mobile.spot.390x844.compare-sheet | PASS | {"entries":1,"box":{"inside":true}} |
| mobile.spot.390x844.layout-tabs | PASS | {"tabs":2,"panes":0,"overflow":false} |
| mobile.spot.390x844.order-form-reachable | PASS | {"visible":true} |
| mobile.futures.430x932.loaded | PASS | {"chartState":"candles","overflow":false,"errors":[]} |
| mobile.futures.430x932.phone-row | PASS | {"h":44,"quick":5,"sheet":true,"rows":1,"stripScrolls":false,"menuKeyVisible":true,"clipped":[]} |
| mobile.futures.430x932.sheet | PASS | {"sheet":{"id":"phone-sheet","x":0,"y":292,"w":430,"h":640,"vw":430,"vh":932,"inside":true},"sheetItems":["menus","layout","tools","presets","goto","scale","snapshot","fullscreen","fullscreen"]} |
| mobile.futures.430x932.order-form-reachable | PASS | {"visible":true} |
| mobile.spot.430x932.loaded | PASS | {"chartState":"candles","overflow":false,"errors":[]} |
| mobile.spot.430x932.phone-row | PASS | {"h":44,"quick":5,"sheet":true,"rows":1,"stripScrolls":false,"menuKeyVisible":true,"clipped":[]} |
| mobile.spot.430x932.sheet | PASS | {"sheet":{"id":"phone-sheet","x":0,"y":292,"w":430,"h":640,"vw":430,"vh":932,"inside":true},"sheetItems":["menus","layout","tools","presets","goto","scale","snapshot","fullscreen","fullscreen"]} |
| mobile.spot.430x932.order-form-reachable | PASS | {"visible":true} |
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
| zoom.90 | PASS | {"cssWidth":1600,"toolbar":{"x":16,"y":154,"w":974,"h":28},"clipped":[],"features":7} |
| zoom.100 | PASS | {"cssWidth":1440,"toolbar":{"x":16,"y":154,"w":814,"h":28},"clipped":[],"features":5} |
| zoom.110 | PASS | {"cssWidth":1309,"toolbar":{"x":16,"y":154,"w":683,"h":28},"clipped":[],"features":3} |
| zoom.125 | PASS | {"cssWidth":1152,"toolbar":{"x":16,"y":150,"w":526,"h":28},"clipped":[],"features":3} |
| perf.A.one-chart-requests | PASS | {"candleRequests":3,"allRequests":3,"newSockets":0,"socketsTotal":1,"heapMb":15,"canvases":11,"cpuTaskMs":0,"windowMs":15000} |
| perf.B.compares-bounded | PASS | {"candleRequests":3,"allRequests":4,"newSockets":0,"socketsTotal":1,"heapMb":15,"canvases":7,"cpuTaskMs":0,"windowMs":15000} |
| perf.C.two-charts-bounded | PASS | {"candleRequests":4,"allRequests":4,"newSockets":0,"socketsTotal":1,"heapMb":17,"canvases":18,"cpuTaskMs":0,"windowMs":15000} |
| perf.C.four-charts-bounded | PASS | {"candleRequests":7,"allRequests":18,"newSockets":0,"socketsTotal":1,"heapMb":19,"canvases":32,"cpuTaskMs":0,"windowMs":15000} |
| perf.hidden-tab-silent | PASS | {"candleRequests":0,"allRequests":0,"newSockets":0,"socketsTotal":1,"heapMb":19,"canvases":32,"cpuTaskMs":0,"windowMs":15000} |
| perf.collapse-stops-panes | PASS | {"candleRequests":3,"allRequests":3,"newSockets":0,"socketsTotal":2,"heapMb":17,"canvases":11,"cpuTaskMs":0,"windowMs":15000,"canvasesBefore":11} |

## Performance

| measure | value |
|---|---|
| geometry.futures.1366.chart | {"x":60,"y":188,"w":628,"h":390} |
| geometry.spot.1366.chart | {"x":322,"y":188,"w":402,"h":412} |
| geometry.futures.1440.chart | {"x":60,"y":188,"w":702,"h":390} |
| geometry.spot.1440.chart | {"x":322,"y":188,"w":476,"h":412} |
| geometry.futures.1600.chart | {"x":60,"y":188,"w":862,"h":390} |
| geometry.spot.1600.chart | {"x":322,"y":188,"w":636,"h":412} |
| geometry.futures.1707.chart | {"x":60,"y":188,"w":968,"h":390} |
| geometry.spot.1707.chart | {"x":322,"y":188,"w":738,"h":412} |
| geometry.futures.1920.chart | {"x":60,"y":188,"w":1182,"h":390} |
| geometry.spot.1920.chart | {"x":322,"y":188,"w":886,"h":412} |
| aith.spot.1440.timeframes | {"strip":[{"tf":"1m","plan":"native","off":false},{"tf":"5m","plan":"native","off":false},{"tf":"15m","plan":"native","off":false},{"tf":"1h","plan":"native","off":false},{"tf":"4h","plan":"native","off":false},{"tf":"1d","plan":"native","off":false},{"tf":"1w","plan":"native","off":false}],"options":[{"tf":"1m","disabled":false,"title":"","hint":""},{"tf":"3m","disabled":false,"title":"Строится из свечей 1м","hint":""},{"tf":"5m","disabled":false,"title":"","hint":""},{"tf":"15m","disabled":false,"title":"","hint":""},{"tf":"30m","disabled":false,"title":"Строится из свечей 15м","hint":""},{"tf":"1h","disabled":false,"title":"","hint":""},{"tf":"2h","disabled":false,"title":"Строится из свечей 1ч","hint":""},{"tf":"4h","disabled":false,"title":"","hint":""},{"tf":"6h","disabled":false,"title":"Строится из свечей 1ч","hint":""},{"tf":"12h","disabled":false,"title":"Строится из свечей 4ч","hint":""},{"tf":"1d","disabled":false,"title":"","hint":""},{"tf":"1w","disabled":false,"title":"","hint":""},{"tf":"1M","disabled":false,"title":"Строится из свечей 1Д","hint":""}],"unavailableOnStrip":[],"disabledInMenu":[]} |
| aith.spot.1440.1w | {"request":{"path":"/market/test-assets/AITH-USDT/candles","interval":"1w","limit":520},"state":"candles","bars":1,"widthCss":476,"heightCss":412,"widestBodyPx":5,"bodiesOnRow":1,"lowestCandleRatio":0.937,"highestCandleRatio":0.107,"prices":{"top":24.33594962616981,"bottom":0.6040734682519753,"paneHeight":412,"logical":{"from":-55,"to":4},"barSpacing":7.933333333333334}} |
| aith.spot.1440.1d | {"request":{"path":"/market/test-assets/AITH-USDT/candles","interval":"1d","limit":520},"state":"candles","bars":2,"widthCss":476,"heightCss":412,"widestBodyPx":5,"bodiesOnRow":1,"lowestCandleRatio":0.937,"highestCandleRatio":0.107,"prices":{"top":24.33594962616981,"bottom":0.6040734682519753,"paneHeight":412,"logical":{"from":-54,"to":5},"barSpacing":7.933333333333334}} |
| aith.spot.1440.1h | {"request":{"path":"/market/test-assets/AITH-USDT/candles","interval":"1h","limit":520},"state":"candles","bars":22,"widthCss":476,"heightCss":412,"widestBodyPx":5,"bodiesOnRow":1,"lowestCandleRatio":0.937,"highestCandleRatio":0.107,"prices":{"top":24.33594962616981,"bottom":0.6040734682519753,"paneHeight":412,"logical":{"from":-34,"to":25},"barSpacing":7.933333333333334}} |
| aith.spot.1440.5m | {"request":{"path":"/market/test-assets/AITH-USDT/candles","interval":"5m","limit":520},"state":"candles","bars":259,"widthCss":492,"heightCss":412,"widestBodyPx":3,"bodiesOnRow":2,"lowestCandleRatio":0.84,"highestCandleRatio":0.102,"prices":{"top":23.690509972549034,"bottom":6.397364339828765,"paneHeight":412,"logical":{"from":139,"to":258},"barSpacing":4.1}} |
| aith.spot.1440.1m | {"request":{"path":"/market/test-assets/AITH-USDT/candles","interval":"1m","limit":520},"state":"candles","bars":1000,"widthCss":500,"heightCss":412,"widestBodyPx":3,"bodiesOnRow":23,"lowestCandleRatio":0.597,"highestCandleRatio":0.117,"prices":{"top":22.616454556532346,"bottom":16.037793777764985,"paneHeight":412,"logical":{"from":400,"to":519},"barSpacing":4.166666666666667}} |
| aith.spot.1440.extras | {"gear":true,"legend":"SMA 200мало данных: 22 из 200 свечей","insufficient":1} |
| aith.spot.1440.compare | {"entry":"BTC/USDT+2,40%","value":"+2,40%","requests":["/api/v1/market/external/candles/BTC-USDT"]} |
| aith.spot.1440.pane | {"state":"ok","pair":"BTC/USDT","options":["1m","3m","5m","15m","30m","1h","2h","4h","6h","12h","1d","1w","1M"],"last":"85,794.25","requests":["/api/v1/market/external/candles/BTC-USDT","/api/v1/market/external/candles/BTC-USDT"]} |
| contexts.futures.BTC.timeframes | {"native":["1m","3m","5m","15m","30m","1h","2h","4h","6h","12h","1d","1w","1M"],"derived":[]} |
| contexts.spot.BTC.timeframes | {"native":["1m","5m","15m","1h","4h","1d","1w"],"derived":["3m","30m","2h","6h","12h","1M"]} |
| contexts.spot.NRX.timeframes | {"native":["1m","5m","15m","1h","4h","1d","1w"],"derived":["3m","30m","2h","6h","12h","1M"]} |
| contexts.spot.VTA.timeframes | {"native":["1m","5m","15m","1h","4h","1d","1w"],"derived":["3m","30m","2h","6h","12h","1M"]} |
| futures.1440.timeframeSwitchMs | 104 |
| futures.1440.compareFirstLineMs | 1175 |
| futures.1440.layout2OpenMs | 203 |
| spot.1440.timeframeSwitchMs | 97 |
| spot.1440.compareFirstLineMs | 1195 |
| spot.1440.layout2OpenMs | 243 |
| futures.1920.layout4OpenMs | 285 |
| after.chartOpenMs | 732 |
| after.A.one-chart | {"candleRequests":3,"allRequests":3,"newSockets":0,"socketsTotal":1,"heapMb":15,"canvases":11,"cpuTaskMs":0,"windowMs":15000} |
| after.B.three-compares | {"candleRequests":3,"allRequests":4,"newSockets":0,"socketsTotal":1,"heapMb":15,"canvases":7,"cpuTaskMs":0,"windowMs":15000} |
| after.C.two-charts | {"candleRequests":4,"allRequests":4,"newSockets":0,"socketsTotal":1,"heapMb":17,"canvases":18,"cpuTaskMs":0,"windowMs":15000} |
| after.C.four-charts | {"candleRequests":7,"allRequests":18,"newSockets":0,"socketsTotal":1,"heapMb":19,"canvases":32,"cpuTaskMs":0,"windowMs":15000} |
| after.hidden-tab.four-charts | {"candleRequests":0,"allRequests":0,"newSockets":0,"socketsTotal":1,"heapMb":19,"canvases":32,"cpuTaskMs":0,"windowMs":15000} |
| after.A.after-collapse | {"candleRequests":3,"allRequests":3,"newSockets":0,"socketsTotal":2,"heapMb":17,"canvases":11,"cpuTaskMs":0,"windowMs":15000} |

## Page errors

None.

## Evidence

105 files, 14.7 MB, sha256 per file in `manifest.json`. Case clashes: none. Screenshots reported but missing: none.
