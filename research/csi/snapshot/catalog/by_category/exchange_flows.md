# exchange_flows

Картки кандидатів. Жодної ринкової перевірки у цьому пакеті не виконано. Формули — операційні описи, не перевірені функції бібліотеки.

## O076 · Exchange balance

**Канонічне поле:** `exchange_balance` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `sum native balances of tagged hot and cold exchange wallets`

**Входи:** historical exchange labels;ledger

**Гіпотеза механізму:** Потенційна торговельна ліквідність.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: CM попереджає про неповні labels; current labels cause revisions.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** allowed public labels or Coin Metrics entitlement; not obtained; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** exchange_inventory · **Перевірка визначення:** research_candidate

**Джерела:** [Exchange supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/splyexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Exchange deposits](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/flowinexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O077 · Exchange inflow

**Канонічне поле:** `exchange_inflow` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `native transfer into tagged exchange set excluding inter-exchange as specified`

**Входи:** ledger;PIT labels

**Гіпотеза механізму:** Потенційна пропозиція на біржах.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Депозит не обов’язково sell; collateral/внутрішня логістика.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** allowed public labels or Coin Metrics entitlement; not obtained; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** exchange_flows · **Перевірка визначення:** research_candidate

**Джерела:** [Exchange supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/splyexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Exchange deposits](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/flowinexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O078 · Exchange outflow

**Канонічне поле:** `exchange_outflow` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `native transfer from tagged exchanges to outside set`

**Входи:** ledger;PIT labels

**Гіпотеза механізму:** Гіпотеза виведення з торгованого запасу.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Custody reorganization, OTC та bridges.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** allowed public labels or Coin Metrics entitlement; not obtained; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** exchange_flows · **Перевірка визначення:** research_candidate

**Джерела:** [Exchange supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/splyexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Exchange deposits](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/flowinexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O079 · Exchange netflow

**Канонічне поле:** `exchange_netflow` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `exchange_inflow-exchange_outflow`

**Входи:** matched inflow;outflow

**Гіпотеза механізму:** Баланс потенційного біржового тиску.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Правила наборів повинні збігатися; знак не напрям ціни.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** allowed public labels or Coin Metrics entitlement; not obtained; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** exchange_inventory · **Перевірка визначення:** research_candidate

**Джерела:** [Exchange supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/splyexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Exchange deposits](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/flowinexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O080 · Exchange balance change

**Канонічне поле:** `exchange_balance_change` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `exchange_balance-exchange_balance[k]`

**Входи:** labelled balances

**Гіпотеза механізму:** Зміна біржового запасу.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Відрізняється від netflow при relabelling/issuance/fees.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** allowed public labels or Coin Metrics entitlement; not obtained; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** exchange_inventory · **Перевірка визначення:** research_candidate

**Джерела:** [Exchange supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/splyexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Exchange deposits](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/flowinexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O081 · Exchange supply ratio

**Канонічне поле:** `exchange_supply_ratio` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `exchange_balance/SplyCur`

**Входи:** exchange balances;supply

**Гіпотеза механізму:** Частка supply з біржовим контролем.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Неповні labels, централізоване custody.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** allowed public labels or Coin Metrics entitlement; not obtained; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** exchange_flows · **Перевірка визначення:** research_candidate

**Джерела:** [Exchange supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/splyexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Exchange deposits](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/flowinexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O082 · Stablecoins on exchanges

**Канонічне поле:** `exchange_stablecoin_balance` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `stablecoin balances at tagged exchange wallets`

**Входи:** stablecoin contracts;exchange labels

**Гіпотеза механізму:** Можлива purchasing capacity.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не committed buying; free labels не підтверджено.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** allowed public labels or Coin Metrics entitlement; not obtained; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** exchange_flows · **Перевірка визначення:** research_candidate

**Джерела:** [Exchange supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/splyexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Exchange deposits](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/flowinexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O083 · Stablecoin exchange netflow

**Канонічне поле:** `exchange_stablecoin_netflow` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `stablecoin_inflow-stablecoin_outflow for same exchange set`

**Входи:** stablecoin transfers;labels

**Гіпотеза механізму:** Зміна settlement collateral на біржах.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Mint/burn/chain migration не покупка BTC.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** allowed public labels or Coin Metrics entitlement; not obtained; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** exchange_flows · **Перевірка визначення:** research_candidate

**Джерела:** [Exchange supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/splyexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Exchange deposits](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/flowinexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O084 · Large-deposit concentration

**Канонічне поле:** `exchange_large_deposit_share` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `large tagged deposits/total deposits; cutoff predeclared`

**Входи:** labelled exchange deposits

**Гіпотеза механізму:** Концентрація потенційного тиску.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Вибір threshold та dust denominator; UTXO batching.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** allowed public labels or Coin Metrics entitlement; not obtained; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** exchange_flows · **Перевірка визначення:** research_candidate

**Джерела:** [Exchange supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/splyexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Exchange deposits](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/flowinexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.

## O085 · Mean exchange deposit size

**Канонічне поле:** `exchange_deposit_mean` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** btc;eth

**Формула:** `exchange_inflow/deposit_count`

**Входи:** labelled deposits

**Гіпотеза механізму:** Середній розмір надходження.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Один whale і batching змінюють mean; self transfers.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** allowed public labels or Coin Metrics entitlement; not obtained; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** exchange_flows · **Перевірка визначення:** research_candidate

**Джерела:** [Exchange supply](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/splyexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.; [Exchange deposits](https://raw.githubusercontent.com/coinmetrics/docs-website/master/asset-metrics/exchange/flowinexntv.md) — Офіційне визначення метрики; не підтвердження доступності Community, не емпірична перевірка alpha.
