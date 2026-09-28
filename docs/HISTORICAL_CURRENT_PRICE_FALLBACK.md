# Systemic historical current-price fallback

Follow-up to merged PR #308, based on fresh main
`b413e0ba53f3b767aac8f31ebe1dd5d5f8edbc37`. No symbol allowlist or
QNT/AKE-specific production path is introduced.

## Root causes and fix

1. A failed `marks` HTTP/network request threw before independent ticker/quote
   reads could run. Historical demo acquisition now proceeds to the existing
   authenticated exact-symbol ticker and then quote on frame transport failure.
   Caller cancellation, malformed JSON and invalid frame schemas still fail
   closed. No public endpoint, cached price or historical entry is substituted.
2. Ticker acceptance checked only the 60-second display lifetime, ignoring the
   command's 15-second commit headroom. A 45.001–60-second ticker could therefore
   prevent a usable quote from being tried, only to fail at final admission.
   Every fallback candidate now checks all three timestamps against the caller's
   actual budget before selection. An insufficient ticker falls through to quote.

The frame/ticker/quote sequence remains bounded: one frame read and at most one
ticker plus one quote per missing symbol, with existing concurrency and request/
command deadlines. Failure logs contain only symbol and sanitized error reasons.
The 60-second display lifetime, 45-second command admission budget, 5-second live
quote validation and final pre/post-persistence freshness checks are unchanged.
No polling, persistence, frontend, historical candle selection, risk-tier parser,
margin, P&L, liquidation, funding or unrelated trading-product logic changes.

## Regression evidence

- New failures reproduced on the unpatched main implementation before the fix.
- `historicalPriceFallback.test.ts`: command boundaries 45s/45.001s/50s/60s/60.001s,
  each timestamp independently, unchanged display policy and frame fast path,
  frame HTTP/network/timeout failures, authenticated bounded fallback, cancellation
  before/during reads, malformed/conflicting frames, invalid JSON and strict custom
  quote headroom.
- `nativeThinContract.test.ts`: real authenticated loopback collector HTTP routes,
  upstream parser and native command/reload engine, with synthetic public venue
  and in-memory repository. QNT, AKE and ETH all cover frame outages, aged ticker
  to fresh quote, and zero commits when all sources are unavailable or stale.
  Historical entry and current valuation remain separate. No real orders/accounts.
- Both regression files are explicitly included in the existing CI workflow.
- Full local private-trading suite: 46 suites, 860 tests passed; 3 environment-gated
  suites / 40 database tests skipped. No production database was connected.
- Backend TypeScript, frontend TypeScript and production frontend build passed.
  Vite retains its existing >500 kB chunk warning.
- Frontend preservation: 60/60 tests across native demo UI, native Futures terminal
  and chart-trading suites passed. No frontend source files changed.

The fix cannot guarantee trading when every current-price provider is unavailable
or stale; such commands must still be refused without financial persistence.
No merge, deployment or production financial write was performed for this follow-up.
