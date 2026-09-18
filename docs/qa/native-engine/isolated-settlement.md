# Native engine — how an isolated position settles

The rule, stated once, that the engine, the ledger, the invariants oracle
and the tests all follow. Bybit's isolated margin is the reference; where
the simulation differs, it says so.

## The rule

1. **A settlement is booked at the price it happened at**, for the quantity
   it happened for. A manual or reduce-only close: the observed book level
   it consumed (`pricing: OBSERVED_BOOK`), or the resting order's own price
   for a maker fill on the replayed path. A stop or take-profit: the trigger
   price of the observation that fired it. A liquidation: the position's
   bankruptcy price — the level at which the venue takes the position over
   (`pricing: LIVE_QUOTE_MODEL` or `OHLC_PATH_MODEL`), never presented as a
   book fill. The journal is the record of what the market did; nothing
   rewrites a fill.
2. **Realized P&L and fees are real.** `realizedGross` is the sum of the
   fills' gross P&L at their actual prices; `closingFees` is the taker or
   maker rate on the actual notional; an order's `averagePrice` is the
   average of its actual fills.
3. **The post is all the shared wallet can lose.** Each reducing slice
   takes its share of the post home: `released = post × q / quantity`. The
   slice's settlement is `gross − fee + released`. When it is positive it
   is credited to the wallet. When it is negative — loss and fees beyond
   the post — the wallet is **not debited**; the difference is booked as a
   separate event `kind: SHORTFALL` (`cashflow` = the uncovered amount,
   `price` = the bankruptcy price before the slice, same `quantity` and
   `actionId` as the slice it follows). The position carries the running
   total in `shortfallCovered`; the ledger carries it as `SHORTFALL_COVER`
   lines and `totals.shortfallCovered`, and `totals.net` includes it, so
   `closingBalance` still equals free cash plus open posts.
4. **Where the closing fee comes from.** Out of the slice's settlement,
   that is, out of the post that comes home with the slice. When the post
   cannot cover loss and fee, the remainder is part of the SHORTFALL line.
   The shared wallet never pays a fee for an isolated position. (Before
   this rule the fee of a settlement past bankruptcy was debited to the
   shared wallet; the gap tests pinned that as "the post plus the fee".)
5. **Funding** is charged to the post, bounded by it (a flow larger than
   the post is charged up to the post), never to the wallet; the risk pass
   then liquidates a position whose post is gone.
6. **A leverage change** re-posts `quantity × entry / leverage` and moves
   the difference to or from the wallet; it never moves the entry, the
   quantity or realized P&L.

## What the simulation's insurance model is

The counterpart of a SHORTFALL line is the simulation itself: on the venue
the insurance fund (or auto-deleveraging) absorbs a loss past bankruptcy;
here there is no fund balance, so the line is simply not charged to the
trader. It is visible, counted once, and reconciled — it is not "profit"
and it is not hidden inside a rewritten price.

## Where the risk pass runs

A live OPEN or CLOSE journals the observed mark it was decided on and runs
the risk pass on it BEFORE executing: a position the observation already
carried past its bankruptcy level is liquidated there (rule 1, at the
bankruptcy price), and the close then finds no open position and refuses —
nothing settles at the gapped book (`executionOrdering:
OBSERVED_MARK_RISK_PASS_BEFORE_EXECUTION`). A book whose top level is
inside the post and whose next level is past it settles both slices at
their real levels and books a SHORTFALL line for the second only.

## What proves it

- `nativeIsolatedGap.test.ts` — engine and service: full and partial closes
  past bankruptcy, a stop at a gapped last, a short, a close inside the
  post (no line), funding larger than the post, a liquidation, the service
  ordering, and a two-level book straddling bankruptcy with every fill
  checked against the levels the fixture served.
- `nativeInvariants.test.ts` and `invariants.ts` — each reducing slice of
  an isolated position must carry exactly the SHORTFALL line its settlement
  leaves uncovered (`SHORTFALL_SLICE`), the position's total once
  (`SHORTFALL_ONCE`), the post folded from the journal (`POST_FROM_JOURNAL`),
  and what the wallet paid for the position never exceeds what it posted
  (`ISOLATED_LOSS_BEYOND_POST`).
- `nativeTradeLifecycle.test.ts` — an ordinary isolated trade with every
  fill at the served level, no SHORTFALL line, and the post home at the
  end.
- `isolatedMargin.test.ts`, `nativeStress30.test.ts` — the account pays
  exactly zero on a liquidation past bankruptcy; the fee is the line.

## Not Bybit

- No insurance fund balance and no auto-deleveraging; the line is the
  whole of the model.
- No liquidation fee distinct from the taker fee (`liquidationFeeRate` is
  0 in the published profile); the liquidation's taker fee is what the
  line covers on a liquidation exactly at bankruptcy.
- Version: a state persisted before this rule (`version: 2`) reads with
  `shortfallCovered: '0'` on every position (`migrateDemoState`).
