# volume_liquidity

Картки кандидатів. Жодної ринкової перевірки у цьому пакеті не виконано. Формули — операційні описи, не перевірені функції бібліотеки.

## M047 · Rolling VWAP distance

**Канонічне поле:** `rolling_vwap_distance` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `C/(sum(TP*V)/sum(V))-1`

**Входи:** H;L;C;V

**Гіпотеза механізму:** Відстань до об’ємно-зваженого орієнтира.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Барний TP*V не є точним trade-level VWAP.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volume_liquidity · **Перевірка визначення:** operational_definition

**Джерела:** [Vwap — library specification](https://python.stockindicators.dev/indicators/Vwap/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.

## M048 · On-Balance Volume slope

**Канонічне поле:** `obv_slope` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `delta_k(cumsum(sign(delta C)*V))`

**Входи:** C;V

**Гіпотеза механізму:** Гіпотеза участі обсягу у напрямку руху.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не actual money inflow; wash volume.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volume_liquidity · **Перевірка визначення:** operational_definition

**Джерела:** [Obv — library specification](https://python.stockindicators.dev/indicators/Obv/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.

## M049 · Chaikin Money Flow

**Канонічне поле:** `cmf` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `sum(((2*C-H-L)/(H-L))*V)/sum(V)`

**Входи:** H;L;C;V

**Гіпотеза механізму:** Об’ємно-зважене закриття у свічці.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не агресорна дельта, H=L обробляти явно.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volume_liquidity · **Перевірка визначення:** operational_definition

**Джерела:** [Cmf — library specification](https://python.stockindicators.dev/indicators/Cmf/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.

## M050 · Accumulation Distribution Line

**Канонічне поле:** `adl` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `cumsum(((2*C-H-L)/(H-L))*V)`

**Входи:** H;L;C;V

**Гіпотеза механізму:** Накопичений close-location proxy.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Абсолютний рівень залежить від стартової дати.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volume_liquidity · **Перевірка визначення:** operational_definition

**Джерела:** [Adl — library specification](https://python.stockindicators.dev/indicators/Adl/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.

## M051 · Money Flow Index

**Канонічне поле:** `mfi` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `100-100/(1+positive_TP_volume/negative_TP_volume)`

**Входи:** H;L;C;V

**Гіпотеза механізму:** Price-volume oscillator.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Підвищення TP не класифікує справжню покупку.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volume_liquidity · **Перевірка визначення:** operational_definition

**Джерела:** [Mfi — library specification](https://python.stockindicators.dev/indicators/Mfi/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.

## M052 · Force Index

**Канонічне поле:** `force_index` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `EMA_n(delta C*V)`

**Входи:** C;V

**Гіпотеза механізму:** Амплітуда руху разом з обсягом.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Ціна й обсяг ендогенні; великі бари домінують.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volume_liquidity · **Перевірка визначення:** operational_definition

**Джерела:** [ForceIndex — library specification](https://python.stockindicators.dev/indicators/ForceIndex/) — Інтерфейс, виходи, вимоги прогріву й посилання на реалізацію; вихідний код не завантажено.

## M053 · Relative Volume

**Канонічне поле:** `relative_volume` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `V/median_trailing_n(V)`

**Входи:** V

**Гіпотеза механізму:** Аномальна участь у ринку.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Денна сезонність/зміна біржі; поріг не відомий.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volume_liquidity · **Перевірка визначення:** operational_definition

**Джерела:** [Stock Indicators for Python — indicator catalog](https://python.stockindicators.dev/indicators/) — Визначення або перелік; не доказ прогнозної переваги.; [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.

## M054 · Amihud illiquidity proxy

**Канонічне поле:** `amihud_illiquidity` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `mean(abs(r)/quote_volume_usd)`

**Входи:** C;quote_volume

**Гіпотеза механізму:** Орієнтовна ціна руху на одиницю обороту.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не вимірює виконання великого ордера; нульовий volume.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volume_liquidity · **Перевірка визначення:** operational_definition

**Джерела:** [Stock Indicators for Python — indicator catalog](https://python.stockindicators.dev/indicators/) — Визначення або перелік; не доказ прогнозної переваги.; [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.

## M055 · Spot turnover

**Канонічне поле:** `spot_turnover` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `quote_volume_usd/market_cap_usd`

**Входи:** quote_volume;market_cap

**Гіпотеза механізму:** Активність відносно масштабу активу.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Обсяг біржі не сукупний обсяг; circulating definitions.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volume_liquidity · **Перевірка визначення:** operational_definition

**Джерела:** [Stock Indicators for Python — indicator catalog](https://python.stockindicators.dev/indicators/) — Визначення або перелік; не доказ прогнозної переваги.; [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.

## M056 · Quoted spread

**Канонічне поле:** `quoted_spread` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `(best_ask-best_bid)/mid`

**Входи:** best_bid;best_ask

**Гіпотеза механізму:** Фактична вартість негайного виконання малого розміру.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Потрібні історичні snapshots, не OHLCV.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_spot + local_calculation; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** volume_liquidity · **Перевірка визначення:** operational_definition

**Джерела:** [Stock Indicators for Python — indicator catalog](https://python.stockindicators.dev/indicators/) — Визначення або перелік; не доказ прогнозної переваги.; [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.
