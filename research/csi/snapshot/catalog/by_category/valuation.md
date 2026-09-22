# valuation

Картки кандидатів. Жодної ринкової перевірки у цьому пакеті не виконано. Формули — операційні описи, не перевірені функції бібліотеки.

## O001 · Realized capitalization

**Канонічне поле:** `CapRealUSD` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc;eth

**Формула:** `sum(unspent_units * USD_price_at_last_transfer)`

**Входи:** UTXO/account cost-basis methodology;historical price

**Гіпотеза механізму:** Гіпотеза агрегованої бази собівартості.

**Що підтверджено:** Відкрито офіційне визначення. Community-доступ і прогнозна перевага не підтверджені; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Переказ не обов’язково купівля; account-chain методика інша.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** valuation · **Перевірка визначення:** provider_definition_opened

**Джерела:** [Realized capitalization](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/caprealusd.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O002 · Realized price

**Канонічне поле:** `realized_price` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc;eth

**Формула:** `CapRealUSD/SplyCur`

**Входи:** CapRealUSD;SplyCur

**Гіпотеза механізму:** Рівень агрегованої оцінки останнього руху монет.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не гарантована підтримка і не справжня ціна купівлі всіх інвесторів.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** realized_valuation · **Перевірка визначення:** research_candidate

**Джерела:** [Realized capitalization](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/caprealusd.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Market to Realized Value](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/capmvrvcur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O003 · MVRV

**Канонічне поле:** `CapMVRVCur` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc;eth

**Формула:** `CapMrktCurUSD/CapRealUSD`

**Входи:** CapMrktCurUSD;CapRealUSD

**Гіпотеза механізму:** Відхилення ринкової оцінки від realized cost proxy.

**Що підтверджено:** Відкрито офіційне визначення. Community-доступ і прогнозна перевага не підтверджені; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Містить поточну ціну; не незалежний від NUPL.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** realized_valuation · **Перевірка визначення:** provider_definition_opened

**Джерела:** [Market to Realized Value](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/capmvrvcur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O004 · MVRV Z-score causal audit variant

**Канонічне поле:** `mvrv_z_causal` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc;eth

**Формула:** `(CapMrktCurUSD-CapRealUSD)/expanding_std_past(CapMrktCurUSD)`

**Входи:** market cap;realized cap

**Гіпотеза механізму:** Нормалізація відхилення циклу.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не standard z-score; різні price/cap варіанти. Не full-history denominator.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** realized_valuation · **Перевірка визначення:** research_candidate

**Джерела:** [MVRV Z-Score chart explanation](https://charts.bitbo.io/mvrv-z-score/) — Публічне пояснення; виявлено неоднозначність price vs capitalization та full-history denominator. Не прийнято як готову специфікацію backtest.; [Market to Realized Value](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/capmvrvcur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O005 · NUPL aggregate

**Канонічне поле:** `nupl` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc;eth

**Формула:** `(CapMrktCurUSD-CapRealUSD)/CapMrktCurUSD`

**Входи:** market cap;realized cap

**Гіпотеза механізму:** Гіпотеза нереалізованого загального прибутку.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Точно 1-1/MVRV за однакових визначень; не другий голос.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** realized_valuation · **Перевірка визначення:** research_candidate

**Джерела:** [Realized capitalization](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/caprealusd.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Market to Realized Value](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/capmvrvcur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O006 · STH realized price

**Канонічне поле:** `sth_realized_price` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `cohort_realized_cap/cohort_supply; age rule must be fixed`

**Входи:** age-labelled UTXO costs

**Гіпотеза механізму:** Собівартість новіших монет.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Поріг cohort та entity adjustment треба підтвердити; не всі BTC покупці.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** valuation · **Перевірка визначення:** research_candidate

**Джерела:** [Realized capitalization](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/caprealusd.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Market to Realized Value](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/capmvrvcur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O007 · LTH realized price

**Канонічне поле:** `lth_realized_price` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `cohort_realized_cap/cohort_supply; age rule must be fixed`

**Входи:** age-labelled UTXO costs

**Гіпотеза механізму:** Собівартість старіших монет.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Старіння переводить монети без угод; потрібна узгоджена cohort history.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** valuation · **Перевірка визначення:** research_candidate

**Джерела:** [Realized capitalization](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/caprealusd.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Market to Realized Value](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/capmvrvcur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O008 · STH MVRV

**Канонічне поле:** `sth_mvrv` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `PriceUSD/sth_realized_price`

**Входи:** PriceUSD;STH realized price

**Гіпотеза механізму:** Перекос нових власників як гіпотеза.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не доступно з total MVRV; не придумувати cohorts.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** valuation · **Перевірка визначення:** research_candidate

**Джерела:** [Realized capitalization](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/caprealusd.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Market to Realized Value](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/capmvrvcur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O009 · LTH MVRV

**Канонічне поле:** `lth_mvrv` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `PriceUSD/lth_realized_price`

**Входи:** PriceUSD;LTH realized price

**Гіпотеза механізму:** Прибуток старшої cohort як гіпотеза.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Lost coins, cohort aging та незмінний supply denominator.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** valuation · **Перевірка визначення:** research_candidate

**Джерела:** [Realized capitalization](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/caprealusd.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Market to Realized Value](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/capmvrvcur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O010 · STH/LTH cost basis ratio

**Канонічне поле:** `sth_lth_cost_ratio` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `sth_realized_price/lth_realized_price`

**Входи:** STH;LTH realized price

**Гіпотеза механізму:** Різниця собівартості cohorts.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Комбінація двох пов’язаних показників, не нове джерело.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** valuation · **Перевірка визначення:** research_candidate

**Джерела:** [Realized capitalization](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/caprealusd.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Market to Realized Value](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/capmvrvcur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O011 · Realized cap change

**Канонічне поле:** `realized_cap_change` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc;eth

**Формула:** `CapRealUSD/CapRealUSD[k]-1`

**Входи:** CapRealUSD

**Гіпотеза механізму:** Гіпотеза зміни агрегованої бази капіталу.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не чистий cash inflow; self-transfers можуть переоцінювати coins.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** valuation · **Перевірка визначення:** research_candidate

**Джерела:** [Realized capitalization](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/caprealusd.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Market to Realized Value](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/capmvrvcur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O012 · Thermocap

**Канонічне поле:** `thermocap` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc;eth

**Формула:** `cumulative miner revenue USD under fixed reward/fee convention`

**Входи:** RevUSD from genesis

**Гіпотеза механізму:** Кумулятивна ціна security budget як контекст.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не оцінка всього invested capital; початкова історія критична.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** valuation · **Перевірка визначення:** research_candidate

**Джерела:** [Realized capitalization](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/caprealusd.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Market to Realized Value](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/capmvrvcur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O013 · Market cap to thermocap

**Канонічне поле:** `mcap_thermocap` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc;eth

**Формула:** `CapMrktCurUSD/thermocap`

**Входи:** market cap;thermocap

**Гіпотеза механізму:** Співвідношення оцінки та security spend.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Містить ціну й загальний часовий тренд; економічний знаменник спірний.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** valuation · **Перевірка визначення:** research_candidate

**Джерела:** [Realized capitalization](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/caprealusd.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Market to Realized Value](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/capmvrvcur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O014 · Realized profit USD

**Канонічне поле:** `realized_profit_usd` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `sum(max(current_price-cost_price,0)*spent_units)`

**Входи:** spent outputs;cost basis

**Гіпотеза механізму:** Реалізований прибуток потенційних продавців.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: On-chain spend не обов’язково продаж; точна методика не перевірена.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** valuation · **Перевірка визначення:** research_candidate

**Джерела:** [Realized capitalization](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/caprealusd.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Market to Realized Value](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/capmvrvcur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O015 · Realized loss USD

**Канонічне поле:** `realized_loss_usd` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `sum(max(cost_price-current_price,0)*spent_units)`

**Входи:** spent outputs;cost basis

**Гіпотеза механізму:** Потенційна капітуляція збиткових монет.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не можна отримати з SOPR одним множенням без його знаменника.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** valuation · **Перевірка визначення:** research_candidate

**Джерела:** [Realized capitalization](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/caprealusd.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Market to Realized Value](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/market/capmvrvcur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.
