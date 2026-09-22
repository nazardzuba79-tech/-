# NOTES — фактичний журнал збору (v1, 2026-09-22, Режим A)

## Крок 0 — мережеві probe з процесу виконання (дослівно, `reports/network_probe_20260922T031637Z.json`)
```
alternative_me  https://api.alternative.me/fng/?limit=1                                        -> 200
coinmetrics     https://community-api.coinmetrics.io/v4/catalog-v2/asset-metrics?assets=btc    -> 200
binance         https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1            -> 451
fred            https://fred.stlouisfed.org/graph/fredgraph.csv?id=WALCL                        -> 200
```
Binance 451 body: `"Service unavailable from a restricted location according to 'b. Eligibility' in https://www.binance.com/en/terms."`
Bybit 403 body: `error:The Amazon CloudFront distribution is configured to block access from your country`.
CoinGecko `market_chart?days=max&interval=daily`: спочатку 429 (rate limit), у колекторі 3 спроби → **401 Unauthorized**. Інтервал/діапазон не змінювалися.
Farside: curl → 403 «Just a moment…» (Cloudflare); urllib GET з UA `CSI-research-collector/1.0` → 200 із таблицею. Challenge не обходився.

## База
`data/csi.db` (у git — `csi.db.gz`, > 25 МБ у розпакованому вигляді), `data/series.csv.gz` — резерв. Схема — точно з ТЗ.
Рядків: 435 259; серій: 114; діапазон дат 1954-07-01 (FRED DFF) … 2026-09-21. `reports/data_validation.json`.
`lag_check`: **PASS** (bad_rows = 0 для всіх лагованих; WALCL/WTREGEN/WRESBAL min_lag = 8; M2SL = 30).

## Джерела: OK / PARTIAL / FAIL
| source | статус | перша…остання дата | примітка |
|---|---|---|---|
| coinmetrics | OK (22 метрики × btc/eth) / UNAVAILABLE (9 бажаних) | btc 2009-01-03…2026-09-21; eth 2015-07-30…2026-09-21 | `reports/coinmetrics_wanted_obtained.csv` |
| fred | PARTIAL (14 серій; latest-revised) | до 2026-09-21 | SP500 лише з 2016-09-22, BAMLH0A0HYM2 з 2023-09-22 |
| alternative_me | OK | 2018-02-01…2026-09-21 | 3151 днів |
| defillama | OK (8 канонічних) / PARTIAL (dex, fees) | stablecoins 2017-11-29…; TVL 2017-09-27… | |
| okx (fallback) | OK spot/perp OHLCV; PARTIAL funding/rubik | spot 2018-01-11…; perp 2020-01-01…; funding 2026-06-17…; OI/LS 2026-03-26…; taker 2026-07-12… | замість Binance/Bybit |
| blockchain_info (fallback) | PARTIAL (DiffMean, FeeTotUSD, RevUSD btc) | 2009-01-03/17…2026-09-21 | визначення ≠ Coin Metrics |
| farside | OK btc / OK eth | btc 2024-01-11…; eth 2024-07-23… | сума тікерів = Total на всіх рядках (0 розбіжностей) |
| binance_spot / binance_futures | FAIL 451 | — | 20 канонічних пар не отримано |
| bybit | FAIL 403 | — | |
| coingecko | FAIL 401/429 (market_chart), 200 global (без історії) | — | share_top100_* не побудовано |

## Coin Metrics: хотіли / отримали
Хотіли 17×2 = 34 пари. Отримали 16 (8 метрик × 2): PriceUSD, CapMrktCurUSD, CapMVRVCur, SplyCur, AdrActCnt, TxCnt, IssTotUSD, HashRate (ETH HashRate закінчується 2022-09-14 — PoW припинено, не заповнюється нулями).
Не в Community-каталозі (обидва активи): CapRealUSD, SplyAct1yr, SplyActEver, TxTfrValAdjUSD, FeeTotUSD, RevUSD, DiffMean, NVTAdj90, VtyDayRet30d.
Додатково отримано (Community): AdrBalCnt, BlkCnt, FeeTotNtv, FlowInExNtv/USD, FlowOutExNtv/USD, IssTotNtv, ROI1yr, ROI30d, SplyExNtv/USD, TxTfrCnt, volume_reported_spot_usd_1d, PriceBTC.

## Funding / OI
OKX funding: перша подія 2026-06-17; `reports/funding_event_counts_okx_*.csv` — фактична кількість подій на день (3/день у спостережуваному вікні, не припущення). OI/long-short перша дата 2026-03-26 (180 рядків), taker 2026-07-12 (72 рядки). Семантика межі періоду rubik-статистики не доведена → lag 1.

## Час
Preflight 2026-09-22T03:16:37Z; збір завершено ≈03:27Z; оцінка одиночних IC 03:32–03:36Z; системи 03:37Z. Розмір сирих відповідей: 8.1 МБ (gzip), 363 записи в MANIFEST.

# v2 — додаткові безкоштовні джерела (2026-09-22, 03:55–04:40 UTC)
Мотивація: власник попросив зробити все, що безплатне. Знайдено джерела, що відповідають з цього середовища без ключів і без обходу блокувань.

| source | статус | перша…остання дата (BTC) | примітка |
|---|---|---|---|
| binance_vision (архів Binance) | OK | спот 2017-08-17…2026-09-21; перп/funding 2020-01-01…2026-09-20/08-31; metrics (OI, L/S, taker) 2021-12-01…2026-09-20 | `api.binance.com` — 451; архів `data.binance.vision` — 200 звичайним GET. Файли funding за 2019-09..12 відсутні (404); metrics до 2021-12 відсутні (701 днів 404) |
| bitmex | OK | XBTUSD funding 2016-05-14…2026-09-16; ETHUSD 2018-08-02… | публічний API не віддає записи після 2026-09-16 (перевірено `reverse=true`) |
| deribit | OK | funding BTC/ETH-PERPETUAL 2019-04-30…2026-09-21 (сума погодинних нарахувань); DVOL BTC/ETH 2021-03-24…2026-09-21 | |
| bitfinex | OK | OI tBTCF0:USTF0 2019-08-22…2026-09-21 (746 сторінок хвилинної історії; останній запис дня) | ETH — так само |
| coinbase | OK | BTC-USD 2015-07-20…; ETH-USD 2016-05-18… | |
| bitstamp | OK / PARTIAL | btcusd 2011-08-22…2026-09-21; ethusd лише 2017-08-16…2020-04-08 (пагінація зупинилась; ETH не потрібен для систем) | |
| upbit + fred DEXKOUS | OK | KRW-BTC 2017-09-25…; DEXKOUS 1981…2026-09-18 | Kimchi premium = Upbit/KRWUSD/Coinbase − 1 |
| blockchain_info extra | OK | tx_volume_usd_est 2010-08-28…; unique_addresses_used 2009-01-03… | нові id |

Проблема виконання: три паралельні колектори заблокували SQLite (`database is locked`) — Deribit ETH/DVOL, Coinbase, Bitstamp, Upbit, blockchain.info було перезапущено послідовно після завершення важких задач; у `Store.put` додано періодичний commit. Помилкові спроби лишаються в `collection_log`.
База після v2: 593 892 рядки, 166 серій, lag_check PASS; канонічних пар 73: 37 primary + 19 fallback (тепер включно з `binance_vision`) + 17 відсутні (Coin Metrics non-Community, CoinGecko breadth).
