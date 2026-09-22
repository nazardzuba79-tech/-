# defi

Картки кандидатів. Жодної ринкової перевірки у цьому пакеті не виконано. Формули — операційні описи, не перевірені функції бібліотеки.

## O113 · Total DeFi TVL

**Канонічне поле:** `total_tvl` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** ринок/макро

**Формула:** `provider global TVL aggregate`

**Входи:** protocol balances;prices

**Гіпотеза механізму:** Розмір капіталу у smart contracts.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Price revaluation не inflow; double-count settings.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama/public protocol ledgers; endpoint and history audit required; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** defi · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.

## O114 · Price-adjusted protocol inflows

**Канонічне поле:** `defi_usd_inflows` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** ринок/макро

**Формула:** `sum((balance_t-balance_t-1)*price_t) with declared pricing`

**Входи:** token balances;prices

**Гіпотеза механізму:** Ближчий вимір flow, ніж delta USD TVL.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Coverage and exact token composition; не cash from outside crypto.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama/public protocol ledgers; endpoint and history audit required; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** defi · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.

## O115 · DEX volume

**Канонічне поле:** `dex_volume` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** ринок/макро

**Формула:** `sum executed swap notional under provider convention`

**Входи:** DEX swaps;prices

**Гіпотеза механізму:** Економічна торговельна активність.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Wash/incentive volume, aggregator double counting.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama/public protocol ledgers; endpoint and history audit required; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** defi · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.

## O116 · Protocol fees

**Канонічне поле:** `protocol_fees` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** ринок/макро

**Формула:** `fees paid by users of protocol`

**Входи:** fee events

**Гіпотеза механізму:** Willingness to pay for protocol use.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Fees не повністю належать token holders.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama/public protocol ledgers; endpoint and history audit required; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** protocol_economics_nested · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.

## O117 · Protocol revenue

**Канонічне поле:** `protocol_revenue` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** ринок/макро

**Формула:** `portion of fees retained by protocol`

**Входи:** fee split;treasury rules

**Гіпотеза механізму:** Економічний capture протоколу.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не корпоративний чистий прибуток, не guaranteed token accrual.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama/public protocol ledgers; endpoint and history audit required; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** protocol_economics_nested · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.

## O118 · Tokenholder revenue

**Канонічне поле:** `tokenholder_revenue` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** ринок/макро

**Формула:** `portion passed to holders via documented mechanism`

**Входи:** distribution/buyback/burn events

**Гіпотеза механізму:** Безпосередня економічна передача holders.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не сумувати revenue+holder revenue як незалежні flows.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama/public protocol ledgers; endpoint and history audit required; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** protocol_economics_nested · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.

## O119 · Outstanding DeFi loans

**Канонічне поле:** `defi_active_loans` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** ринок/макро

**Формула:** `sum active debt under provider definitions`

**Входи:** lending protocol debt

**Гіпотеза механізму:** On-chain leverage exposure.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Recursive lending та valuation; active loans excluded from default TVL.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama/public protocol ledgers; endpoint and history audit required; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** defi · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.

## O120 · Bridge net flow

**Канонічне поле:** `bridge_netflow` · **Група:** onchain · **Горизонт:** regime;tactical · **Активи:** ринок/макро

**Формула:** `verified destination inflows-source outflows in matched units`

**Входи:** bridge events;chain balances

**Гіпотеза механізму:** Перерозподіл капіталу між chains.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не global new money; pending messages та double counting.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama/public protocol ledgers; endpoint and history audit required; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** defi · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.
