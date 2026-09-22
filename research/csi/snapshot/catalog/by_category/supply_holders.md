# supply_holders

Картки кандидатів. Жодної ринкової перевірки у цьому пакеті не виконано. Формули — операційні описи, не перевірені функції бібліотеки.

## O031 · Current visible supply

**Канонічне поле:** `SplyCur` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc;eth

**Формула:** `visible issued native units at day end`

**Входи:** ledger balances

**Гіпотеза механізму:** Масштаб мережі і знаменник valuation.

**Що підтверджено:** Відкрито офіційне визначення. Community-доступ і прогнозна перевага не підтверджені; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не обов’язково circulating/free-float у маркетинговому сенсі.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** supply_holders · **Перевірка визначення:** provider_definition_opened

**Джерела:** [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O032 · Supply active within 1 year

**Канонічне поле:** `SplyAct1yr` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc;eth

**Формула:** `unique native units last active within trailing year by provider methodology`

**Входи:** coin age;ledger

**Гіпотеза механізму:** Частка recently movable supply.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не трактувати як inactive 1y+; рахунок account coins потребує методики.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** supply_holders · **Перевірка визначення:** index_only

**Джерела:** [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O033 · Supply active ever

**Канонічне поле:** `SplyActEver` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc;eth

**Формула:** `provider active-ever supply; verify exact eligible coins`

**Входи:** ledger history

**Гіпотеза механізму:** Базовий опис залучених монет.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не замінювати SplyCur; exact definition needs audit.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** supply_holders · **Перевірка визначення:** index_only

**Джерела:** [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O034 · Supply inactive 1y+

**Канонічне поле:** `supply_inactive_1y` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc;eth

**Формула:** `SplyCur-SplyAct1yr only if same coin universe`

**Входи:** supply;active1y

**Гіпотеза механізму:** Гіпотеза довгого утримання.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Dormant не дорівнює втрачені; методологічна сумісність.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** supply_holders · **Перевірка визначення:** index_only

**Джерела:** [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O035 · Supply active 30 days

**Канонічне поле:** `supply_active_30d` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc;eth

**Формула:** `unique supply moved in trailing 30d`

**Входи:** age-indexed ledger

**Гіпотеза механізму:** Ротація короткої active supply.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Більше переказів не означає net buying.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** supply_holders · **Перевірка визначення:** index_only

**Джерела:** [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O036 · HODL waves

**Канонічне поле:** `hodl_waves` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `share of current supply in fixed non-overlapping last-active age bins`

**Входи:** UTXO age distribution

**Гіпотеза механізму:** Структура віку власності.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Межі bins та lost supply; compositional dependence.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** supply_holders · **Перевірка визначення:** index_only

**Джерела:** [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O037 · Realized HODL waves

**Канонічне поле:** `realized_hodl_waves` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `share of realized cap by last-active age bins`

**Входи:** UTXO ages;cost basis

**Гіпотеза механізму:** Вартісна структура cohorts.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Включає історичну ціну; not independent of realized cap.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** supply_holders · **Перевірка визначення:** index_only

**Джерела:** [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O038 · Revived supply 1y+

**Канонічне поле:** `revived_supply_1y` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `spent amount whose previous age exceeds 1 year`

**Входи:** spent outputs;age

**Гіпотеза механізму:** Повернення старих coins у рух.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Один переказ біржі здатен дати великий spike.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** supply_holders · **Перевірка визначення:** index_only

**Джерела:** [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O039 · LTH supply

**Канонічне поле:** `lth_supply` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `supply meeting documented long-holder age rule`

**Входи:** UTXO ages;cohort rule

**Гіпотеза механізму:** Довга незмінна пропозиція як гіпотеза.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Вхід у cohort через aging, не лише купівля.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** supply_holders · **Перевірка визначення:** index_only

**Джерела:** [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O040 · STH supply

**Канонічне поле:** `sth_supply` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `supply meeting documented short-holder age rule`

**Входи:** UTXO ages;cohort rule

**Гіпотеза механізму:** Короткострокова потенційна ліквідність.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: За комплементарних cohorts це supply-LTH, не нове свідчення.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** supply_holders · **Перевірка визначення:** index_only

**Джерела:** [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O041 · Supply in profit fraction

**Канонічне поле:** `supply_profit_fraction` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `sum(units with current_price>last_move_price)/eligible_supply`

**Входи:** UTXO cost basis;price

**Гіпотеза механізму:** Частка потенційного прибутку власників.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Поточна ціна механічно зсуває всіх coins; no sell proof.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** supply_holders · **Перевірка визначення:** index_only

**Джерела:** [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O042 · Supply in loss fraction

**Канонічне поле:** `supply_loss_fraction` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc

**Формула:** `sum(units with current_price<last_move_price)/eligible_supply`

**Входи:** UTXO cost basis;price

**Гіпотеза механізму:** Частка потенційного збитку.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Комплементарність profit/loss з поправкою breakeven.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** supply_holders · **Перевірка визначення:** index_only

**Джерела:** [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O043 · New native issuance

**Канонічне поле:** `native_issuance` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc;eth

**Формула:** `native units newly created in day; gross not net`

**Входи:** protocol issuance

**Гіпотеза механізму:** Протокольна нова пропозиція.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Gross issuance не net change при burn.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** protocol_supply · **Перевірка визначення:** index_only

**Джерела:** [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O044 · Net supply growth

**Канонічне поле:** `net_supply_growth` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc;eth

**Формула:** `SplyCur/SplyCur[k]-1`

**Входи:** SplyCur

**Гіпотеза механізму:** Зміна видимої пропозиції.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Unlocks/circulating supply можуть відрізнятись від issuance.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** protocol_supply · **Перевірка визначення:** index_only

**Джерела:** [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O045 · Free-float supply

**Канонічне поле:** `free_float_supply` · **Група:** onchain · **Горизонт:** cycle;regime · **Активи:** btc;eth

**Формула:** `provider spendable/eligible free-float definition`

**Входи:** tagged balances;eligibility rules

**Гіпотеза механізму:** Ближчий знаменник до торгованого обсягу.

**Що підтверджено:** Офіційний індекс підтверджує назву/сімейство, не детальну формулу чи free-доступ. Формула — операційне визначення для аудиту; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Пропрієтарні правила та revisions; free API entitlement невідомий.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** supply_holders · **Перевірка визначення:** index_only

**Джерела:** [Current supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/supply/splycur.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.
