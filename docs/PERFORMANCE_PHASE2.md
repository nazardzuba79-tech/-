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



## Measured comparison

| Metric | Before | After | Delta |
| --- | --- | --- | --- |
| visible-empty-60s / candles.setData | 161 | 22 | -86.3% |
| visible-empty-60s / candles.points | 83,720 | 11,440 | -86.3% |
| visible-empty-60s / markers.setMarkers | 150 | 11 | -92.7% |
| visible-empty-60s / candles.createPriceLine | 0 | 0 | — |
| visible-empty-60s / render.PriceChart | 150 | 156 | 4.0% |
| visible-active-60s / candles.setData | 175 | 24 | -86.3% |
| visible-active-60s / candles.points | 91,000 | 12,480 | -86.3% |
| visible-active-60s / markers.setMarkers | 163 | 14 | -91.4% |
| visible-active-60s / candles.createPriceLine | 163 | 14 | -91.4% |
| visible-active-60s / render.PriceChart | 163 | 169 | 3.7% |
| hidden-active-60s / candles.setData | 14 | 0 | -100.0% |
| hidden-active-60s / candles.points | 7,280 | 0 | -100.0% |
| hidden-active-60s / markers.setMarkers | 14 | 0 | -100.0% |
| hidden-active-60s / candles.createPriceLine | 14 | 0 | -100.0% |
| hidden-active-60s / render.PriceChart | 14 | 14 | 0.0% |
| history-scroll / candles.setData | 7 | 2 | -71.4% |
| history-scroll / candles.points | 6,240 | 2,080 | -66.7% |
| history-scroll / markers.setMarkers | 6 | 2 | -66.7% |
| history-scroll / candles.createPriceLine | 6 | 2 | -66.7% |
| history-scroll / render.PriceChart | 10 | 10 | 0.0% |
| mobile-workspaces-calculator / candles.setData | 6 | 0 | -100.0% |
| mobile-workspaces-calculator / candles.points | 3,120 | 0 | -100.0% |
| mobile-workspaces-calculator / markers.setMarkers | 6 | 0 | -100.0% |
| mobile-workspaces-calculator / candles.createPriceLine | 0 | 0 | — |
| mobile-workspaces-calculator / render.PriceChart | 10 | 10 | 0.0% |

Reference run: baseline-stable; candidate run: candidate. Both use the same 200 ms synthetic depth source and real 60-second windows. Parent render counts are intentionally not suppressed. Timings/heap vary with GC, OS scheduling and concurrent test processes; call/byte counts and deterministic regression assertions are the primary evidence.

| Stage | Before task ms | After task ms | Before elapsed ms | After elapsed ms | Before heap delta | After heap delta |
| --- | --- | --- | --- | --- | --- | --- |
| fresh-authenticated-open | 176.37 | 146.48 | 228 | 215 | 6,767,548 | 5,613,892 |
| visible-empty-60s | 2,498.1 | 1,932.87 | 60,010 | 60,025 | 1,638,476 | -3,582,348 |
| open-long | 202.59 | 209.89 | 316 | 337 | -4,833,976 | -7,997,152 |
| visible-active-60s | 5,266.13 | 3,949.43 | 60,018 | 60,007 | 16,829,608 | 12,761,416 |
| hidden-active-60s | 2,097.02 | 2,103.38 | 60,013 | 60,011 | -12,042,504 | -10,093,032 |
| history-scroll | 230.95 | 225.76 | 1,517 | 1,512 | 3,017,796 | 1,513,652 |
| mobile-first-usable | 181.39 | 261.31 | 291 | 352 | 11,737,020 | 8,604,988 |
| mobile-workspaces-calculator | 83.38 | 122.23 | 183 | 200 | 3,322,568 | 5,255,520 |
| /wallet | 76.01 | 118.12 | 8,075 | 8,079 | 1,025,024 | -345,516 |
| /copy-trading | 407.48 | 341.75 | 8,088 | 8,087 | 9,995,292 | 8,366,524 |
| /banking | 131.94 | 99.69 | 8,112 | 8,078 | 3,798,308 | 1,090,156 |
| /markets | 148.85 | 95.49 | 8,083 | 8,076 | 4,255,436 | 3,988,176 |
| /admin/deposits | 106.3 | 136.21 | 8,073 | 8,105 | 4,979,860 | 2,303,220 |

## Network audit: active Futures, 60 seconds

| Endpoint | Calls/min before→after | Transfer bytes before→after | p50 ms before→after | p95 ms before→after | Required / dedupe / cache / cadence / risk |
| --- | --- | --- | --- | --- | --- |
| GET /api/v1/futures/mark-price/BTC-USDT | 27 → 27 | 9720 → 9720 | 5.54 → 5.31 | 8.22 → 7.96 | Required server mark; two consumers (4s/5s), candidate for coalescing only with proven freshness; unchanged. |
| GET /api/v1/futures/funding-rate/BTC-USDT | 15 → 15 | 5385 → 5385 | 6.53 → 6.03 | 10.82 → 10.04 | Existing display read; no change. Cache/dedupe requires source-specific freshness evidence. |
| GET /api/v1/private-trading/candles | 12 → 12 | 579948 → 579948 | 32.93 → 28.79 | 41.81 → 45.65 | Required chart; existing loader coalesces; incremental response could help but needs separate contract; keep 5s/history correctness. |
| GET /api/v1/market/snapshot | 4 → 4 | 1436 → 1436 | 5.22 → 5.24 | 10.52 → 9.24 | Existing display read; no change. Cache/dedupe requires source-specific freshness evidence. |
| GET /api/v1/private-trading/access | 4 → 4 | 1556 → 1556 | 6.41 → 7.27 | 9.6 → 11.35 | Required security verdict; no cache/cadence change; high access risk. |
| GET /api/v1/admin/deposits | 4 → 4 | 1436 → 1436 | 6.01 → 8.23 | 7.7 → 9.2 | Existing navigation badge reads; fixture 403; no conclusion about production payload/DB cost; unchanged. |
| GET /api/v1/admin/withdrawals | 4 → 4 | 1436 → 1436 | 7.28 → 8.39 | 7.98 → 9.35 | Existing navigation badge reads; fixture 403; no conclusion about production payload/DB cost; unchanged. |
| GET /api/v1/admin/clients | 4 → 4 | 1436 → 1436 | 7.29 → 9.07 | 8.78 → 10.5 | Existing navigation badge reads; fixture 403; no conclusion about production payload/DB cost; unchanged. |
| GET /api/v1/market/derivatives/BTC | 2 → 2 | 718 → 718 | 10.87 → 10.9 | 10.87 → 10.9 | Existing display read; no change. Cache/dedupe requires source-specific freshness evidence. |
| GET /api/v1/private-trading/native/live | 2 → 2 | 6392 → 6390 | 5.35 → 5.2 | 5.35 → 5.2 | Required active account; compact + serialized already; no shared account cache; keep 30s; high financial display risk. |
| GET /api/v1/market/external/rankings | 1 → 1 | 359 → 359 | 8.86 → 10.62 | 8.86 → 10.62 | Existing display read; no change. Cache/dedupe requires source-specific freshness evidence. |
| GET /api/v1/market/universe | 1 → 1 | 688 → 688 | 9.72 → 11.67 | 9.72 → 11.67 | Existing display read; no change. Cache/dedupe requires source-specific freshness evidence. |

Config/contract/universe are loaded during initialization; full per-stage endpoints, status codes, max latency, byte counts and bundle list are in the JSON evidence. History is absent from idle polling and loaded on demand by the unchanged browser scenarios. No cadence was slowed.

| Database workload | Wire bytes before→after | Reads before→after | Writes before→after | API JSON bytes before→after | p50 / p95 / max ms after |
| --- | --- | --- | --- | --- | --- |
| 120 pure live | 438120 → 438120 | 1200 → 1200 | 0 → 0 | 340800 → 340800 | 8.24 / 11.37 / 13.83 |
| 120 live + 360 executor | 2550834 → 2550834 | 3758 → 3758 | 12 → 12 | 340800 → 340800 | 9.69 / 13.48 / 14.96 |

All 120 account and position financial results match exactly in both workloads, without decimal tolerance. Independent random fixture position IDs are excluded from that comparison. No backend, financial, Prisma schema/migration or authorization source is changed. Exact whole-journal replay equivalence for a changed backend is therefore not claimed or needed; existing replay suites are still run.

## Bundle comparison (uninstrumented production output)

| Chunk | Before raw/gzip bytes | After raw/gzip bytes |
| --- | --- | --- |
| index | 537752 / 170811 | 537752 / 170799 |
| TerminalPremium | 259370 / 84225 | 259608 / 84281 |
| CardPage | 177409 / 55533 | 177409 / 55533 |
| FuturesPage | 136044 / 40269 | 136257 / 40331 |
| hi | 118293 / 25411 | 118293 / 25411 |
| CopyTradingPage | 97456 / 30371 | 97456 / 30375 |
| WalletPage | 90092 / 23169 | 90092 / 23171 |
| FuturesStudio | 90028 / 57366 | 90028 / 57367 |
| ja | 81292 / 23288 | 81292 / 23288 |
| LegalPage | 78467 / 26075 | 78467 / 26075 |

## Change and preservation boundary

One optimization, three runtime files:

- `frontend/src/pages/private-trading/useNativeHistory.ts`: stable empty overlay
  identity until session/revision/symbol/chart data changes. No new history demand.
- `frontend/src/pages/private-trading/useNativeDemo.tsx`: memoize the actual chart
  positions/trades/interaction, including all callback dependencies. Moving marks,
  PnL, TP/SL, selection and changed positions still reach their consumers.
- `frontend/src/components/PriceChart.tsx`: selected-candle highlighting has its
  own invalidation boundary; position/mark-only updates cannot replace OHLC.

No CSS, layout, formatting, navigation, financial/backend source, Prisma schema,
migration, API endpoint, polling cadence, security guard, Banking terms, Copy
Trading behavior, deposit approval, withdrawal or balance logic is changed.
PriceChart and FuturesPage invocation counts are NOT claimed to fall; the costly
chart API side effects do. No fourth optimization (nor a second/third one).

Fresh origin/main at the start was `fdad6f6def1613dc249e3f09f47dc7f7c138e196`.
During measurement, another PR (#165, shell/chunk recovery) landed on main:
`69529beadcb7a4e51293b1bc663af749e88cad17`. The experiment deliberately retains the
fixed original baseline. This PR does not modify or revert #165's ErrorBoundary,
chunkRecovery or cache headers; merge-ref CI validates their combined tree.
The measurement commit is `eb22d3cf5cac7cf2f15a0e25ca5301c66bc1ee5b`. Candidate
JSON identifies that parent because runtime changes were measured uncommitted
before the second commit; the second commit contains those measured changes.

## Validation

- Backend TypeScript: PASS. Frontend TypeScript + production Vite build: PASS.
- Targeted actual-hook/chart tests: 90/90 PASS, including 100 mark/overlay changes
  with **zero** candle replacements, selected-bar color/clear, latest close
  callback state, unchanged lazy history and access/live cadences.
- Broader local preservation matrix initially: 1,940 PASS, two failures, 33 DB
  cases skipped without a database. A source-shape assertion required the original
  explicit `trades:ChartTradeOverlay[]` annotation: retained it without changing
  emitted JS or weakening the assertion. Its 35-test terminal/hook rerun PASS.
- Remaining local failure: existing `copyTradingCiCoverage` uses Windows path
  separators against Unix workflow globs. It also fails on the untouched baseline.
  No assertion was removed; Linux Actions runs the full matrix including it.
- All 33 previously skipped PostgreSQL transaction/replay/projection tests were
  separately run against disposable local PostgreSQL: PASS (4 suites).
- Native browser acceptance: 8 scenario groups at 1440/390, 74 nested checks,
  all PASS; no browser runtime errors. LONG/SHORT, LIMIT create/cancel,
  reduce-only, protection, partial/full close, historical picking, symbol/history
  transitions, reload, large values and mobile workspaces/calculator are covered.
- Admin-only deposits: 16 real PostgreSQL acceptance checks + 1440/390 browser
  checks PASS. 100/299/300/5000/10000 self-claims/discovery never auto-credit;
  concurrency, verified amounts, audit/ledger/referral reconciliation preserved.
- Comparison guards PASS: >70% fewer candle/marker calls, zero hidden candle
  replacements, unchanged empty/hidden live-idle behavior, exactly equal DB bytes,
  SQL counts, response budgets and market-call counts. No full journal refresh.
- Desktop and phone screenshots are in `docs/qa/performance-phase2/`; visual
  structure is unchanged. Moving synthetic quotes make these unsuitable for a
  pixel-identical screenshot assertion.
- Actions results belong to the exact published head, and are reported in the PR.

Additional reproduction after the baseline:

```powershell
node scripts/performance-phase2-browser.cjs baseline-stable --measure-only
# Apply the second commit's three runtime changes, then:
node scripts/performance-phase2-browser.cjs candidate
node scripts/performance-phase2-db.cjs candidate --tests
node scripts/performance-phase2-compare.cjs
node scripts/performance-phase2-regressions.cjs
npm run build --prefix frontend
$env:QA_PLAYWRIGHT_MODULE = (Resolve-Path node_modules/.cache/deposit-qa/node_modules/playwright).Path
node scripts/qa-deposit-minimum.cjs --browser
```

## Remaining limits / non-claims

1. This is an isolated fixture benchmark. Wallet, Banking, Markets and Admin
   route survey responses include unsupported local APIs (explicit 403 in JSON);
   their full production DB/query/provider costs were not measured. Admin success
   behavior is covered separately by the real-service disposable DB acceptance.
2. Hidden native/live, candles and depth become idle, but existing mark/funding,
   navigation badge, market and 15s access timers still make requests. Those
   inherited activities remain unchanged; no claim of a completely idle hidden
   browser is made. Individual timer-callback counts were not instrumented.
3. Timing/heap figures are short local samples, not production p95s, a mobile
   hardware profile, retained-heap proof or a long soak. Per-command scenario
   durations are recorded, but DB cost by every individual financial command is
   not re-benchmarked because the financial backend is untouched. Only the
   service/repository live + executor workloads have PostgreSQL wire counters.

No merge or deploy performed.

## Mobile repeat check

The single instrumented mobile sample was slower (291 → 352 ms), so it was not
accepted as a conclusion. A separate **uninstrumented** check built both variants
from the same source tree, substituting only the three optimized modules with
their exact baseline versions for the control. Ten fresh 390px browser contexts
per variant, empty caches, authoritative balance + seeded LIMIT ready:

| Metric | Before | After |
| --- | ---: | ---: |
| First usable p50 | 437.6 ms | 375.6 ms |
| First usable p95 / max (10 samples) | 590.0 ms | 459.9 ms |

This is an observed local non-regression, not a promise about production/mobile
hardware. Sequential ordering and OS caching can influence these short samples.
Raw samples: `docs/qa/performance-phase2/first-load.json`.

```powershell
node scripts/performance-phase2-first-load.cjs fdad6f6def1613dc249e3f09f47dc7f7c138e196
```

Synchronization note: after opening the draft, GitHub reported an append-only
AI_HANDOFF conflict with #165. The two commits were rebased onto exact main
69529beadcb7a4e51293b1bc663af749e88cad17, retaining both handoffs and all #165
runtime/cache changes. The original baseline SHAs in evidence remain the exact
historical experiments; synchronization does not relabel those measurements.
