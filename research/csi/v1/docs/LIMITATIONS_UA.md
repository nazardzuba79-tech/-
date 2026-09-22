# Обмеження v1 — що НЕ доведено і чому

1. **Дані.** Binance (HTTP 451) і Bybit (HTTP 403 CloudFront) геозаблоковані з цього середовища; обхід не застосовувався. Спот/перп OHLCV, funding і позиційні статистики взяті з OKX як запасного venue. Історія funding — ~97 днів, OI/long-short — 180 днів, taker — 72 дні: усі позиційні гіпотези TACTICAL мають статус `insufficient`.
2. **Coin Metrics Community** дає 8 із 17 бажаних метрик. Відсутні CapRealUSD (realized cap виведено як CapMrktCurUSD/CapMVRVCur — окремий derived id), SplyAct1yr/SplyActEver (HODL-сімейство не реалізовано), TxTfrValAdjUSD/NVTAdj90 (NVT не реалізовано), FeeTotUSD/RevUSD/DiffMean (для BTC узято blockchain.info під канонічним ім'ям із `source=blockchain_info` за правилом ТЗ; для ETH — відсутні), VtyDayRet30d.
3. **CoinGecko** без ключа: 429, потім 401 на `days=max`. Breadth/dominance/PIT-universe не побудовано.
4. **Farside** отримано через urllib (curl давав 403). BTC з 2024-01-11, ETH з 2024-07-23: увесь ряд лежить у холдауті → жодної development-оцінки ETF-потоків.
5. **Лаги.** `available_at = date + lag` — контракт власника; дати реальних релізів, revisions і vintages (FRED ALFRED) не перевірялися. Coin Metrics — latest-revised history. Отже «leakage-free» **не** заявляється; заявляється «відповідає контракту лагів».
6. **Ціна.** CYCLE/REGIME оцінені на референсній ціні Coin Metrics (не виконувана). Backtests — модель, не торгівля: комісія+проковзування 0.15%/сторона припущені, а не виміряні.
7. **Статистична сила.** 365-денний горизонт має ≈8 неперекривних спостережень на development і ≈2.6 на холдауті. Будь-який CYCLE-результат — слабкий доказ за побудовою.
8. **Поправки протоколу після першого прогону** (attempt 3 у `experiments.jsonl`): поріг N_eff для h≥180 і використання CM-цінового вікна для REGIME. Обидві зроблені до перегляду відповідних результатів, але формально це post-hoc зміни; читач має право дисконтувати підтвердження REGIME на development ще сильніше (на холдауті воно й так провалилося).
9. **Не реалізовано** 66 обчислюваних кандидатів (`catalog_audit.csv`: computable_not_evaluated) — здебільшого дублікати сімей тренду/моментуму/волатильності та DeFi-розбивки. 61 untestable за визначенням, 52 без даних.
10. **Pine.** Файли `platform/pine/*_reduced.pine` не компілювалися і не тестувалися в TradingView; паритет із Python не заявляється; повна модель у Pine неможлива (див. `platform/FEED_FEASIBILITY.md`).
11. **ETH** зібрано (Coin Metrics, OKX), але системи оцінено лише для BTC.
12. **Автооновлення.** `python -m csi.collect --source all` перезбирає лише реально доступні джерела; dashboard показує STALE/SHORT_HISTORY/ENDED, а не імітує актуальність.
