# Збір даних у наступному середовищі
Live-збір цього коду в поточній сесії НЕ виконаний через DNS gate. Перевірка синтаксису/структури не є перевіркою API parser на реальних відповідях.

Запуск з кореня папки:
```bash
python collectors/preflight.py
python collectors/collect_core.py --source alternative_me
python collectors/collect_core.py --source fred
python collectors/collect_core.py --source coinmetrics
python collectors/collect_core.py --source binance_spot
python collectors/collect_core.py --source binance_funding
python collectors/validate_pack.py
```
Python standard library; не встановлює залежностей і не вимагає секретів. Починати з одного джерела, перевірити raw/schema/units, потім решта. Код робить GET лише на allowlist, не обходить 403/451, зберігає тіло отриманих HTTP-відповідей до parsing, не синтезує пропуски. Runtime DNS exception не має response body: тоді manifest file порожній.

**Що код покриває:** FNG, задані FRED CSV, Coin Metrics catalog gate/series paging, spot daily close+volume (OHLCV лишаються в raw), фактичні funding events та daily sum. Це scaffold для аудиту, не сертифікований downloader. Catalog schema Coin Metrics може вимагати адаптації: за невідомої форми він зупиняється, а не вгадує.

**Що НЕ реалізовано:** DefiLlama parser, perp/spot basis, short-history OI/ratios, Farside HTML parsing, CoinGecko breadth/PIT universe, резервні джерела, option history, повний on-chain node/indexer, vintage-aware ALFRED history. Для них є `request_specs.json`; наступний агент має реалізувати й протестувати адаптери на справжньому raw. Не називати їх завантаженими або готовими.

Дата + lag точно зберігає контракт користувача, але fixed lag не доводить release/vintage validity. Перед торговим backtest застосувати вимоги `research/SPEC_AUDIT_UA.md`. Поточна база містить 0 observations і записи лише про чотири фактичні preflight failures. Не відновлювати її з чисел на вебграфіках.
