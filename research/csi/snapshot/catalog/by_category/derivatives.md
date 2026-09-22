# derivatives

Картки кандидатів. Жодної ринкової перевірки у цьому пакеті не виконано. Формули — операційні описи, не перевірені функції бібліотеки.

## M067 · Daily funding sum

**Канонічне поле:** `funding_rate_daily` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btcusdt;ethusdt

**Формула:** `sum(actual fundingRate events within UTC day)`

**Входи:** fundingRate;fundingTime

**Гіпотеза механізму:** Вартість утримання та перекос perpetual попиту.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не припускати рівно 3 події; позитивний funding може тривати.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.

## M068 · Perpetual-spot basis

**Канонічне поле:** `perp_spot_basis` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btcusdt;ethusdt

**Формула:** `perp_close/spot_close-1 at aligned timestamp`

**Входи:** perp_close;spot_close

**Гіпотеза механізму:** Попит на leveraged exposure.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: USDT vs USD і різні timestamps спотворюють різницю.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.

## M069 · Open interest contracts

**Канонічне поле:** `open_interest` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btcusdt;ethusdt

**Формула:** `last validated end-of-day sumOpenInterest`

**Входи:** OI_contracts

**Гіпотеза механізму:** Незакриті позиції як масштаб leverage.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Контракти мають різний multiplier; лише short-history endpoint.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.

## M070 · Open interest USD

**Канонічне поле:** `open_interest_usd` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btcusdt;ethusdt

**Формула:** `last validated end-of-day sumOpenInterestValue`

**Входи:** OI_notional

**Гіпотеза механізму:** Порівнянний розмір відкритих позицій.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Зростає від ціни навіть без нових контрактів.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.

## M071 · OI to market cap

**Канонічне поле:** `oi_mcap_ratio` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `open_interest_usd/CapMrktCurUSD`

**Входи:** OI_USD;market_cap

**Гіпотеза механізму:** Leverage відносно активу.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Склад бірж неповний; end-of-period release.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; optional public Deribit after endpoint audit; cost=freemium; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.; [Deribit API documentation](https://docs.deribit.com/) — Вхід до документації public API; точні historical option endpoints/retention потребують перевірки.

## M072 · Price-neutral OI change

**Канонічне поле:** `oi_contract_change` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `log(OI_contracts/OI_contracts[k])`

**Входи:** OI_contracts

**Гіпотеза механізму:** Відокремлення росту позицій від price revaluation.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Rolls/contract metadata; не визначає long чи short.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; optional public Deribit after endpoint audit; cost=freemium; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.; [Deribit API documentation](https://docs.deribit.com/) — Вхід до документації public API; точні historical option endpoints/retention потребують перевірки.

## M073 · Taker buy/sell ratio

**Канонічне поле:** `taker_buy_sell_ratio` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btcusdt;ethusdt

**Формула:** `sum(taker_buy_volume)/sum(taker_sell_volume)`

**Входи:** taker buy/sell volume

**Гіпотеза механізму:** Агресивний дисбаланс виконаних угод.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Одна біржа, а не увесь ринок; short history.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.

## M074 · Global account long/short ratio

**Канонічне поле:** `long_short_ratio` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btcusdt;ethusdt

**Формула:** `long_account_share/short_account_share`

**Входи:** account shares

**Гіпотеза механізму:** Чисельний перекос рахунків.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не розмір позицій; один whale важливіший за багато рахунків.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.

## M075 · Top traders position ratio

**Канонічне поле:** `top_position_ratio` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `top_group_long_notional/top_group_short_notional`

**Входи:** top trader position shares

**Гіпотеза механізму:** Розмір позицій спеціальної групи.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Провайдерська класифікація; не вся популяція.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; optional public Deribit after endpoint audit; cost=freemium; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.; [Deribit API documentation](https://docs.deribit.com/) — Вхід до документації public API; точні historical option endpoints/retention потребують перевірки.

## M076 · Liquidation notional

**Канонічне поле:** `liquidation_notional` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `sum(executed forced liquidation USD)`

**Входи:** liquidation executions

**Гіпотеза механізму:** Реалізоване примусове закриття leverage.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Потрібна повна історія, websocket sample не повна tape.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; optional public Deribit after endpoint audit; cost=freemium; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.; [Deribit API documentation](https://docs.deribit.com/) — Вхід до документації public API; точні historical option endpoints/retention потребують перевірки.

## M077 · Liquidation imbalance

**Канонічне поле:** `liquidation_imbalance` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `(long_liq-short_liq)/(long_liq+short_liq)`

**Входи:** side-specific liquidations

**Гіпотеза механізму:** Напрям вже реалізованого deleveraging.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Нульові та пропущені записи не тотожні; неповне покриття.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; optional public Deribit after endpoint audit; cost=freemium; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.; [Deribit API documentation](https://docs.deribit.com/) — Вхід до документації public API; точні historical option endpoints/retention потребують перевірки.

## M078 · Dated futures annualized basis

**Канонічне поле:** `dated_basis_annualized` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `(F/S-1)*365/days_to_expiry`

**Входи:** dated future;spot;expiry

**Гіпотеза механізму:** Вартість перенесення й попит на leverage.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Settlement, roll і collateral currency відрізняються.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; optional public Deribit after endpoint audit; cost=freemium; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.; [Deribit API documentation](https://docs.deribit.com/) — Вхід до документації public API; точні historical option endpoints/retention потребують перевірки.

## M079 · ATM implied volatility

**Канонічне поле:** `atm_iv` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `option IV at fixed delta/moneyness and tenor`

**Входи:** option bid/ask;strike;expiry

**Гіпотеза механізму:** Ринкова ціна очікуваного ризику.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не замінювати realized vol; expired options history needed.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; optional public Deribit after endpoint audit; cost=freemium; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.; [Deribit API documentation](https://docs.deribit.com/) — Вхід до документації public API; точні historical option endpoints/retention потребують перевірки.

## M080 · 25-delta risk reversal

**Канонічне поле:** `risk_reversal_25d` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `IV_25delta_call-IV_25delta_put at same tenor`

**Входи:** option surface

**Гіпотеза механізму:** Асиметрична ціна страхування хвоста.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Delta convention і interpolated tenor повинні бути сталими.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; optional public Deribit after endpoint audit; cost=freemium; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.; [Deribit API documentation](https://docs.deribit.com/) — Вхід до документації public API; точні historical option endpoints/retention потребують перевірки.

## M081 · 25-delta butterfly

**Канонічне поле:** `butterfly_25d` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `0.5*(IV_call25+IV_put25)-IV_ATM`

**Входи:** option surface

**Гіпотеза механізму:** Вартість хвостової опуклості.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Шум неліквідних страйків; не знак дохідності.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; optional public Deribit after endpoint audit; cost=freemium; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.; [Deribit API documentation](https://docs.deribit.com/) — Вхід до документації public API; точні historical option endpoints/retention потребують перевірки.

## M082 · Implied-volatility term slope

**Канонічне поле:** `iv_term_slope` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `IV_90d-IV_30d on matched ATM surfaces`

**Входи:** option surface

**Гіпотеза механізму:** Календарний розподіл очікуваного ризику.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Неповна поверхня та time-to-expiry bias.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; optional public Deribit after endpoint audit; cost=freemium; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.; [Deribit API documentation](https://docs.deribit.com/) — Вхід до документації public API; точні historical option endpoints/retention потребують перевірки.

## M083 · Put/call volume ratio

**Канонічне поле:** `put_call_volume_ratio` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `put_volume/call_volume using same notional units`

**Входи:** option trades

**Гіпотеза механізму:** Попит на два типи опціонів.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Trade direction невідома; selling puts не bearish саме по собі.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; optional public Deribit after endpoint audit; cost=freemium; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.; [Deribit API documentation](https://docs.deribit.com/) — Вхід до документації public API; точні historical option endpoints/retention потребують перевірки.

## M084 · Put/call OI ratio

**Канонічне поле:** `put_call_oi_ratio` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `put_OI/call_OI after notional normalization`

**Входи:** option OI

**Гіпотеза механізму:** Запас відкритих опціонних позицій.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не customer dealer sign; expiry distribution.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; optional public Deribit after endpoint audit; cost=freemium; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.; [Deribit API documentation](https://docs.deribit.com/) — Вхід до документації public API; точні historical option endpoints/retention потребують перевірки.

## M085 · Variance risk premium proxy

**Канонічне поле:** `variance_risk_premium` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `ATM_IV^2-past_realized_vol^2 with matched annualization`

**Входи:** IV;returns

**Гіпотеза механізму:** Різниця ціни страхування і минулого ризику.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Минуле RV не майбутня realized variance, only proxy.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; optional public Deribit after endpoint audit; cost=freemium; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.; [Deribit API documentation](https://docs.deribit.com/) — Вхід до документації public API; точні historical option endpoints/retention потребують перевірки.

## M086 · Perpetual spot premium dispersion

**Канонічне поле:** `perp_premium_dispersion` · **Група:** market · **Горизонт:** tactical;regime · **Активи:** btc;eth

**Формула:** `std(synchronized perp_spot_basis across venues)`

**Входи:** perp;spot;venue metadata

**Гіпотеза механізму:** Фрагментація leveraged попиту.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Без синхронних цін може бути просто stale quotes.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** binance_futures; optional public Deribit after endpoint audit; cost=freemium; lag=0. Free entitlement не підтверджено.

**Сімейство:** derivatives · **Перевірка визначення:** operational_definition

**Джерела:** [USD-M futures market data API](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) — Перевірено розділи funding history, fundingInfo, open interest statistics: змінний інтервал funding; OI history — останній місяць. Не всі розділи прочитані.; [Deribit API documentation](https://docs.deribit.com/) — Вхід до документації public API; точні historical option endpoints/retention потребують перевірки.
