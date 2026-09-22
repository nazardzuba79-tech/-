# ethereum_pos

Картки кандидатів. Жодної ринкової перевірки у цьому пакеті не виконано. Формули — операційні описи, не перевірені функції бібліотеки.

## O086 · ETH staking share

**Канонічне поле:** `eth_staking_share` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** eth

**Формула:** `active_staked_balance/eligible_ETH_supply`

**Входи:** beacon active balances;ETH supply

**Гіпотеза механізму:** Частка supply у security commitment.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Deposit-contract balance не active stake; LST лишає ліквідність.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** public beacon/execution node or verified community series; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** ethereum_pos · **Перевірка визначення:** research_candidate

**Джерела:** [Ethereum staking](https://ethereum.org/staking/) — Протокольний зміст staking/validators. Поточні числові віджети не збирались.; [EIP-1559 — Fee market change](https://eips.ethereum.org/EIPS/eip-1559) — Base fee burn і priority fee; протокольна специфікація, не прогноз ціни.; [EIP-4844 — Shard Blob Transactions](https://eips.ethereum.org/EIPS/eip-4844) — Окремий blob fee market; не емпірична перевірка індикатора.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O087 · Active validator count

**Канонічне поле:** `eth_active_validators` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** eth

**Формула:** `count validators in active status at snapshot`

**Входи:** beacon validator registry

**Гіпотеза механізму:** Масштаб участі у consensus.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не прирівнювати validators до людей/операторів або fixed balances.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** public beacon/execution node or verified community series; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** ethereum_pos · **Перевірка визначення:** research_candidate

**Джерела:** [Ethereum staking](https://ethereum.org/staking/) — Протокольний зміст staking/validators. Поточні числові віджети не збирались.; [EIP-1559 — Fee market change](https://eips.ethereum.org/EIPS/eip-1559) — Base fee burn і priority fee; протокольна специфікація, не прогноз ціни.; [EIP-4844 — Shard Blob Transactions](https://eips.ethereum.org/EIPS/eip-4844) — Окремий blob fee market; не емпірична перевірка індикатора.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O088 · Validator activations

**Канонічне поле:** `eth_validator_activations` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** eth

**Формула:** `count newly activated validators in UTC day`

**Входи:** beacon activation epochs

**Гіпотеза механізму:** Зміна security participation.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Попередні deposits і activation-time різні дати.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** public beacon/execution node or verified community series; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** ethereum_pos · **Перевірка визначення:** research_candidate

**Джерела:** [Ethereum staking](https://ethereum.org/staking/) — Протокольний зміст staking/validators. Поточні числові віджети не збирались.; [EIP-1559 — Fee market change](https://eips.ethereum.org/EIPS/eip-1559) — Base fee burn і priority fee; протокольна специфікація, не прогноз ціни.; [EIP-4844 — Shard Blob Transactions](https://eips.ethereum.org/EIPS/eip-4844) — Окремий blob fee market; не емпірична перевірка індикатора.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O089 · Validator exits

**Канонічне поле:** `eth_validator_exits` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** eth

**Формула:** `count effective exits in day`

**Входи:** beacon exit epochs

**Гіпотеза механізму:** Гіпотеза зняття stake commitment.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Exit не instant withdrawal і не sell.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** public beacon/execution node or verified community series; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** ethereum_pos · **Перевірка визначення:** research_candidate

**Джерела:** [Ethereum staking](https://ethereum.org/staking/) — Протокольний зміст staking/validators. Поточні числові віджети не збирались.; [EIP-1559 — Fee market change](https://eips.ethereum.org/EIPS/eip-1559) — Base fee burn і priority fee; протокольна специфікація, не прогноз ціни.; [EIP-4844 — Shard Blob Transactions](https://eips.ethereum.org/EIPS/eip-4844) — Окремий blob fee market; не емпірична перевірка індикатора.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O090 · Activation queue balance

**Канонічне поле:** `eth_activation_queue` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** eth

**Формула:** `pending eligible activation ETH at snapshot`

**Входи:** beacon pending registry

**Гіпотеза механізму:** Очікуваний staking demand.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Черга змінюється churn rules та protocol upgrades.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** public beacon/execution node or verified community series; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** ethereum_pos · **Перевірка визначення:** research_candidate

**Джерела:** [Ethereum staking](https://ethereum.org/staking/) — Протокольний зміст staking/validators. Поточні числові віджети не збирались.; [EIP-1559 — Fee market change](https://eips.ethereum.org/EIPS/eip-1559) — Base fee burn і priority fee; протокольна специфікація, не прогноз ціни.; [EIP-4844 — Shard Blob Transactions](https://eips.ethereum.org/EIPS/eip-4844) — Окремий blob fee market; не емпірична перевірка індикатора.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O091 · Exit queue balance

**Канонічне поле:** `eth_exit_queue` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** eth

**Формула:** `ETH scheduled to exit but not effective yet`

**Входи:** beacon exit queue

**Гіпотеза механізму:** Майбутня потенційна ліквідність.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Розмір черги не ринковий ордер продажу.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** public beacon/execution node or verified community series; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** ethereum_pos · **Перевірка визначення:** research_candidate

**Джерела:** [Ethereum staking](https://ethereum.org/staking/) — Протокольний зміст staking/validators. Поточні числові віджети не збирались.; [EIP-1559 — Fee market change](https://eips.ethereum.org/EIPS/eip-1559) — Base fee burn і priority fee; протокольна специфікація, не прогноз ціни.; [EIP-4844 — Shard Blob Transactions](https://eips.ethereum.org/EIPS/eip-4844) — Окремий blob fee market; не емпірична перевірка індикатора.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O092 · Slashing events

**Канонічне поле:** `eth_slashings` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** eth

**Формула:** `count confirmed slashings in UTC day`

**Входи:** beacon penalties

**Гіпотеза механізму:** Operational risk до security.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Рідкі події; історія не достатня для direction classifier.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** public beacon/execution node or verified community series; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** ethereum_pos · **Перевірка визначення:** research_candidate

**Джерела:** [Ethereum staking](https://ethereum.org/staking/) — Протокольний зміст staking/validators. Поточні числові віджети не збирались.; [EIP-1559 — Fee market change](https://eips.ethereum.org/EIPS/eip-1559) — Base fee burn і priority fee; протокольна специфікація, не прогноз ціни.; [EIP-4844 — Shard Blob Transactions](https://eips.ethereum.org/EIPS/eip-4844) — Окремий blob fee market; не емпірична перевірка індикатора.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O093 · Attestation participation

**Канонічне поле:** `eth_attestation_participation` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** eth

**Формула:** `attesting effective balance/eligible effective balance`

**Входи:** beacon attestations

**Гіпотеза механізму:** Якість роботи consensus.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не ціна; stale/finality data risk.

**Вердикт:** weak — Нижчий дослідницький пріоритет через дублювання, нестійкість або слабкий механізм.

**Історія:** НЕ ЗІБРАНА. **Шлях:** public beacon/execution node or verified community series; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** ethereum_pos · **Перевірка визначення:** research_candidate

**Джерела:** [Ethereum staking](https://ethereum.org/staking/) — Протокольний зміст staking/validators. Поточні числові віджети не збирались.; [EIP-1559 — Fee market change](https://eips.ethereum.org/EIPS/eip-1559) — Base fee burn і priority fee; протокольна специфікація, не прогноз ціни.; [EIP-4844 — Shard Blob Transactions](https://eips.ethereum.org/EIPS/eip-4844) — Окремий blob fee market; не емпірична перевірка індикатора.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O094 · ETH burned

**Канонічне поле:** `eth_burned` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** eth

**Формула:** `sum(execution base_fee*gas_used)+specified blob burn`

**Входи:** execution receipts;blob fees

**Гіпотеза механізму:** Протокольне зменшення supply.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Окремо врахувати blobs і upgrade dates; burn не автоматичний bull signal.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** public beacon/execution node or verified community series; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** ethereum_pos · **Перевірка визначення:** research_candidate

**Джерела:** [Ethereum staking](https://ethereum.org/staking/) — Протокольний зміст staking/validators. Поточні числові віджети не збирались.; [EIP-1559 — Fee market change](https://eips.ethereum.org/EIPS/eip-1559) — Base fee burn і priority fee; протокольна специфікація, не прогноз ціни.; [EIP-4844 — Shard Blob Transactions](https://eips.ethereum.org/EIPS/eip-4844) — Окремий blob fee market; не емпірична перевірка індикатора.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O095 · ETH net issuance

**Канонічне поле:** `eth_net_issuance` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** eth

**Формула:** `consensus+execution issuance minus all burns`

**Входи:** issuance;burns

**Гіпотеза механізму:** Чистий протокольний supply pressure.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Consensus/execution totals і withdrawals не плутати.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** public beacon/execution node or verified community series; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** protocol_supply · **Перевірка визначення:** research_candidate

**Джерела:** [Ethereum staking](https://ethereum.org/staking/) — Протокольний зміст staking/validators. Поточні числові віджети не збирались.; [EIP-1559 — Fee market change](https://eips.ethereum.org/EIPS/eip-1559) — Base fee burn і priority fee; протокольна специфікація, не прогноз ціни.; [EIP-4844 — Shard Blob Transactions](https://eips.ethereum.org/EIPS/eip-4844) — Окремий blob fee market; не емпірична перевірка індикатора.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O096 · ETH base fee

**Канонічне поле:** `eth_base_fee` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** eth

**Формула:** `daily statistic of baseFeePerGas in gwei`

**Входи:** execution block headers

**Гіпотеза механізму:** Blockspace congestion.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не total gas price; pricing rule змінює часові властивості.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** public beacon/execution node or verified community series; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** ethereum_pos · **Перевірка визначення:** research_candidate

**Джерела:** [Ethereum staking](https://ethereum.org/staking/) — Протокольний зміст staking/validators. Поточні числові віджети не збирались.; [EIP-1559 — Fee market change](https://eips.ethereum.org/EIPS/eip-1559) — Base fee burn і priority fee; протокольна специфікація, не прогноз ціни.; [EIP-4844 — Shard Blob Transactions](https://eips.ethereum.org/EIPS/eip-4844) — Окремий blob fee market; не емпірична перевірка індикатора.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O097 · ETH priority fees

**Канонічне поле:** `eth_priority_fees` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** eth

**Формула:** `sum(priority_fee_per_gas*gas_used)`

**Входи:** execution receipts

**Гіпотеза механізму:** Винагорода за включення транзакцій.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не враховує всі MEV transfers автоматично.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** public beacon/execution node or verified community series; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** ethereum_pos · **Перевірка визначення:** research_candidate

**Джерела:** [Ethereum staking](https://ethereum.org/staking/) — Протокольний зміст staking/validators. Поточні числові віджети не збирались.; [EIP-1559 — Fee market change](https://eips.ethereum.org/EIPS/eip-1559) — Base fee burn і priority fee; протокольна специфікація, не прогноз ціни.; [EIP-4844 — Shard Blob Transactions](https://eips.ethereum.org/EIPS/eip-4844) — Окремий blob fee market; не емпірична перевірка індикатора.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O098 · ETH gas utilization

**Канонічне поле:** `eth_gas_utilization` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** eth

**Формула:** `sum(gas_used)/sum(gas_limit) over comparable blocks`

**Входи:** execution headers

**Гіпотеза механізму:** Використання execution capacity.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Target gas не total gas limit; capacity upgrades.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** public beacon/execution node or verified community series; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** ethereum_pos · **Перевірка визначення:** research_candidate

**Джерела:** [Ethereum staking](https://ethereum.org/staking/) — Протокольний зміст staking/validators. Поточні числові віджети не збирались.; [EIP-1559 — Fee market change](https://eips.ethereum.org/EIPS/eip-1559) — Base fee burn і priority fee; протокольна специфікація, не прогноз ціни.; [EIP-4844 — Shard Blob Transactions](https://eips.ethereum.org/EIPS/eip-4844) — Окремий blob fee market; не емпірична перевірка індикатора.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O099 · Blob base fee

**Канонічне поле:** `eth_blob_base_fee` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** eth

**Формула:** `daily statistic of blob base fee`

**Входи:** blob gas state

**Гіпотеза механізму:** Попит на окремий data availability ресурс.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Не EVM execution gas; після upgrade змінюються параметри.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** public beacon/execution node or verified community series; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** ethereum_pos · **Перевірка визначення:** research_candidate

**Джерела:** [Ethereum staking](https://ethereum.org/staking/) — Протокольний зміст staking/validators. Поточні числові віджети не збирались.; [EIP-1559 — Fee market change](https://eips.ethereum.org/EIPS/eip-1559) — Base fee burn і priority fee; протокольна специфікація, не прогноз ціни.; [EIP-4844 — Shard Blob Transactions](https://eips.ethereum.org/EIPS/eip-4844) — Окремий blob fee market; не емпірична перевірка індикатора.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.

## O100 · Blob utilization

**Канонічне поле:** `eth_blob_utilization` · **Група:** onchain · **Горизонт:** regime;cycle · **Активи:** eth

**Формула:** `blob_gas_used / active_protocol_blob_target`

**Входи:** blob gas;fork config

**Гіпотеза механізму:** L2 data posting activity.

**Що підтверджено:** Це дослідницька конструкція на документованих входах, не перевірений готовий індикатор; alpha: без джерела.

**Що може зламатися:** Методологічний ризик / наша оцінка: Target залежить від fork; не кількість кінцевих користувачів.

**Вердикт:** keep_candidate — Залишити для одиночної перевірки: прозорі входи й окреме питання; не включати автоматично у композит.

**Історія:** НЕ ЗІБРАНА. **Шлях:** public beacon/execution node or verified community series; cost=freemium; lag=1. Free entitlement не підтверджено.

**Сімейство:** ethereum_pos · **Перевірка визначення:** research_candidate

**Джерела:** [Ethereum staking](https://ethereum.org/staking/) — Протокольний зміст staking/validators. Поточні числові віджети не збирались.; [EIP-1559 — Fee market change](https://eips.ethereum.org/EIPS/eip-1559) — Base fee burn і priority fee; протокольна специфікація, не прогноз ціни.; [EIP-4844 — Shard Blob Transactions](https://eips.ethereum.org/EIPS/eip-4844) — Окремий blob fee market; не емпірична перевірка індикатора.; [Coin Metrics official documentation index](https://raw.githubusercontent.com/coinmetrics/docs-website/master/SUMMARY.md) — Перелік офіційних ідентифікаторів. Детальну методологію кожного пункту і Community entitlement окремо НЕ перевірено; repository branch не зафіксовано SHA.
