# Chart workspace QA — after

Build: /tmp/claude-0/-home-user--/3aa28e0f-5e9a-5b55-a5ca-126a4a881276/scratchpad/wt-cw2/frontend/dist
Checks: 13 passed, 0 failed

| check | result | detail |
|---|---|---|
| panes.spot.1440.opens-on-another-instrument | PASS | {"state":"ok","source":"spot-public","pair":"ETH/USDT","tf":"1h","shown":"3235.68","stale":null,"note":null,"bars":300,"last":3235.684228063357} |
| panes.spot.1440.switch-clears-at-once | PASS | {"state":"loading","source":"spot-public","pair":"SOL/USDT","tf":"1h","shown":null,"stale":null,"note":"Загрузка…","bars":0,"last":null} |
| panes.spot.1440.late-answer-dropped | PASS | {"quick":{"state":"ok","source":"test-market","pair":"AITH/USDT","tf":"1h","shown":"21.5648","stale":null,"note":null,"bars":22,"last":21.564827988054493},"late":{"state":"ok","source":"test-market","pair":"AITH/USDT","tf":"1h","shown":"21.5648","stale":null,"note":null,"bars":22,"last":21.564827988 |
| panes.spot.1440.error-then-retry | PASS | {"failed":{"state":"error","source":"spot-public","pair":"DOGE/USDT","tf":"1h","shown":null,"stale":null,"note":"Не удалось загрузитьПовторить","bars":0,"last":null},"recovered":{"state":"ok","source":"spot-public","pair":"DOGE/USDT","tf":"1h","shown":"0.119803","stale":null,"note":null,"bars":300," |
| panes.spot.1440.refresh-failure-is-stale-not-blank | PASS | {"state":"stale","source":"spot-public","pair":"DOGE/USDT","tf":"1h","shown":"0.119803","stale":"Не обновляется с 12:47","note":null,"bars":300,"last":0.11980258147698568} |
| panes.spot.1440.empty-answer-is-not-success | PASS | {"state":"empty","source":"test-market","pair":"NRX/USDT","tf":"1h","shown":null,"stale":null,"note":"Нет истории","bars":0,"last":null} |
| panes.spot.1440.errors | PASS | [] |
| futures.1440.regression.terminal-intact | PASS | {"form":true,"formVisible":true,"book":true,"rail":true,"tv":["VOLTEX","TradingView"]} |
| futures.1440.regression.tradingview-switch | PASS | {"iframe":false,"dataDisabled":true,"form":true,"back":"candles"} |
| futures.1440.errors | PASS | [] |
| spot.1440.regression.terminal-intact | PASS | {"form":true,"formVisible":true,"book":true,"rail":true,"tv":["VOLTEX","TradingView"]} |
| spot.1440.regression.tradingview-switch | PASS | {"iframe":false,"dataDisabled":true,"form":true,"back":"candles"} |
| spot.1440.errors | PASS | [] |

## Performance

| measure | value |
|---|---|
