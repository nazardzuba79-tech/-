# breadth_sentiment

Картки кандидатів. Жодної ринкової перевірки у цьому пакеті не виконано. Формули — операційні описи, не перевірені функції бібліотеки.

## M087 · BTC dominance

**Канонічне поле:** `btc_dominance` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `BTC_market_cap/crypto_universe_market_cap`

**Входи:** PIT crypto market caps

**Гіпотеза механізму:** Ротація між BTC та рештою ринку.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Stablecoin inclusion і зміна universe; не on-chain.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coingecko + explicitly audited venue sources; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** breadth_sentiment · **Перевірка визначення:** operational_definition

**Джерела:** [Coin Historical Chart Data by ID](https://docs.coingecko.com/reference/coins-id-market-chart) — Інтерфейс historical prices/marketcaps/volumes; доступність days=max без ключа тут не перевірена.; [Crypto Fear & Greed Index and API](https://alternative.me/crypto/fear-and-greed-index/) — Індекс включає ціну/волатильність/обсяг; не незалежна чиста оцінка настрою.

## M088 · ETH/BTC relative price

**Канонічне поле:** `eth_btc_ratio` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `ETH_USD/BTC_USD at matched close`

**Входи:** PriceUSD btc;eth

**Гіпотеза механізму:** Ротація між двома великими активами.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Ratio не пояснює абсолютний напрям обох.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coingecko + explicitly audited venue sources; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** breadth_sentiment · **Перевірка визначення:** operational_definition

**Джерела:** [Coin Historical Chart Data by ID](https://docs.coingecko.com/reference/coins-id-market-chart) — Інтерфейс historical prices/marketcaps/volumes; доступність days=max без ключа тут не перевірена.; [Crypto Fear & Greed Index and API](https://alternative.me/crypto/fear-and-greed-index/) — Індекс включає ціну/волатильність/обсяг; не незалежна чиста оцінка настрою.

## M089 · Top100 above SMA50 breadth

**Канонічне поле:** `share_top100_above_sma50` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `count(C_i>SMA50_i)/valid point-in-time constituents`

**Входи:** PIT universe;prices

**Гіпотеза механізму:** Ширина участі у тренді.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Сьогоднішній top100 на минулому = survivorship bias.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coingecko + explicitly audited venue sources; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** breadth_sentiment · **Перевірка визначення:** operational_definition

**Джерела:** [Coin Historical Chart Data by ID](https://docs.coingecko.com/reference/coins-id-market-chart) — Інтерфейс historical prices/marketcaps/volumes; доступність days=max без ключа тут не перевірена.; [Crypto Fear & Greed Index and API](https://alternative.me/crypto/fear-and-greed-index/) — Індекс включає ціну/волатильність/обсяг; не незалежна чиста оцінка настрою.

## M090 · Top100 outperforming BTC 30d

**Канонічне поле:** `share_top100_beating_btc_30d` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `count(r30_i>r30_BTC)/valid PIT constituents`

**Входи:** PIT universe;prices

**Гіпотеза механізму:** Частка ринку сильніша за BTC.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не current universe backfill; delisted активи обов’язкові.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coingecko + explicitly audited venue sources; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** breadth_sentiment · **Перевірка визначення:** operational_definition

**Джерела:** [Coin Historical Chart Data by ID](https://docs.coingecko.com/reference/coins-id-market-chart) — Інтерфейс historical prices/marketcaps/volumes; доступність days=max без ключа тут не перевірена.; [Crypto Fear & Greed Index and API](https://alternative.me/crypto/fear-and-greed-index/) — Індекс включає ціну/волатильність/обсяг; не незалежна чиста оцінка настрою.

## M091 · Advance/decline breadth

**Канонічне поле:** `advance_decline` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `count(r_i>0)-count(r_i<0) within PIT universe`

**Входи:** PIT prices

**Гіпотеза механізму:** Поширеність денного руху.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Універсум та missing observations змінюють знак.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coingecko + explicitly audited venue sources; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** breadth_sentiment · **Перевірка визначення:** operational_definition

**Джерела:** [Coin Historical Chart Data by ID](https://docs.coingecko.com/reference/coins-id-market-chart) — Інтерфейс historical prices/marketcaps/volumes; доступність days=max без ключа тут не перевірена.; [Crypto Fear & Greed Index and API](https://alternative.me/crypto/fear-and-greed-index/) — Індекс включає ціну/волатильність/обсяг; не незалежна чиста оцінка настрою.

## M092 · New highs minus lows

**Канонічне поле:** `new_high_low_breadth` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `count(new_90d_high)-count(new_90d_low)`

**Входи:** PIT OHLC

**Гіпотеза механізму:** Одночасність екстремумів у ринку.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: IPO/listing age і зниклі токени.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coingecko + explicitly audited venue sources; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** breadth_sentiment · **Перевірка визначення:** operational_definition

**Джерела:** [Coin Historical Chart Data by ID](https://docs.coingecko.com/reference/coins-id-market-chart) — Інтерфейс historical prices/marketcaps/volumes; доступність days=max без ключа тут не перевірена.; [Crypto Fear & Greed Index and API](https://alternative.me/crypto/fear-and-greed-index/) — Індекс включає ціну/волатильність/обсяг; не незалежна чиста оцінка настрою.

## M093 · Cross-sectional return dispersion

**Канонічне поле:** `return_dispersion` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `stdev(asset_log_returns) within PIT universe`

**Входи:** PIT prices

**Гіпотеза механізму:** Неоднорідність ринку як режим.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не напрям; дрібні неліквідні активи домінують.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coingecko + explicitly audited venue sources; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** breadth_sentiment · **Перевірка визначення:** operational_definition

**Джерела:** [Coin Historical Chart Data by ID](https://docs.coingecko.com/reference/coins-id-market-chart) — Інтерфейс historical prices/marketcaps/volumes; доступність days=max без ключа тут не перевірена.; [Crypto Fear & Greed Index and API](https://alternative.me/crypto/fear-and-greed-index/) — Індекс включає ціну/волатильність/обсяг; не незалежна чиста оцінка настрою.

## M094 · Rolling BTC beta

**Канонічне поле:** `beta_to_btc` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `cov(r_asset,r_btc)/var(r_btc) trailing only`

**Входи:** asset;BTC prices

**Гіпотеза механізму:** Систематична залежність від BTC.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Beta змінюється; estimation error.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coingecko + explicitly audited venue sources; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** breadth_sentiment · **Перевірка визначення:** operational_definition

**Джерела:** [Coin Historical Chart Data by ID](https://docs.coingecko.com/reference/coins-id-market-chart) — Інтерфейс historical prices/marketcaps/volumes; доступність days=max без ключа тут не перевірена.; [Crypto Fear & Greed Index and API](https://alternative.me/crypto/fear-and-greed-index/) — Індекс включає ціну/волатильність/обсяг; не незалежна чиста оцінка настрою.

## M095 · BTC-ETH correlation

**Канонічне поле:** `btc_eth_correlation` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `corr(r_BTC,r_ETH) trailing n`

**Входи:** BTC;ETH prices

**Гіпотеза механізму:** Ступінь спільного ризику.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Correlation не причинність; overlap.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coingecko + explicitly audited venue sources; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** breadth_sentiment · **Перевірка визначення:** operational_definition

**Джерела:** [Coin Historical Chart Data by ID](https://docs.coingecko.com/reference/coins-id-market-chart) — Інтерфейс historical prices/marketcaps/volumes; доступність days=max без ключа тут не перевірена.; [Crypto Fear & Greed Index and API](https://alternative.me/crypto/fear-and-greed-index/) — Індекс включає ціну/волатильність/обсяг; не незалежна чиста оцінка настрою.

## M096 · Fear & Greed

**Канонічне поле:** `fng` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** ринок/макро

**Формула:** `provider index; do not reconstruct missing weights`

**Входи:** provider fng

**Гіпотеза механізму:** Настрій як гіпотеза поведінкового перекосу.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Містить ціну/обсяг/волатильність; подвійний облік.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** alternative_me; cost=free; lag=0. Free entitlement не підтверджено.

**Сімейство:** breadth_sentiment · **Перевірка визначення:** operational_definition

**Джерела:** [Crypto Fear & Greed Index and API](https://alternative.me/crypto/fear-and-greed-index/) — Індекс включає ціну/волатильність/обсяг; не незалежна чиста оцінка настрою.

## M097 · Google Trends attention

**Канонічне поле:** `google_trends_btc` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `normalized search interest with fixed topic/geography/window`

**Входи:** Trends observations

**Гіпотеза механізму:** Увага як гіпотеза припливу учасників.

**Що підтверджено:** Включено за ТЗ; точне первинне визначення не верифіковано. Відкриті джерела у рядку — лише споріднені входи/сімейства. Alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Нормалізація/семплювання змінюють історію; доступ не перевірено.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coingecko + explicitly audited venue sources; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** breadth_sentiment · **Перевірка визначення:** unverified_definition

**Джерела:** [Coin Historical Chart Data by ID](https://docs.coingecko.com/reference/coins-id-market-chart) — Інтерфейс historical prices/marketcaps/volumes; доступність days=max без ключа тут не перевірена.; [Crypto Fear & Greed Index and API](https://alternative.me/crypto/fear-and-greed-index/) — Індекс включає ціну/волатильність/обсяг; не незалежна чиста оцінка настрою.

## M098 · Coinbase premium

**Канонічне поле:** `coinbase_premium` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `Coinbase_BTCUSD/reference_BTCUSD-1`

**Входи:** synchronized venue spot prices

**Гіпотеза механізму:** Регіональна фрагментація попиту.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не використовувати USDT як USD без окремого FX basis.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coingecko + explicitly audited venue sources; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** breadth_sentiment · **Перевірка визначення:** operational_definition

**Джерела:** [Coin Historical Chart Data by ID](https://docs.coingecko.com/reference/coins-id-market-chart) — Інтерфейс historical prices/marketcaps/volumes; доступність days=max без ключа тут не перевірена.; [Crypto Fear & Greed Index and API](https://alternative.me/crypto/fear-and-greed-index/) — Індекс включає ціну/волатильність/обсяг; не незалежна чиста оцінка настрою.

## M099 · Kimchi premium

**Канонічне поле:** `kimchi_premium` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `(BTC_KRW/USD_KRW)/BTC_USD-1`

**Входи:** BTC_KRW;FX;BTC_USD

**Гіпотеза механізму:** Сегментація ринку та капітальні бар’єри.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: FX calendar і обмеження арбітражу; не безризикова угода.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coingecko + explicitly audited venue sources; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** breadth_sentiment · **Перевірка визначення:** operational_definition

**Джерела:** [Coin Historical Chart Data by ID](https://docs.coingecko.com/reference/coins-id-market-chart) — Інтерфейс historical prices/marketcaps/volumes; доступність days=max без ключа тут не перевірена.; [Crypto Fear & Greed Index and API](https://alternative.me/crypto/fear-and-greed-index/) — Індекс включає ціну/волатильність/обсяг; не незалежна чиста оцінка настрою.

## M100 · Stablecoin peg deviation

**Канонічне поле:** `stablecoin_peg_deviation` · **Група:** market · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `stablecoin_USD_price-1`

**Входи:** stablecoin market prices

**Гіпотеза механізму:** Ризик collateral/liquidity для crypto.

**Що підтверджено:** Документовано визначення/вхід. Прогнозна перевага саме цього кандидата: без джерела; тут не тестувалася.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не кожне невелике відхилення економічно значуще.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coingecko + explicitly audited venue sources; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** breadth_sentiment · **Перевірка визначення:** operational_definition

**Джерела:** [Coin Historical Chart Data by ID](https://docs.coingecko.com/reference/coins-id-market-chart) — Інтерфейс historical prices/marketcaps/volumes; доступність days=max без ключа тут не перевірена.; [Crypto Fear & Greed Index and API](https://alternative.me/crypto/fear-and-greed-index/) — Індекс включає ціну/волатильність/обсяг; не незалежна чиста оцінка настрою.
