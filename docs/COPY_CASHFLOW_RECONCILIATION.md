# Nazara v8 reconciliation — internal synthetic review

Computed from the final v8 code on **2026-09-06**, using `reviewReconciliationReport(createReviewSyntheticState(new Date('2026-09-05T12:00:00Z')))`. The approved bootstrap ends on **2026-09-05T23:59:59.999Z**. Inception is **2025-08-21**; there are 380 complete calendar-day results from August 22 and 381 public index observations.

This is an explicitly authored **synthetic review scenario**, not actual exchange execution, verified investment performance, customer funds or a backtest against historical market fills. The requested return anchors are scenario inputs. Mathematical reconciliation does not establish economic attainability, safety or real liquidity. Private master-capital amounts below are engineering data, not public Wallet balances. This document is not a deployment confirmation.

## 1. Sources, version boundary and the actual change from v7

- `reviewPerformanceV8Config.ts`: approved v8 scenario inputs, dates, 471 trades, 458 wins, 13 losses, simple-return anchors and weekly operating policy.
- `reviewPerformanceV8.ts`: priced master trade ledger, daily capital at risk, explicit owner cash flows, additive public index and deterministic future weeks.
- `reviewFollowerLedger.ts`: unchanged 64 allocations, copy parameters, entry-time capital checks, copied executions and daily high-water-mark fee events.
- `reviewEconomics.ts`: common period slices, version-specific return/drawdown and actual risk calculations.
- `reviewReconciliationReport.ts`: internal report used for every table below, never imported into the public DTO/UI.
- `reviewSyntheticHistory.ts` and `reviewCalendarClock.ts`: explicit `nazara-review-v8` bootstrap and same-date deterministic runtime review snapshots.

**v7 already had owner withdrawals.** It did not blindly retain all profits in the private account: its distinction was a geometrically linked public TWR index and daily surplus withdrawals. v8 changes the public performance definition to a custom cash-flow-adjusted **simple return**, uses a stable weekly operating target, and recalculates actual trades and copied economics. It is not accurate to describe v7 as lacking withdrawal accounting.

Historical v7 code and outcomes remain available through `createCashflowMasterState` and `createLegacyV7ReviewSyntheticState`; v1–v7 persisted histories are not silently converted. The previous explanation and verified v7 numbers remain in the [pre-v8 document at 7f77213](https://github.com/nazardzuba79-tech/-/blob/7f772132ad7b4b4670d302d045f94ba39ff4525b/docs/COPY_CASHFLOW_RECONCILIATION.md). The shared follower implementation only widens explicit version guards; the v7 numerical regression remains exact.

The implementation is isolated review accounting. It does not edit real balances, Auth, Wallet, exchange matching, real copy execution, subscriber database records or production infrastructure. No database migration is needed. Main/production promotion is not part of this report.

## 2. One master ledger and additive performance

For UTC calendar day `d`:

```text
capitalAtRisk[d] = min(weeklyOperatingTarget[d], actualOpeningAccountEquity[d])
tradingPnl[d] = sum(closedMasterTrade.netPnl on d)
dailyReturn[d] = tradingPnl[d] / capitalAtRisk[d]

closingAccountEquity[d]
  = openingAccountEquity[d] + deposits[d] + tradingPnl[d] - withdrawals[d]

publicIndex[0] = 100
publicIndex[d] = 100 + 100 × sum(dailyReturn[1..d])
periodROI = 100 × sum(dailyReturn within selected period)
cumulativeMoneyPnl[d] = sum(closedMasterTrade.netPnl through d)
```

This is **cash-flow-adjusted simple return**, not TWR, CAGR, compounded wealth growth or a geometric investment return. Public index levels are not money. Dividing end index by start index would be the wrong v8 period formula; selected index subtraction or summing the daily returns is correct. A 3727% simple return over changing operating capital does not mean the final private account is 38.27 times its initial value.

Methodology distinction: the [GIPS Handbook for Firms](https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/) describes geometric linking for time-weighted returns. This owner-defined additive review measure is different and must not be represented as a comparable GIPS/TWR investment return.

Withdrawals are not trading losses and deposits are not profit. The v8 denominator is the explicit whole operating target, bounded by actual available account equity after losses. It is not selected position margin. Idle profit cash awaiting weekly withdrawal is separately recorded in the account and does not increase the operating target midweek. This is a custom strategy-capital performance convention, not a claim of GIPS compliance.

### Consecutive slices, not independent target datasets

Windows use dates strictly after their cutoff through the simulation day. ALL never rolls away inception. The opening cutoff index observation is retained for the chart.

| Consecutive slice at baseline | Dates | Contribution to simple ROI |
| --- | --- | ---: |
| Before latest 90D | 2025-08-22–2026-06-07 | +2886 percentage points |
| Prior 60 days of 90D | 2026-06-08–2026-08-06 | +570 percentage points |
| First 16 days of 30D | 2026-08-07–2026-08-22 | +44 percentage points |
| Previous nonoverlapping 7D | 2026-08-23–2026-08-29 | +115 percentage points |
| Latest 7D | 2026-08-30–2026-09-05 | +112 percentage points |

Thus `115 + 112 + 44 = 271`, `570 + 271 = 841`, and `2886 + 841 = 3727`. These are additive percentage-point relationships, not the old v7 factor divisions. The actual ALL result is 3726.999996277622%; four-decimal money rounding produces only sub-display precision differences. Baseline trading PnL is exactly 4,711,027.0000 USDT.

Weekly regimes and bounded daily opportunity weights are fitted before trades are emitted. Positive opportunities have date-seeded ceilings between 19.8% and 21.8%, avoiding identically tall upper bars. These are generation constraints, not chart clipping. Fixed genuine loss days and zero-return leave are retained. Four-decimal rounding remainders are spread across eligible planned sessions and trades; no final-day/final-trade residual creates an ending spike. Prices are solved and remeasured to agree with emitted gross PnL, fees, funding and net.

## 3. Private weekly capital and withdrawals

Strategy operating weeks are **Sunday–Saturday**. The target is stable inside each week. Realized cash above it waits in the account and is not automatically used for larger positions. Losses can reduce actual available capital below target; there is no automatic deposit or invisible replenishment.

On an eligible Saturday, after trading:

```text
retainedProfit = min(
  max(0, accountBeforeWithdrawal - operatingTarget),
  max(0, actualWeekTradingPnl) × 0.02,
  operatingTarget × seededGrowthRate
)
nextOperatingTarget = operatingTarget + retainedProfit
withdrawal = max(0, accountBeforeWithdrawal - nextOperatingTarget)
```

The seeded growth rate is 0.10%–0.45% of target; actual growth may be smaller or zero. Holiday dates do not create owner cash flows. A negative week's recovery cannot be manufactured by a top-up.

The initial deposit is solved by simulating the complete unit-capital weekly retention/withdrawal path first: `initialCapital = 4,711,027 / sum(unitPathTradingPnl)`. It is **not** simply `4,711,027 / 37.27`, an arbitrary displayed capital, or a rescale of previously emitted financial history.

| Private engineering value | Baseline USDT |
| --- | ---: |
| Initial deposit / operating target | 119,881.2699 |
| Minimum actual daily capital at risk | 99,598.1123 |
| Maximum baseline daily capital at risk | 134,464.1310 |
| Final / next-week operating target | 134,909.4762 |
| Cumulative retained operating profit | 15,028.2063 |
| Actual ending account equity | 134,909.4762 |
| Total owner deposits | 119,881.2699 |
| Total master trading PnL | 4,711,027.0000 |
| Total owner withdrawals, 47 events | 4,695,998.7937 |

Exact fixed-point identity: `119,881.2699 + 4,711,027.0000 - 4,695,998.7937 = 134,909.4762`. Maximum observed weekly target growth is **0.4381201378%**, below 1%. Target growth is not ROI; owner withdrawals are not follower performance-fee earnings.

## 4. Baseline economics from final code

Money is USDT at four-decimal ledger precision; turnover is reported to two decimals. Entry notional is counted once for turnover. The master and all copied totals come from the same actual emitted trade records.

| Period | ROI | Master net PnL | Trades, wins/losses | Active/calendar days | Win rate | Average trade PnL | Average holding, minutes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 7D | +112.0% | 150,599.8267 | 9, 8/1 | 7/7 | 88.888889% | 16,733.3141 | 672.8889 |
| 30D | +271.0% | 363,361.9314 | 34, 32/2 | 29/30 | 94.117647% | 10,687.1156 | 829.5588 |
| 90D | +841.0% | 1,111,408.9452 | 111, 108/3 | 87/90 | 97.297297% | 10,012.6932 | 697.1802 |
| ALL | +3727.0% | 4,711,027.0000 | 471, 458/13 | 343/380 | 97.239915% | 10,002.1805 | 624.4628 |

The exact lifetime win rate is `458 / 471 × 100 = 97.2399150743%`; it rounds to 97.2% at one decimal. It does not pin each short-window win rate. Average frequency is `471 / 380 × 7 = 8.6763157895` trades per calendar week. Holding times span 176–1,375 minutes. A high winning-trade frequency is not a guarantee of small losing trades or low risk.

Previous nonoverlapping 7D: **+114.9999999851%**, master net 154,064.5004; 9 wins, no losses; average trade 17,118.2778; average holding 629 minutes. Master volume is 3,073,055.95 and copied volume 137,074,947.36. Follower gross is 6,840,626.1803, fees 612,883.5085, net 6,227,742.6718. Fees are below 10% of that window's gross because the lifetime HWM includes earlier losses.

| Period | Master turnover | Copied turnover | Average capital at risk, private | Master turnover / average capital |
| --- | ---: | ---: | ---: | ---: |
| 7D | 4,091,952.77 | 199,587,910.73 | 134,464.1310 | 30.4316x |
| 30D | 13,713,285.73 | 601,349,509.38 | 133,859.7833 | 102.4452x |
| 90D | 44,781,907.33 | 1,588,886,080.40 | 131,594.0325 | 340.3035x |
| ALL | 181,445,602.44 | 2,844,869,348.22 | 125,983.1550 | 1440.2370x |

Average capital includes zero-trade calendar days. Period turnover/capital is not leverage, average daily turnover, allocated AUM or PnL.

| Period | Follower gross after trading/copy costs | Nazara performance-fee earnings | Follower net after performance fees |
| --- | ---: | ---: | ---: |
| 7D | 7,288,080.8446 | 728,808.0850 | 6,559,272.7596 |
| 30D | 16,398,764.2733 | 1,639,876.4333 | 14,758,887.8400 |
| 90D | 39,918,975.2766 | 3,991,897.5446 | 35,927,077.7320 |
| ALL | 76,251,447.0380 | 7,625,144.7450 | 68,626,302.2930 |

There are **11,709 copied trades, 7,966 fee events and 64 allocation events**. Follower equity is `7,200,000 + 68,626,302.2930 = 75,826,302.2930`. Allocated AUM remains **7,200,000**, not this larger equity value.

The much larger follower profit than v7 is a consequence of the new simple-return trade history, relatively small master operating capital and unchanged late-joining follower allocations. It was not calibrated to a desired follower-profit number. It remains a highly aggressive synthetic scenario, not verified wealth creation.

## 5. Priced executions, copied exposure and fees

Master reference assets remain BTC, ETH, SOL, XRP and BNB. Prices are deterministic synthetic references, not claimed real historical fills. Each position includes direction, price, quantity, leverage, open/close times, holding duration, gross price PnL, fees, funding and net. Positions are sequential and open/close within one UTC day; replay rejects overlap.

- Leverage: 2x–8x. Counts: 2x=41, 3x=63, 4x=62, 5x=75, 6x=80, 7x=78, 8x=72.
- Position margin is at most approximately 72% of actual capital at risk; required notional also reflects the planned price move. Entry notionals span about 111,169.36–720,452.54.
- Master round-trip fees: `(entryPrice + exitPrice) × quantity × 0.0002` (2 bps per leg).
- Master funding: `entryNotional × 0.00005 × holdingMinutes / 480`; fixed review assumption, not a live funding quote.
- Master gross 4,795,727.8818 less fees 72,607.2839 and funding 12,093.5979 equals net **4,711,027.0000**.

At each eligible master entry:

```text
followerAccountEquity = allocatedCapital + priorClosedCopiedGrossPnl - alreadyCrystallizedFees
availableCopyCapital = min(allocatedCapital, followerAccountEquity)
copyScale = availableCopyCapital / masterDay.capitalAtRisk × copyRatio
copiedQuantity = masterQuantity × copyScale
copiedEntryNotional = masterEntryPrice × copiedQuantity
```

No pre-join position is copied, even if it closes after joining. Closed intraday results are included before the next entry; unclosed profit is never spent. Profits do not grow allocation automatically. Losses reduce available exposure; nonpositive equity and margin exceeding available funds fail closed, not silently skip a bad day.

Copy ratios remain 0.89–1.00, adverse slippage 0.15–0.75 bps, latency 40–350 ms. These are explicit liquid-market assumptions, not guarantees of fills at multimillion sizes:

```text
roundTripNotional = copiedQuantity × (entryPrice + exitPrice)
executionCost = round4(roundTripNotional × (slippageBps + latencyMs / 1000) / 10000)
copiedGrossBeforeCosts = round4(masterGrossPnl × copyScale)
copiedTradingFees = round4(masterTradingFees × copyScale)
copiedFunding = round4(masterFunding × copyScale)
copiedGrossPnl = copiedGrossBeforeCosts - copiedTradingFees - copiedFunding - executionCost
```

ALL copied gross before costs is 77,961,497.5933, less trading fees 1,138,939.4838, funding 201,862.7943 and execution drag 369,248.2772, leaving gross after costs of **76,251,447.0380**. All 64 copies retain positive account equity and independently checked available margin under the final larger losses.

After all closes for a UTC day, the 10% fee uses lifetime copied gross profit **after trading/copy costs but before performance fees**:

```text
eligibleProfit = max(0, cumulativeGrossPnl - priorCrystallizedLifetimeGrossPnlHWM)
feeAmount = round4(eligibleProfit × 0.10)
newHWM = max(priorHWM, cumulativeGrossPnl)
netFollowerPnl = cumulativeGrossPnl - sum(feeEvents.feeAmount)
currentFollowerEquity = allocatedCapital + netFollowerPnl
```

Losses, recovery to an old peak and contributions do not create eligible profit or reset the HWM. Daily fee IDs and before/after HWM values are recorded. A selected window sums its actual crystallization events; it is not blindly 10% of that window's gross. Rounding thousands of individual events can differ slightly from rounding one aggregate multiplication. Fees are neither 10% of AUM nor an annual fee.

Follower net ROI remains cash-flow-neutral account performance from its actual join date. With the unchanged allocation, linked net daily account returns telescope to `netPnl / startingAllocation × 100`. That follower accounting is independent of the master's custom public simple index; no master pre-join return or index level sizes a copy.

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

## 7. Risk, leave and distribution

Risk calculations use every selected **calendar-day** cash-flow-adjusted return, including zeros, with a zero target/risk-free rate:

```text
mean = sum(dailyReturn) / n
sampleDeviation = sqrt(sum((dailyReturn - mean)^2) / (n - 1))
downsideDeviation = sqrt(sum(min(dailyReturn, 0)^2) / n)
Sharpe = mean / sampleDeviation × sqrt(365)
Sortino = mean / downsideDeviation × sqrt(365)
annualizedVolatility = sampleDeviation × sqrt(365) × 100
ProfitFactor = sum(positive master trade netPnL) / abs(sum(negative master trade netPnL))
```

For v8 maximum drawdown, the selected window's additive index is rebased to 100, then relative peak-to-trough decline is measured. Historical ALL gains do not dilute a rolling window's opening level. It is neither private-account drawdown after owner withdrawals nor a cap on individual daily losses. Calmar uses **linear** simple-return annualization, not an exponent.

| Period | Sharpe | Sortino | Annualized volatility | Additive-index max drawdown | Profit Factor |
| --- | ---: | ---: | ---: | ---: | ---: |
| 7D | 28.11619110 | 95.14730912 | 207.70950013% | 6.09276569% | 14.17647063 |
| 30D | 17.32009402 | 38.55028128 | 190.36655698% | 14.69234185% | 9.61094911 |
| 90D | 23.07117212 | 47.38961906 | 147.83480445% | 5.63914406% | 15.48868890 |
| ALL | 22.00115648 | 46.59932087 | 162.71333637% | 7.32621639% | 14.62293684 |

These ratios are unusually high and **uncapped**. The previous +115% week has no loss, so Sortino and Profit Factor are null; Sharpe is 110.41717360 and drawdown is zero. Undefined ratios must be shown as unavailable, not replaced with an attractive finite constant.

The 13 actual negative days have **8.5%–30% operating-capital losses**, not cosmetic red bars. Two explicit losing weeks, October 12–18 and February 8–14, each sum to -15%; their daily simple returns are `+19.5%, -18%, 0, -18.5%, +20%, -18%, 0`. Other loss dates are September 11 (-23.5%), November 19 (-28%), March 18 (-25.5%), May 5 (-30%), July 15 (-26%), August 20 (-23%) and September 1 (-8.5%). High win frequency therefore coexists with **severe tail risk**. An ALL additive-index drawdown of 7.33% must not be mistaken for a maximum account/position loss of 7.33%.

The selected trader's leave remains December 18–January 5 (19 dates) and April 10–12 (3 dates). It is synthetic personal leave, not a claim that crypto markets close. There are no master or copy executions, trading PnL or owner flows on these 22 dates. Additional quiet sessions give **37 zero-trade days total**, with 343 active days and 13 negative days. Leave and quiet observations remain in risk statistics.

- Largest positive daily return: **21.77772686%**, below 22%; most positive sessions are lower.
- Largest money day: **29,013.3241**, only **0.61585986%** of ALL PnL.
- Final day: **26,523.9372**, not the largest day.
- Latest seven days: **150,599.8267**, **3.19675151%** of ALL PnL.

No final residual produces these values. The exact daily-return histogram uses the ledger's signed percentage return; the money curve sums actual dollar PnL. ROI and PnL can differ in shape because the operating target changes modestly and losses reduce available capital. Neither chart changes the underlying ledger.

The model omits live liquidity/partial fills, real liquidation engines, variable venue funding, taxes and actual subscriber execution. Long histories of high returns with rare large losses still yield extreme ratios; this is an explicit limitation, not verified safety.

The v8 public Risk Level is therefore **High**, not the inherited Moderate label: it flags a canonical loss of at least 15% or ALL annualized volatility above 100%. This is a transparent review warning, not a calibrated risk-rating service. Legacy methodologies and other traders retain their existing classification. The duplicate Average Holding entry is removed from the v8 Trading Profile block; the value remains in Performance.

## 8. Runtime UTC progression and recomputed future reports

The bootstrap targets apply to **September 5**, not forever. On page load the review runtime creates or advances a deterministic snapshot through the current UTC calendar date; the same date yields identical JSON. The engine operates in complete-day synthetic scenarios, not a live intraday clock: a snapshot for September 6 represents that authored day through 23:59:59.999Z even if loaded earlier.

The runtime cache regenerates deterministically after a restart and is not a durable customer database. Forward dates append new days; date rollback recreates a prior deterministic review snapshot without mutating persisted customer history. The baseline constructor and inception stay pinned. No rebuild is required merely to move the runtime review date; this replaces the old build-time-only v7 snapshot behavior.

All old master trades, cash flows, daily/index observations, copied trades, fee IDs, allocation events and AUM-history prefixes survive +7/+30/+90. The 64 followers and current allocation AUM remain unchanged unless explicit new allocation events are supplied. New turnover and fees are actual appended executions/events, not stale baseline totals.

### Today: September 6, not the pinned baseline

Actual runtime-date example: 7D **+103.84583379%**, 30D **+275.74648152%**, 90D **+842.50666772%**, ALL **+3740.36057821%**. ALL contains 472 trades (459 wins, 13 losses), master PnL **4,729,051.6911**, gross follower PnL **77,155,048.0237**, fees **7,715,504.8437**, net **69,439,543.1800**. Master turnover is 181,756,244.36 and copied turnover 2,860,476,848.68. The extra day has 64 copied trades; total copied records are 11,773 and fee records 8,030.

### Forward period reconciliation

All advances below start at the September 5 baseline. ROI is rounded to six decimals here; generated values remain full precision.

| Advance / end date | Window | ROI | Master PnL | Trades, wins/losses | Master turnover | Copied turnover |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| +7 / 2026-09-12 | 7D | +72.000000% | 97,134.8229 | 8, 8/0 | 3,506,307.60 | 176,166,488.25 |
| +7 | 30D | +315.416766% | 423,671.7530 | 36, 34/2 | 14,937,821.35 | 688,405,281.36 |
| +7 | 90D | +836.370151% | 1,108,132.8358 | 109, 106/3 | 44,201,308.77 | 1,657,406,715.88 |
| +7 | ALL | +3798.999996% | 4,808,161.8229 | 479, 466/13 | 184,951,910.03 | 3,021,035,836.47 |
| +30 / 2026-10-05 | 7D | +103.131400% | 140,301.8733 | 9, 9/0 | 3,452,289.17 | 172,006,476.12 |
| +30 | 30D | +358.566171% | 486,380.5234 | 44, 43/1 | 17,179,355.97 | 858,551,577.25 |
| +30 | 90D | +877.296176% | 1,173,551.6933 | 117, 113/4 | 46,596,711.24 | 2,013,850,625.38 |
| +30 | ALL | +4085.566167% | 5,197,407.5234 | 515, 501/14 | 198,624,958.40 | 3,703,420,925.47 |
| +90 / 2026-12-04 | 7D | +77.241935% | 107,814.8205 | 11, 11/0 | 4,643,825.70 | 225,610,656.70 |
| +90 | 30D | +283.147370% | 392,367.1727 | 37, 37/0 | 15,633,390.25 | 764,188,181.57 |
| +90 | 90D | +858.568166% | 1,175,520.9338 | 123, 121/2 | 50,073,383.97 | 2,477,876,968.09 |
| +90 | ALL | +4585.568162% | 5,886,547.9338 | 594, 579/15 | 231,518,986.41 | 5,322,746,316.32 |

| Advance | Window | Follower gross | Performance fees | Follower net |
| --- | --- | ---: | ---: | ---: |
| +7 | 7D | 4,858,223.4773 | 485,822.3499 | 4,372,401.1274 |
| +7 | 30D | 19,839,888.2518 | 1,983,988.8308 | 17,855,899.4210 |
| +7 | 90D | 42,162,038.1718 | 4,216,203.8346 | 37,945,834.3372 |
| +7 | ALL | 81,109,670.5153 | 8,110,967.0949 | 72,998,703.4204 |
| +30 | 7D | 6,969,017.9130 | 696,901.7929 | 6,272,116.1201 |
| +30 | 30D | 24,197,071.3118 | 2,419,707.1395 | 21,777,364.1723 |
| +30 | 90D | 52,175,893.6445 | 5,217,589.3829 | 46,958,304.2616 |
| +30 | ALL | 100,448,518.3498 | 10,044,851.8845 | 90,403,666.4653 |
| +90 | 7D | 5,207,398.2371 | 520,739.8264 | 4,686,658.4107 |
| +90 | 30D | 19,096,694.8610 | 1,909,669.4965 | 17,187,025.3645 |
| +90 | 90D | 57,885,916.7120 | 5,788,591.6978 | 52,097,325.0142 |
| +90 | ALL | 134,137,363.7500 | 13,413,736.4428 | 120,723,627.3072 |

The first complete forward week, September 6–12, earns **+72% simple return**, with eight actual trades. Its Sortino and Profit Factor are null because it contains no loss, not because a value is hidden. Future regimes are date-seeded and irregular, include possible negative weeks, and are not recalibrated to preserve baseline headlines. The first 90 forward days happen to contain two actual losses; this does not guarantee losses will remain so rare indefinitely.

| Advance | Calendar days | Copied records | Fee records | Next operating target | Retained profit to date | Owner withdrawals to date | Actual ending account |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| +7 | 387 | 12,221 | 8,414 | 135,494.1704 | 15,612.9005 | 4,792,548.9224 | 135,494.1704 |
| +30 | 410 | 14,525 | 9,822 | 136,266.8230 | 16,385.5531 | 5,159,076.4778 | 158,212.3155 |
| +90 | 470 | 19,581 | 13,598 | 139,641.7793 | 19,760.5094 | 5,770,139.7764 | 236,289.4273 |

The larger ending cash on non-Saturdays awaits normal settlement and is not new operating allocation. At +90, it includes 96,647.6480 above the target. Maximum weekly target growth across all tested snapshots remains 0.4381201378%.

| Advance | ALL Sharpe | ALL Sortino | ALL volatility | ALL max drawdown | ALL Profit Factor | ALL average PnL | ALL average holding, min |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| +7 | 22.19733602 | 47.06800641 | 161.41739571% | 7.32621639% | 14.90382285 | 10,037.9161 | 628.4927 |
| +30 | 22.79392140 | 48.95483457 | 159.56668025% | 7.32621639% | 15.59954122 | 10,092.0534 | 621.1476 |
| +90 | 23.43982406 | 51.11194622 | 151.92659778% | 7.32621639% | 17.09640087 | 9,910.0134 | 624.9949 |

## 9. Executed checks and remaining integrated validation

After the final 8.5%–30% loss refinement, executed:

```text
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath src/services/copyTrading/__tests__/ReviewFollowerLedgerV8.test.ts src/services/copyTrading/__tests__/ReviewFollowerLedger.test.ts
```

**25/25 passed, two suites, 21.622 seconds**: eight v8 tests and all 17 unchanged v7 regression tests. Coverage includes:

- Same 64 allocation rows, join dates, ratios, slippage and latency as v7; exact unchanged v7 net 10,803,990.5431 and fees 1,200,443.4346.
- Independent replay of every v8 copied quantity, entry equity/margin, gross PnL, costs, funding, daily HWM, fee and positive account equity.
- No pre-join copying; no public-index dependency; exact fixed-point gross minus fees equals net and allocation plus net equals equity.
- Actual +7/+30/+90 master/copy/fee/cash-flow/AUM prefixes unchanged; new turnover and net PnL match appended records; cohorts never regenerate.
- Serialized split advancement (+3 then +4) equals +7; replay does not create more events.
- Internal report agrees with actual period trade/copy/fee sums, counts, holding times, previous-week ROI and weekly capital journal.
- Legacy fixtures still reject invalid/intraday/ambiguous allocations, overlapping positions, missing capital, insolvency and historical rewrites; loss/recovery HWM behavior is unchanged.

The report generator was executed against final code for baseline, current September 6 and +7/+30/+90; every numeric table above comes from those outputs. Monetary rows use fixed-point reconciliation, while returns/risk retain ordinary floating-point precision.

### Final integrated local verification, 2026-09-06

- Backend `tsc --noEmit` and frontend `tsc -b`: PASS. Production frontend build: 5,640 modules, PASS. Isolated review build: 5,604 modules, PASS. Existing >500 kB bundle advisory remains; no check disabled.
- Final complete relevant Jest run: **19 suites, 158 tests, all PASS**, 307.879 seconds. Pattern: `(copyTrading/__tests__|synthetic.*(test)|dailyReturnChart.*test|reviewPolicy.*test)`. Includes baseline, priced trades, copy replay, cash flows, v8 risk, every period, +7/+30/+90, v7/v8 +400, legacy histories, calendar restart/rollback and UI adapters. Two pre-existing tests imported the already removed money-chart helper; only their chart assertions/imports were migrated to the percentage helper, preserving ledger/count/rounding assertions.
- Actual built localhost `/copy-trading`, port 4178: ALL tested at **1920, 1440, 1366, 1280, 1024, 768, 430, 390, 375**. Document scroll width equals client width at all nine. Desktop/mobile screenshots inspected: strong periods throughout inception, visible loss bars and zero baseline, no final hockey-stick, no fourth empty hero metric. Existing internal horizontal chart/table scrolling on narrow screens remains.
- Calendar-date browser results on September 6: 472 trades, ALL +3740.4%, 4,729,051.69 USDT; 7/30/90/381 daily bars, matching canonical readouts. ROI/PnL toggle and underlying date/value tooltips verified. Trade tab displays the newest 20 closes (September 6 through August 22). Removed public turnover, AUM milestones/explanation, Winning/Losing/Trading Days rows confirmed absent. Current followers64, AUM7.2m and derived High risk label remain. No recorded JavaScript errors or warnings.
- Actual runtime HTTP checks: same-day repeated JSON identical; GET200, HEAD200 with empty body, `Cache-Control: no-store`; POST and account API requests403. UTC advancement is exercised through the injectable server clock tests, not by waiting months or faking browser financial state.
- Staged/working diff checks pass. No main, production accounting, real copy execution, production configuration/env/domain or other-page source changes. The approved eligibility border remains unchanged.

The existing `voltex-review` auto-deploy is the only promotion target. This local verification entry is **not** a deployment claim; confirm the final pushed SHA as Render live and in the public review manifest, then browser-check the actual staging route before delivery. No production deployment is requested or implied.
