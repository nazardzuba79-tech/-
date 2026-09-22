# network_activity

Картки кандидатів. Жодної ринкової перевірки у цьому пакеті не виконано. Формули — операційні описи, не перевірені функції бібліотеки.

## O046 · Active addresses

**Канонічне поле:** `AdrActCnt` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** btc;eth

**Формула:** `count distinct addresses active per documented chain rules`

**Входи:** ledger addresses

**Гіпотеза механізму:** Гіпотеза економічної активності.

**Що підтверджено:** Відкрито офіційне визначення. Community-доступ і прогнозна перевага не підтверджені; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Адреса не користувач; дешеві Sybil і self transfers.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** network_activity · **Перевірка визначення:** provider_definition_opened

**Джерела:** [Active addresses](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/addresses/adractcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O047 · New addresses

**Канонічне поле:** `new_addresses` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** btc;eth

**Формула:** `count first-seen addresses under provider rule`

**Входи:** ledger addresses

**Гіпотеза механізму:** Гіпотеза нової участі.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Нові адреси wallet change не нові користувачі.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** network_activity · **Перевірка визначення:** index_only

**Джерела:** [Active addresses](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/addresses/adractcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [NVT adjusted 90 days](https://github.com/coinmetrics/docs-website/blob/master/asset-metrics/economics/nvtadj90.md) — Визначення або перелік; не доказ прогнозної переваги.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O048 · Nonzero-balance addresses

**Канонічне поле:** `nonzero_addresses` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** btc;eth

**Формула:** `count addresses with positive native balance at day end`

**Входи:** ledger balances

**Гіпотеза механізму:** Ширина володіння native asset.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Dust addresses дешеві; ERC20-only account може не рахуватися.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** network_activity · **Перевірка визначення:** index_only

**Джерела:** [Addresses with positive balance](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/addresses/adrbalcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O049 · Transaction count

**Канонічне поле:** `TxCnt` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** btc;eth

**Формула:** `sum confirmed user transactions excluding protocol issuance per provider`

**Входи:** ledger transactions

**Гіпотеза механізму:** Використання мережі.

**Що підтверджено:** Відкрито офіційне визначення. Community-доступ і прогнозна перевага не підтверджені; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Batching та bot transactions; міжмережеві правила різні.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** network_activity · **Перевірка визначення:** provider_definition_opened

**Джерела:** [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O050 · Adjusted transfer value USD

**Канонічне поле:** `TxTfrValAdjUSD` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** btc;eth

**Формула:** `provider-adjusted native transfer value converted to USD`

**Входи:** ledger;price;adjustments

**Гіпотеза механізму:** Економічний settlement proxy.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: USD revaluation; методика change/self transfers потребує аудиту.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** network_activity · **Перевірка визначення:** index_only

**Джерела:** [Active addresses](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/addresses/adractcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [NVT adjusted 90 days](https://github.com/coinmetrics/docs-website/blob/master/asset-metrics/economics/nvtadj90.md) — Визначення або перелік; не доказ прогнозної переваги.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O051 · NVT

**Канонічне поле:** `nvt` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** btc;eth

**Формула:** `CapMrktCurUSD/daily_adjusted_transfer_USD`

**Входи:** market cap;transfers

**Гіпотеза механізму:** Оцінка мережі відносно settlement activity.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Ендогенна ціна; не P/E компанії.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** network_activity · **Перевірка визначення:** index_only

**Джерела:** [Active addresses](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/addresses/adractcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [NVT adjusted 90 days](https://github.com/coinmetrics/docs-website/blob/master/asset-metrics/economics/nvtadj90.md) — Визначення або перелік; не доказ прогнозної переваги.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O052 · NVT 90-day adjusted

**Канонічне поле:** `NVTAdj90` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** btc;eth

**Формула:** `CapMrktCurUSD/mean_90d(TxTfrValAdjUSD); verify exact smoothing`

**Входи:** market cap;adjusted transfer USD

**Гіпотеза механізму:** Повільніша valuation/activity relation.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Nonstationarity і структурна зміна usage; не NVTS усіх провайдерів.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** network_activity · **Перевірка визначення:** index_only

**Джерела:** [Active addresses](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/addresses/adractcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [NVT adjusted 90 days](https://github.com/coinmetrics/docs-website/blob/master/asset-metrics/economics/nvtadj90.md) — Визначення або перелік; не доказ прогнозної переваги.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O053 · RVT

**Канонічне поле:** `rvt` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** btc;eth

**Формула:** `CapRealUSD/adjusted_transfer_USD with declared smoothing`

**Входи:** realized cap;transfer value

**Гіпотеза механізму:** Cost-basis valuation до settlement.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Знаменник той самий як NVT; не незалежний family.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** network_activity · **Перевірка визначення:** index_only

**Джерела:** [Active addresses](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/addresses/adractcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [NVT adjusted 90 days](https://github.com/coinmetrics/docs-website/blob/master/asset-metrics/economics/nvtadj90.md) — Визначення або перелік; не доказ прогнозної переваги.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O054 · Monetary velocity

**Канонічне поле:** `monetary_velocity` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** btc;eth

**Формула:** `native_transfer_volume/current_native_supply`

**Входи:** native transfers;supply

**Гіпотеза механізму:** Оборотність видимої пропозиції.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Custody churn підвищує velocity без фінального попиту.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** network_activity · **Перевірка визначення:** index_only

**Джерела:** [Active addresses](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/addresses/adractcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [NVT adjusted 90 days](https://github.com/coinmetrics/docs-website/blob/master/asset-metrics/economics/nvtadj90.md) — Визначення або перелік; не доказ прогнозної переваги.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O055 · Top100-address supply concentration

**Канонічне поле:** `supply_top100_fraction` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** btc;eth

**Формула:** `supply in top100 addresses/current supply`

**Входи:** address balances

**Гіпотеза механізму:** Концентрація потенційно movable supply.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Біржа містить багатьох власників; адреса не entity.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** network_activity · **Перевірка визначення:** index_only

**Джерела:** [Active addresses](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/addresses/adractcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [NVT adjusted 90 days](https://github.com/coinmetrics/docs-website/blob/master/asset-metrics/economics/nvtadj90.md) — Визначення або перелік; не доказ прогнозної переваги.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.
