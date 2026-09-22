# cycle_controversial

Картки кандидатів. Жодної ринкової перевірки у цьому пакеті не виконано. Формули — операційні описи, не перевірені функції бібліотеки.

## M057 · Mayer Multiple

**Канонічне поле:** `mayer_multiple` · **Група:** market · **Горизонт:** cycle · **Активи:** btc

**Формула:** `C/SMA_200d(C)`

**Входи:** C

**Гіпотеза механізму:** Тривале відхилення від тренду, не intrinsic value.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Алгебраїчне дублювання SMA-distance; BTC циклів мало.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** price_trend · **Перевірка визначення:** research_candidate

**Джерела:** [Sma — library specification](https://python.stockindicators.dev/indicators/Sma/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.; [Pi Cycle Top explanation](https://charts.bitbo.io/pi-cycle-top/) — 111DMA vs 2×350DMA. Приклади провайдера не є незалежним OOS доказом.; [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## M058 · 2-Year MA multiplier

**Канонічне поле:** `two_year_ma` · **Група:** market · **Горизонт:** cycle · **Активи:** btc

**Формула:** `C/SMA_730d(C); no preset buy/sell bands`

**Входи:** C

**Гіпотеза механізму:** Повільний baseline циклу.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Довгий прогрів; історичні множники підбирались на малих циклах.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** price_trend · **Перевірка визначення:** research_candidate

**Джерела:** [Sma — library specification](https://python.stockindicators.dev/indicators/Sma/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.; [Pi Cycle Top explanation](https://charts.bitbo.io/pi-cycle-top/) — 111DMA vs 2×350DMA. Приклади провайдера не є незалежним OOS доказом.; [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## M059 · 200-Week MA distance

**Канонічне поле:** `ma200w_distance` · **Група:** market · **Горизонт:** cycle · **Активи:** btc

**Формула:** `weekly_close/SMA_200(weekly_close)-1`

**Входи:** C

**Гіпотеза механізму:** Довгий тренд як контекст.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Лише завершені UTC weeks; не жорстка цінова підлога.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** price_trend · **Перевірка визначення:** research_candidate

**Джерела:** [Sma — library specification](https://python.stockindicators.dev/indicators/Sma/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.; [Pi Cycle Top explanation](https://charts.bitbo.io/pi-cycle-top/) — 111DMA vs 2×350DMA. Приклади провайдера не є незалежним OOS доказом.; [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## M060 · Pi Cycle Top

**Канонічне поле:** `pi_cycle_top` · **Група:** market · **Горизонт:** cycle · **Активи:** btc

**Формула:** `cross(SMA_111d(C),2*SMA_350d(C))`

**Входи:** C

**Гіпотеза механізму:** Немає встановленого причинного механізму; емпіричне правило.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Числовий збіг із pi не є доказом; небагато незалежних циклів.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** cycle_controversial · **Перевірка визначення:** research_candidate

**Джерела:** [Sma — library specification](https://python.stockindicators.dev/indicators/Sma/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.; [Pi Cycle Top explanation](https://charts.bitbo.io/pi-cycle-top/) — 111DMA vs 2×350DMA. Приклади провайдера не є незалежним OOS доказом.; [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## M061 · Golden Ratio Multiplier

**Канонічне поле:** `golden_ratio_multiplier` · **Група:** market · **Горизонт:** cycle · **Активи:** btc

**Формула:** `C/(SMA_350d(C)*k); k from documented chosen variant`

**Входи:** C

**Гіпотеза механізму:** Немає встановленого механізму golden ratio.

**Що підтверджено:** Включено за ТЗ; точне первинне визначення не верифіковано. Відкриті джерела у рядку — лише споріднені входи/сімейства. Alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Сітка множників та варіанти формули; exact original не перевірено.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** cycle_controversial · **Перевірка визначення:** unverified_definition

**Джерела:** [Sma — library specification](https://python.stockindicators.dev/indicators/Sma/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.; [Pi Cycle Top explanation](https://charts.bitbo.io/pi-cycle-top/) — 111DMA vs 2×350DMA. Приклади провайдера не є незалежним OOS доказом.; [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## M062 · Rainbow chart bands

**Канонічне поле:** `rainbow_chart` · **Група:** market · **Горизонт:** cycle · **Активи:** btc

**Формула:** `log-price regression on log(age) with fitted bands`

**Входи:** C;network_age

**Гіпотеза механізму:** Немає незалежного механізму прогнозу.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Повносемпловий fit і перегляд bands спричиняють leakage; як causal alpha відхилено.

**Вердикт:** reject — Не використовувати як торговий голос у заданій реалізації; залишити як негативний контроль.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** cycle_controversial · **Перевірка визначення:** research_candidate

**Джерела:** [Sma — library specification](https://python.stockindicators.dev/indicators/Sma/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.; [Pi Cycle Top explanation](https://charts.bitbo.io/pi-cycle-top/) — 111DMA vs 2×350DMA. Приклади провайдера не є незалежним OOS доказом.; [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## M063 · Stock-to-Flow price model

**Канонічне поле:** `stock_to_flow_price` · **Група:** market · **Горизонт:** cycle · **Активи:** btc

**Формула:** `fit log(P)=a+b*log(stock/annual_new_issuance)`

**Входи:** C;issued_supply;issuance

**Гіпотеза механізму:** Припущення, що дефіцитність домінує попит.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Часові тренди, мала кількість halvings, попит відсутній; не causal valuation.

**Вердикт:** reject — Не використовувати як торговий голос у заданій реалізації; залишити як негативний контроль.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** cycle_controversial · **Перевірка визначення:** research_candidate

**Джерела:** [Sma — library specification](https://python.stockindicators.dev/indicators/Sma/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.; [Pi Cycle Top explanation](https://charts.bitbo.io/pi-cycle-top/) — 111DMA vs 2×350DMA. Приклади провайдера не є незалежним OOS доказом.; [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## M064 · Days since halving

**Канонічне поле:** `halving_age_days` · **Група:** market · **Горизонт:** cycle · **Активи:** btc

**Формула:** `date-last_observed_halving_date`

**Входи:** block_height;date

**Гіпотеза механізму:** Подія зміни темпу пропозиції.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Загальновідома подія; дуже мало незалежних циклів.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** cycle_controversial · **Перевірка визначення:** research_candidate

**Джерела:** [Sma — library specification](https://python.stockindicators.dev/indicators/Sma/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.; [Pi Cycle Top explanation](https://charts.bitbo.io/pi-cycle-top/) — 111DMA vs 2×350DMA. Приклади провайдера не є незалежним OOS доказом.; [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## M065 · Four-year return

**Канонічне поле:** `four_year_return` · **Група:** market · **Горизонт:** cycle · **Активи:** btc

**Формула:** `C/C[1460]-1`

**Входи:** C

**Гіпотеза механізму:** Опис минулого циклу.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не окремий механізм і не гарантія наступного циклу.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** cycle_controversial · **Перевірка визначення:** research_candidate

**Джерела:** [Sma — library specification](https://python.stockindicators.dev/indicators/Sma/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.; [Pi Cycle Top explanation](https://charts.bitbo.io/pi-cycle-top/) — 111DMA vs 2×350DMA. Приклади провайдера не є незалежним OOS доказом.; [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## M066 · Log power-law residual

**Канонічне поле:** `powerlaw_residual` · **Група:** market · **Горизонт:** cycle · **Активи:** btc

**Формула:** `log(C)-expanding_fit(log(network_age))`

**Входи:** C;network_age

**Гіпотеза механізму:** Немає встановленої фундаментальної опори exponent.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Вибір старту/форми змінює bands; часткове detrending тренду.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** cycle_controversial · **Перевірка визначення:** research_candidate

**Джерела:** [Sma — library specification](https://python.stockindicators.dev/indicators/Sma/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.; [Pi Cycle Top explanation](https://charts.bitbo.io/pi-cycle-top/) — 111DMA vs 2×350DMA. Приклади провайдера не є незалежним OOS доказом.; [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.
