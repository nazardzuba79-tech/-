# macro_institutional

Картки кандидатів. Жодної ринкової перевірки у цьому пакеті не виконано. Формули — операційні описи, не перевірені функції бібліотеки.

## M101 · Federal Reserve total assets

**Канонічне поле:** `WALCL` · **Група:** market · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `value, millions USD`

**Входи:** WALCL

**Гіпотеза механізму:** Розмір активів ФРС; не прямий crypto flow.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Publication/vintage mismatch; latest revised history не point-in-time; не стверджуємо причинний прогноз crypto.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred; cost=free; lag=8. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** operational_definition

**Джерела:** [Federal Reserve total assets](https://fred.stlouisfed.org/series/WALCL) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.

## M102 · Treasury General Account

**Канонічне поле:** `WTREGEN` · **Група:** market · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `value, millions USD, weekly average`

**Входи:** WTREGEN

**Гіпотеза механізму:** Казначейська ліквідність; не Wednesday point value.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Publication/vintage mismatch; latest revised history не point-in-time; не стверджуємо причинний прогноз crypto.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred; cost=free; lag=8. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** operational_definition

**Джерела:** [Treasury General Account](https://fred.stlouisfed.org/series/WTREGEN) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.

## M103 · Overnight reverse repo

**Канонічне поле:** `RRPONTSYD` · **Група:** market · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `value, billions USD`

**Входи:** RRPONTSYD

**Гіпотеза механізму:** Паркування резервної ліквідності; одиниці не як WALCL.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Publication/vintage mismatch; latest revised history не point-in-time; не стверджуємо причинний прогноз crypto.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** operational_definition

**Джерела:** [Overnight reverse repo](https://fred.stlouisfed.org/series/RRPONTSYD) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.

## M104 · Reserve balances

**Канонічне поле:** `WRESBAL` · **Група:** market · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `value, millions USD, weekly average`

**Входи:** WRESBAL

**Гіпотеза механізму:** Резерви банків як фінансовий контекст.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Publication/vintage mismatch; latest revised history не point-in-time; не стверджуємо причинний прогноз crypto.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred; cost=free; lag=8. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** operational_definition

**Джерела:** [Reserve balances](https://fred.stlouisfed.org/series/WRESBAL) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.

## M105 · US M2

**Канонічне поле:** `M2SL` · **Група:** market · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `value, billions USD, monthly`

**Входи:** M2SL

**Гіпотеза механізму:** Грошовий агрегат США, не глобальна M2.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Publication/vintage mismatch; latest revised history не point-in-time; не стверджуємо причинний прогноз crypto.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred; cost=free; lag=30. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** operational_definition

**Джерела:** [US M2](https://fred.stlouisfed.org/series/M2SL) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.

## M106 · Broad trade-weighted dollar

**Канонічне поле:** `DTWEXBGS` · **Група:** market · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `index level`

**Входи:** DTWEXBGS

**Гіпотеза механізму:** Сила широкого доларового індексу; НЕ ICE DXY.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Publication/vintage mismatch; latest revised history не point-in-time; не стверджуємо причинний прогноз crypto.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** operational_definition

**Джерела:** [Broad trade-weighted dollar](https://fred.stlouisfed.org/series/DTWEXBGS) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.

## M107 · 10-year real Treasury yield

**Канонічне поле:** `DFII10` · **Група:** market · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `percent per year`

**Входи:** DFII10

**Гіпотеза механізму:** Альтернативна реальна ставка дисконту.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Publication/vintage mismatch; latest revised history не point-in-time; не стверджуємо причинний прогноз crypto.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** operational_definition

**Джерела:** [10-year real Treasury yield](https://fred.stlouisfed.org/series/DFII10) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.

## M108 · High-yield option-adjusted spread

**Канонічне поле:** `BAMLH0A0HYM2` · **Група:** market · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `percent spread`

**Входи:** BAMLH0A0HYM2

**Гіпотеза механізму:** Ціна кредитного ризику.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Publication/vintage mismatch; latest revised history не point-in-time; не стверджуємо причинний прогноз crypto.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** operational_definition

**Джерела:** [High-yield option-adjusted spread](https://fred.stlouisfed.org/series/BAMLH0A0HYM2) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.

## M109 · VIX

**Канонічне поле:** `VIXCLS` · **Група:** market · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `index level`

**Входи:** VIXCLS

**Гіпотеза механізму:** Очікувана волатильність акцій, не crypto IV.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Publication/vintage mismatch; latest revised history не point-in-time; не стверджуємо причинний прогноз crypto.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** operational_definition

**Джерела:** [VIX](https://fred.stlouisfed.org/series/VIXCLS) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.

## M110 · S&P 500 level

**Канонічне поле:** `SP500` · **Група:** market · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `price index`

**Входи:** SP500

**Гіпотеза механізму:** Контекст ризикових активів; не total return.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Publication/vintage mismatch; latest revised history не point-in-time; не стверджуємо причинний прогноз crypto.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** operational_definition

**Джерела:** [S&P 500 level](https://fred.stlouisfed.org/series/SP500) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.

## M111 · 10y-2y yield curve

**Канонічне поле:** `T10Y2Y` · **Група:** market · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `percentage-point spread`

**Входи:** T10Y2Y

**Гіпотеза механізму:** Форма кривої як макроконтекст.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Publication/vintage mismatch; latest revised history не point-in-time; не стверджуємо причинний прогноз crypto.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** operational_definition

**Джерела:** [10y-2y yield curve](https://fred.stlouisfed.org/series/T10Y2Y) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.

## M112 · Effective federal funds rate

**Канонічне поле:** `DFF` · **Група:** market · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `percent per year`

**Входи:** DFF

**Гіпотеза механізму:** Коротка безризикова ставка.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Publication/vintage mismatch; latest revised history не point-in-time; не стверджуємо причинний прогноз crypto.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** operational_definition

**Джерела:** [Effective federal funds rate](https://fred.stlouisfed.org/series/DFF) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.

## M113 · 10-year breakeven inflation

**Канонічне поле:** `T10YIE` · **Група:** market · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `percentage-point spread`

**Входи:** T10YIE

**Гіпотеза механізму:** Компенсація інфляції включає risk/liquidity premium.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Publication/vintage mismatch; latest revised history не point-in-time; не стверджуємо причинний прогноз crypto.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** operational_definition

**Джерела:** [10-year breakeven inflation](https://fred.stlouisfed.org/series/T10YIE) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.

## M114 · Chicago Fed financial conditions

**Канонічне поле:** `NFCI` · **Група:** market · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `index level`

**Входи:** NFCI

**Гіпотеза механізму:** Узагальнений стан кредитних умов.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Publication/vintage mismatch; latest revised history не point-in-time; не стверджуємо причинний прогноз crypto.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** operational_definition

**Джерела:** [Chicago Fed financial conditions](https://fred.stlouisfed.org/series/NFCI) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.

## M115 · Net liquidity heuristic

**Канонічне поле:** `net_liquidity_heuristic` · **Група:** market · **Горизонт:** cycle;regime · **Активи:** ринок/макро

**Формула:** `WALCL-WTREGEN-1000*RRPONTSYD in millions USD; align only released observations`

**Входи:** WALCL;WTREGEN;RRPONTSYD

**Гіпотеза механізму:** Гіпотеза доступності доларової ліквідності.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не офіційний агрегат; змішані average/point дані; асинхронний календар.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred;farside;additional feed audit required; cost=free; lag=max_input_availability. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** research_candidate

**Джерела:** [Federal Reserve total assets](https://fred.stlouisfed.org/series/WALCL) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.; [Treasury General Account](https://fred.stlouisfed.org/series/WTREGEN) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.; [Overnight reverse repo](https://fred.stlouisfed.org/series/RRPONTSYD) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.

## M116 · Global M2 in USD

**Канонічне поле:** `global_m2_usd` · **Група:** market · **Горизонт:** cycle;regime · **Активи:** ринок/макро

**Формула:** `sum(country_M2_local * contemporaneous_FX_to_USD)`

**Входи:** country M2;FX;release calendars

**Гіпотеза механізму:** Глобальна ліквідність як гіпотеза.

**Що підтверджено:** Включено як кандидат за ТЗ. Точне першоджерело повного безкоштовного ряду/методики не підтверджено; джерело у рядку лише споріднений макроконтекст. Alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Різні визначення M2; довільні lead shifts заборонені; free series не зібрано.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred;farside;additional feed audit required; cost=free; lag=unknown. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** unverified_definition

**Джерела:** [Federal Reserve total assets](https://fred.stlouisfed.org/series/WALCL) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.; [Treasury General Account](https://fred.stlouisfed.org/series/WTREGEN) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.; [Overnight reverse repo](https://fred.stlouisfed.org/series/RRPONTSYD) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.; [Bitcoin ETF Flow](https://farside.co.uk/btc/) — Таблиця USD million доступна у веб-перегляді; не завантажена в код, повне покриття не встановлене.; [Ethereum ETF Flow](https://farside.co.uk/eth/) — Таблиця доступна у веб-перегляді; повна історія в коді не зібрана.

## M117 · ETF net flow BTC/ETH

**Канонічне поле:** `etf_flow_musd` · **Група:** market · **Горизонт:** cycle;regime · **Активи:** btc;eth

**Формула:** `Total USD million from provider; parentheses negative`

**Входи:** ETF per-ticker flows;Total

**Гіпотеза механізму:** Первинний попит через ETF, не price performance.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Total перевірити сумою; corrections та неповна ETH history.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** farside; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** research_candidate

**Джерела:** [Bitcoin ETF Flow](https://farside.co.uk/btc/) — Таблиця USD million доступна у веб-перегляді; не завантажена в код, повне покриття не встановлене.; [Ethereum ETF Flow](https://farside.co.uk/eth/) — Таблиця доступна у веб-перегляді; повна історія в коді не зібрана.

## M118 · Gold relative strength

**Канонічне поле:** `gold_btc_relative` · **Група:** market · **Горизонт:** cycle;regime · **Активи:** ринок/макро

**Формула:** `gold_USD/BTC_USD at aligned close`

**Входи:** gold fixing;BTC

**Гіпотеза механізму:** Відносна перевага двох видів активів.

**Що підтверджено:** Включено як кандидат за ТЗ. Точне першоджерело повного безкоштовного ряду/методики не підтверджено; джерело у рядку лише споріднений макроконтекст. Alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Фіксинг не 24/7; надійний дозволений historical feed не перевірено.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred;farside;additional feed audit required; cost=free; lag=unknown. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** unverified_definition

**Джерела:** [Federal Reserve total assets](https://fred.stlouisfed.org/series/WALCL) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.; [Treasury General Account](https://fred.stlouisfed.org/series/WTREGEN) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.; [Overnight reverse repo](https://fred.stlouisfed.org/series/RRPONTSYD) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.; [Bitcoin ETF Flow](https://farside.co.uk/btc/) — Таблиця USD million доступна у веб-перегляді; не завантажена в код, повне покриття не встановлене.; [Ethereum ETF Flow](https://farside.co.uk/eth/) — Таблиця доступна у веб-перегляді; повна історія в коді не зібрана.

## M119 · ISM manufacturing PMI

**Канонічне поле:** `ism_pmi` · **Група:** market · **Горизонт:** cycle;regime · **Активи:** ринок/макро

**Формула:** `published PMI level; no fabricated monthly days`

**Входи:** ISM releases;vintages

**Гіпотеза механізму:** Реальний економічний цикл.

**Що підтверджено:** Включено як кандидат за ТЗ. Точне першоджерело повного безкоштовного ряду/методики не підтверджено; джерело у рядку лише споріднений макроконтекст. Alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Точний дозволений безкоштовний ряд не перевірено.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred;farside;additional feed audit required; cost=free; lag=unknown. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** unverified_definition

**Джерела:** [Federal Reserve total assets](https://fred.stlouisfed.org/series/WALCL) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.; [Treasury General Account](https://fred.stlouisfed.org/series/WTREGEN) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.; [Overnight reverse repo](https://fred.stlouisfed.org/series/RRPONTSYD) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.; [Bitcoin ETF Flow](https://farside.co.uk/btc/) — Таблиця USD million доступна у веб-перегляді; не завантажена в код, повне покриття не встановлене.; [Ethereum ETF Flow](https://farside.co.uk/eth/) — Таблиця доступна у веб-перегляді; повна історія в коді не зібрана.

## M120 · ICE Dollar Index DXY

**Канонічне поле:** `dxy` · **Група:** market · **Горизонт:** cycle;regime · **Активи:** ринок/макро

**Формула:** `official ICE DXY index, no DTWEXBGS substitution`

**Входи:** licensed DXY history

**Гіпотеза механізму:** Інший кошик валют для доларового ризику.

**Що підтверджено:** Включено як кандидат за ТЗ. Точне першоджерело повного безкоштовного ряду/методики не підтверджено; джерело у рядку лише споріднений макроконтекст. Alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Немає перевіреного дозволеного free feed; не підміняти Broad USD.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** fred;farside;additional feed audit required; cost=free; lag=unknown. Free entitlement не підтверджено.

**Сімейство:** macro_institutional · **Перевірка визначення:** unverified_definition

**Джерела:** [Federal Reserve total assets](https://fred.stlouisfed.org/series/WALCL) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.; [Treasury General Account](https://fred.stlouisfed.org/series/WTREGEN) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.; [Overnight reverse repo](https://fred.stlouisfed.org/series/RRPONTSYD) — Офіційні одиниці/частота; значення з вебсторінки не переносились у базу.; [Bitcoin ETF Flow](https://farside.co.uk/btc/) — Таблиця USD million доступна у веб-перегляді; не завантажена в код, повне покриття не встановлене.; [Ethereum ETF Flow](https://farside.co.uk/eth/) — Таблиця доступна у веб-перегляді; повна історія в коді не зібрана.
