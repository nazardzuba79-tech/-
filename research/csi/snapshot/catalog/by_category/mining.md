# mining

Картки кандидатів. Жодної ринкової перевірки у цьому пакеті не виконано. Формули — операційні описи, не перевірені функції бібліотеки.

## O066 · Hash rate estimate

**Канонічне поле:** `HashRate` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `provider estimate from block production and difficulty`

**Входи:** difficulty;block intervals

**Гіпотеза механізму:** Ресурси security supply як гіпотеза stress.

**Що підтверджено:** Відкрито офіційне визначення. Community-доступ і прогнозна перевага не підтверджені; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Hashrate оцінюється, а не спостерігається точно.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** mining · **Перевірка визначення:** provider_definition_opened

**Джерела:** [Hash rate](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/mining/hashrate.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O067 · Hash ribbons

**Канонічне поле:** `hash_ribbons` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `short-vs-long trailing means of HashRate; fixed declared windows`

**Входи:** HashRate

**Гіпотеза механізму:** Гіпотеза відновлення після miner stress.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не гарантія capitulation bottom; hashrate noise.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** mining · **Перевірка визначення:** index_only

**Джерела:** [Hash rate](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/mining/hashrate.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O068 · Mean mining difficulty

**Канонічне поле:** `DiffMean` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `mean difficulty over interval per provider`

**Входи:** block headers

**Гіпотеза механізму:** Складність конкуренції за subsidy.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Ступінчасті зміни; метод mean може відрізнятися.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** mining · **Перевірка визначення:** index_only

**Джерела:** [Hash rate](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/mining/hashrate.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O069 · Difficulty ribbon compression

**Канонічне поле:** `difficulty_ribbon` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `dispersion of predeclared trailing difficulty averages`

**Входи:** DiffMean

**Гіпотеза механізму:** Гіпотеза зміни miner competition.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Багато MA того самого входу; parameter freedom.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** mining · **Перевірка визначення:** index_only

**Джерела:** [Hash rate](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/mining/hashrate.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O070 · Miner revenue USD

**Канонічне поле:** `RevUSD` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `block subsidies plus fees in USD for PoW convention`

**Входи:** issuance;fees;price

**Гіпотеза механізму:** Можливий бюджет продажу майнерів.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Revenue не cashflow after power costs; USD price endogeneity.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** mining · **Перевірка визначення:** index_only

**Джерела:** [Hash rate](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/mining/hashrate.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O071 · Issuance USD

**Канонічне поле:** `IssTotUSD` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `newly issued native units valued in USD`

**Входи:** native issuance;price

**Гіпотеза механізму:** Нова supply pressure у грошовому вимірі.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не фактичні продажі; emission ledger convention.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** mining · **Перевірка визначення:** index_only

**Джерела:** [Hash rate](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/mining/hashrate.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O072 · Puell Multiple

**Канонічне поле:** `puell_multiple` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `IssTotUSD/SMA_365d(IssTotUSD); issuance variant explicit`

**Входи:** IssTotUSD

**Гіпотеза механізму:** Відхилення issuance-dollar revenue від річного стану.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: RevUSD/average(RevUSD) — інша версія; halving break.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** mining · **Перевірка визначення:** index_only

**Джерела:** [Hash rate](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/mining/hashrate.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O073 · Hash price

**Канонічне поле:** `hash_price` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `RevUSD/HashRate with declared units and interval`

**Входи:** RevUSD;HashRate

**Гіпотеза механізму:** Дохід на одиницю security resource.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Ні витрат, ні leverage майнерів; змінюється з fee spikes.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** mining · **Перевірка визначення:** index_only

**Джерела:** [Hash rate](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/mining/hashrate.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O074 · Miner reserves

**Канонічне поле:** `miner_reserves` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `native balance of historically identified miner addresses`

**Входи:** miner labels;ledger

**Гіпотеза механізму:** Потенційний запас продажу.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Label uncertainty; coinbase address не вся компанія.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** mining · **Перевірка визначення:** index_only

**Джерела:** [Hash rate](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/mining/hashrate.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O075 · Miner outflows

**Канонічне поле:** `miner_outflows` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `outgoing native units from labelled miner wallets`

**Входи:** miner labels;transfers

**Гіпотеза механізму:** Гіпотеза розподілу винагород/продажу.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Pool payouts та внутрішні transfers не exchange sales.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** mining · **Перевірка визначення:** index_only

**Джерела:** [Hash rate](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/mining/hashrate.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.
