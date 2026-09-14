# Private trading model, version 1

This model is confined to the owner's private simulator. Production matching,
balances, maintenance margins and liquidation functions are not modified.
All financial inputs and outputs are decimal strings; the simulator uses its
own 36-decimal BigNumber configuration. Quantities remain base-asset units.

## Sources reviewed on 2026-09-14

- [Bybit P&L FAQ](https://www.bybit.com/en/help-center/article/FAQ-Profit-Loss-Calculation):
  linear P&L is quantity times the directional price change. Leverage changes
  required collateral, not absolute profit for a fixed quantity. The fee-to-close
  estimate is a buffer, not a fee already paid.
- [Bybit initial margin](https://www.bybit.com/en/help-center/article/Initial-Margin-USDT-Contract):
  the current article uses mark-based position value for initial margin and
  side-dependent closing-fee reserves. This differs from the owner's requested
  entry-fixed test denominator and from older help examples. Therefore this
  simulator explicitly identifies its entry-fixed profile; it does not claim
  to reproduce today's Bybit account UI or historical account configuration.
- [Bybit maintenance margin](https://www.bybit.com/en/help-center/article/Maintenance-Margin-USDT-Contract):
  maintenance depends on quantity times mark price, tier rate and tier deduction.
  The tier may change as mark value changes. The displayed maintenance amount
  includes an estimated closing fee. The article's illustrative tiers are not
  real symbol parameters and are never used as defaults here.
- [Bybit liquidation process](https://www.bybit.com/en/help-center/article/UTA-Trading-Rules-Liquidation-Process):
  isolated liquidation is triggered by mark price. The exchange's full laddered
  liquidation and insurance process is not reconstructed by an OHLC simulation.
- [Bybit funding](https://www.bybit.com/en/help-center/article/Funding-fee-calculation):
  the cash transfer uses quantity, mark and signed funding rate. A positive rate
  debits longs and credits shorts. Funding intervals can change. Free cash pays
  first, with insufficient cash reducing isolated margin. Historical settlement
  timing near a funding boundary is not claimed to match exchange latency.

## Explicit financial profile

The profile snapshots symbol risk tiers, maker/taker and liquidation fee rates,
slippage and three model version identifiers. Current symbol parameters used
for a historical experiment are recorded as current assumptions, not verified
historical rates. Missing tiers are an error; notional beyond their coverage is
an error. Deductions must form a continuous, nondecreasing tier schedule.

For quantity Q, entry E, mark P and leverage L:

```
entry notional = Q E
base margin = Q E / L
estimated close reserve (long) = Q E (1 - 1/L) takerRate
estimated close reserve (short) = Q E (1 + 1/L) takerRate
initial isolated collateral = base margin + close reserve
opening order cost = isolated collateral + actual opening fee
gross unrealized = Q (P-E) for long; Q (E-P) for short
maintenance = max(0, Q P tierRate - tierDeduction) + close reserve
equity = remaining isolated collateral + gross unrealized
liquidation condition = equity <= maintenance
```

The liquidation boundary is solved within each tier, including collateral,
deduction and close reserve. It is not `E (1 +/- 1/L)`. Missing coverage does not
produce an invented liquidation price. Funding and paid fees are separate
journal entries: reserved closing fees are never debited twice. Partial closes
release collateral and allocate opening costs/funding in the closed proportion.

`calculatePosition` takes collateral **after** any cash changes and uses fee and
funding inputs only to report net P&L. Its optional valuation metrics do not
perform a second ledger debit. In the historical simulator funding uses free
scenario cash first, then position collateral; received funding enters free
scenario cash. The scenario cannot credit a live wallet.

Open-position ROI is gross unrealized P&L divided by its contribution-based
remaining collateral, with closing-fee reserve included. Replay-result ROI is
the scenario position's total net P&L divided by the sum of remaining and
proportionately released collateral contributions. Added margin increases that
basis; withdrawals reduce it. Realized proceeds and funding are not capital
contributions. Zero basis returns null, never Infinity. This is position/scenario
ROI, not account ROI, and alternative experiment results must not be summed.

## OHLC replay rules

- UTC integer timestamps. `createdAt` is the actual creation time; effective
  times belong only to the simulation. The result retains a fixed `asOf`.
- Entry and explicit requested close execute at the **next** candle open, with
  model slippage and actual model fees. A manual entry is a recorded assumption.
- User margin, close and TP/SL events must be on a candle boundary. Otherwise
  finer historical data is required; the engine returns an ambiguous draft.
- Boundary ordering: existing mark risk; funding for positions already held;
  risk after funding; pending/explicit close; manual close; margin; TP/SL update.
  Same-kind events use immutable event IDs for a deterministic tie break.
- TP/SL triggers use mark. A single unambiguous trigger executes at the next
  trade-candle open. A candle hitting TP and SL, or either plus liquidation,
  remains ambiguous; the engine never selects the favorable sequence.
- Mark adverse extremes test maintenance through the complete path. An
  unambiguous intrabar liquidation uses the model's liquidation boundary plus
  exit slippage; its effective time is the containing candle's end. This is a
  reproducible OHLC model, not an actual historical market fill. Boundary gaps
  liquidate at the available trade open, potentially producing scenario debt;
  no synthetic exchange insurance credit is added. Such debt stays isolated
  within that scenario.
- A later rally, margin event or TP/SL edit cannot restore an earlier liquidation.
  Closed results stop processing market data and retain their exit snapshot.
- Trade and mark candles must be present and aligned. Every expected funding
  event needs its actual rate and boundary mark. No interpolation fills gaps.
  Missing provider coverage remains incomplete even if partial totals exist.
- Only fully closed candle paths are consumed. At an exact `asOf` boundary only
  the next candle's open may be used; its high/low/close cannot influence the
  result. A sub-candle end needs finer data.
- All fills/journal entries have deterministic IDs. The persistence service must
  enforce uniqueness, preview-version confirmation, transaction isolation,
  ownership and cancellation; the pure module performs no financial writes.

## Execution depth

The live helper consumes sorted actual bid/ask levels and reports weighted fills
and an unfilled remainder. Limit prices bound eligible levels. It does not create
counterparty liquidity, invent levels or use the last trade as guaranteed price.
The service must verify contract identity and freshness before calling it and
again before committing its result. Current symbol price/quantity/leverage steps
are checked separately from historical assumptions.

Private previews and execution share the account's remaining observed depth.
Already consumed liquidity cannot reappear merely because the provider response
timestamp changes: a newer matching-engine snapshot is required. Successive fills
check the aggregate position's leverage tier at both entry and Mark Price value.
A resting limit order cannot draw additional unapproved free capital when its
actual notional would exceed its reserved margin budget.

Historical `remainingCollateral` is the collateral attached to the open remainder,
and is zero after full close. It is separate from the cumulative contribution
denominator used for scenario net ROI; partial closes must not make the displayed
collateral equal to that larger cumulative denominator.

## Verification

The dedicated math and replay tests cover the owner's no-fee 1200% ROI fixture,
both sides, fixed-quantity leverage invariance, fee reserves, added collateral,
tier transitions, partial close allocation, funding signs, depth exhaustion,
liquidation before a rally, intrabar ambiguity, no lookahead, gaps, model inputs,
event ordering and the invariant `scenarioEquity = allocatedCapital + netPnl`.
HTTP authorization, durable accounting, live quote expiry and browser/export
coverage are separate integration responsibilities.

## Validation record — 2026-09-14

- Math, replay, live-account engine and request identity: 78 tests passed across
  four suites. Including the service runtime suite, the final focused run was
  102/102 across five suites. Backend `tsc --noEmit` passed with the integrated
  service on disk.
- Real PostgreSQL: all 12 cases in `service.integration.test.ts` passed in
  bounded batches. These cover the complete allocated-demo-capital order and
  card flow, restart persistence, idempotent commands, insufficient balance,
  quote expiry immediately before final write, concurrent full closes,
  historical isolation, incomplete replay, scenario advance, owner/session
  revocation, and funding of both signs without duplicate settlement. The two
  additional regressions cover a concurrent remaining entry fill/full close
  and revocation after the precommit check but before final persistence.
- The database suite is opt-in (`PRIVATE_TRADING_DB_TESTS=1`) and checks the
  destination host before creating a Prisma client. It was run on Neon branch
  `br-spring-salad-ax6wgel4`, `codex-private-trading-replay-20260914`, endpoint
  `ep-damp-sky-axh52ggd`. Fresh Neon metadata confirmed this branch is neither
  primary nor default; production is a different branch. Only UUID-labelled
  fixtures were written. Existing rows were not deleted. Test-owned production
  model sentinel balances remained byte-for-byte unchanged, with no Spot,
  Futures or legacy demo execution rows created for those fixtures.
- The first silent combined remote run was interrupted, then cases ran with
  visible per-case progress and 30/40-second limits. After additional final
  access checks were introduced, the full lifecycle case exceeded its old
  30-second limit. It passed alone in 33.116 seconds with explicit stage progress
  and a bounded 45-second limit; all financial assertions remain unchanged.
  Other final cases took roughly 13–27 seconds due to remote SQL latency. One assertion
  initially expected the time-derived preview DTO to remain READY after its
  five-second lifetime; it now checks the persisted row is unchanged while
  the account, command and every ledger entry are also exactly unchanged.
  The intended quote-stale error and full transaction rollback passed.
- No production financial transaction, migration or deployment was performed
  by these checks. Browser/export and full candidate-suite results belong to
  the overall release report, not this module validation record.
