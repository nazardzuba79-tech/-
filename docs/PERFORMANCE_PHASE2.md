# Performance phase 2 — measured baseline

Base: `fdad6f6def1613dc249e3f09f47dc7f7c138e196`, freshly fetched from origin/main.
Branch: `codex/performance-phase2`. Draft review only; no merge or deployment.

## Measurement boundary

The production frontend is built unchanged first (bundle sizes), then a separate
observation build counts component invocations and actual lightweight-charts API
calls. Local review routes execute the real native service against isolated
synthetic accounts. A routed 5 Hz depth fixture exercises the normal book
subscription/coalescing path without contacting an exchange. Financial actions
reuse the existing browser acceptance functions and their assertions.

This is not production latency, production account reconciliation or Neon billing.
The review server does not implement every API: 403 responses in the other-route
survey must not be mistaken for successful Wallet/Banking/Admin data acceptance.
The hidden test dispatches the document visibility contract; it does not claim to
reproduce OS background timer throttling. JS heap deltas are not retained heap or
a long-duration leak test. Component counts include local state updates, not just
parent renders. API transfer bytes include HTTP response overhead, not only JSON.

The PostgreSQL run uses a newly created loopback cluster and all committed
migrations, a 352,204-byte authoritative fixture and 118 closed trades. A TCP
proxy counts PostgreSQL server-to-client bytes. Service/repository queries are
included; HTTP authorization middleware is not included in this DB measurement.
No inherited production DATABASE_URL is used.

## Phase A evidence (before runtime edits)

| Metric | Current main |
| --- | ---: |
| Visible active, 60 seconds: candle setData | 166 |
| Candle points handed to setData | 86,320 |
| Marker updates / price-line recreations | 154 / 154 |
| Actual candle fetches | 12 |
| Candle API transfer bytes | 579,948 |
| FuturesPage / PriceChart invocations | 142 / 154 |
| Hidden 60 seconds: candle setData | 14 |
| Empty account periodic native/live reads | 0 |
| Active account native/live reads per minute | 2 |
| Largest production JS chunk, raw / gzip | 537,752 / 170,811 bytes |
| Futures route JS, raw / gzip | 136,044 / 40,269 bytes |
| 120 pure live reads: PostgreSQL bytes | 438,120 |
| 120 pure live reads: SELECT / writes | 1,200 / 0 |
| 120 pure live reads: response bytes | 340,800 |
| Largest compact live response | 2,840 bytes |
| Pure live p50 / p95 / max | 9.15 / 11.26 / 12.87 ms |
| 120 live + 360 executor: PostgreSQL bytes | 2,550,834 |
| Including executor: SELECT / writes | 3,758 / 12 |

The pure-live assertions prohibit NativeDemoRevision queries, authoritative
NativeDemoAccount.payload reads and writes, and verify the authoritative payload
remains exactly unchanged. Both modes enforce the 50 KB live response ceiling.
The older #156 numbers are a reference workload, not re-labelled as this run:
fixture/commits differ. The current-main control is the regression comparator.

## Ranked measured costs and decision

1. **Avoidable chart synchronization:** 166 full candle replacements and 154
   marker/price-line rebuilds for 12 candle fetches. Interaction object identity
   changes on unrelated parent updates; the overlay effect also replaces candles.
   Proposed minimal change: stable native interaction inputs and separate candle
   highlight invalidation. Expected: candle replacements follow candle/selection
   changes, not order-book or near-live PnL updates. Risk: stale selection/markers
   or callbacks. Prove with actual chart hook tests, native hook tests, browser
   entry/exit/history/TP-SL scenarios and the same measured traffic.
2. **Candle transfer volume:** 579,948 bytes/minute at the existing cadence.
   Not optimized in this patch. Incremental history contracts need their own
   correctness evidence; slowing freshness is explicitly out of scope.
3. **Initial shell delivery:** 537,752 raw / 170,811 gzip bytes. No lazy-loading
   change justified by this single local run; existing route splits preserved.

Only optimization 1 is selected. No backend/math/auth/deposit change is planned.
This ranking separates steady-state avoidable CPU work, network bytes and initial
delivery cost; it is not a claim that unlike units can be numerically compared.

## Reproduction

From the repository root, with dependencies installed and Prisma generated:

```powershell
npm run build
npm run build --prefix frontend
npm install --prefix node_modules/.cache/deposit-qa --no-save --ignore-scripts @embedded-postgres/windows-x64@18.4.0-beta.17 pg@8.23.0 playwright@1.56.1
node scripts/performance-phase2-db.cjs baseline
node scripts/performance-phase2-browser.cjs baseline
```

Browser script uses installed Edge on Windows; local fixture port 4178 must be
free. The browser script replaces frontend/dist with an instrumented observation
build; run `npm run build --prefix frontend` afterwards for a clean production
artifact. Outputs go to `output/performance-phase2/<label>/`. The database values
files allow exact before/after comparison; synthetic IDs/timestamps are stable in
the service fixture. No production endpoint or credentials are needed.

Phase B comparison, complete network audit and regression results follow after
the baseline run and the selected optimization have completed.
