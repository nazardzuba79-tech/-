RESEARCH ONLY — NO DATA

# Фактичний стан збору
Режим B. API-відповідей із даними не отримано. 0 observations; 0 дат історії. Primary collection_log містить 4 фактичні невдалі мережеві probes. `000` — вивід curl без HTTP-відповіді. Це НЕ 403 host_not_allowed, який описано як досвід інших середовищ у вкладеному файлі.

### alternative_me
URL: `https://api.alternative.me/fng/?limit=1`
Exit code: `6`
```text
stdout: 000
stderr: curl: (6) Could not resolve host: api.alternative.me
```

### coinmetrics
URL: `https://community-api.coinmetrics.io/v4/catalog-v2/asset-metrics?assets=btc`
Exit code: `6`
```text
stdout: 000
stderr: curl: (6) Could not resolve host: community-api.coinmetrics.io
```

### binance
URL: `https://fapi.binance.com/fapi/v1/fundingRate?symbol=BTCUSDT&limit=1`
Exit code: `6`
```text
stdout: 000
stderr: curl: (6) Could not resolve host: fapi.binance.com
```

### fred
URL: `https://fred.stlouisfed.org/graph/fredgraph.csv?id=WALCL`
Exit code: `6`
```text
stdout: 000
stderr: curl: (6) Could not resolve host: fred.stlouisfed.org
```

# Джерела
Coin Metrics, Binance futures, FRED, Alternative.me: FAIL на обов’язковому probe. Це не перевірка всіх endpoint-ів цих сервісів. Binance spot, DefiLlama, Farside, CoinGecko та fallback-джерела: NOT_RUN після Mode B gate. У вебперегляді Farside BTC/ETH-таблиці читались, але це не runtime завантаження і не встановлення повного покриття ETH.

# Бажали / отримали
У `reports/missing_core_metrics.csv` 73 канонічні metric+asset пари. Отримали 0. Для Coin Metrics бажали 17×2=34 пари; catalog отримано 0, тому немає підстав позначати будь-яку як доступну Community або недоступну через платний тариф. ETH HashRate/DiffMean потребують applicability audit, не нульового заповнення.

OI/ratio first date: невідома, немає отриманих рядків. Funding first date: невідома. FRED vintage coverage: відсутнє. Farside ETH full-history: не підтверджено. CoinGecko days=max: runtime response не отримували, не приписувати йому 401/429/403. Exchange-label та cohort історія: відсутня. Усі history_start у каталозі порожні.

# Перевірки та прогалини
lag_check, coverage і sources_check мають лише заголовки: це N/A / NOT_EVALUATED_NO_DATA, не PASS. Код колекторів лише доданий для наступного середовища; live adapters не тестувались. Не реалізовані адаптери перелічено у collectors/README_UA.md. Інженерна перевірка архіву описана окремо у reports/quality_check.json і не є backtest.

Реєстр джерел: 85 записів, з них 81 відкритий текст сторінки, 2 лише пошукові витяги з невдалим open, 1 попередній контекст, 1 shell-only. Наявність source URL не означає доказ alpha. Для частини кандидатів точне первинне визначення не підтверджено — див. selection_metadata.json.

# Час
Перший probe: 2026-09-21T12:29:48.431623+00:00. Формування цього журналу: 2026-09-21T12:57:09.277158+00:00.
Минуло 1640.8 секунд між цими подіями. Це журнал виконаного, не оцінка майбутньої тривалості.

ZIP менше 1 МБ, оскільки історію не отримано. Архів навмисно не наповнювався дублями, графічними PDF або synthetic observations для розміру.


# Фінальне пакування
Час завершення підготовки: 2026-09-21T13:01:40.427253+00:00. Від першого probe до цього запису: 1912.0 секунд. Структурний валідатор: 21 PASS, 0 FAIL; це не перевірка торгових результатів. Оригінальні вкладення звірено SHA256, вміст збігається.
