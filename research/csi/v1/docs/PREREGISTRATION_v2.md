# Pre-registration v2 — додаткові безкоштовні джерела (2026-09-22, до будь-яких v2-обчислень)

Хеш `csi/features_v2.py` — у `docs/PREREGISTRATION_v2_HASH.txt`. Усі правила v1 (`PREREGISTRATION.md`) діють без змін, зокрема поправки attempt 3.

## Що змінюється
1. **Нові джерела** (усі публічні, без ключів, без обходу): архів Binance `data.binance.vision` (спот 2017-08+, funding, OI/long-short/taker метрики),
   BitMEX funding (2016-05+), Deribit funding (2019-05+) і DVOL (2021-03+), Bitfinex OI (2019-08+), Coinbase, Bitstamp, Upbit + FRED DEXKOUS, blockchain.info tx-volume/unique addresses.
   `api.binance.com` лишається 451; архів `data.binance.vision` відповідає 200 без будь-яких трюків — це задокументовано як окреме джерело `binance_vision`.
2. **Ціна для TACTICAL** = Binance-архів спот `BTCUSDT` close (канонічна виконувана ціна ТЗ). CYCLE/REGIME — як у v1 (Coin Metrics).
3. **Нові ознаки** зі знаками, зафіксованими тут: T101–T113 (funding −, OI-зміна −, OI/mcap −, taker −, global L/S −, top-trader position +, DVOL рівень +, DVOL зміна −, Coinbase premium +, Kimchi −, Bitfinex OI −),
   R101–R109 (funding 30d −, OI/mcap −, OI зміна −, DVOL +, Coinbase premium +, Kimchi −, NVT −, unique addresses +, Bitfinex OI −), C101 (NVT z −), C102 (funding 90d −).
4. **Холдаут**: той самий (рішення з 2023-01-31). Для ознак v1 холдаут **уже переглянутий** у v1 і більше не є blind; blind він лише для нових ознак T/R/C1xx. Це записано тут і в підсумку.
5. **Бюджет**: один прогін одиночних IC v2, одна побудова композитів v2 з одноразовим холдаутом. Знаки не змінюються після результатів. Поріг підтвердження — той самий.
6. Ознаки з < 2 років development-історії (DVOL з 2021-03 → лише ~1.75 року до 2022-12) очікувано отримають `insufficient` або слабку статистику; вони не виключаються заздалегідь, але їхній холдаут при відсутності development-підтвердження не вважається доказом.
