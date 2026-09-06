# Nazar profile correction — 2026-09-06

Scope: owner-authorized synthetic **review only**, from freshly fetched
`claude/review-ready` at `a918ba6c7c21e01f93a4d7b86b6ebb07844d3796`, on
`codex/nazar-profile-consistency`. Performance V8 is the prerequisite and remains
the methodology. No avatar work, real account operations or production changes.

## Canonical baseline, September 5

| Metric | Derived result |
| --- | ---: |
| Master trades | 471 |
| Positive net outcomes | 434 |
| Negative net outcomes | 34 |
| Zero net outcomes, after costs | 3 |
| Resolved-outcome Win Rate | 434 / 468 = 92.73504273504274% |
| Public Win Rate | 92.7% |
| ALL maximum drawdown | 5.789999980841042%, displayed 5.79% |
| Minimum daily return before | -29.99999999225023% |
| Minimum daily return after | -4.820316933187279% |
| Negative sessions | 25 |
| ALL master PnL | 4,711,027.0000 USDT |
| Profit Factor | 41.312696236605234 |
| Sharpe, 365 calendar observations/year | 27.501413329292937 |
| Sortino, downside against zero | 223.09105524172048 |
| Annualized volatility | 130.17082206217313% |
| Average trade net PnL | 10,002.180467091295 USDT |
| Average holding | 632.3694267515923 minutes |

All prices, quantities, both fee legs and funding independently reconstruct
each outcome in the existing 0.0001-USDT precision. A breakeven has zero net PnL,
not zero costs. JSON signed zero is normalized before freezing the history.

## Conservation and methodology

Reused the V8 generator. Original daily plans determine approved weekly budgets;
local correction occurs **before** priced executions are emitted. Smaller loss
sessions replace shocks; nearby positive sessions in the same week/anchor slice
absorb the difference. No final-day/trade/week balancing bucket was added.

The fixture `approvedV8Baseline.json` records the independent starting-commit
history. Every Sunday-week total and nested period boundary reconciles within
financial-rounding tolerance. Baseline ROI remains: 7D +112%, previous separate
7D +115%, 30D +271%, 90D +841%, ALL +3727%. ALL PnL remains exactly 4,711,027
USDT in integer money units. There is no geometric reinvestment or synthetic
deposit to repair losses. Public index = 100 + 100 × sum(daily returns), as V8.
Public drawdown is peak-to-trough of this additive strategy index, **not** the
drawdown of a private withdrawn/replenished margin account and not GIPS/TWR.

Stable-capital/retention/withdrawal equations are unchanged. Replaying the
corrected path necessarily changes some derived private money amounts: initial
capital 119,881.2699 → 119,389.9466 USDT; ending operating target 134,909.4762 →
134,378.4295; total withdrawals 4,695,998.7937 → 4,696,038.5171. Thus individual
daily/rolling monetary sums are recalculated, not represented as unchanged.
The requested ALL money target and all approved return targets are preserved.

Follower sizing, cohorts, allocations, slippage, funding and high-water-mark fee
rules are unchanged, replayed from corrected master trades/capital. 64 followers,
7,200,000 USDT AUM and 10% fee remain. Baseline gross follower PnL76,277,916.8771
minus fee7,627,791.7245 = net68,650,125.1526 USDT. These are synthetic modeled
results; unusually high PF/Sortino are derived and uncapped, not verified returns.

## Future history and public presentation

UTC calendar extension still appends deterministic days without rebuilding past
trades, daily returns, index, cash flows, follower copies or fee events. Genuine
mixed-outcome sessions target the baseline resolved-loss ratio34/468; the UI
always divides actual wins by actual resolved outcomes and may move naturally.
No future 92.7 constant exists. +1/+7/+30/+90/+365/+400, serialized split runs and
legacy v7 behavior are covered.

September6 live-clock result:472 trades/435wins/34losses/3breakevens,
92.75053304904051% → **92.8%**; ALL ROI3740.360584033047%, PnL4,728,980.7402.
This is a new date, not the frozen September5 baseline. No fake date override
was added to make staging show the old baseline count/rate.

User-visible name is Nazar, including favorite/accessibility labels, unavailable
states and follower explanations. Internal legacy identifiers remain. Profile
sidebar explicitly uses ALL-history statistics while yellow chart, Daily Return
and follower selected-period readouts still follow the period selector. Removed
Average Return / Day completely; existing flex readout has one natural item.
Whole-USDT public formatting: +1 113 907,03 USDT → +1 113 907 USDT; small amounts
retain decimals, ledger/price/quantity precision is not rounded by formatting.
Recent closed trades remain newest-first, at most20 in the primary profile.

## Verification

- Backend TypeScript PASS; frontend TypeScript/build PASS.
- 23 relevant Jest suites,191 distinct tests passed after updating the last
  stale458/13 expectation and rerunning its full12-test suite. Includes legacy
  engine, master/follower/fee independent reconciliation, canonical periods,
  clock/persistence, outcome distribution, money formatting and actual SSR UI.
- Production build5641modules; review build5605modules PASS. Existing >500kB
  chunk advisory only. Windows sandbox esbuild process denial resolved by the
  same authorized build with normal process access, no checks disabled.
- Local actual built `/copy-trading`,port4178:1920/1440/1366/1280/1024/768/430/390/375,
  no document overflow or out-of-bounds KPIs/buttons. One Daily Return readout;
  7/30/90/381 actual bars,25 ALL negative sessions; percentage tooltips match the
  canonical ledger. Linear signed scale and bar geometry unchanged, no clipping.
- Desktop/mobile screenshots inspected; full-page stitching duplicated strips
  in the capture, not DOM (one panel each). Actual viewport screenshots verified.
- Yellow chart component exact source fingerprint preserved; entire CSS and
  chart-data helper unchanged. Actual1440px comparison: both panels
  943.1667×570.7604px; identical line/fill/grid styles;382points, maximum local
  SVG-coordinate difference0.9. Overall/weekly anchors unchanged; no redesign.
- Four period switches retain lifetime Win Rate/count. Recent20trades newest
  first; no recorded browser JavaScript errors/warnings. Eligibility/real copy
  authorization remain untouched, review writes remain disabled.

Deployment target only existing `claude/review-ready` → `voltex-review`:
https://voltex-review.onrender.com/copy-trading. This document records pre-push
validation; final delivery additionally requires actual Render live SHA,
manifest/runtime response, staging browser and recent service log verification.
Main audit SHA: `ced48a598c64269880ed00fca712ce1c148298de`.
