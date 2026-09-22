# stablecoins

Картки кандидатів. Жодної ринкової перевірки у цьому пакеті не виконано. Формули — операційні описи, не перевірені функції бібліотеки.

## O101 · Total stablecoin market cap

**Канонічне поле:** `stablecoin_mcap` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `sum stablecoin circulating USD value per provider universe`

**Входи:** stablecoin supplies;prices

**Гіпотеза механізму:** Гіпотеза settlement liquidity.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Mint не купівля crypto; universe/bridged double counting.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama_stablecoins; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** stablecoin_stock · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.

## O102 · Stablecoin net supply change

**Канонічне поле:** `stablecoin_supply_change` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `stablecoin_mcap-stablecoin_mcap[k]`

**Входи:** stablecoin_mcap

**Гіпотеза механізму:** Зміна запасу ліквідності.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: USD change includes depeg revaluation; не gross issuance.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama_stablecoins; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** stablecoins · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.

## O103 · Stablecoin Supply Ratio

**Канонічне поле:** `stablecoin_supply_ratio` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `BTC_market_cap/selected_stablecoin_market_cap`

**Входи:** BTC cap;stablecoin supplies

**Гіпотеза механізму:** Співвідношення BTC value та settlement capacity.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: BTC price у чисельнику; universe stablecoins необхідний.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama_stablecoins; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** stablecoins · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.

## O104 · Gross stablecoin minting

**Канонічне поле:** `stablecoin_gross_mints` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `sum verified issuance mints excluding bridge representation duplication`

**Входи:** token mint events;classification

**Гіпотеза механізму:** Нова емісія settlement tokens.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Treasury mint може ще не бути circulating; bridges.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama_stablecoins; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** stablecoins · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.

## O105 · Gross stablecoin redemptions

**Канонічне поле:** `stablecoin_gross_burns` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `sum verified redemption burns excluding migration`

**Входи:** burn events;issuer rules

**Гіпотеза механізму:** Погашення settlement units.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Burn не обов’язково вихід із crypto; migration.

**Вердикт:** untestable — Не допускати до навчання, доки не підтверджено методологію та дозволену історію.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama_stablecoins; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** stablecoins · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.

## O106 · Stablecoin issuer concentration

**Канонічне поле:** `stablecoin_issuer_hhi` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `sum((issuer_supply/total_supply)^2)`

**Входи:** per-issuer supply

**Гіпотеза механізму:** Концентрація collateral/counterparty risk.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не direction signal, провайдерські classification.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama_stablecoins; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** stablecoins · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.

## O107 · Stablecoin market cap Ethereum

**Канонічне поле:** `stablecoin_mcap_ethereum` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `provider chain total peggedUSD`

**Входи:** chain stablecoin supplies

**Гіпотеза механізму:** Ліквідність конкретної execution ecosystem.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Міграція між chain не global inflow.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama_stablecoins; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** stablecoin_geography · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.

## O108 · Stablecoin market cap Tron

**Канонічне поле:** `stablecoin_mcap_tron` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `provider chain total peggedUSD`

**Входи:** chain stablecoin supplies

**Гіпотеза механізму:** Використання settlement у Tron.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Payment demand не обов’язково спекулятивний попит.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama_stablecoins; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** stablecoin_geography · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.

## O109 · Stablecoin market cap Solana

**Канонічне поле:** `stablecoin_mcap_solana` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `provider chain total peggedUSD`

**Входи:** chain stablecoin supplies

**Гіпотеза механізму:** Запас settlement у Solana.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Випуск/bridges та ціна токена незалежні.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama_stablecoins; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** stablecoin_geography · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.

## O110 · Stablecoin market cap Arbitrum

**Канонічне поле:** `stablecoin_mcap_arbitrum` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `provider chain total peggedUSD`

**Входи:** chain stablecoin supplies

**Гіпотеза механізму:** Ліквідність конкретного L2.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Bridged та native issuance не дублювати.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama_stablecoins; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** stablecoin_geography · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.

## O111 · Stablecoin market cap Base

**Канонічне поле:** `stablecoin_mcap_base` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `provider chain total peggedUSD`

**Входи:** chain stablecoin supplies

**Гіпотеза механізму:** Ліквідність конкретного L2.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Немає автоматичного токена чи ціни Base для target.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama_stablecoins; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** stablecoin_geography · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.

## O112 · Stablecoin market cap BSC

**Канонічне поле:** `stablecoin_mcap_bsc` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** ринок/макро

**Формула:** `provider chain total peggedUSD`

**Входи:** chain stablecoin supplies

**Гіпотеза механізму:** Ліквідність BSC ecosystem.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Однакова валюта може мігрувати без нового капіталу.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** defillama_stablecoins; cost=free; lag=1. Free entitlement не підтверджено.

**Сімейство:** stablecoin_geography · **Перевірка визначення:** research_candidate

**Джерела:** [DeFi Data Definitions & Metrics Glossary](https://defillama.com/data-definitions) — TVL, inflows, fees/revenue, DEX volumes, stablecoins, active loans. Опис не доводить безкоштовний повний API для кожного поля.
