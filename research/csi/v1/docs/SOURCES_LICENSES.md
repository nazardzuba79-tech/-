# Джерела, ендпоїнти та ліцензійний статус (v1)

Усі запити — публічні GET без ключів, без trial-акаунтів, без обходу блокувань. Дослівні відповіді збережено у `raw/<source>/*.gz`
(gzip дослівних байтів; sha256 оригінальних байтів у `raw/CHECKSUMS.csv`, контрактний manifest у `raw/MANIFEST.csv`).
Умови використання кожного провайдера в цій сесії **не перечитувалися**; нижче — лише те, що фактично спостерігалося у відповідях.
Безкоштовний доступ не означає право на redistribution: архів призначено для внутрішнього дослідження власника.

| source | ендпоїнти, що реально використані | результат | ліцензія / обмеження (як спостережено) |
|---|---|---|---|
| coinmetrics (Community) | `community-api.coinmetrics.io/v4/catalog-v2/asset-metrics`, `/timeseries/asset-metrics` | 200; 31 метрика з `community:true` для btc/eth; 9 із 17 бажаних відсутні | Community-рівень; ліміт запитів дотримано (0.7 с між сторінками) |
| fred | `fred.stlouisfed.org/graph/fredgraph.csv?id=…` | 200 для 14 серій | SP500 лише 10 років, BAMLH0A0HYM2 лише з 2023-09-22 (ліцензійні вікна постачальників даних FRED); latest-revised, не vintages |
| alternative_me | `api.alternative.me/fng/?limit=0&format=json` | 200, 3151 днів з 2018-02-01 | — |
| defillama | `stablecoins.llama.fi/stablecoincharts/{all,Ethereum,Tron,Solana,Arbitrum,Base,BSC}`, `api.llama.fi/v2/historicalChainTvl`, `api.llama.fi/overview/{dexs,fees}` | 200 | агрегати за всіма протоколами в лістингу; ранні нулі = відсутність покриття |
| okx (fallback) | `www.okx.com/api/v5/market/history-candles`, `/api/v5/public/funding-rate-history`, `/api/v5/rubik/stat/…` | 200; spot з 2018-01-11, perp з 2020-01-01, funding ~97 днів, rubik 72–180 днів | використано ЛИШЕ через Binance 451 і Bybit 403 |
| blockchain_info (fallback) | `api.blockchain.info/charts/{difficulty,transaction-fees-usd,miners-revenue}?timespan=all&sampled=false` | 200 | записано під канонічними іменами `DiffMean`, `FeeTotUSD`, `RevUSD` з `source=blockchain_info` за правилом ТЗ; визначення відрізняються від Coin Metrics (див. `reports/units_check.csv`) |
| farside | `farside.co.uk/bitcoin-etf-flow-all-data/`, `/btc/`, `/eth/`, `/ethereum-etf-flow-all-data/` | curl: 403 (Cloudflare "Just a moment"); urllib з UA `CSI-research-collector/1.0`: 200, HTML-таблиця | без обходу challenge; сторінка «ethereum-etf-flow-all-data» не була в переліку ТЗ, але це той самий провайдер |
| binance | `api.binance.com/api/v3/klines`, `fapi.binance.com/fapi/v1/fundingRate`, `/futures/data/*` | **451** «Service unavailable from a restricted location» | геоблокування; не обходилося |
| bybit | `api.bybit.com/v5/market/*` | **403** «CloudFront distribution is configured to block access from your country» | геоблокування; не обходилося |
| coingecko | `/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=max&interval=daily`, `/api/v3/global`, `/api/v3/ping` | ping 200; market_chart: 429, потім **401** (дослівно в `collection_log`); global 200 (без історії) | публічний API без ключа не віддає `days=max`; інтервал/діапазон не змінювалися |
| mempool.space | `api/v1/mining/hashrate/3y` | 200 при probe; **не записано** (HashRate уже отримано з Coin Metrics) | — |

## Публічний код третіх сторін
Не копіювався. Усі індикатори (RSI, %B, CCI, stochastic, Mayer тощо) реалізовано з визначень у `csi/features.py`; версії формул зафіксовано там же.
Python-залежності: numpy 2.4.6, pandas 3.0.6, scipy 1.17.1, pytest (стандартні PyPI-пакети).

## v2 — додаткові безкоштовні джерела (2026-09-22, після v1)
| source | ендпоїнти | результат | примітки |
|---|---|---|---|
| binance_vision | `data.binance.vision/data/spot/monthly/klines/{SYM}/1d/*.zip`, `…/spot/daily/klines/…`, `…/futures/um/monthly/fundingRate/{SYM}/*.zip`, `…/futures/um/monthly/klines/{SYM}/1d/*.zip`, `…/futures/um/daily/metrics/{SYM}/*.zip` | 200 (публічний архів Binance; `api.binance.com` лишається 451) | спот з 2017-08-17; funding і перп-свічки з 2020-01 (файли 2019-09..12 відсутні: 404); metrics (OI, long/short, taker) із 5-хв кроком, агрегація: остання точка дня / середнє дня. Жодних заголовків, ключів чи проксі — звичайний GET |
| bitmex | `www.bitmex.com/api/v1/funding?symbol=XBTUSD|ETHUSD&count=500&startTime=…` | 200 | XBTUSD з 2016-05-14, ETHUSD з 2018-08-02; публічний API віддає історію лише до 2026-09-16 на момент збору (перевірено `reverse=true`) |
| deribit | `www.deribit.com/api/v2/public/get_funding_rate_history`, `get_volatility_index_data` (DVOL, 1D) | 200 | funding — сума погодинних `interest_1h` (безперервне нарахування; визначення ≠ 8-годинних виплат); DVOL з 2021-03-24 |
| bitfinex | `api-pub.bitfinex.com/v2/status/deriv/tBTCF0:USTF0/hist?limit=5000&start=…&sort=1` | 200 | хвилинна історія з 2019-08; беремо останній запис дня: OI (у BTC), deriv/spot price → basis; ~750 сторінок |
| coinbase | `api.exchange.coinbase.com/products/BTC-USD|ETH-USD/candles?granularity=86400` | 200 | з 2015-01 / 2016-05; вхід для Coinbase premium |
| bitstamp | `www.bitstamp.net/api/v2/ohlc/btcusd|ethusd/?step=86400&limit=1000&start=…` | 200 | btcusd з 2011-08 |
| upbit | `api.upbit.com/v1/candles/days?market=KRW-BTC&count=200&to=…` | 200 | KRW; конвертація через FRED `DEXKOUS` (lag 1) |
| blockchain_info (extra) | `charts/estimated-transaction-volume-usd`, `charts/n-unique-addresses` | 200 | нові id `tx_volume_usd_est`, `unique_addresses_used` (не визначення Coin Metrics) |
