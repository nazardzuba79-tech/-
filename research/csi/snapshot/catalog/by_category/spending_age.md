# spending_age

Картки кандидатів. Жодної ринкової перевірки у цьому пакеті не виконано. Формули — операційні описи, не перевірені функції бібліотеки.

## O016 · SOPR

**Канонічне поле:** `sopr` · **Група:** onchain · **Горизонт:** cycle;regime;tactical · **Активи:** btc

**Формула:** `USD_value_of_spent_outputs_at_spend/USD_cost_at_creation`

**Входи:** spent UTXOs;historical prices

**Гіпотеза механізму:** Прибутковість витрачених монет як стан ринку.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Ratio sums не mean individual ratios; spend не означає sell.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** spending_age · **Перевірка визначення:** research_candidate

**Джерела:** [Spent Output Profit Ratio](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/economics/sopr.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O017 · aSOPR

**Канонічне поле:** `asopr` · **Група:** onchain · **Горизонт:** cycle;regime;tactical · **Активи:** btc

**Формула:** `SOPR after excluding short-lived outputs per exact source convention`

**Входи:** UTXO age;spent value

**Гіпотеза механізму:** Прибрати частину технічного churn.

**Що підтверджено:** Включено за ТЗ; точне первинне визначення не верифіковано. Відкриті джерела у рядку — лише споріднені входи/сімейства. Alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Конкретний cutoff та provider adjustment не підтверджено.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** spending_age · **Перевірка визначення:** unverified_definition

**Джерела:** [Spent Output Profit Ratio](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/economics/sopr.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O018 · STH SOPR

**Канонічне поле:** `sth_sopr` · **Група:** onchain · **Горизонт:** cycle;regime;tactical · **Активи:** btc

**Формула:** `SOPR restricted to documented short-age cohort`

**Входи:** UTXO age;spent outputs

**Гіпотеза механізму:** Поведінка новішої cohort.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Total SOPR не дозволяє відновити cohort; history needed.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** spending_age · **Перевірка визначення:** research_candidate

**Джерела:** [Spent Output Profit Ratio](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/economics/sopr.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O019 · LTH SOPR

**Канонічне поле:** `lth_sopr` · **Група:** onchain · **Горизонт:** cycle;regime;tactical · **Активи:** btc

**Формула:** `SOPR restricted to documented long-age cohort`

**Входи:** UTXO age;spent outputs

**Гіпотеза механізму:** Прибуток довших власників при витрачанні.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Кілька великих старих UTXO можуть домінувати.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** spending_age · **Перевірка визначення:** research_candidate

**Джерела:** [Spent Output Profit Ratio](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/economics/sopr.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O020 · SOPR cohort ratio

**Канонічне поле:** `sopr_cohort_ratio` · **Група:** onchain · **Горизонт:** cycle;regime;tactical · **Активи:** btc

**Формула:** `lth_sopr/sth_sopr`

**Входи:** LTH SOPR;STH SOPR

**Гіпотеза механізму:** Відносний тиск cohorts.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Залежить від двох дорогих/неотриманих серій.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** spending_age · **Перевірка визначення:** research_candidate

**Джерела:** [Spent Output Profit Ratio](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/economics/sopr.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O021 · Coin Days Destroyed

**Канонічне поле:** `coin_days_destroyed` · **Група:** onchain · **Горизонт:** cycle;regime;tactical · **Активи:** btc

**Формула:** `sum(spent_coin_amount*age_days)`

**Входи:** spent output amount;age

**Гіпотеза механізму:** Пробудження старих монет.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Self-spends та custodial moves не обов’язково продаж.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** spending_age · **Перевірка визначення:** research_candidate

**Джерела:** [Spent Output Profit Ratio](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/economics/sopr.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O022 · Binary CDD causal variant

**Канонічне поле:** `binary_cdd_causal` · **Група:** onchain · **Горизонт:** cycle;regime;tactical · **Активи:** btc

**Формула:** `1[CDD>expanding_mean_past(CDD)]`

**Входи:** CDD

**Гіпотеза механізму:** Частота аномальної активності старих монет.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Спростить амплітуду; не точна копія всіх Binary CDD провайдерів.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** spending_age · **Перевірка визначення:** research_candidate

**Джерела:** [Spent Output Profit Ratio](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/economics/sopr.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O023 · Supply-adjusted CDD

**Канонічне поле:** `cdd_supply_adjusted` · **Група:** onchain · **Горизонт:** cycle;regime;tactical · **Активи:** btc

**Формула:** `CDD/SplyCur`

**Входи:** CDD;supply

**Гіпотеза механізму:** Нормування старого spend за розміром мережі.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Може рахувати age двічі з іншими age-features.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** spending_age · **Перевірка визначення:** research_candidate

**Джерела:** [Spent Output Profit Ratio](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/economics/sopr.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O024 · Dormancy

**Канонічне поле:** `dormancy` · **Група:** onchain · **Горизонт:** cycle;regime;tactical · **Активи:** btc

**Формула:** `CDD/coin_amount_transferred under same spend universe`

**Входи:** CDD;transferred units

**Гіпотеза механізму:** Середній вік витрачених монет.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Знаменник повинен відповідати CDD; не USD volume.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** spending_age · **Перевірка визначення:** research_candidate

**Джерела:** [Spent Output Profit Ratio](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/economics/sopr.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O025 · Liveliness

**Канонічне поле:** `liveliness` · **Група:** onchain · **Горизонт:** cycle;regime;tactical · **Активи:** btc

**Формула:** `cumulative CDD/cumulative coin-days-created`

**Входи:** CDD;supply history

**Гіпотеза механізму:** Баланс витрачання і накопичення віку.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Неповний genesis history змінює рівень; методику треба звірити.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** spending_age · **Перевірка визначення:** research_candidate

**Джерела:** [Spent Output Profit Ratio](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/economics/sopr.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O026 · Reserve Risk

**Канонічне поле:** `reserve_risk` · **Група:** onchain · **Горизонт:** cycle;regime;tactical · **Активи:** btc

**Формула:** `PriceUSD/HODL_bank; bank construction not independently verified here`

**Входи:** HODL bank;price

**Гіпотеза механізму:** Гіпотеза винагороди проти довготермінового невитрачання.

**Що підтверджено:** Включено за ТЗ; точне первинне визначення не верифіковано. Відкриті джерела у рядку — лише споріднені входи/сімейства. Alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Визначення bank неоднозначне; без повної специфікації не реалізовувати.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** spending_age · **Перевірка визначення:** unverified_definition

**Джерела:** [Spent Output Profit Ratio](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/economics/sopr.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O027 · RHODL ratio

**Канонічне поле:** `rhodl_ratio` · **Група:** onchain · **Горизонт:** cycle;regime;tactical · **Активи:** btc

**Формула:** `ratio of specified realized-cap age bands with age adjustment; exact variant unresolved`

**Входи:** realized HODL age bands

**Гіпотеза механізму:** Перекіс realized value молодих та старих монет.

**Що підтверджено:** Включено за ТЗ; точне первинне визначення не верифіковано. Відкриті джерела у рядку — лише споріднені входи/сімейства. Alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Потрібні original bands/adjustment; опис не замінює сирі cohort дані.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** spending_age · **Перевірка визначення:** unverified_definition

**Джерела:** [Spent Output Profit Ratio](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/economics/sopr.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O028 · Realized profit/loss ratio

**Канонічне поле:** `realized_profit_loss_ratio` · **Група:** onchain · **Горизонт:** cycle;regime;tactical · **Активи:** btc

**Формула:** `realized_profit_usd/realized_loss_usd`

**Входи:** profit;loss USD

**Гіпотеза механізму:** Співвідношення двох видів реалізації.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Near-zero losses робить ratio нестійким; не SOPR.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** spending_age · **Перевірка визначення:** research_candidate

**Джерела:** [Spent Output Profit Ratio](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/economics/sopr.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O029 · Net realized profit loss

**Канонічне поле:** `net_realized_profit_loss` · **Група:** onchain · **Горизонт:** cycle;regime;tactical · **Активи:** btc

**Формула:** `realized_profit_usd-realized_loss_usd`

**Входи:** profit;loss USD

**Гіпотеза механізму:** Чистий знак реалізованого P/L.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не всі on-chain moves є торгівлею.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** spending_age · **Перевірка визначення:** research_candidate

**Джерела:** [Spent Output Profit Ratio](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/economics/sopr.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O030 · Spent output age distribution

**Канонічне поле:** `spent_age_distribution` · **Група:** onchain · **Горизонт:** cycle;regime;tactical · **Активи:** btc

**Формула:** `share of spent coin volume by fixed non-overlapping age bins`

**Входи:** spent outputs;ages

**Гіпотеза механізму:** Яка cohort створює оборот.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не одна скалярна метрика; bins не рахувати як незалежних експертів.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** coinmetrics_community_if_catalog_confirms; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** spending_age · **Перевірка визначення:** research_candidate

**Джерела:** [Spent Output Profit Ratio](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/economics/sopr.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.
