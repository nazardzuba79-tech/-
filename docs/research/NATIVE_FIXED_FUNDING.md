# Native demo Futures: one fixed funding rate

Status on 2026-10-16: **the code is ready, the rate is not set.** `NATIVE_FIXED_FUNDING.rate` in
`src/private-trading/native/fundingModel.ts` is `null`, so nothing is activated and every account
keeps settling under the original custom model until a rate computed from Bybit is committed.

## Why the rate is not in this change

The rate must come from Bybit's own settled funding history. The cloud container this work was done
in cannot reach Bybit: `api.bybit.com`, `api.bytick.com`, `api.bybit.nl`, `api.byhkbit.com`,
`api.bybit.kz` and `api.bybitglobal.com` answered HTTP 403 "blocked from your country" (re-checked
2026-10-16), and `public.bybit.com` publishes no funding history. The one GitHub Actions attempt
(branch `claude/peaceful-volta-h5zw7g-bybit-funding-probe`, run 38901482152) failed at the Bybit step
and produced no artifact; that route is not used again. No other exchange or aggregator was used as a
substitute, and no number was typed in by hand.

Step-by-step run on the owner's Windows machine (PowerShell or Codex):
[`BYBIT_FUNDING_WINDOWS_RUN.md`](BYBIT_FUNDING_WINDOWS_RUN.md).

## How to produce it

From any machine that can reach `api.bybit.com` (public endpoints, no API key, no account):

```
node scripts/research/bybit-funding-average.mjs --end 2026-10-16 --days 30 --top 10 --out docs/research
```

It writes `docs/research/bybit-funding-<end>.json` (every settled record used) and `.md` (the
table), and exits with code 2 — and `"usable": false` — if any contract's history is incomplete.
To activate, commit the JSON and set, in `fundingModel.ts`:

```
NATIVE_FIXED_FUNDING = { version: 'BYBIT_LINEAR_30D_MEAN_V1', rate: '<summary.fixedRate8h>', evidence: '<sha256 of the JSON file>' }
```

The guard in `nativeFixedFunding.test.ts` fails unless a committed `bybit-funding-*.json` has exactly
that SHA-256, `"usable": true` and the same `fixedRate8h` (checked: a typed-in rate with made-up
evidence fails it). A second test pins whatever `NATIVE_FIXED_FUNDING` holds through the real pin
and proves that every settlement before its start is byte-identical to the legacy replay and every
later one carries the shipped rate. `.gitattributes` keeps git from rewriting the evidence's line
endings, so its SHA-256 survives Windows and Linux checkouts.

## Method (also written into the JSON)

| Step | Rule |
|---|---|
| Source | Bybit v5 public API: `/v5/market/instruments-info`, `/v5/market/tickers`, `/v5/market/funding/history` |
| Window | the last N complete UTC days before `--end`; a record counts when `start ≤ fundingRateTimestamp < end` |
| Contracts | USDT-settled `LinearPerpetual`, status `Trading`, listed before the window opened; top `--top` by 24h turnover, plus BTCUSDT, ETHUSDT, SOLUSDT always |
| Interval | each record's interval is the gap to the previous settlement of the same contract (one extra day is read before the window) |
| 8h normalisation | per contract `sum(rate) × 480 / sum(interval minutes)`; for an all-8h contract this is exactly the plain arithmetic mean |
| Signs | kept; negative funding lowers the mean |
| Aggregation | equal-weight arithmetic mean of the per-contract means |
| Rounding | half away from zero to 8 decimal places (Bybit's own precision) |
| Arithmetic | exact scaled BigInt; no floating point touches a rate |

The method is tested on a local stand-in for the same API (`scripts/research/bybit-funding-average.test.cjs`,
no network): 3 contracts → `0.00003500`; with a 4h contract normalised to 8h and a contract listed
inside the window excluded → `0.00005125`; a missing settlement → exit 2, not averaged around.

## What the engine does with it

- One rate for every supported USDT perpetual on the native demo account. Not read from any market,
  never refreshed; a different number is a new `version`.
- Settlements at 00:00, 08:00 and 16:00 UTC: `funding = quantity × boundary mark × rate`. A positive
  rate debits LONG and credits SHORT; a negative one the reverse. Leverage is never applied.
- Only positions open at the boundary take part, on the quantity they hold then: a position closed
  before the boundary owes nothing; after a partial close only the remainder settles. A position
  opened exactly at a boundary does not settle at it.
- Every settlement is a journaled `FUNDING` event with its time, position, quantity, mark, amount and,
  for a fixed-rate settlement, `fundingRate` and `fundingModel`. The ledger shows the same lines.
- A replay, a restart or a repeated command settles each boundary once (`lastFundingAt`).
- Isolated positions settle against their own posted margin, capped at it; Cross against the wallet.

### Old trades are never re-priced

The account is a replay of its journal, so a plain constant change would re-price every settlement
the replay passes. Funding is therefore a **schedule keyed by settlement time**: version
`VOLTEX_CUSTOM_DEMO_V1` (LONG −0.1%, SHORT +0.4% of position value per 8h) prices every boundary
before the fixed version's start, byte for byte, and its events keep their original shape. The start
is pinned **once in the database** (`NativeFundingModel`, migration `20261016150000`) to the first 8h
boundary after the first process that knows the version — so nothing the previous code already showed
is re-priced. Two processes starting together pin one row (`createMany … skipDuplicates`); a database
trigger refuses UPDATE and DELETE of a pinned row; a different rate or evidence under the same version
is refused (`FUNDING_MODEL_CONFLICT`). Every native read and command waits for the schedule and fails
closed if it cannot be read.

## Not double-charged

| Mechanism | Accounts | Changed here |
|---|---|---|
| `src/futures/FundingRateService.ts` | real `FuturesPosition` rows | no |
| `src/private-trading` live engine | private owner scenarios | no |
| `src/private-trading/native` | native demo (test) accounts | yes — the only one |

Native demo positions are journal state, not `FuturesPosition` rows, so the real-account service
never sees them; a guard test asserts neither side references the other. Spot, Stocks and CFD have no
funding path and are untouched. Entry/exit prices, fees, liquidation and order rules are unchanged.

## P&L

`Net P&L = Trading P&L − fees + funding` (funding signed: received +, paid −), reported by the engine
for every position (`tradingPnl`, `feesPaid`, `fundingNet`, `netPnl`). An open position includes only
funding already settled; a closed trade includes all of it and its total is its `netPnl`, which is
exactly what the wallet moved. Closing settles no extra funding. On the native terminal the open table
shows Trading P&L, Funding, Fees and Net P&L in place of the single realized column; the history table
and the close card show the same four. Real-account tables are unchanged.

Browser evidence (fixture engine, synthetic prices and a SYNTHETIC QA rate 0.0001 — not a proposed
rate): `docs/qa/native-funding-pnl/after` and, for comparison, `docs/qa/native-funding-pnl/before`.
