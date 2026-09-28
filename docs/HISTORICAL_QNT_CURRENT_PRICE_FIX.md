# Historical QNT OPEN refusal — 2026-09-28

Base: fresh `origin/main` at `0f02773e02c0907b9364f2396c733f3065029139`.
Branch: `codex/historical-current-price-fix`. No merge, deployment or production mutation.

## Evidence before the patch

Read-only Render logs (owner-confirmed **VOLTEX Free**, `voltex-api`) show four
QNTUSDT HISTORICAL_DEMO OPEN requests between 04:22:57 and 04:24:09 UTC.
All refuse with **collector_unavailable**, HTTP 503, immediately after
`market.instrument.end`. Example request `3fd6da17-2994-4ed8-8baa-3fb44778a8fe`:
`market.instrument` at 1988 ms, end at 2424 ms, refusal at 2424 ms.
No `market.historical_entry` or current-price acquisition follows.

The actual path is therefore:

`OPEN -> historicalDemoAttempt -> market.instrument -> collector instruments/QNTUSDT -> refusal`

It does **not** reach `demoCurrentPrices -> historicalDemoPrices -> marks -> ticker -> quote`.
The API currently collapses non-2xx collector responses into `collector_unavailable`,
and the frontend maps that to its price-unavailable message. Neither was changed.

Running the **unchanged** CollectorPrivateTradingSource against read-only public
Bybit endpoints reproduced `instrument(QNTUSDT) -> market_data_invalid`, while
QNT ticker and quote both succeeded. AKE instrument/ticker/quote also succeeded.
At that observation QNT mark was 259.71 (the owner's earlier 264 quote is not a
hardcoded production assumption). Ticker timestamps were
`markProviderTimestamp=1790570353277`, `receivedAt=fetchedAt=1790570352597`;
quote `markProviderTimestamp=1790570353502`, `fetchedAt=1790570352827`.
The provider clock was ~680 ms ahead, within the unchanged 1000 ms skew budget.

QNT's public risk-limit payload has blank `mmDeduction` for limits 5000, 7000,
10000 and 12000, all with MMR 0.01. The fifth tier has MMR 0.015 and deduction 60.
The parser accepted a blank deduction only for the explicitly flagged lowest
tier, so it failed at tier 2. Fresh prices could not help.

**Evidence boundary:** production collector is loopback-only and its bearer token
is generated at process startup. No authenticated production shell/token was
available; production marks/ticker/quote responses were not directly captured.
The exact production refusal stage/code is proven by existing logs; the underlying
parser defect is reproduced with the identical source and current public payload.
Authenticated route tests below run locally, not on production. No secrets were read.

## Comparison with 579349b6

The ticker-first, quote-second fallback in `marketData.ts` is unchanged from
579349b6. The failing deduction parser already existed in that commit and dates
to `f1a93b4b348d1c343dfb10521521396e6cff6049` (initial private replay implementation).
This is an uncovered QNT instrument shape, not a demonstrated later fallback regression.

Separately, `fa220080` changed the collector's default slow refresh from 20s back
to 60s. That can increase fallback use but cannot explain these refusals, which
occur before price reads. Its cadence is intentionally left unchanged.

## Narrow fix

Normalize a blank deduction to zero only across the initial constant-MMR zero
plateau, anchored by `isLowestRisk=1`, with subsequent rows explicitly flagged 0.
Once MMR changes or a nonzero deduction appears, blank deductions still refuse.
Missing, malformed, wrongly flagged and duplicate-limit rows still refuse.
All numeric provider deductions and tier values are preserved.

This is input normalization, not a new margin formula. The mathematical zero
condition follows Bybit's documented recurrence:
`D[n] = D[n-1] + Limit[n-1] * (MMR[n] - MMR[n-1])`.
Source: https://www.bybit.com/en/help-center/article/Maintenance-Margin-USDT-Contract

Freshness, commit headroom, frontend execution authority, historical entry,
matching, margin/P&L/liquidation/funding engines and all unrelated products are untouched.
Patched read-only provider checks accept both QNT and AKE, each with all 30 tiers.

## Verification

- Private-trading suite: 45 suites / 811 tests passed, 3 suites / 40 tests skipped
  by their existing environment gates. Two additional unavailable-source cases
  subsequently passed (813 distinct backend tests passed across runs).
- New HTTP integration suite: 10/10. Real authenticated collector routes,
  real venue parser, real native command engine; synthetic upstream and repository.
  QNT/AKE: aged frame + fresh ticker; unavailable ticker + fresh quote; all stale;
  all unavailable; malformed nonzero deduction refuses before writes. Entry/current
  valuation and new-service reload checked. No real database or trading provider writes.
- Parser test covers QNT's four zero-deduction tiers plus rejection boundaries.
- Frontend preservation: 69 passed, 1 existing failure in
  `priceChartMarketOrders.test.ts:454`. It requires an LF-only source substring;
  this Windows checkout uses CRLF. Both the test and PriceChart.tsx are identical
  to origin/main. Left unchanged to avoid unrelated edits.
- Backend TypeScript, frontend TypeScript and production frontend build passed.
  Vite reports its existing >500 kB chunk-size warning.
- Isolated browser QA at 127.0.0.1:4196, real built React/native engine,
  `NATIVE_PREVIEW_FIXTURE=1 NATIVE_PREVIEW_THIN_CONTRACT_QA=1`:
  selected old candles, opened longs and reloaded. QNT: quantity 1, entry 61.08,
  current mark 264.51, unrealized P&L 203.43. AKE: quantity 2000, entry 0.004,
  current mark 0.0538, unrealized P&L 99.60. Both positions survived reload.
  The opt-in fixture makes marks 61s old so execution must use the fresh ticker.
  The existing preview may display public external depth; it is not execution authority.

No production order, position, balance, account or database row was changed.
