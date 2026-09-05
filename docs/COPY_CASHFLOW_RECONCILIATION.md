# Nazara v7 cash-flow reconciliation — internal synthetic review

Snapshot computed on 2026-09-05 from `reviewReconciliationReport(createReviewSyntheticState(new Date('2026-09-05T12:00:00Z')))`. The simulation accounts for complete UTC days, so the snapshot's effective end is **2026-09-05T23:59:59.999Z**. Inception is **2025-08-21**, with the first trading day on 2025-08-22: 380 calendar-day results and 381 performance-index observations.

This is an engineering reconciliation of an explicitly authored **synthetic review scenario**, not independently verified trading history, real client balances, investment results, or proof of exchange execution. The unusually high requested performance is a scenario constraint. The internal account amounts below must not be published in the public performance DTO, rendered as a user's Wallet balance, or confused with follower AUM. This document is not a deployment confirmation.

## 1. Canonical sources and isolation

The v7 source of truth is the following set of linked ledgers, not a collection of separately assigned UI statistics:

- `src/services/copyTrading/reviewEconomicsConfig.ts`: explicit review assumptions and bootstrap constraints.
- `reviewMasterLedger.ts`: priced master executions, daily operating capital, owner cash flows and the unitized performance index.
- `reviewFollowerLedger.ts`: dated allocations, actual synthetic copied executions, execution costs and performance-fee events.
- `reviewEconomics.ts`: rolling/ALL slices, public metrics, risk calculations and the private-to-public projection.
- `reviewReconciliationReport.ts`: internal engineering report used for the numbers below; it is not imported into the public UI/DTO.
- `reviewSyntheticHistory.ts`: explicitly selected review bootstrap, pinned to 2026-09-05 under `nazara-review-v7`.

The v1–v6 accounting algorithms, existing persisted histories and their continuation are retained. Shared engine/analytics entry points dispatch **only an explicitly version-7 state** to the new accounting. The legacy static-capital configuration remains a compatibility source, not a competing v7 source. There is no silent conversion, rescaling or reset of a production synthetic state.

No real account, Wallet ledger, database, matching engine, live copy-execution service, production workflow, main branch or production Render setting is part of this scenario change. No database migration is required. New v7 histories are for isolated review; adopting them elsewhere would require a separately authorized promotion and explicit state-policy decision.

## 2. Master cash-flow-neutral performance

For calendar day `d`:

```text
capitalAtRisk[d] = openingAccountEquity[d] + beforeTradingDeposits[d]
tradingPnl[d]    = sum(masterTrade.netPnl closed on d)
dailyReturn[d]   = tradingPnl[d] / capitalAtRisk[d]
closingAccountEquity[d]
  = openingAccountEquity[d] + deposits[d] + tradingPnl[d] - withdrawals[d]

performanceIndex[0] = 100
performanceIndex[d] = performanceIndex[d - 1] × (1 + dailyReturn[d])
periodROI = (product(1 + dailyReturn[d] within the period) - 1) × 100
```

Owner withdrawals are not losses; deposits are not trading profits. All available operating account capital, including cash not assigned to an individual position, stays in the daily denominator. This is not a return-on-selected-margin denominator that hides idle cash.

The conceptual reference for neutralizing external cash flows and geometrically linking subperiod returns is the [GIPS Standards Handbook for Firms, discussion of Provision 2.A.24](https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/). This synthetic implementation does **not** claim GIPS compliance or verified performance.

`equityHistory` in the v7 public response is a **unitized TWR performance index**, not an account balance. Legacy-named public `dailyResults.startEquity/endEquity` are projected to corresponding index levels. Private master account/cash-flow ledgers remain outside that response. Money PnL charts use the accumulated master trading-PnL ledger, not the index or net withdrawals.

### Nested, consecutive factors

All windows use the same dates, trades and daily returns. Closed-trade/fee windows include dates strictly after the cutoff through the current simulation date; the performance-index slice also includes its opening cutoff observation.

| Consecutive segment | Included calendar dates | Required factor | Segment return |
| --- | --- | ---: | ---: |
| Before the latest 90D | 2025-08-22–2026-06-07 | 38.27 / 9.41 = 4.0669500531 | +306.69500531% |
| Days 31–90 | 2026-06-08–2026-08-06 | 9.41 / 3.71 = 2.5363881402 | +153.63881402% |
| Days 8–30 | 2026-08-07–2026-08-29 | 3.71 / 2.12 = 1.75 | +75.0% |
| Latest 7D | 2026-08-30–2026-09-05 | 2.12 | +112.0% |

Multiplication reconstructs the 2.12x, 3.71x, 9.41x and 38.27x requested factors. They are not added and are not separately drawn chart paths. The actual emitted ALL factor is `38.27000000090499`; four-decimal money quantization produces only sub-display-precision differences from the bootstrap constraints.

### Internal operating-capital solution — not public account data

The operating account is solved from the generated daily returns and an explicit withdrawal policy, **not** from `4,711,027 / 37.27`.

First run the cash-flow rule with an operating base of one unit:

```text
normalizedAccount[0] = 1
normalizedPnl[d] = normalizedAccount[d - 1] × dailyReturn[d]
normalizedAccount[d] = min(1, normalizedAccount[d - 1] + normalizedPnl[d])
operatingBase = 4,711,027 / sum(normalizedPnl[d])
```

Losses lower the account until subsequent profits recover them; they do not trigger automatic top-ups. After an active trading session, any account value above the solved operating base is withdrawn. The bootstrap contains one inception deposit, no later deposits and 321 explicit after-trading withdrawal events. Holiday days have no owner cash flows.

| Private engineering field | Computed USDT |
| --- | ---: |
| Initial deposit / solved operating base | 1,265,627.9282 |
| Minimum daily capital at risk | 1,254,508.1149 |
| Maximum daily capital at risk | 1,265,627.9282 |
| Final operating account | 1,265,627.9282 |
| Total owner deposits | 1,265,627.9282 |
| Total trading PnL | 4,711,027.0000 |
| Total owner withdrawals | 4,711,027.0000 |

The final identity is `1,265,627.9282 = 1,265,627.9282 + 4,711,027.0000 - 4,711,027.0000`. Ending account balance alone therefore does not measure the strategy's TWR or lifetime trading PnL.

Master monetary execution fields use 0.0001-USDT precision. Quantization differences are distributed over eligible planned sessions/trades in minimal monetary units; no final-day or final-trade financial balancing spike is introduced. Execution prices are solved and remeasured so `gross - fees - funding = net` at the stored precision; net PnL is not changed independently of the emitted prices and quantities.

## 3. Computed bootstrap economics

Amounts are USDT. Trading-volume fields count **entry notional once** (`entryPrice × quantity`); fees may depend on both entry and exit. Tables retain four decimals for money reconciliation and two decimals for reported turnover. Display rounding is not an additional data source.

| Period | Included dates | ROI | Master net trading PnL | Master trades | Active / calendar days | Trade win rate |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 7D | 2026-08-30–2026-09-05 | +112.0% | 1,021,705.3073 | 62 | 7 / 7 | 93.5484% |
| 30D | 2026-08-07–2026-09-05 | +271.0% | 1,740,067.6364 | 240 | 30 / 30 | 96.6667% |
| 90D | 2026-06-08–2026-09-05 | +841.0% | 2,929,207.2977 | 750 | 90 / 90 | 97.2% |
| ALL | 2025-08-22–2026-09-05 | +3727.0% | 4,711,027.0000 | 3,250 | 358 / 380 | 97.2% |

The prior 290 days contribute 1,781,819.7023 USDT before the latest 90-day window. ALL contains 3,159 winning and 91 losing trades; the latest 90D contains 729 winning and 21 losing trades. Short-window win rates are their actual counts, not a fixed 97.2% label. A winning-trade percentage is not a winning-day percentage.

| Period | Master trading volume | Copied trading volume | Average deployed capital, internal | Master volume / average deployed capital |
| --- | ---: | ---: | ---: | ---: |
| 7D | 172,352,589.36 | 890,237,391.79 | 1,264,955.2453 | 136.2519x |
| 30D | 674,817,243.25 | 3,099,919,461.32 | 1,265,262.4864 | 533.3417x |
| 90D | 2,059,152,031.30 | 7,569,862,660.35 | 1,265,292.0817 | 1,627.4124x |
| ALL | 9,108,030,452.90 | 13,726,339,164.44 | 1,265,122.6575 | 7,199.3260x |

Average deployed capital is the arithmetic mean of the selected calendar-day capital-at-risk entries, including inactive days. These turnover ratios are period totals, not daily ratios or leverage. None of the trading-volume columns is the 7.2m follower AUM.

| Period | Gross follower PnL after execution costs | Nazara performance-fee earnings | Net follower PnL |
| --- | ---: | ---: | ---: |
| 7D | 5,152,138.7089 | 515,213.8719 | 4,636,924.8370 |
| 30D | 7,996,660.0613 | 799,666.0129 | 7,196,994.0484 |
| 90D | 11,285,520.2298 | 1,127,658.1787 | 10,157,862.0511 |
| ALL | 12,004,433.9777 | 1,200,443.4346 | 10,803,990.5431 |

The bootstrap contains **78,687 copied trades**, **7,053 performance-fee events** and **64 allocation events**. Current allocated AUM is 7,200,000.0000; aggregate follower equity is `7,200,000.0000 + 10,803,990.5431 = 18,003,990.5431`. Profits retained in follower equity do not become additional allocated AUM automatically.

## 4. Priced positions, turnover and cost assumptions

Master positions are generated from reference prices for BTC, ETH, SOL, XRP and BNB; these are deterministic synthetic executions, not sampled market fills or a real-market backtest. Each trade stores direction, entry/exit prices, quantity, leverage, opening/closing timestamps, holding duration, gross PnL, trading fees, funding and net PnL.

- Leverage is 2x–8x. Counts by leverage are 2x: 472; 3x: 465; 4x: 459; 5x: 497; 6x: 466; 7x: 423; 8x: 468. No 50x/100x workaround is used.
- Intended initial margin is 18%–72% of daily capital at risk. Actual rounded notional/margin is remeasured from emitted prices and quantity.
- Positions are sequential and close on the same UTC day. This prevents overlapping positions from reusing unclosed profit or the same available margin. The follower module rejects overlapping positions rather than pretending to support portfolio margin.
- Bootstrap holding periods are 24–274 minutes, averaging 91.6612 minutes. Actual master entry notionals range approximately from 456,444.01 to 7,282,230.76 USDT.
- Master trading costs are 2 bps on each entry/exit leg: `(entryPrice + exitPrice) × quantity × 0.0002`. Funding is `entryNotional × 0.00005 × holdingMinutes / 480`; this is an explicit synthetic eight-hour funding assumption, not a live rate.
- ALL master gross price PnL is 8,440,459.1385, less trading fees of 3,643,180.4168 and funding of 86,251.7217, giving net trading PnL of 4,711,027.0000.

High turnover and short holding times are visible consequences of this aggressive scenario. They are not evidence that equivalent real executions would be available at these prices, size, liquidity or funding costs.

### Copied-position sizing and execution

At each eligible master entry:

```text
followerAccountEquity = currentAllocation + cumulativeCopiedGrossPnl - crystallizedFees
availableCopyCapital = min(currentAllocation, followerAccountEquity)
copyScale = availableCopyCapital / masterDay.capitalAtRisk × follower.copyRatio
copiedQuantity = masterQuantity × copyScale
copiedEntryNotional = masterEntryPrice × copiedQuantity
```

Profits do not automatically compound allocated exposure; losses reduce the capital available to fund the next position. Prior closed intraday results and prior crystallized fees are included. Copied margin (`copiedEntryNotional / masterLeverage`) must not exceed available follower equity. Nonpositive equity fails closed rather than silently skipping the return calculation or manufacturing a recovery from an insolvent account.

Copy ratios vary deterministically from 0.89–1.00. Liquid-market execution assumptions vary by follower: adverse slippage 0.15–0.75 bps and latency 40–350 ms. Latency contributes one additional basis point per second, charged proportionally rather than as a percent of profit:

```text
roundTripNotional = copiedQuantity × (masterEntryPrice + masterExitPrice)
executionCost = round4(roundTripNotional × (slippageBps + latencyMs / 1000) / 10000)
copiedGrossBeforeCosts = round4(masterGrossPnl × copyScale)
copiedTradingFees = round4(masterTradingFees × copyScale)
copiedFunding = round4(masterFunding × copyScale)
copiedGrossPnl = copiedGrossBeforeCosts - copiedTradingFees - copiedFunding - executionCost
```

The latency/slippage ranges are documented liquidity assumptions, not a guarantee of real fills or a calibration to a follower-profit target. The initial wider additional-cost assumptions were rejected during independent testing because they exhausted certain follower accounts under high turnover. The implemented model both states the revised assumptions and enforces available-equity risk limits; it does not conceal insolvency with a clamped ROI.

ALL copied execution drag is 1,780,685.1347, copied trading fees are 5,490,322.8218 and copied funding is 136,939.1869 USDT. These costs arise from the actual sized copied positions; no aggregate follower-profit target or AUM-based earnings shortcut is applied.

## 5. Daily high-water-mark performance fees

Nazara's review performance-fee rate is **10%**, not 20%, not 10% of AUM and not an annual management charge. Other marketplace traders do not inherit this rate.

Crystallization policy: `DAILY_GROSS_PNL_HIGH_WATER_MARK`. After all closed trades for each UTC day, use lifetime cumulative copied PnL **after execution/trading/funding costs but before performance fees**:

```text
eligibleProfit = max(0, cumulativeGrossPnl - priorCrystallizedGrossPnlHWM)
feeAmount = round4(eligibleProfit × 0.10)
newHWM = max(priorHWM, cumulativeGrossPnl)
netFollowerPnl = cumulativeGrossPnl - sum(feeAmount)
currentFollowerEquity = currentAllocatedCapital + netFollowerPnl
```

Each fee event records a deterministic ID, follower, date, eligible profit, rate, fee amount and HWM before/after. Losses, recovery to an old maximum, and new contributions do not produce a new eligible profit or reset the mark. A day with a winning trade can still have no fee if other trades leave the day below the old HWM.

The loss-recovery/new-high concept is informed by [ESMA's performance-fee guidance, Annex IV definitions and Guideline 4](https://www.esma.europa.eu/sites/default/files/library/esma_34-39-968_final_report_guidelines_on_performance_fees.pdf). The chosen gross-PnL ledger and daily review crystallization are scenario assumptions, **not** a claim of UCITS/AIF compliance, regulatory approval or applicability to a real VOLTEX product.

The exact recovery fixture has gross daily PnL `+100, -60, +40, +20, +15`: fees are `10, 0, 0, 0, 1.5`, not a second charge on recovered profit. Fees in 7D/30D/90D/ALL are sums of events crystallized inside that window. They are not blindly 10% of that window's gross PnL because the lifetime HWM crosses window boundaries. Each event is rounded at four decimals; summing thousands of rounded events can differ slightly from rounding one aggregate multiplication.

Follower ROI respects the actual join date and uses net daily trading profit after crystallized fees. Allocation cash flows occur at UTC day start; the denominator is that day's allocation plus prior net accumulated trading profit. With the authored unchanged allocations this telescopes to lifetime net follower PnL divided by starting allocation. No follower is assigned the master's pre-join ROI.

## 6. Explicit cohort and AUM ledger

All identifiers below are `review-follower-` plus the listed suffix; display names are masked synthetic review aliases, not real account identities. Every row is one JOIN event. There is no random vector rescaled to 7.2m, and the last 132,500 allocation is not a balancing residual.

The explicit minimum-policy effective date is **2026-03-01**. New joins from that date require at least 20,000 USDT. Eight earlier sub-20k accounts are grandfathered; they are not forced to top up. This policy history is an authored review assumption, not an independently verified historical VOLTEX rule.

| Allocation band | Followers | Actual allocated total, USDT |
| --- | ---: | ---: |
| Grandfathered below 20k | 8 | 94,000 |
| Standard, 20k–75k | 20 | 1,006,000 |
| Medium, 75k–150k | 20 | 2,200,000 |
| Large, 150k–300k | 12 | 2,320,000 |
| Larger, 300k–500k | 4 | 1,580,000 |
| **Total** | **64** | **7,200,000** |

| ID suffix | Join date, UTC | Starting/current allocation, USDT |
| --- | --- | ---: |
| 001 | 2025-08-21 | 5,000 |
| 002 | 2025-08-21 | 7,000 |
| 003 | 2025-08-30 | 8,500 |
| 004 | 2025-09-06 | 28,750 |
| 005 | 2025-09-18 | 10,000 |
| 006 | 2025-09-29 | 76,800 |
| 007 | 2025-10-06 | 12,000 |
| 008 | 2025-10-17 | 71,850 |
| 009 | 2025-10-29 | 151,750 |
| 010 | 2025-11-02 | 15,000 |
| 011 | 2025-11-13 | 32,750 |
| 012 | 2025-11-20 | 143,200 |
| 013 | 2025-11-26 | 17,500 |
| 014 | 2025-12-05 | 67,850 |
| 015 | 2025-12-17 | 82,500 |
| 016 | 2025-12-22 | 238,250 |
| 017 | 2026-01-07 | 35,400 |
| 018 | 2026-01-19 | 19,000 |
| 019 | 2026-01-24 | 137,500 |
| 020 | 2026-02-03 | 65,200 |
| 021 | 2026-02-09 | 163,500 |
| 022 | 2026-02-24 | 89,125 |
| 023 | 2026-03-02 | 38,900 |
| 024 | 2026-03-12 | 326,500 |
| 025 | 2026-03-25 | 61,700 |
| 026 | 2026-04-06 | 130,875 |
| 027 | 2026-04-13 | 226,500 |
| 028 | 2026-04-19 | 41,650 |
| 029 | 2026-04-24 | 92,500 |
| 030 | 2026-05-01 | 58,950 |
| 031 | 2026-05-07 | 179,250 |
| 032 | 2026-05-10 | 127,500 |
| 033 | 2026-05-16 | 44,750 |
| 034 | 2026-05-24 | 96,800 |
| 035 | 2026-05-27 | 210,750 |
| 036 | 2026-05-31 | 373,500 |
| 037 | 2026-06-06 | 55,850 |
| 038 | 2026-06-10 | 123,200 |
| 039 | 2026-06-18 | 187,000 |
| 040 | 2026-06-22 | 101,750 |
| 041 | 2026-06-25 | 47,900 |
| 042 | 2026-06-30 | 118,250 |
| 043 | 2026-07-04 | 198,000 |
| 044 | 2026-07-07 | 52,700 |
| 045 | 2026-07-13 | 104,600 |
| 046 | 2026-07-17 | 194,600 |
| 047 | 2026-07-21 | 49,125 |
| 048 | 2026-07-25 | 115,400 |
| 049 | 2026-07-28 | 418,750 |
| 050 | 2026-08-01 | 51,475 |
| 051 | 2026-08-06 | 107,250 |
| 052 | 2026-08-10 | 190,400 |
| 053 | 2026-08-13 | 26,750 |
| 054 | 2026-08-16 | 112,750 |
| 055 | 2026-08-19 | 174,250 |
| 056 | 2026-08-21 | 73,850 |
| 057 | 2026-08-24 | 79,500 |
| 058 | 2026-08-26 | 461,250 |
| 059 | 2026-08-28 | 37,250 |
| 060 | 2026-08-30 | 140,500 |
| 061 | 2026-09-01 | 205,750 |
| 062 | 2026-09-03 | 87,500 |
| 063 | 2026-09-04 | 63,350 |
| 064 | 2026-09-05 | 132,500 |

The inception snapshot has two active founders and 12,000 USDT AUM. The latest snapshot has 64 active followers and exactly 7,200,000 USDT. Joins are irregular and five followers join during the last seven calendar days. A follower can allocate during the master's holiday leave, but cannot receive nonexistent trades or PnL from that pause.

Current allocations equal starting allocations in this bootstrap; no invisible increases are fabricated. The ledger supports explicit JOIN/INCREASE/DECREASE/STOP events with old allocation, delta and new allocation. Replay validates the arithmetic and dates. Events must occur at **UTC day start**, with at most one event per follower per day; unsupported intraday changes are rejected because they would require additional valuation checkpoints. AUM history and active counts are rebuilt from those events only. Follower profits and performance fees are not deposits.

## 7. Holidays, concentration and chart interpretation

The year-end break is **2025-12-18–2026-01-05 inclusive: 19 days**. The selected Easter break is **2026-04-10–2026-04-12 inclusive: 3 days**. Both are synthetic trader inactivity, not exchange or crypto-market closure.

The three-day Easter assumption is anchored to Orthodox Pascha on 2026-04-12, as listed in the [Orthodox Church in America calendar](https://www.oca.org/saints/lives/2026/04/12/27-holy-pascha-the-resurrection-of-our-lord). It does not assert the trader's religion or actual holiday behavior.

On all 22 dates there are zero master/copy trades, zero trading PnL, zero generated wins/losses and no owner deposits/withdrawals. Daily returns are zero and therefore contribute a factor of exactly one. Cumulative trading PnL and the performance index remain flat. Bootstrap totals are 358 active days, 22 zero-trade days and 25 net negative days. Calendar observations are retained rather than removing leave to improve risk statistics.

The requested latest-7D +112% factor, together with the selected stable operating-capital policy, necessarily requires a strong latest-week contribution in this model. It cannot simultaneously be represented as an evenly distributed lifetime dollar-profit line while retaining these constraints:

- Latest seven days: **1,021,705.3073 USDT, 21.68752816% of ALL PnL**.
- Largest day: **265,258.5317 USDT on 2026-09-03, 5.63058823% of ALL**.
- Final day: **130,480.4558 USDT, 2.76968177% of ALL**, not the largest day.

This is a consequence of the approved nested factors and the actual chosen capital/return path, not a final-day residual or frontend smoothing. It must not be described as flat or uniformly distributed profit. Signed daily variation, quieter regimes and genuine leave remain visible. The ROI/TWR path compounds daily percentage returns; the money-PnL path accumulates money earned on an account that regularly withdraws profits. Their shapes are different for a valid accounting reason.

## 8. Risk calculations and limitations

Risk uses cash-flow-neutral **calendar-day** returns, including the 22 zero-return days. Risk-free/target return is zero. Standard deviation uses sample variance (`n - 1`); annualization uses 365 days. Sortino downside deviation is the square root of the mean squared negative returns across all calendar observations. Drawdown is peak-to-trough decline of the selected TWR index, not of the owner's post-withdrawal account balance. Profit Factor is positive net master-trade PnL divided by absolute negative net master-trade PnL.

| Period | Sharpe | Sortino | Annualized volatility | Max drawdown | Profit Factor |
| --- | ---: | ---: | ---: | ---: | ---: |
| 7D | 30.1650 | 1,567.6744 | 139.6216% | 0.3721% | 65.2067 |
| 30D | 16.8050 | 775.6136 | 99.5831% | 0.4942% | 54.4903 |
| 90D | 14.5997 | 444.9868 | 64.3172% | 0.6433% | 34.4047 |
| ALL | 9.9049 | 133.6292 | 36.1133% | 0.8786% | 12.9999 |

These very high ratios are reported as calculated, not capped to look conventional. Tiny modeled downside alongside very high constrained returns can make Sortino especially large; this is an important limitation, not evidence of low real investment risk. Undefined ratios are nullable in the authoritative `economics.periods` projection and must be shown as unavailable rather than invented or capped. The older numeric DTO compatibility fields are not authoritative substitutes for those nullables.

The scenario does not model a live order book, venue liquidity, partial fills, liquidation engines, variable real funding rates, taxes, real subscribers or actual copy execution. It is a deterministic accounting/presentation test environment. Passing mathematical reconciliation does not validate the realism, attainability or safety of its requested investment returns.

## 9. Continuation and validation evidence

The 2026-09-05 baseline and inception are pinned. Later simulation dates append new complete UTC-day ledgers using serialized RNG state; they do **not** shift inception, recalibrate old days to the target ROIs, or keep the four headline targets fixed forever. Future genuine generated losses may reduce cumulative PnL or performance. ALL retains the complete history; 7D/30D/90D move their cutoffs over that same history.

The 64 cohorts remain fixed during advancement. New followers or capital changes require explicit allocation-ledger events; no automatic monthly cohort growth or forced return to 7.2m is applied. Existing trade/fee IDs and records are retained during replay; an attempted historical rewrite is rejected. The fixture supports complete-day advancement, not live intraday account processing.

Executed focused command:

```text
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/services/copyTrading/__tests__/ReviewFollowerLedger.test.ts
```

**Result: 17/17 tests passed, one suite, 33.7 seconds.** Coverage includes independent daily HWM recovery; no pre-join execution; copy costs and actual notional; funding credits; loss-limited entry sizing; contribution/withdrawal AUM reconstruction; policy boundary; rejection of invalid/intraday/overlapping/insolvent scenarios; immutable replay; all 64 follower profits, fees, equity, ROI and margin; every historical AUM snapshot; and actual **+90-day** append preserving all old copied-trade, fee and AUM prefixes and the same 64 cohorts.

The report generator was also executed against the completed model to obtain every bootstrap table above.

### Integrated validation, 2026-09-05

- Backend TypeScript (`node node_modules/typescript/bin/tsc --noEmit`) passed. Frontend TypeScript passed independently and in both build workflows.
- Full Copy Trading services plus the six relevant frontend suites: **16 suites / 117 tests passed**. After the final UTC/price-format regression test was added, all six affected frontend/legacy presentation suites passed again (**37 tests**); **118 distinct tests** are covered across these runs. No existing assertion was weakened. A legacy floating-point regression was fixed by preserving its original monetary-equity arithmetic, while v7 uses daily trading PnL.
- Time advancement tests execute +1, +7, +30, +90 and +400 days. Independent reconciliation additionally checks rolling 7/30/90-day counts, increasing ALL history, preserved master/copy/fee records, complete AUM history and no bootstrap recalibration.
- Final local production frontend build passed, 5,640 modules; isolated review build passed, 5,604 modules. Existing large-chunk advisory remains; no build threshold/check was disabled.
- Browser-tested the real built `/copy-trading` on `http://127.0.0.1:4178`: all four headline periods, actual cumulative PnL versus TWR, holiday zero-day SVG titles, separate master/copied turnover, gross/net follower PnL and earned fees, 64 expanded follower rows, real join dates, AUM/count history and the priced-trade table. Trade times in v7 are explicitly UTC, matching period boundaries; small-price executions retain meaningful precision.
- Profile and trade-table document widths checked at **1920, 1440, 1366, 1024, 768, 430, 390 and 375 px**: no page-level horizontal overflow. Narrow trade/daily-history areas retain their existing internal scrolling. Desktop/mobile screenshots inspected; no console errors/warnings were recorded. No layout/typography redesign; the pre-existing approved light eligibility outline is preserved.

The existing frontend-only Render review serves a build-time synthetic snapshot, not a running accounting backend or a durable subscriber database. The engine and later review builds append elapsed simulation days deterministically; a deployed snapshot itself does not autonomously generate trades between builds. Real-time production execution, persistence and customer operations are deliberately outside this task. Staging delivery is verified separately against the pushed commit and live review manifest; this document does not claim a production deployment.

### Daily Return histogram follow-up, 2026-09-05

The former USDT Daily PnL histogram is now **Дневная доходность / Daily Return**. Each original calendar day is plotted at `dailyReturn * 100`, using the same canonical daily return as TWR, Sharpe, Sortino and drawdown. In v7 this is net trading PnL divided by actual private day-start capital at risk; after-trading owner withdrawals and follower cash flows are excluded. Public `startEquity` is a normalized TWR index, not money, and must never be used as the denominator of dollar PnL. Legacy histories also retain their canonical `dailyReturn`.

- The y axis is linear in percent about a visible zero baseline; positive/negative bars remain green/red. No normalization, smoothing, clipping, logarithms, aggregation or history redistribution. Axis text too close to zero is omitted solely to prevent overlapping labels; its grid line, axis range and all bar geometry remain unchanged.
- `ROI за период` geometrically links every daily factor; `Средняя доходность / день` is the arithmetic mean over all visible calendar days, including zero-return leave days. Dollar PnL appears only as secondary tooltip information.
- Bootstrap 7D/30D/90D/ALL readouts are +112%/+271%/+841%/+3727%; daily arithmetic means are 11.538857%/4.584910%/2.572636%/0.979994%. ALL retains 380 bars, including 25 negative and 22 zero-return dates.
- The underlying synthetic JSON is byte-identical to the previous version (SHA-256 `f639078f9a8dda82a37c311eb0d9fd1d01bbffd78bfb234c04b4d63f008c6b03`). The approved +112% recent-7D target still implies a strong recent cluster; the percentage conversion does not conceal it or establish organic/real-world performance. No profit, historical return or financial metric was adjusted.
- Follow-up validation: frontend/backend TypeScript passed; 4 relevant suites / 35 tests passed, including independent trade-PnL/private-capital reconstruction for all periods, +90-day preservation, money-independent linear geometry, holidays and legacy compatibility. Production and review builds passed with the existing chunk-size advisory. Browser period/readout checks and 8 responsive widths passed with no runtime errors or page-level overflow.
