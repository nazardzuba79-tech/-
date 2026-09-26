# Browser read budget

## Rule for every feature before merge

State idle requests/hour, estimated Neon reads/hour AND writes/hour, whether
a background timer exists, hidden-tab behavior, and whether events can replace
polling. Default: **NO polling unless realtime is genuinely required**.
Count actual mounted consumers, not just a constant in an unused hook.

## September 2026 implementation

Only browser acquisition changed. Server execution, pricing authority, margin,
balances math, liquidation, funding settlement, protection execution, schemas,
Support, KYC, deposit packages/watchers and Analytics are not changed by this PR.

| Resource | Visible fallback | Other reads |
|---|---|---|
| Wallet account/overview/performance | none | opening, known local mutation, manual; visible return when successful data age >=120s |
| Wallet rankings | none; shared tab cache 30min | opening/cache miss, stale visible return |
| Admin Users activity | 60min | opening, manual, existing block/unblock/credit callbacks |
| Admin alert cursor | 60min, admin layout only | opening, stale visible return; existing chime retained |
| Futures positions | empty 60s; active 10s | known mutation, stale visible return |
| Futures orders | empty 60s; active 15s | known mutation, stale visible return |
| Futures balances | empty 60s; active position/order 30s | known mutation, stale visible return |
| Futures histories | none | active-tab entry, active-tab event/manual; inactive events mark dirty only |
| Futures mark/index | one shared 30s read per symbol | symbol change, stale visible return |

Hidden/unmounted read schedulers own no polling timer. In-flight reads may finish;
they cannot schedule another hidden read. The generic scheduler uses successful
acquisition age, not visibility age. Session changes clear private data and reject
old in-flight results; failures preserve last-good data. Mutations during a GET
queue one new read instead of accepting the pre-mutation snapshot. History
subscriptions use `0` for activation/events, not a zero-delay interval.

The central Futures store enforces the floors even if another subscriber asks
for a faster cadence. Detected order/position size/status changes refresh
dependent account views; normal PnL ticks do not. Server PnL/ROE is retained:
the browser does not invent mark-price/risk math for a display optimization.
Header and sizing form share the genuine mark/index endpoint (not last trade).

Known Wallet modal mutations use their existing refresh callbacks. Returning
from another route loads anew. A remotely credited deposit has no client push
event in this architecture: it appears on manual refresh or stale visibility
return, not through a new background watcher. No global event bus was added.

## Reproducible measurement (not production telemetry)

Production Vite bundles, loopback HTTP fixtures, actual browser components and
stores, controllable browser clock. `scripts/qa-futures-account-harness.cjs
--budget --port 4244` serves the current bundle; `--dist <baseline>/frontend/dist`
serves a built detached baseline. `/__qa/scenario?mode=A|B|C` resets only the
in-memory fixture. This harness never opens a database connection or real order.
The budget bootstrap is injected only by this opt-in test server, never bundled.
It blocks external fetch/WebSocket traffic, counts requests, drains HTTP bodies
and React tasks between virtual clock ticks, and provides hidden/visible controls.

Intervals are half-open: opening read included, endpoint at exactly 60min/10min
excluded. No mutations during idle census. Fixture latency is not production
latency; physical Neon query counts require production telemetry and are NOT
claimed measured here. Initial baseline ebba6795; rebased and rechecked against
current main 6ad0c19d9ce32d9ee821751c3f17a35f8c61fd05.

### Wallet and Admin (one hour)

| Requests | Before | After |
|---|---:|---:|
| Wallet overview | 450 | 1 |
| Wallet rankings | 240 | 1 |
| Wallet all fixture HTTP, including existing snapshot POST | 697 | 9 |
| Wallet all GETs | 696 | 8 |
| Admin Users activity | 144 | 1 |
| Admin Users entire page GETs | 147 | 5 |
| Admin alerts, actual mounted baseline | 0 | 1 |
| Admin alerts, old hook cadence if mounted | 60 | 1 |

Important: the old alert hook was not mounted anywhere on baseline. Thus the
actual page gains one cursor read; do not claim 59 saved requests from an unused
hook. The old hook's 60/hour budget becomes 1/hour when mounted only in admin.
Wallet's fixed seven requests are me, deposits, withdrawals, native wallet gate,
two performance reads, and the existing once-per-load portfolio snapshot POST.
The native-wallet gate can legitimately reject an ordinary real account.

### Futures (ten minutes)

A: no positions/orders. B: one position, no orders. C: one position and one order.

| Requests | Before A/B/C | After A | After B | After C |
|---|---:|---:|---:|---:|
| positions | 150 | 10 | 60 | 60 |
| balances | 120 | 10 | 20 | 20 |
| orders/me | 120 | 10 | 10 | 40 |
| mark-price | 270 | 20 | 20 | 20 |
| four target endpoints | 660 | 50 | 110 | 140 |
| authenticated target account reads | 390 | 30 | 90 | 120 |
| ALL authenticated page reads | 421 | 61 | 121 | 151 |
| estimated target Prisma reads | 780 / 930 / 930 | 60 | 240 | 300 |

The baseline mark count is 150 header reads at 4s plus 120 form reads at 5s.
Remaining authenticated overhead is 30 private-trading access checks (three
existing consumers) and one me read, unchanged. Public overhead is also disclosed:
spot snapshot 10, display 20, candles 121, funding 10, derivatives 10, rankings 10,
universe 2, config 1, icons 1–2 depending on mounted responsive rows. Those add
216–217 requests including authenticated overhead: all-page HTTP is 876–877
before and 266–267 / 326–327 / 356–357 after. Not all chart traffic was optimized.

Initial ebba6795 had an additional one-time Support resume read; current main's
independent Support change removes it. It is NOT counted as this PR's saving.

### Neon estimates and writes

Counts are route-level Prisma read calls including one session lookup for a
session-bound JWT, not measured SQL statements. Relations/query strategy and
account authorization branches can change the physical SQL count.

- Wallet overview: auth session + user + spot balances + futures balances = 4.
  Variable idle read load: 1,800/hour -> 4/hour. Rankings: no Prisma reads.
  Add unchanged opening-read overhead; performance reads alone add about 14.
- Admin activity: auth + admin user + 3 counts + package queue 4–6 reads = about
  9–11/read: 1,296–1,584/hour -> 9–11/hour. Package-dependent relations vary.
- Alerts: auth + admin user + three latest-row lookups = 5/read. Old hypothetical
  mounted cadence: 300 -> 5/hour; actual unmounted baseline: 0 -> 5/hour.
- Futures: positions cost 2 empty / 3 nonempty (protection lookup); balances and
  orders each cost 2. Mark endpoint has no Prisma read. Add unchanged access/me,
  funding and other route overhead to the target totals above.
- No new business-data write was introduced. Existing GET auth may touch a
  session's lastSeenAt when older than 5min: do not call authenticated polling
  literally zero DB writes. Wallet's existing portfolio snapshot POST remains
  once per mounted load (server deduplicates); no periodic snapshot write added.

## Verification

681 frontend tests / 39 suites pass on the rebased branch, including real shared
stores, mounted React hooks, mutation-during-GET, hidden timers, failed reads,
logout/login isolation, exact A/B/C counts and shared mark/index preservation.
The native-account isolation source guard now expects the new 15s/10s real-account
cadences while still requiring an empty subscription for the native adapter.
Backend TypeScript and production frontend TypeScript/Vite build pass. Vite's
existing ~500kB main-chunk warning remains, unrelated to this change.

Additional backend preservation: 495 pass, 6 pre-existing CFD failures across
CfdMarketDataService, CfdQuoteSafety, CfdQuoteRoutes; all six reproduce unchanged
on the baseline. No production/DB-connected integration test was run. Separate
legacy Wallet UI suites also have 25 pre-existing failures on baseline (missing
toast mock, obsolete hashes/expectations); the real Wallet account projection
preservation suite passes. These unrelated suites are not silently rewritten.

Browser QA at 1440/430/390/360/320: no horizontal regression; no console errors.
Fixture actions verify immediate place/cancel/close/transfer refresh, closed row
in history, TP/SL value retained, and balance update without advancing the clock.
Hidden 10min Futures and hidden 1h Wallet/Admin add zero polling requests.
Wallet/Admin own zero hidden timers. Futures retains display-only countdown and
existing non-request timer callbacks; scoped acquisition schedulers own zero.
No real trade, production database connection, manual deployment or secret used.
