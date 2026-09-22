# fees_blockspace

Картки кандидатів. Жодної ринкової перевірки у цьому пакеті не виконано. Формули — операційні описи, не перевірені функції бібліотеки.

## O056 · Daily total fees USD

**Канонічне поле:** `FeeTotUSD` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `sum native fees converted under source pricing convention`

**Входи:** ledger fees;price

**Гіпотеза механізму:** Попит на blockspace як гіпотеза.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Fee revenue може зростати лише через price.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** fees_blockspace · **Перевірка визначення:** index_only

**Джерела:** [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.; [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O057 · Mean native transaction fee

**Канонічне поле:** `mean_fee_native` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `sum(native_tx_fees)/eligible_transaction_count`

**Входи:** fees;tx count

**Гіпотеза механізму:** Ціна типового використання blockspace.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Mean чутливе до outliers; не median.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** fees_blockspace · **Перевірка визначення:** index_only

**Джерела:** [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.; [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O058 · Fee per byte/weight

**Канонічне поле:** `fee_per_weight` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `validated transaction fee divided by virtual size/weight`

**Входи:** fees;tx sizes

**Гіпотеза механізму:** Інтенсивність конкуренції за blockspace.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Byte vs vbyte vs weight не змішувати.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** fees_blockspace · **Перевірка визначення:** index_only

**Джерела:** [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.; [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O059 · Fee share of miner revenue

**Канонічне поле:** `fee_revenue_share` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `FeeTotUSD/RevUSD under same chain/day`

**Входи:** fees;miner revenue

**Гіпотеза механізму:** Частка комісій у security budget.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Після halving mechanical jump; ETH revenue taxonomy інша.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** fees_blockspace · **Перевірка визначення:** index_only

**Джерела:** [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.; [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O060 · Block count

**Канонічне поле:** `block_count` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `confirmed blocks in UTC day`

**Входи:** block timestamps

**Гіпотеза механізму:** Операційна швидкість мережі.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Кількість випадкова; не ціновий сигнал сама по собі.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** fees_blockspace · **Перевірка визначення:** index_only

**Джерела:** [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.; [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O061 · Mean block interval

**Канонічне поле:** `block_interval_mean` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `mean(time between adjacent blocks)`

**Входи:** block timestamps

**Гіпотеза механізму:** Умови виробництва блоків.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Timestamp noise та пересікання UTC boundaries.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** fees_blockspace · **Перевірка визначення:** index_only

**Джерела:** [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.; [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O062 · Mean block size

**Канонічне поле:** `block_size_mean` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `mean(serialized block bytes)`

**Входи:** block data

**Гіпотеза механізму:** Навантаження capacity.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Великий block не завжди більша економічна цінність.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** fees_blockspace · **Перевірка визначення:** index_only

**Джерела:** [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.; [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O063 · Mempool pending vbytes

**Канонічне поле:** `mempool_pending_vbytes` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `size of locally observed unconfirmed transaction set`

**Входи:** archived mempool snapshots

**Гіпотеза механізму:** Поточна незадоволена конкуренція за blockspace.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Mempool не global canonical state; історію з blockchain не відновити.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** fees_blockspace · **Перевірка визначення:** index_only

**Джерела:** [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.; [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O064 · Transaction throughput

**Канонічне поле:** `tx_throughput` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `TxCnt/86400 for daily mean`

**Входи:** TxCnt

**Гіпотеза механізму:** Інтенсивність використання.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Точний масштаб TxCnt, не незалежний голос.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** fees_blockspace · **Перевірка визначення:** index_only

**Джерела:** [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.; [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O065 · Median native fee

**Канонічне поле:** `median_fee_native` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `median(eligible transaction native fees)`

**Входи:** ledger transaction fees

**Гіпотеза механізму:** Стійкіша типова вартість use.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не можна отримати з mean і sum; точна provider coverage невідома.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** fees_blockspace · **Перевірка визначення:** index_only

**Джерела:** [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.; [Transaction count](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/transactions/txcnt.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.
