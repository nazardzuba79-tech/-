# Server idle — sleeping background loops

Branch `claude/peaceful-volta-h5zw7g`, base `main` `14120a82`. Goal: an always-on
Render backend must not keep Neon awake while the exchange has no server-side
work. Nothing here was run against production or Neon; every figure is a
**local measurement** (a local PostgreSQL 16, or a recording Prisma client on a
simulated clock). None of it is a Neon billing figure.

## 1. Audit — every background loop on `main` `14120a82`

| # | Loop (file) | Cadence with work | Cadence idle (main) | Reads Neon | Statements per idle pass | Woken by (main) | After a restart | Can sleep safely |
|---|---|---|---|---|---|---|---|---|
| 1 | Futures liquidation (`futures/LiquidationEngine.ts`) | 5 s | backoff 5→60 s, then **60 s forever** | yes | 1 SELECT (`FuturesPosition` OPEN) | `FuturesPositionService.placeOrder` after commit | first pass at +5 s | **yes**: positions only come from `placeOrder`, which wakes it |
| 2 | Futures TP/SL (`futures/FuturesProtectionService.ts`) | 3 s | 3→60 s, then **60 s** | yes | 1 UPDATE (reclaim) + 1 SELECT | `setProtection` | first pass at +3 s; reclaims `TRIGGERING` rows older than 60 s | **yes**, once a `TRIGGERING` row counts as work (fixed here) |
| 3 | CFD liquidation (`cfd/CfdLiquidationEngine.ts`) | 5 s | 5→60 s, then **60 s** | yes, if a CFD provider key is set | 1 SELECT (`CfdPosition` OPEN) | `CfdPositionService.open` | first pass at +5 s | **yes** |
| 4 | Spot conditional orders (`services/PriceWatcherService.ts`) | 5 s | 5→60 s, then **60 s** | yes | 1 SELECT (`Order` PENDING_TRIGGER) | only the `OrderService` built in `index.ts`: **the one the HTTP route uses had no wake** | first pass at +5 s | **yes**, after the route wake (fixed here) |
| 5 | Native demo limit pass (`private-trading/native/limitPass.ts`) | 10 s (env 10–300 s) | **fixed 10 s, no backoff** | yes | 1 raw SELECT (jsonb scan of demo accounts) | nothing | first pass at +10 s | **yes**, with a route wake (added here) |
| 6 | Owner-account pass, legacy private trading (`private-trading/service.ts`) | 3 s | **fixed 3 s, no backoff** | yes, while `PRIVATE_TRADING_ENABLED` | 1 SELECT (no account) … 4 (account + live session: account, user, session, previews) | nothing | first pass at +3 s | **yes**, with a route wake (added here) |
| 7 | Futures listing (`futures/FuturesMarketRegistry.ts`) | 15 min | **15 min** | yes | 2 SELECT (distinct symbols of open positions / resting orders) + Kraken HTTP | — | refresh at start | the DB read **only matters when a contract would be delisted** |
| 8 | Funding (`futures/FundingRateService.ts`) | 00:00 / 08:00 / 16:00 UTC | same | yes | per listed contract: BEGIN, INSERT `FundingRateRecord`, SELECT positions, COMMIT | timer to the boundary | re-armed to the next boundary | kept: the record is the funding rate the terminal header shows |
| 9 | Deposit watcher (`services/deposits/DepositWatchScheduler.ts`) | startup +60 s, 12:00 / 16:00 / 20:00 Kyiv | same | yes | 2 (INSERT … ON CONFLICT DO NOTHING + SELECT); a scan only when enabled and due | timer to the next slot; admin open/manual | one check at +60 s | kept as approved (no night scans, manual buttons always) |
| 10 | Start-up recovery (`OrderBookRecovery`, `FuturesOrderBookRecovery`) | once | — | yes | a few SELECTs | — | — | once per start |
| — | Market data: MarketUniverse, collector client (WS + 10 s watchdog), Binance liquidation stream, Deriv CFD stream, `/market/live` SSE heartbeat, provider timeouts | — | — | **no** (no Prisma in any of them; the collector process has none either) | 0 | — | — | not touched |

Loops that queried Neon **every 60 s or more often** on an empty exchange: #6 every **3 s**, #5 every **10 s**, #1–#4 every **60 s** (and every 3–5 s in their first minute). #7 every 15 min. With Neon suspending after 5 idle minutes, any one of them keeps the compute awake 24 h a day.

## 2. Design — near-zero idle database polling

`IdleBackoffScheduler` gains an opt-in **sleep**: a sweep that found no rows at all, after a start-up grace, holds **no timer**. It runs again only on `wake()` (work created) or `nudge()` ("there may be work"; a no-op for a loop already sweeping at its base cadence). The found-work rule is unchanged: a loop with anything to watch never sleeps and keeps its original cadence.

Because a sleeping loop depends on being woken, the wake is layered:

1. **Mutation wakes** (after the commit, never inside it): futures placement → liquidation; `setProtection` → TP/SL; spot conditional/OCO placement → price watcher (**including the HTTP route, which had none**); CFD open → CFD liquidation; any native command whose committed reply leaves an open position or working order, and every session admission → native limit pass; every successful legacy private write → owner pass.
2. **Activity net** (`BackgroundWorkCoordinator`): any successful mutating API request (non-GET, status < 400) nudges every sleeping loop, at most once per 30 s plus one trailing re-check. The database is awake for that request anyway; with nobody active it costs nothing.
3. **Scheduled reconciliation** at every funding boundary + 2 min (00:02 / 08:02 / 16:02 UTC): funding has just woken the database, so this re-check costs **no wake of its own**. It covers work that reached the database without any request to this instance (manual SQL, another process). Worst case for such out-of-band work: 8 h.
4. **Start-up**: each loop's first pass is its recovery scan (no event needed). For the first **10 min** after a start a loop only backs off (≤ 60 s) and never sleeps: Render starts the new instance while the old one still serves requests, and anything the old one commits in that overlap woke the old one's loops.

Two correctness gaps that sleeping would have turned into silent failures were closed first:
- a TP/SL row left in `TRIGGERING` by a crash is reclaimed only once it is 60 s old; it now counts as work, so the loop cannot sleep past it;
- the spot orders route built its own `OrderService` without the wake.

Other changes: the native limit pass and the owner pass moved from fixed `setInterval` to the same scheduler (unchanged cadence while there is work); the futures listing re-reads open positions/orders only when a refresh would drop a contract (after one successful read, every in-flight contract is already listed: orders are only accepted for listed contracts and no refresh drops one).

**Why not a timer fallback (e.g. every hour)?** Each timer wake of an otherwise idle Neon costs at least the 5-minute suspend delay of compute: hourly = 24 wakes ≈ 2 h/day, every 6 h ≈ 20 min/day. Riding the funding boundary gives the same 8-hour bound for out-of-band work at zero extra wakes, and every in-app path is covered within seconds by layers 1–2.

**Unchanged on purpose:** funding formula and settlement (the per-contract record is what the header shows as the funding rate); deposit watcher schedule and manual actions; all trading, balance, P&L, liquidation, TP/SL, matching and deposit-credit logic; no schema change.

## 3. Measurements

### 3.1 Simulated idle day (recording Prisma, simulated clock)

`src/__tests__/serverIdleDbBudget.test.ts` builds every background loop from its real class, starts them exactly as `index.ts` does (on `main`: its own start sequence; on this branch: `createServerBackground`), and runs 24 simulated hours from 00:30 UTC. Every Prisma call is attributed to its service by stack. "Steady" = hours 0.5–24. Figures are Prisma operations (≈ SQL statements).

Scenario **empty** (demo trading on, owner configured, nothing open anywhere):

| per source, steady 23.5 h | main `14120a82` | this branch |
|---|---|---|
| owner pass (legacy private) | 28 200 reads | 3 reads |
| native limit pass | 8 460 reads | 3 reads |
| futures TP/SL | 1 410 reads + 1 410 writes | 6 reads + 3 writes |
| futures liquidation | 1 410 reads | 3 reads |
| CFD liquidation | 1 410 reads | 3 reads |
| spot conditional | 1 410 reads | 3 reads |
| futures listing | 188 reads | 0 |
| funding (3 boundaries, 3 contracts in the fixture) | 9 reads + 9 writes + 18 BEGIN/COMMIT | same |
| deposit watcher (3 slots, paused) | 3 reads + 3 writes | same |
| **loops, per hour** | **1 808 reads + 60 writes** | **0.9 reads + 0.13 writes**, all inside the funding wake |
| loop queries at a moment the database was not already awake for scheduled work | **42 944** | **0** |
| timers held at rest | 9 | 4 (listing refresh, funding, deposit slot, reconciliation) |

Scenario **owner-session** (the owner's legacy account exists with a live session, nothing open): main **5 408 reads/hour** (the owner pass alone 4 800/h); this branch 0 queries outside the funding wake windows.

### 3.2 Real server, real PostgreSQL, 30 minutes, zero requests

The compiled backend (`node dist/index.js`) against a local PostgreSQL 16 with
`log_statement = 'all'`; every statement the server issued for its database
was counted from the PostgreSQL log (`run-idle.cjs`, `window.cjs`). No HTTP
request at all during the run. Production-like switches: private/demo
trading on with an owner configured, collector URL set (so the native limit
pass exists), a CFD provider key set (so the CFD sweep queries), market data
from a local stub (`market-stub.cjs`: Kraken tickers for three majors, 404
for everything else — no real provider was called). BEFORE and the first
AFTER ran side by side in the same window, 08:01–08:31 UTC (after the 08:00
funding boundary, before the 12:00 Kyiv deposit slot), on separate databases;
the final-head run followed at 08:19:46–08:49:49 UTC on a fresh database.

| | main `14120a82` (BEFORE) | branch, first build (AFTER) | branch, final head `9456fc35` (AFTER) |
|---|---|---|---|
| whole 30 min: SELECT / INSERT+UPDATE / BEGIN+COMMIT | 1 052 / 34 / 68 | 140 / 15 / 30 | 137 / 15 / 30 |
| minutes 12–30 (steady state): reads / writes | **629 / 18** | **0 / 0** | **0 / 0** (minutes 12–30 of its own window, 08:31:46–08:49:46) |
| steady reads per hour / writes per hour | **2 096.7 / 60.0** | **0 / 0** | **0 / 0** |
| statements per minute | 58 in minute 0, then **35–39 every minute to the end** | 43 in minute 0, 12–17 per minute through minute 10 (the start-up grace), then **0 from minute 11 to 30** | 43 in minute 0, 12–18 per minute through minute 10, then **0 from minute 11 to 30** |
| biggest sources | owner pass `PrivateTradingAccount` 599 (every 3 s), native limit pass 179 (every 10 s), Prisma `SELECT 1` pre-checks 138, TP/SL 33 UPDATE + 33 SELECT, spot 33, futures 32, CFD 32 (every 60 s) | the same loops' start-up scans and grace backoff only | |
| futures listing (positions/orders re-read) | 2 + 2 (start, +15 min) | 1 + 1 (start only; the +15 min refresh skipped it) | 1 + 1 (start only) |
| deposit watcher | 1 check (+60 s): INSERT … ON CONFLICT DO NOTHING + SELECT | same | same |

Raw results: `real-30m-before-main-14120a82.json`,
`real-30m-after-first-build.json`, `real-30m-after-final-9456fc35.json`.
"First build" is this branch's working tree when the run started (before the
`nativeLimitTargets` extraction and the best-effort wake wrappers, neither of
which touches an idle path); the final-head run repeats it on the exact code
of the PR.

Result: on an idle exchange main issues a statement roughly every 1.6 s,
forever; this branch issues none once its 10-minute start-up grace has
passed.

## 4. Correctness — real PostgreSQL (`src/__tests__/serverWatcherSleep.pg.test.ts`)

Real services and a real PostgreSQL 16, real timers (base 100 ms, grace 0). "Asleep" is asserted by the loop state **and** by the database: zero statements in Prisma's query log while the test is quiet.

- **Futures**: asleep empty; a resting order wakes it for one sweep and it sleeps again; the opening fill wakes liquidation synchronously and it sweeps at base cadence while positions are open; TP + SL armed (protection wakes); partial close (2 → 1); TP executes, SL cancelled; SL on the SHORT executes (full close), TP cancelled; with nothing open and nothing armed both loops sleep and the database hears nothing.
- **Spot**: STOP_LIMIT wakes the watcher; trigger fires; watcher sleeps; TAKE_PROFIT_LIMIT keeps it awake; cancelling it puts it to sleep.
- **CFD**: open wakes; close → sleeps.
- **Native demo**: an OPEN through the real `nativeDemoRoutes` wakes the limit pass; a resting LIMIT is filled **by the pass** (no client command) when the market moves; closing everything puts the pass to sleep.
- **Restart**: positions, TP/SL, a conditional order and a CFD position written with no wake at all are found by each loop's start-up scan; once cleared, every loop sleeps. An idle restart runs one scan per loop and then nothing.

Also proven:
- **the first wake is not lost** — a wake that lands while a sweep is in flight re-runs the sweep straight after it (`IdleBackoffScheduler.sleep.test.ts`), and on PostgreSQL a resting order wakes the loop, it sleeps again, and the opening fill wakes it synchronously;
- **a wake can never turn a committed write into an error** — every wake handed out by `index.ts`, the native route's wake and the legacy owner-pass nudge run through `bestEffortWake`; with a wake that throws, the native command still answers 200 with its body (mutation-checked: 500 without the wrapper), and a watcher whose nudge throws does not change a write's response;
- the 3 route tests that broke on the first commit (a legacy route's test double had no `nudge`) pass.

The PostgreSQL suite passed three consecutive runs together with `futuresBookLock.pg` (22/22 each).

Neon note: Neon's own guidance says scale-to-zero works with open client connections and severs them on suspend; the next query reconnects. Prisma re-validates a connection that has sat idle before reusing it (the `SELECT 1` visible in the statement log). Reconnect behaviour against Neon itself was **not** exercised here.

## 5. Regression against clean `main`

Full `jest` on the final head vs a checkout of `main` `14120a82` (same machine, both with a backend `dist`, no frontend `dist`):

| | suites | tests | passed | failed | skipped |
|---|---|---|---|---|---|
| main `14120a82` | 344 | 5 476 | 5 273 | 122 | 81 |
| branch `9456fc35` | 349 | 5 522 | 5 314 | 122 | 86 |

Failed-test sets are identical: **0 new failures, 0 fixed.** The 122 are pre-existing on `main` (frontend source-text guards, CFD quote safety, provider failure matrix, copy-trading canonical hashes and similar) and untouched here. The +5 skipped are the new PostgreSQL suite, which runs only with `VOLTEX_PG_TEST_URL` (and in the new `server-idle.yml` workflow).

Database-gated suites run separately on local PostgreSQL 16: private trading / native (`service.integration`, `nativeDemo.integration`, `nativeCommandAcceptance.integration`, `nativeLivePostgres`) 42/42; `futuresBookLock.pg` + `serverWatcherSleep.pg` 22/22.

## 6. Reproduce

```
# simulated day (branch); run the same file in a checkout of main for BEFORE
IDLE_BUDGET_REPORT=/tmp/after.json npx jest src/__tests__/serverIdleDbBudget.test.ts
# real PostgreSQL scenarios (disposable, migrated, otherwise idle database)
VOLTEX_PG_TEST_URL=postgresql://…/voltex_test npx jest src/__tests__/serverWatcherSleep.pg.test.ts
# 30-minute real-server idle run (PostgreSQL with log_statement='all')
node docs/qa/server-idle/market-stub.cjs 4599 &
node docs/qa/server-idle/run-idle.cjs after ./dist voltex_after 4702 30
```
