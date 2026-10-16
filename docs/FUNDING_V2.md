# VOLTEX funding V2

Set by the owner on 2026-10-16. One source: `src/config/voltexFunding.ts`.

| Side | Per 8h settlement (00/08/16 UTC) | Direction |
|---|---|---|
| LONG | −0.01% of position value | trader pays |
| SHORT | +0.04% of position value | trader receives |

Same directions as the original demo model (LONG −0.1% / SHORT +0.4%), ten
times smaller. Position value is quantity × mark at the boundary. Leverage
never multiplies it. This is VOLTEX's own model, not provider funding, and it
is not zero-sum between longs and shorts.

## What already happened is never recalculated

- **Native demo (test) accounts** are replayed from their journal, so the
  terms are a schedule keyed by settlement time (`private-trading/native/fundingModel.ts`).
  - Every settlement before V2's start keeps V1 (−0.1% / +0.4%), byte for
    byte. Its events keep their original shape.
  - V2's start is pinned **once** in the database (`NativeFundingModel`,
    migration `20261016170000_native_funding_model`). It is the first 8h
    boundary after the first process that knows V2 started.
  - A restart, a redeploy or a second instance reads the same row. A trigger
    refuses UPDATE and DELETE of the row. Different rates under the same
    version are refused.
  - V2 settlements carry `fundingRate` (that side's fraction) and
    `fundingModel` on their event and ledger line.
- **Real futures accounts** settle funding as a cash-flow at the boundary
  (`futures/FundingRateService.ts`). Past `FundingPayment` rows and balances
  are not touched. Only settlements after the deploy use V2.

## Each boundary settles once

- **Native:** `lastFundingAt` per position. A replay, a restart or a repeated
  command settles nothing twice.
- **Real:** each run takes a transaction-scoped advisory lock on
  (symbol, boundary). It settles nothing if a `FundingRateRecord` for that
  symbol already exists inside the boundary's interval. Proven on real
  PostgreSQL with two instances settling at once
  (`src/futures/__tests__/fundingOnce.pg.test.ts`). With the guard removed,
  that test fails.

## Net P&L carries funding once

- **Native:** `realizedPnl = realizedGross − fees + fundingNet`. Closing
  re-applies no funding, and the wallet moves by exactly the net. The ledger
  reconciles.
- **Real:** `/futures/positions` and `/futures/positions/history` now report
  `realizedPnl` = price P&L + settled funding (one grouped `FundingPayment`
  read), with `fundingNet` beside it. The wallet was already moved at each
  settlement, and closing re-applies nothing.

## Terminal

The header and «Данные контракта» show VOLTEX's rates by side from
`/futures/config` (`fundingCashflow`). They no longer show a settled-record
poll or the provider's live rate.

### P&L taken apart (native demo / test accounts)

Ported from PR #534 (display only; its Bybit rate, fixed-rate model and
migration were not carried over). The engine already reports
`tradingPnl`, `feesPaid`, `fundingNet` and `netPnl`, with
`netPnl = tradingPnl − feesPaid + fundingNet`. The terminal shows them
unchanged and never recomputes them:

- **Open positions:** «Торговый P&L», «Фандинг», «Комиссии», «Чистый P&L»
  replace the single realized column. Fees are shown as a debit. The
  «≈ USD» line is under the Net P&L only.
- **Position history:** the same four columns. The total is the Net P&L
  the wallet moved by.
- **«Позиция закрыта» card:** Trading, Funding and Fees above the Net P&L.
  The native demo loads history only on demand, so the Positions tab now
  asks for it while the card is shown. Before this change, the card's result
  stayed «…» until the card closed itself.
- **Phone:** the four figures sit in pairs, and the TP/SL and «Закрыть как»
  cells keep full width (`data-pnl-split`).
- **7 languages:** four new keys (`futures.colTradingPnl`,
  `futures.colFunding`, `futures.colFees`, `futures.colNetPnl`).
- **Real accounts:** the API reports no per-position fees, so their tables
  keep one P&L column. That column includes settled funding (see above).

Browser proof: `scripts/qa-native-funding-pnl.cjs`.

- It runs on the review fixture with two QA levers, fixture only and off by
  default:
  - `NATIVE_PREVIEW_CLOCK_QA`: a forward-only server clock;
  - `NATIVE_PREVIEW_FUNDING_V2_QA`: the shipped V2 terms pinned three days
    back.
- It crosses real 00/08/16 UTC boundaries, then checks every figure against
  the engine and the ledger at 1920, 1440 and 390 px. This covers open rows,
  history and a «Рыночный» close from the table.

## Before activation (owner only)

Merging and deploying is the owner's decision. The migration is additive (one
table). It must be applied together with the new API: native requests fail
closed if the pin cannot be read. Nothing here was merged, deployed or
migrated on production.
