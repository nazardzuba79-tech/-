# Stocks #613 — Stocks load isolated from crypto execution

Status: source and CI diagnostic only. Nothing is deployed, no flag is turned on,
production BUY/SELL stays a silent NO-OP for everyone.

## Why

In the paired 50+2 diagnostic (50 viewers polling every second, 2 synthetic
traders, the frozen crypto trace) the crypto p95 rose by +40 % to +53 % when the
Stocks load was added. The harness ran the crypto API, the Stocks authority
(`stocksTestCashRouter` with its PostgreSQL authority), the Stocks gateway and the
synthetic market in one Node process: API CPU went from about 2.1 s to 6–8.5 s per
20 s window and every Stocks request queued on the crypto API's event loop.

## Release layout (separated)

| Process | How it starts | Listens on | Holds |
|---|---|---|---|
| Crypto API | API image, `node dist/index.js` (unchanged) | public `PORT` | no Stocks route: `STOCKS_TEST_CASH_ENABLED`, `STOCKS_CATALOGUE_ENABLED`, `STOCKS_ORDER_EXECUTION_ENABLED`, `STOCKS_AUTHORITY_INTERNAL_PORT`, `STOCKS_AUTHORITY_REQUESTS_PER_MINUTE` all unset |
| Stocks authority (new) | same API image, `node dist/stocksAuthority.js` | `127.0.0.1:STOCKS_AUTHORITY_INTERNAL_PORT` only | `DATABASE_URL`, `JWT_SECRET` (the API's), Stocks authority settings |
| Stocks gateway | `Dockerfile.release` gateway target (bytes unchanged), `release-entrypoint.mjs` | `127.0.0.1:4437` (+ ingress `4438`) | no database credentials; `STOCKS_TEST_CASH_AUTHORITY_URL=http://127.0.0.1:<authority port>/api/v1/stocks-test-cash` |

`src/stocksAuthority.ts` mounts exactly what the API mounted for Stocks — the same
middleware order (helmet, 100 kB JSON limit, private ingress, router) — and nothing
else. The authority is its own process, not part of the gateway, so the process
that serves browser traffic still has no database credentials and the reviewed
gateway image, release configuration and runtime closure stay as they are.

`deploy/stocks-pages-gateway.compose.yaml.example` shows both services (source
only, review profile). The authority uses the ordinary API image with another
command; neither Dockerfile changes.

## What does not change

- Router code (`src/api/routes/stocksTestCash.ts`): `requireAuth` with the single
  live session read, revocation, contact block, actor binding, gateway capability,
  readiness that re-reads the bindings, both server gates. (P1 later added the
  `POST identities` batch route; see below.)
- PostgreSQL authority: `User`/`Session` `FOR NO KEY UPDATE` and
  `StocksTestAccount`/`DemoBalance` `FOR UPDATE` fences, blocked users refused
  inside the transaction, atomic commands, receipts and idempotent replays.
- Private ingress: loopback-only listener, exact Host/path/method, no forwarded
  headers, constant-time capability, finite transport quota (120–240 per minute,
  default 240), 128 connections, 15 s / 10 s / 5 s deadlines. (P1 added
  `POST identities` to the exact path/method list only.)
- Exactly one authority process. Its per-principal admission queue is per
  process; correctness rests on the PostgreSQL locks. Run one instance only.
- `STOCKS_ORDER_EXECUTION_ENABLED` stays `false` in production: readiness reports
  `tradingEnabled: false` and the gateway grants nobody `canTrade`.

## Start, stop, rollback

1. Start the authority. It refuses to start without its private port
   (`STOCKS_AUTHORITY_PROCESS_CONFIG_INVALID`) or with an invalid ingress setting
   (`STOCKS_INGRESS_CONFIG_INVALID`) and prints only such codes.
2. Start the gateway pointed at it; its startup readiness check verifies the
   authority (bindings, schema, issuer, principals digest) before it listens.
3. Rollback: stop the gateway and the authority. The crypto API is not touched.

## Scheduling control

Both Stocks services run with a lower CPU weight than the crypto API:
`cpu_shares: 102` against Docker's default 1024 (about a tenth under contention;
on cgroup v2 Docker converts shares to `cpu.weight`). Outside Docker the same
relation is `Nice=10` (or `CPUWeight=10` against the API's default 100) in the
service units. It reserves nothing, takes no CPU away when the host is idle and
adds nothing to the budget. The 50+2 `after` pin applies it as nice 10 on both
Stocks processes.

R6 tried the gateway in Linux's idle scheduling class (`chrt --idle 0`). The
acceptance run showed no measurable effect on the crypto p95 (section R6), so
R7 removed it from the compose example and from the 50+2 `after` pin. The idle
class must not be used for the authority in any case: it holds trader rows
locked inside its transactions, and an idle-class lock holder can be starved
while a crypto write waits for that row (seen locally, section R6).

## Resources

Same host and no new server. One more Node process for the authority; its own
Prisma pool counts against PostgreSQL `max_connections`. Until R7 every process of the
50+2 harness (driver, crypto API, authority, gateway, PostgreSQL) stayed inside the same
2-vCPU `taskset`; since R8 the server side has exactly those 2 vCPUs and the clients and
the synthetic market run on the runner's other core (section R8).

## Evidence

- `src/__tests__/stocksAuthority.test.ts` (Jest, mocked rows): no start without
  the private port or with relaxed limits; capability, path and method before any
  session read; live revocation; quota still ends in `AUTH_RATE_LIMIT`.
- `services/stocks-global/separated-authority.pg.test.cjs` (Node 22.23.3, real
  PostgreSQL, compiled `dist/`): the compiled authority process and the unchanged
  release gateway; readiness, live revocation through the gateway and on a direct
  command, blocked binding refused by the authority, no row changed.
- 50+2 paired diagnostic: `policy-613.cjs` runs the runtime as one process,
  `policy-613-after.cjs` runs the same runtime separated
  (`scripts/qa/stocks-rc-50plus2/README.txt`). Results: `docs/AI_HANDOFF.md`.

### Round 1 (separated, no CPU weight): run 40510632557 on `f06e7fa9`

Collection COMPLETE 8/8; both pins `DIAGNOSTIC_P95_FAIL`.

| Pin | Crypto p50/p95/p99 baseline → mixed (ms) | Pooled Δp95 | Median run Δp95 | Crypto API CPU base → mixed (ms) |
|---|---|---|---|---|
| one process | 5.89/12.42/74.02 → 6.48/15.05/24.55 | +21.2 % | +42.8 % | 1838 → 5848 |
| separated | 5.64/10.61/25.19 → 7.07/16.73/26.54 | +57.7 % | +59.3 % | 1721 → 1929 |

The `before-1` baseline arm contains a 55 ms p95 outlier, which lowers the pooled
one-process Δp95. The separation did what it should for the crypto API process:
- its CPU stays at the baseline (+12 % instead of +218 %);
- its event-loop utilization stays at 0.05 (0.20 in one process).

The crypto p95 still rose:
- server-side crypto p95 rose from about 9 ms to 15 ms;
- the client-minus-server gap stayed at 1.6 → 2.1 ms.

Per window (mean, mixed arm), CPU in ms:

| Crypto API | Authority | Gateway | Driver | PostgreSQL |
|---|---|---|---|---|
| 1929 | 2280 | 2634 | 1878 | 675 |

That is about 9.4 s of CPU per 20 s on the shared 2-vCPU taskset.

The delay is no longer in the crypto API's own CPU or event loop. Two shared
resources remain:
- the two vCPUs, on which the crypto request path wakes the driver, the API and
  a PostgreSQL backend;
- the one PostgreSQL server, which also receives the Stocks commits and session reads.

### Round 2 (separated + Stocks CPU weight): run 40514272799 on `b6ea7d97`

Collection COMPLETE 8/8; both pins `DIAGNOSTIC_P95_FAIL`; errors 0; financial
invariants 0.

| Pin | Crypto p50/p95/p99 baseline → mixed (ms) | Pooled Δp95 | Median run Δp95 | Δp99 | Crypto API CPU base → mixed (ms) |
|---|---|---|---|---|---|
| one process | 7.92/11.61/15.28 → 8.49/17.66/26.45 | +52.1 % | +54.1 % | +73.0 % | 2257 → 6663 |
| separated, nice 10 | 7.83/11.38/19.02 → 8.38/14.55/20.73 | +27.8 % | +25.1 % | +8.9 % | 2184 → 2243 |

The separated layout with the lower CPU weight halves the inflation, but the
gate stays failed.

| Metric (separated) | Baseline | Mixed |
|---|---|---|
| Crypto API event-loop utilization | 0.047 | 0.054 |
| Crypto API loop delay p99 (ms) | — | 11.7 |
| Server-side crypto p95 (ms) | 10.00 | 13.28 |
| Client−server gap p95 (ms) | 1.52 | 1.55 |

Mixed arm, per process:

| Process | CPU per window (ms) | Max RSS (MB) |
|---|---|---|
| Crypto API | 2243 | 203 |
| Stocks authority | 2252 | 163 |
| Stocks gateway | 2551 | 121 |
| Driver | 1780 | — |
| PostgreSQL | 690 | — |

Viewer `/state` p95 is 7.16 ms and trader p95 is 31.9 ms.

**Remaining bottleneck.** The extra time is spent inside the server's request
handling. It does not come from the crypto API's own CPU (+2.7 %) or event loop,
and not from the client (the gap is unchanged). Two causes:

1. **One physical core.** `report.cpu` shows that the taskset's two vCPUs are the
   two SMT threads of one physical core (`thread_siblings_list` `0-1`, AMD EPYC
   7763). Whenever the Stocks processes, the driver's viewer load or PostgreSQL
   run on the sibling thread, the crypto path runs slower. A CPU weight orders the
   run queue; it cannot stop the sibling thread.
2. **Shared PostgreSQL rows.** Trader 0 is also the crypto user. The Stocks
   commands lock the same `User`/`DemoBalance` rows and commit with fsync.
   - Only 13 % of crypto requests overlap trader requests.
   - Yet 8 of the 17 slowest crypto requests (≥ p95) in each of `after-1` and `after-2` overlap them.

Within the stated limits (same budget, unchanged workload), no further deployable
step removes these two shared resources. Separate physical cores, or a separate
database or host for Stocks, would be a resource or topology decision for the owner.

### Round 3 (P1 runtime `e92cbd8a`): run 40731206335 on `5e06c6f8`

[Run 40731206335](https://github.com/nazardzuba79-tech/-/actions/runs/40731206335): same plan, thresholds,
taskset, ABBA order and PAIRS=4; only the runtime moved to the P1 identity multiplexing (section below).
Collection COMPLETE 8/8 (1440 requests per run, 0 errors, 0 timeouts, no order loss or double spend).
Artifact SHA-256 `aa5a1c50b0b2b69f5be0e8fd7afe19b167a0a4a5ab6abd23e4853567f01f7538`.

| Pin | Crypto p95 baseline → mixed, pooled (ms) | Pooled Δp95 | Median run Δp95 | Per-run Δp95 | Verdict |
|---|---|---|---|---|---|
| one process | 13.19 → 11.78 | −10.7 % | −19.4 % | −25.6, −22.2, −16.7, +31.7 % | DIAGNOSTIC_P95_PASS |
| separated, nice 10 | 10.87 → 11.80 | +8.6 % | +6.4 % | −12.9, −5.2, +17.9, +69.4 % | DIAGNOSTIC_P95_FAIL |

Against round 2 (one process +52.1 %, separated +27.8 % pooled): the systematic part of the regression
is gone. Separated, the crypto API's own CPU is unchanged (1,679 → 1,720 ms per window); the Stocks
processes use 960 ms (authority) and 1,360 ms (gateway) per 20 s window, the driver 1,450 ms. Crypto p50
does not move (5.9 ms in both arms). What remains is the p95 tail, and the method's own spread is of
the same size: the baseline arm alone (no Stocks load) ranges 10.0–15.7 ms p95 across the eight runs,
and the one-process pin comes out *faster* under load in three of four runs. In the two failing separated
runs the slowest crypto operation is `place-limit` (p95 56 and 18 ms against 15 and 10 ms in their
baselines): the commit that writes the order with fsync, on the `DemoBalance` of trader 0, who is also
a Stocks trader (cause 2 above). Under the agreed rule the release layout is still **FAIL** at +8.6 %.
The next push replicates the measurement unchanged on the same runtime.

**Replicate, same runtime and method:** [run 40735098249](https://github.com/nazardzuba79-tech/-/actions/runs/40735098249)
on `fcc0c3c2` (artifact SHA-256 `ea3bd143…`), COMPLETE 8/8. Separated +22.9 % pooled, +22.4 % median, every
run over the line (+10.7, +21.2, +23.7, +26.6 %); one process −3.5 % pooled, +8.7 % median (its first baseline
arm had a 45 ms p95 outlier). Across the eight separated runs of rounds 3 and 3b the median is about +19 %:
the separated layout has a real regression, not noise. Per operation (pooled over the four runs) every crypto
operation slows at p90, reads included: `balances` 4.32 → 5.18 ms, `open` 4.41 → 5.57 ms, `place-limit`
9.97 → 12.18 ms, `cancel` 9.07 → 10.69 ms. The added time is server-side (server p95 8.4 → 10.3 ms; the
client−server gap is unchanged) while the crypto API's own CPU and event-loop use do not change. Reads hold no
`DemoBalance` lock, so the trader-0 row lock cannot be the main cause; waiting for a CPU or for PostgreSQL can.

### Method changes of 28.10 (owner request) and the profiling that decides the cause

- **Normal load within the limits.** The harness's trader made 7 private requests every 4 s (state, limit,
  cancel, buy, replay, sell, replay): 210 a minute for two traders before the viewers' identity batches, about
  300 against the reviewed 240/min ceiling. A trader now reads its state every 4 s and runs that order cycle
  every 8 s (`driver.cjs` `PLAN.traderOrderEvery`). The separated topology's authority sits behind the real
  private ingress (240/min), so a run over the quota fails instead of passing unseen.
- **Over the limit, on purpose and apart:** `identity-load.pg.test.cjs` 'over the private quota' drives both
  traders far over the quota with the 50 viewers polling. Local: 429 from about 24 s, only 200 / 429 / the
  market-data `QUOTE_STALE` anywhere, no order or receipt for a refused intent, every accepted market order
  filled once, limits cancelled exactly when the cancel was accepted, nothing for viewers, service back about
  33 s later, and a forged or signed-out token still refused.
- **Repeats and statistics:** PAIRS 8 (was 4); the summary adds per-run spread, a run bootstrap of the pooled
  Δp95 and an A/A reference (baseline arms of odd vs even runs). The verdict and the +5 % line are unchanged.
- **Profiling:** every run records each process's time runnable but waiting for a CPU (`sched.cjs`,
  `/proc/<pid>/task/*/schedstat`), PostgreSQL backends included. A `pg-profile` job logs every lock wait
  over 1 ms with its holder process, statements over 2 ms, checkpoints, autovacuum and WAL sync time, with each
  process's connections named; `pg-profile-613.cjs` compares the slowest 5 % of crypto requests with all of
  them. A `driver-placement` job runs the separated pin with the load driver on the server's two vCPUs and on
  two other CPUs, interleaved on the same runner: in production the 50 viewers' clients are their own devices.

## Gateway → authority identity checks (P1, resolved)

Before: the gateway called `GET identity` on the authority for every gateway request, and a
trader's command path called it once more (`authorize()`) before each command. 50 viewers at one
request per second need about 3,000 private requests per minute against the private ingress quota
of 120–240 per minute. The 50+2 harness mounts the router without the ingress, so it never saw this.

Now, with the quota, Host, path/method, capability, connection and timeout limits unchanged:

1. **No duplicate re-identity before a command (PostgreSQL authority only).** The PostgreSQL
   authority re-reads the session (`revokedAt`, binding, expiry), the user block (`blockedAt`) and
   the trade principals inside every command's own transaction, so `authorize()` right before a
   command only repeated that. `server.mjs` keeps it for the local SQLite worker, which cannot.
   `/portfolio` keeps its post-read re-check. Since R5 (29.10, below) a trader's request whose bearer
   the authority has already confirmed takes no separate request-start check: its own command is the
   live judgement, and a request without one is checked live before it is answered. Viewers keep the
   request-start check on every request.
2. **Identity checks travel together (multiplexing, not caching).** `authority-adapter.mjs` puts
   the bearers of concurrent gateway requests into one `POST identities` (at most 64 bearers,
   60 KiB). The authority (`stocksTestCash.ts`) runs the very same `requireAuth` live session read
   and `actor` binding as `GET identity` for each bearer, one after another, and answers each by
   position. Rules:
   - a request only joins a batch that has not been sent yet, so its bearer is checked after the
     request arrived; no answer is reused by another batch or request;
   - the same bearer twice in one unsent batch is checked once and answers both;
   - a token bucket sized from the private quota Q that every private response announces
     (`RateLimit-Limit`, 120..240): Q/160 batches per second and bursts of 3Q/8. Identity requests
     take at most 3/4 of Q in any minute (180 of 240, 90 of 120); commands keep at least a quarter.
     The burst lets a quiet gateway answer a run of sequential requests at once; under load the rate
     holds (64 bearers per batch: 96 requests per second at the default quota);
   - answers are handed back with the spacing in which their requests arrived: each request of a
     batch waits as long as the oldest one, so the work behind the answers keeps the arrival pattern
     instead of starting together (a released burst queues the crypto requests on the same CPUs);
   - every request keeps its own 3 s deadline and cancellation; a missing, short, malformed or
     foreign-issuer answer fails closed (`AUTH_REQUIRED` / `AUTH_UNAVAILABLE`); `close()` aborts
     batches in flight;
   - the batch carries the gateway capability only, never a user `Authorization` header; the
     private ingress allows it only as `POST`, and the public listener refuses it like the others.

Cost: under sustained load every request waits about one batch interval (≈0.7 s at the default
quota); a quiet gateway answers at once.

The first version (`386f7fc8`) used a fixed burst of 2. The 50+2 diagnostic on it
([run 40719580431](https://github.com/nazardzuba79-tech/-/actions/runs/40719580431)) collected 0/8:
the harness's sequential warm-up of 50 viewers then took about 25 s instead of 0.3 s, the 12 s
market-data demand leases lapsed before the measured arm, and the first reads of the Binance
stream instruments answered `QUOTE_UNAVAILABLE` / `QUOTE_STALE`, which the driver treats as a
failure. Reproduced locally on the same schedule (errors on exactly the same viewers). The next
version (`78e78d64`, burst Q/4 at Q/120 per second, answers released together) ran in
[run 40726294118](https://github.com/nazardzuba79-tech/-/actions/runs/40726294118): the single-process
pin collected 4/4 but crypto p95 rose +187 % (the slowest crypto requests sat exactly at the batch
releases, every 500 ms), and the separated pin still stopped on the same first reads because its
warm-up needs 86 identity checks. Hence the current shape: a 3Q/8 burst covers that warm-up, and the
arrival-spaced release keeps the load as even as the requests themselves (local: warm-up 0.8-1 s,
0 errors, completions spread evenly over each second, viewer p50/p95 0.70/0.71 s).
On this runtime the 50+2 run collected 8/8 (round 3 above).

**Release-chain regression of the harness schedule.** `identity-load.pg.test.cjs` also runs the harness's
warm-up (each trader until its quote is ready, then one read per viewer), the 5 s pause and the 20 s
measured window of `driver.cjs` (50 viewers every second from 0, 20, 40 … ms, the deny-order at the first
cycle, traders from 500 and 2,500 ms every 4 s) against the compiled authority behind the real private
ingress (default 240/min) and the release gateway with the synthetic Binance stream market in its own
process (`synthetic-release-gateway.mjs --stream-market`). It requires every job to finish with no
unexpected error, timeout or late start, no 429, the exact orders, and nothing for viewers. On `78e78d64`
it fails exactly as run 40726294118 (warm-up 12 s; viewers 10, 12, 13, 14, 16 `QUOTE_UNAVAILABLE`,
both traders `QUOTE_STALE`); on `e92cbd8a` it passes (3 of 3 local runs: warm-up 4.9 s, 1,010 jobs,
0 errors, job p50/p95 0.70/0.72 s, 208 private requests in the first quota window).

**Was a known limit until R5: the harness's trader cadence did not fit the private quota.** The
harness's trader job (state, then limit, cancel, buy, replay, sell, replay every 4 s) is 7 private
commands per trader every 4 s. Run at that cadence through the real ingress on `e92cbd8a`…`ed31f4e8`,
both traders got 429 `AUTH_RATE_LIMIT` at their fifth cycle (warm-up 123 + measured 119 private requests
in one 60 s window), because every trader request also took its own identity check: the warm-up's
sequential trader reads alone spent about 36 identity batches. The 8 s cycle was a workaround for that;
since R5 it is only a separately labelled diagnostic. See "R5" below for what changed and what remains.

That a just-demanded Binance stream instrument answers its very first read with `QUOTE_UNAVAILABLE`
(and the next poll succeeds) is existing market-data behaviour, also on the old code; it is left
unchanged here.

### Evidence (local, disposable PostgreSQL 16, Node 22.23.3, compiled `dist/`)

`services/stocks-global/identity-load.pg.test.cjs`: the compiled authority process with the default
quota 240/min and the release gateway (`testing/synthetic-release-gateway.mjs`: the release entrypoint
with a synthetic market, so the traders' commands run offline), 50 synthetic viewers every 1 s and the
2 synthetic traders every 4 s for 61 s. `testing/count-requests.cjs` records what the private listener
served; PostgreSQL counts the `Session` scans.

| Code | Gateway requests | 200 | 429 | Private requests | Busiest minute | Session reads | Viewer p50 / p95 |
|---|---|---|---|---|---|---|---|
| before (`8f0e1f63`) | 3,082 | 285 | 2,797 | 3,096 (3,088 `GET identity`) | 3,047 | 345 | 3 / 6 ms (refused) |
| after (burst 2, `386f7fc8`) | 3,082 | 3,082 | 0 | 158 (124 `POST identities` + 34 commands) | 154 of 240 | 3,131 | 286 / 506 ms |
| after (3Q/8 burst, Q/160 per second, arrival-spaced release) | 3,082 | 3,082 | 0 | 216 (182 `POST identities` + 34 commands) | 212 of 240 (identity 180) | 3,147 | 693 / 708 ms |

On the same running processes right after the load, each change is refused on the very next request:
forged, expired, 2FA-purpose and cross-session tokens; a signed-out device; a blocked contact address
(read live, no revoke needed); the previous account after an account switch (the switched view is the
market-only shape, nothing of the trader); an admin-blocked trader (`User.blockedAt`, refused by the
PostgreSQL authority). No cash, account, receipt or audit row changed.

Unit and route tests: `identity-batch.test.mjs` (batching rules above), `authority-adapter.test.mjs`,
`authority-rate-limit.test.mjs`, `src/api/routes/__tests__/stocksTestCash.test.ts` (capability and
shape before any session read, per-bearer live decisions, same admit/refuse as `GET identity`),
`src/api/middleware/__tests__/stocksAuthorityIngress.test.ts`, `src/__tests__/stocksAuthority.test.ts`.

An admin block (`User.blockedAt`) still does not end a viewer's market-only access: `requireAuth`
does not read it anywhere in the platform (existing sessions expire naturally, see
`src/api/routes/adminUsers.ts`). The contact-address block revokes and refuses at once.

## R5 (29.10): the original 4 s load inside the 240/min quota, and the per-poll gateway overhead

Owner instruction of 29.10: keep the original 50 viewers + 2 traders with the 4 s order cycle as the
acceptance test (the 8 s cycle only as a separately labelled diagnostic), do not raise the 240/min
private limit, remove unnecessary calls and overhead, and fix the runtime cause rather than the test.

**Where the private requests went.** At the 4 s cycle the two traders' commands are 210 a minute
(70 in the 20 s measured window). Every trader request additionally waited for, and was counted in,
an identity batch, although the PostgreSQL authority judges the very same bearer again inside the
command's own transaction (session row, user block, binding, expiry, trade policy) and binds the
command to that bearer's own account. That separate check was the unnecessary call.

**Runtime change (`c67b3fc9`).**

1. *A trader's command is its identity judgement.* After the authority has confirmed a bearer live
   for a principal the gateway lets trade, the adapter remembers which principal that bearer belongs
   to (at most 16 bearers, 60 s, refreshed only by live answers). The bearer's next request starts
   without a separate check and is *unconfirmed*: the command answer now names the actor the authority
   bound (`stocksTestCash.ts`), and the adapter accepts the request only when that actor is the
   expected principal. A request that runs no command, or whose command failed, is checked live before
   the gateway answers it (`server.mjs` `confirm()` before every answer, error answers included).
   Nothing is granted from memory: the remembered bearer only says which principal to expect. A bearer
   refused anywhere is forgotten at once, so the next request goes through the live check. Viewers'
   bearers are never remembered (their requests run no command), so every viewer request is checked
   exactly as before. An unconfirmed request changes nothing the principal's other sessions share
   (review 6489779311: two sessions of one trader share the demand): a read of the instrument and view
   already demanded runs its observation first and renews the lease only after that command confirmed
   it; any other read (another instrument or view, a lapsed lease), a refresh, a lease release and the
   first account binding are checked live first; a failed observation is confirmed live before it is
   recorded in the shared demand. What a signed-out trader's very next request can still do before its
   401 is one market quote read (shared, cached) for the instrument already demanded; it never reaches
   an account, a financial write, the shared demand or an answer. `trader-bearer.test.mjs` reproduces the
   review's two-session case (RED on the previous gateway, GREEN now).
2. *Identity budget sized for the commands too.* The token bucket keeps Q/160 batches per second; its
   burst is Q/4 (was 3Q/8, sized for the 86 warm-up checks that traders no longer need), and a batch
   never takes the last minute's private requests (commands counted; the gateway is the ingress's only
   client) past Q − Q/16 (225 of 240). A check that cannot be sent before its 3 s deadline gets 429
   with `Retry-After` at once, as the ingress would answer, instead of 503 at its deadline. One
   deadline timer for all waiting checks and one release timer per batch replace one of each per
   request.
3. *Per-poll overhead.* Profiled locally under the 4 s load, the gateway's own work for a viewer poll
   included a `structuredClone` of the market-only view (~0.1 ms), a `process.memoryUsage.rss()` and
   `process.cpuUsage()` system call pair, and three or four SHA-256 derivations of the same account
   id. The empty-viewer projection now copies plain data without the serializer (identical output and
   key order, tested against `snapshot()`), the process figures in state answers are read at most
   once a second, and account ids are derived once per (issuer, subject).

**Release-chain regression, original 4 s cycle** (`identity-load.pg.test.cjs`, compiled authority
behind the real private ingress at 240/min, release gateway with the synthetic stream market, the
harness's warm-up, 5 s pause and 20 s measured window; local disposable PostgreSQL 16, Node 22.23.3):

| Run | Jobs | Errors | Missed | 429 | Commands (measured) | Identity batches (warm-up + measured) | Busiest minute incl. warm-up | Job p50 / p95 |
|---|---|---|---|---|---|---|---|---|
| `ed31f4e8` (before) | 1,010 | 2 traders 429 at cycle 5 | — | yes | — | 86 + … | 242 | — |
| R5, run 1 | 1,010 | 0 | 0 | 0 | 70 (2 × 5 × 7) | 52 + 49 | 210 of 240 | 672 / 689 ms |
| R5, run 2 | 1,010 | 0 | 0 | 0 | 70 | 52 + 49 | 210 | 674 / 689 ms |
| R5, run 3 | 1,010 | 0 | 0 | 0 | 70 | 52 + 49 | 210 | 671 / 687 ms |

Exactly the intended orders (each LIMIT cancelled, each MARKET filled once despite its replay), no
viewer balance. The full-minute load test (traders reading state every 4 s) and the over-quota test
pass on the same code; in the over-quota test viewers now get 200 or an immediate 429 (no 503), and
each command the quota refused was one trader request answered 429 (no command sent again).

**What R5 does not change: a sustained full minute of the 4 s cycle.** Two traders cycling every 4 s
for a whole minute make 210 commands a minute; under the 225 ceiling that leaves about 15 identity
batches a minute for 50 viewers polling every second, so after the first minute of continuous trading
most viewer polls would wait for a batch or be refused with 429. The 50+2 acceptance runs (20 s measured windows, fresh
processes per arm) fit with room to spare (busiest minute 210); a pilot that trades at that cadence
continuously needs an owner decision (a higher reviewed ceiling, slower viewer polling, or fewer
commands per cycle). Not changed here.

**Local CPU smoke (4-vCPU dev container under `taskset -c 0,1`; one run each, not a p95 verdict).**
Per 20 s mixed window: on `ed31f4e8` the 4 s cycle failed (trader 1 got 429 on a replay; the
invariant check flagged it); on R5 it completed with 0 errors and all 30 orders. Gateway CPU about
2.5–2.9 s and authority 1.2–1.4 s per window on R5 at the 4 s cycle (2.7 s and 0.7–0.8 s at the 8 s
cycle); run-to-run spread on this container is about ±10 %, so the overhead cuts are not separable
from noise locally. The p95 verdict comes only from the CI 50+2 jobs on the 2-vCPU runner.


## R6 (29.10): the 4 s acceptance result, its cause, and the gateway's scheduling class

**Acceptance run, original 4 s cycle** ([run 40831978973](https://github.com/nazardzuba79-tech/-/actions/runs/40831978973),
job "original 4 s order cycle", head `89ff321a`, runtime `8f73e373` = R5 with review 6489779311). GitHub-hosted runner,
every process inside `taskset -c 0,1` (the two SMT threads of one AMD EPYC 7763 core), PAIRS 8, ABBA order.
Collection COMPLETE 16/16; artifact SHA-256 `7168b29aa0282fa41e87effc885aae29e655937bce43b2c1dafe5b517bcd7512`.

| Pin | Crypto p50/p95/p99 baseline → mixed (ms) | Pooled Δp95 | Median run Δp95 | Per-run Δp95 | Verdict |
|---|---|---|---|---|---|
| one process | 7.48/11.45/17.87 → 7.44/15.73/26.83 | +37.43 % | +37.03 % | +18.8 … +42.5 % | FAIL |
| separated, nice 10 | 7.36/11.45/16.01 → 7.50/14.45/22.66 | +26.26 % | +26.76 % | +13.7 … +39.7 % | FAIL |

Bootstrap 95 % interval of the pooled separated Δp95: 20.0 … 30.4 %. A/A reference (baseline arms, odd vs even
runs): −1.9 %. The +5 % line is not met.

Completeness, every separated run: 1,440 driver requests in the mixed window (320 in the baseline), 0 errors,
0 timeouts, 0 missed jobs, 0 order loss / double spend / viewer balance changes. Private requests to the
authority in the 20 s measured window: 118 (70 commands + 48 identity batches covering about 1,026 bearer checks),
0 failures; the busiest minute including the warm-up was 210 of 240 (gateway ceiling 225); no 429.

Mixed arm, separated, mean per 20 s window:

| | Crypto API | Authority | Gateway | Driver | PostgreSQL |
|---|---|---|---|---|---|
| CPU, baseline → mixed (ms) | 2,063 → 2,121 | 51 → 791 | 184 → 1,466 | 430 → 1,731 | 298 → 493 |
| Runnable but waiting for a CPU (ms) | 842 → 1,287 | 84 → 755 | 150 → 553 | 119 → 630 | 60 → 209 |
| Max RSS (MB) | 205 | 146 | 118 | — | — |

Crypto API event-loop utilization 0.045 → 0.050; server-side crypto p95 9.99 → 12.93 ms; client−server gap
1.52 → 1.77 ms.

Same run, other jobs (report only):
- revised 8 s cycle (labelled diagnostic, **not** the acceptance load): separated +21.35 %, one process
  +19.46 %; authority CPU 441 ms, gateway 1,438 ms per window;
- driver placement: driver on two other CPUs +24.18 %, together +27.15 % — the clients' CPU is not the cause;
- PostgreSQL profile: 2 crypto lock waits on Stocks per run (4.2 and 6.6 ms in total); PostgreSQL accounts for
  3.8 % and 5.2 % of the slowest crypto requests' time.

**Cause.** The crypto API does no Stocks work any more (its CPU and event loop stay at the baseline), the clients
and the PostgreSQL locks are ruled out, and every process on the two vCPUs waits longer for a CPU. What remains is
the Stocks processes' own CPU on the crypto API's core: the gateway's 50 viewer polls a second (1.47 s per 20 s,
unchanged between the 4 s and 8 s cycles) and the authority's commands and identity batches (0.79 s at 4 s, 0.44 s
at 8 s). The crypto request path wakes the API, a PostgreSQL backend and the API again several times per request;
each wakeup that finds both vCPUs busy with a Stocks process waits, and a nice-10 task that has just been picked
keeps its time slice before the waking crypto task gets the CPU.

**Runtime change R6 (removed in R7).** The gateway ran in the idle scheduling class: a waking crypto API or
PostgreSQL task preempts it at once, and it runs whenever the crypto side does not need the CPU. The authority
stayed in the normal class at nice 10. Locally (4-vCPU container, `taskset -c 0,1`, single runs) the idle
class on the authority too produced a run whose crypto writes waited up to 886 ms (`place-limit` p95 756 ms,
`cancel` p95 523 ms, reads unaffected) while trader commands slowed alike: the idle-class authority held trader 0's
rows and was starved. That variant is rejected.

Local A/B on this container (single runs, not a verdict; its baseline p95 is about 22 ms and runs vary by ±15 %):
nice 10 +14.9, +16.4, +3.1 %; gateway idle +18.6, +1.2, +15.6, +19.8 %. The container has no SMT pair and a newer
kernel than the runner, so the verdict comes only from the CI runner. The diagnostic workflow's
`stocks-placement` job (replacing the answered driver-placement job) runs on one runner, interleaved: `nice` (the
release control before R6), `idle` (the R6 pin), `apart` (both Stocks processes on CPUs 2,3) and `alone` (Stocks
and the driver on 2,3, only the crypto API and PostgreSQL on 0,1). `apart` and `alone` use CPUs outside the budget:
they attribute the regression (Stocks CPU on the crypto core, the driver, or the shared PostgreSQL) and are never a
verdict. One local `apart` run still showed +24.5 %, which this container's noise cannot separate. The acceptance
job measures the R6 pin against the unchanged +5 % line.

**Review 6490492921 (residual race).** `refreshContext` checked the request's abort and the demand epoch before an
unconfirmed request's live identity check, then recorded the failed observation (errors, readiness,
`observeFailed`) after it without checking again. A sibling session that moved the shared demand while the check
waited would have had a stale failure recorded against its new demand. The live check now ends only with the
request itself (not with a sibling's demand change, which made the valid request fail with 503), and the abort and
epoch are judged again after it, before anything shared is recorded. `trader-bearer.test.mjs` holds the first
session's identity batch, lets the sibling move the demand, then releases it: RED before (the stale failure was
recorded), GREEN now.

### R6 result ([run 40838996816](https://github.com/nazardzuba79-tech/-/actions/runs/40838996816), head `182cfc37`, runtime `d6da2c84`)

All 49 exact-head checks green or skipped. Acceptance, original 4 s cycle, PAIRS 8, `taskset -c 0,1`
(artifact SHA-256 `8b356fe37879268e12fade42f03f2ff7cf839003cea2bd79dfc403e7dc441467`, collection COMPLETE 16/16):

| Pin | Crypto p50/p95/p99 baseline → mixed (ms) | Pooled Δp95 | Median run Δp95 | Verdict |
|---|---|---|---|---|
| one process | 5.41/10.15/23.17 → 5.56/13.33/24.08 | +31.35 % | +32.60 % | FAIL |
| separated, gateway idle class | 5.24/9.56/17.58 → 5.54/12.51/19.40 | +30.84 % | +32.84 % | FAIL |

Separated per run: +9.7, +33.7, +52.0, +34.9, +21.1, +32.0, +34.8, +31.2 % (coordinator's bootstrap 95 %:
24.3–39.1 %). Every run: 1,440 requests, no error, timeout, missed job, order loss, double spend or viewer change;
118 private requests per measured window (70 commands, 48 identity batches), busiest minute 210/240. CPU per window:
API 1,582 → 1,707 ms, authority 44 → 587, gateway 127 → 1,291, driver 369 → 1,551, PostgreSQL 226 → 380. Revised 8 s
(diagnostic only): separated +33.95 %, one process +17.75 %.

`stocks-placement` (same runner, 3 runs per kind, report only):

| Kind | Besides the crypto API and PostgreSQL on its 2 vCPUs | Mixed crypto p95 per run (ms) | API CPU wait growth (ms) |
|---|---|---|---|
| nice | Stocks (normal class) + driver | 12.57, 26.69, 20.41 | +417 |
| idle | Stocks (gateway idle) + driver | 16.47, 12.84, 13.15 | +251 |
| apart | driver only | 33.60, 13.09, 11.81 | +139 |
| alone | nothing | 12.06, 10.78, 10.94 | +26 |

The baselines of this job include outlier arms (27.7, 32.5 and 25.1 ms pooled for `alone`), so its pooled
percentages are not meaningful, and three runs per kind neither validate the idle class nor rule out other causes
(coordinator review 6492054481). What it shows: with nothing else on the crypto API's core the crypto p95 and the
API's CPU wait stay at the baseline. It does not establish a floor for the regression.

### R7 (29.10): viewer serializer prototype — equivalence holds, saving unsupported

Coordinator review 6494242460 asked for a bounded, viewer-only serializer prototype instead of another benchmark:
cache only immutable public fragments, recompute every dynamic or private field, keep the live identity check and
`no-store`, leave traders unchanged, prove response equivalence, and measure absolute CPU and cache memory.

- *Prototype* (local commit `4e89ddd6`, not published): the viewer answer's only immutable public fragment is the
  catalogue (replaced as a whole on a reload, never changed in place). Its JSON is kept for the current catalogue
  array (one entry, 12,542 bytes) and spliced in at its own key position. Every other field (time, quote status and
  age, FX, errors, readiness, metrics, account, token) is serialized per answer.
- *Equivalence*: every viewer answer in `viewer-serializer.test.mjs` is compared with `JSON.stringify` of the same
  body when it is sent — two viewers, two instruments, a revoked session (401, nothing serialized), a quote
  expiring without a tick (`QUOTE_STALE`), an FX rate expiring (`USDC: FX_STALE`, `USDT: READY`), and the catalogue
  included, left out and replaced by a reload. 5/5; a stale-cache mutation turns the reload case RED. Stocks node
  unit 403/403.
- *CPU* (`scripts/qa/stocks-viewer-serializer-bench.mjs 10`, the distribution of `driver.cjs`'s measured mixed
  window: viewers run only there, and every window starts with fresh held catalogue versions, so each of the 50
  viewers (two instruments) gets the catalogue on its first of 20 polls at 1 s — 50 answers with the catalogue and
  950 without per window. The gateway runs in its own child process per round and the parent drives the requests;
  10 rounds per serializer, order alternating; local CPUs 2–3, Node 22.23.3, synthetic data, loopback, no database):

  | Per window, mean of 10 rounds (range) | Unchanged (`JSON.stringify`) | Prototype |
  |---|---|---|
  | Gateway process CPU (user + system) | 389.4 ms (335.5–448.2) | 398.1 ms (340.2–458.4) |
  | Gateway wall time | 383.9 ms | 377.6 ms |
  | Serializer, 50 answers with the catalogue | 5.08 ms | 0.90 ms |
  | Serializer, 950 answers without it | 14.41 ms | 14.17 ms |
  | Serializer total | 19.49 ms | 15.08 ms |
  | Retained cache | 0 | 12,542 bytes (one entry) |

  Raw per-round totals (ms; serializer = with catalogue + without):

  | Round | Order | Unchanged CPU / wall | Unchanged serializer | Prototype CPU / wall | Prototype serializer |
  |---|---|---|---|---|---|
  | 1 | U, P | 404.8 / 469.9 | 24.63 (9.92 + 14.71) | 384.1 / 402.4 | 16.29 (0.98 + 15.30) |
  | 2 | P, U | 353.8 / 392.2 | 16.17 (3.87 + 12.30) | 447.2 / 471.0 | 17.31 (0.90 + 16.41) |
  | 3 | U, P | 430.7 / 428.7 | 24.65 (4.91 + 19.74) | 350.4 / 335.2 | 11.69 (0.86 + 10.83) |
  | 4 | P, U | 335.5 / 322.3 | 15.29 (3.14 + 12.15) | 340.2 / 328.3 | 12.68 (0.80 + 11.88) |
  | 5 | U, P | 448.2 / 418.6 | 19.79 (3.98 + 15.81) | 438.6 / 388.0 | 16.55 (0.95 + 15.60) |
  | 6 | P, U | 383.9 / 358.7 | 18.61 (4.23 + 14.38) | 370.0 / 342.7 | 16.20 (0.84 + 15.36) |
  | 7 | U, P | 412.0 / 382.0 | 20.01 (5.85 + 14.16) | 414.3 / 377.7 | 16.15 (0.93 + 15.22) |
  | 8 | P, U | 372.6 / 360.1 | 19.90 (7.29 + 12.61) | 382.5 / 359.8 | 14.22 (1.01 + 13.21) |
  | 9 | U, P | 379.1 / 360.0 | 16.81 (3.27 + 13.54) | 458.4 / 408.8 | 15.27 (0.99 + 14.28) |
  | 10 | P, U | 373.3 / 346.7 | 19.04 (4.39 + 14.65) | 395.0 / 362.1 | 14.39 (0.80 + 13.59) |

  Paired by round (prototype minus unchanged): serializer −4.42 ms on average, lower in 9 of 10 rounds; gateway
  process CPU +8.7 ms on average (−80.3 to +93.5), lower in 4 of 10; wall time −6.3 ms, lower in 6 of 10. Response
  bytes per window (2,078,750–2,080,750) vary by round in both arms through time-dependent fields.

  The serializer saving, about 4.4 ms per window and almost all of it on the 50 catalogue answers, is an order of
  magnitude smaller than the round-to-round spread of the gateway's process CPU and does not show in it; against the
  gateway CPU of the CI windows (1.29–1.47 s) it would be about 0.3 %. Saving unsupported: the prototype is not
  proposed for publication, and the stop condition of review 6494242460 stands. This local microbenchmark establishes
  neither effectiveness nor a release improvement.

  Correction (review 6495231915): an earlier version of these figures, posted on the PR, assumed no measured-window
  viewer answer carries the catalogue. That was wrong for `driver.cjs`, whose held catalogue versions are fresh in
  every window; the figures above use its 50 / 950 distribution. The earlier estimate of about 17 % (review reply
  6492099577) came from a profile taken before R5 removed `structuredClone` and the per-answer process figures; it
  does not hold for the current runtime and stays withdrawn, as does the +20 % floor.

## R8 (29.10): isolated-client methodology, sustained load and the private quota

Owner request of 29.10: until R7 every 50+2 run put the server and the load generator on the same two vCPUs
(`taskset -c 0,1` for every process, the driver included; section "Resources"). Prepare a realistic method in which
the server side gets exactly 2 vCPUs and the 50 viewers' and 2 traders' clients load it without using that budget;
keep the original scenario (4 s order cycle, the same operations, 240/min private quota, crypto p95 ≤ +5 %); check
whether such isolation is available without paid resources and do not claim independence that is not there; verify
the tooling, including sustained load and rate limiting; leave the serializer prototype out; remove the unvalidated
SCHED_IDLE setting only after checking its diff; no full benchmark before the method is shown to be correct.

### What isolation is available without paid resources

| Option | Available? | Why |
|---|---|---|
| GitHub-hosted standard runner `ubuntu-24.04` | **yes** | 4 vCPUs = 2 physical cores × 2 SMT threads (AMD EPYC 7763; `thread_siblings_list` 0-1 and 2-3 in every recorded run). The server gets one whole core (CPUs 0,1 = exactly 2 vCPUs), the clients the other (2,3). |
| A separate client machine | no | GitHub-hosted jobs cannot reach one another (no inbound connections); a tunnel or relay would be an external service. |
| An isolated CX23 clone (the original target host) | no | A Hetzner server is a paid resource; not bought. |
| Larger GitHub runners, self-hosted runners | no | Paid, or need hardware that does not exist here. |

So the clients run on **another physical core of the same VM**, not on another machine. Not shared with the server:
the core's execution units and its two hardware threads (no client thread may run there; proven per thread). Still
shared: the L3 cache and memory bandwidth, the kernel, the hypervisor (steal time is recorded for both CPU sets), and
the loopback network stack — on loopback the sender's CPU also does the receiver's TCP work, so the server's CPUs pay
the receive side of their own answers and the clients' CPUs the receive side of the requests. This is reported as
what it is; it is not presented as independent client machines.

### Method (`diagnostic-run-613.cjs --isolated-clients`, `placement.cjs`, `market-worker.cjs`)

- **Server side, exactly CPUs 0,1:** PostgreSQL (`taskset` on `pg_ctl start`, so the postmaster and every backend),
  the crypto API worker (exec'd by `taskset`, so no thread of it ever runs elsewhere) and both Stocks processes
  (forked by the API worker, inheriting its CPUs).
- **Client side, CPUs 2,3:** the load driver (the workflow starts it under `taskset -c 2,3`) and the synthetic
  market. Until R7 the synthetic market (the stand-in for the exchanges' REST and WebSocket endpoints) ran inside the
  gateway process and its CPU was charged to the server; in production the exchanges are not on VOLTEX's host. It now
  runs in `market-worker.cjs` on the client CPUs; the gateway keeps its own market client (hub, stream feed, REST
  fetches), as in production.
- **Admission:** refuses a host without 4 CPUs or `taskset`, a driver that is not on exactly CPUs 2,3, and CPU sets
  that share a physical core (sysfs `thread_siblings_list`) — e.g. a host that numbers SMT siblings 0,2 / 1,3.
- **Placement proof** after the qualification and after every measured window: every thread of every process on both
  sides (PostgreSQL backends and the Stocks processes as descendants) must be allowed exactly its side's CPUs;
  any violation fails the run (`PLACEMENT_PROOF_FAILED_*`).
- **Per-CPU accounting** from `/proc/stat` over each measured window for both sets: user, nice, system, softirq,
  steal, busy and utilisation; memory per server process (VmHWM) and of the PostgreSQL cluster (summed PSS).
- **Client headroom gate:** client set busy ≤ 50 % and driver event-loop utilisation ≤ 0.5 in every window, so a
  saturated client cannot pass for server latency (`CLIENT_HEADROOM_EXCEEDED_*`).
- **Unchanged:** plan (50 viewers at 1 s, 2 traders with the 4 s order cycle and exact replays, 80 crypto cycles,
  5 s warm-up + 20 s measured window), PAIRS 8 in ABBA order, both pins, the +5 % pooled crypto Δp95 verdict,
  the 240/min private ingress, Stocks BUY/SELL off in production. `summarize-613.cjs --methodology isolated-clients`
  additionally requires every proof.
- **A/A calibration before any acceptance run** (`--null-arm`, `calibration-613.cjs`): six runs of the after pin in
  which the second arm carries the baseline load again under the identical procedure. Their pooled Δp95 is the
  method's own error (arm order, fresh processes, warm-up, runner noise). The method counts as calibrated on a runner
  only if all six runs are complete (placement, headroom, cleanup) and |pooled A/A Δp95| ≤ 5 %.
- **Workflow gating:** a push alone runs nothing expensive. The head commit message names what to run
  (`RC50-RUN: methodology | acceptance | sustained | pg-profile`); acceptance and sustained jobs need the calibration
  job of the same workflow run to pass first. The R6 placement job and the 8 s diagnostic matrix entry no longer run
  on every push.
- **Not included:** the R7 viewer serializer prototype (not published, saving unsupported). The gateway's idle
  scheduling class: removed in R7 (`47f5d04d`) after checking its diff — the compose example is byte-identical to the
  pre-R6 `89ff321a`, the after pin no longer sets it, and the runtime source is unchanged.

### Realism notes (reported, not changed)

- The real terminal (`GlobalStocks.tsx`) polls the state every **3 s** (`startVisibleStockPolling(..., 3000)`); the
  agreed 50+2 scenario polls every **1 s**, three times the real viewer load. The scenario is kept as agreed.
- On an overload code with `retryAfterMs` the terminal pauses its reads until then. The acceptance window never sees a
  429; the sustained mode below models that pause.

### Sustained load and the private quota (`--sustained`, `sustained-613.cjs`)

Both arms measure 3 minutes instead of 20 s, otherwise the same plan, after pin, isolated clients. The authority logs
every private request (arrival, route, status) from its start, so the busiest sliding minute includes setup and
warm-up as the ingress's own minute does. Clients answer a 429 as the terminal does: a viewer skips its polls until
`Retry-After`; a trader waits and sends the same request again (same intent id: the authority's idempotency keeps it
exactly-once) and skips the cycles that fall into the wait; a trader order step refused for a stale quote (rolled back
by the authority: no order, no receipt) is sent again after a fresh read. Everything is counted. Gates of this
report-only scenario: the ingress never over 240 in a sliding minute and never answering 429 itself, no crypto error,
no trader request refused, every 429 with `Retry-After`, the financial invariants of both arms.

### R8 calibration result ([run 40880077260](https://github.com/nazardzuba79-tech/-/actions/runs/40880077260), head `36430ce0`, runtime `47f5d04d`)

Runner: 4 vCPUs, AMD EPYC 9V45, `thread_siblings_list` 0-1 and 2-3 (admission passed; earlier runs had EPYC 7763, so
the model is recorded per run). Harness self-tests passed on the runner. Six A/A runs, all complete (placement proven
in every window, client headroom, cleanup); artifact SHA-256 `55db0fd4aafe5fff4503a7995b50925672dd7b2a3f53ea283e603d820493d31a`.

| Run | First arm p95 (ms) | Second arm p95 (ms) | A/A Δp95 |
|---|---|---|---|
| aa-1 | 13.37 | 9.93 | −25.73 % |
| aa-2 | 9.27 | 9.21 | −0.62 % |
| aa-3 | 9.02 | 9.20 | +1.97 % |
| aa-4 | 8.73 | 8.61 | −1.29 % |
| aa-5 | 8.58 | 8.79 | +2.49 % |
| aa-6 | 8.92 | 9.01 | +0.98 % |

Pooled A/A 9.37 → 9.22 ms, **Δp95 −1.63 %** (bootstrap 95 % −6.2 … +1.7 %): **METHOD_CALIBRATED**. Server CPU set
5.0 % busy (baseline load), client set at most 1.4 %, driver event-loop utilisation at most 0.018, steal 0 ms on both
sets, server memory at most 509 MB (API, authority and gateway peak RSS plus the PostgreSQL cluster's PSS). The first
run on the fresh runner had a slow first arm (aa-1); the acceptance job therefore runs one warm-up run of the after pin,
outside the collection and never counted, before its pairs, so the first pair's Δp95 is not biased downwards.

### R8 acceptance result ([run 40883105775](https://github.com/nazardzuba79-tech/-/actions/runs/40883105775), head `f030e953`, runtime `47f5d04d`)

One workflow run, three jobs on three separate VMs (GitHub does not let jobs share a VM): calibration on an Intel
Xeon 6973P-C, acceptance and sustained on AMD EPYC 9V74; every VM 4 vCPUs with `thread_siblings_list` 0-1 / 2-3.
Calibration again **METHOD_CALIBRATED**: six A/A runs complete, pooled 10.60 → 10.42 ms, **Δp95 −1.63 %** (bootstrap
95 % −8.7 … +2.5 %; per run −48.4, −0.6, −0.6, +6.8, +4.4, −1.8 %, the first one cold), recomputed independently from the
artifact (SHA-256 `16a73978…940c`); harness self-tests 35/35. Both pins carry the same runtime `47f5d04d`: *before* =
Stocks inside the crypto API process (single-process), *after* = the separated release layout. One uncounted warm-up
run, then 8 ABBA pairs; collection **COMPLETE 8/8 per pin**, placement proven for every thread in every window
(59–62 threads after, 37–38 before), client headroom held. Artifact SHA-256 `2b6cd294…c5af`.

| Pin | Pooled crypto p95 baseline → mixed | Pooled Δp95 | Median run Δp95 | Bootstrap 95 % of pooled Δp95 | Per-run Δp95 % | Verdict |
|---|---|---|---|---|---|---|
| after (separated) | 9.76 → 11.98 ms | **+22.73 %** | +22.08 % | **+16.4 … +32.9 %** | +14.1, +29.8, +42.9, +22.4, +5.9, +21.8, +6.3, +36.5 | **FAIL** |
| before (single-process) | 10.80 → 11.94 ms | +10.58 % | +12.01 % | −6.0 … +21.0 % | +8.2, +28.8, +10.2, −17.2, +13.9, +17.0, +22.1, −0.8 | FAIL |

The *after* interval lies entirely above +5 % and far outside the A/A error (−1.6 %): with the clients off the server's
CPUs the separated layout still misses the criterion by about four times. Other measured numbers (mixed arm unless
stated; every value from the stored per-run results):

- **Latency:** crypto p50 unchanged (5.71 → 5.72 ms), p99 lower (47.5 → 37.4 ms; the baseline p99 varies 22–117 ms
  between runs); the regression is in the p95 tail. Measured inside the API process
  (server side, no client or loopback time) crypto p95 is 8.96 → 11.02 ms (+23 %): the regression is the server's,
  not the clients'. Viewer state p50/p95/p99 663.6 / 672.2 / 675.4 ms (≈ the gateway's identity-batch interval of 1/1.5 s);
  trader p95 14.7 … 31.7 ms per run.
- **Errors:** 0 errors, 0 timeouts, 0 missed jobs, 0 order loss, 0 double spend, 0 viewer mutations in all 32 arms;
  1 440 requests per mixed arm, 320 per baseline arm.
- **CPU (server set = CPUs 0,1):** busy 5.0 % → 8.9 … 10.9 % in the separated layout (4.7 … 5.3 % → 7.5 … 8.9 % single
  process), steal 0 ms everywhere; client set at most 5.8 %, driver event-loop utilisation at most 0.058. Mean CPU per
  20 s window, baseline → mixed: API 1 679 → 1 731 ms, authority 37 → 615 ms, gateway 111 → 1 177 ms, PostgreSQL
  238 → 383 ms (driver 350 → 1 297 ms on the client set). Single-process API 1 726 → 3 071 ms.
- **Run-queue wait** (schedstat, runnable but not running, mean ms per window, baseline → mixed): API 687 → 881,
  authority 61 → 473, gateway 108 → 313, PostgreSQL 42 → 124.
- **Memory (peak, separated layout):** API 204–205 MB, authority 152–157 MB, gateway 86–119 MB (VmHWM); PostgreSQL
  cluster PSS 52–58 MB; at most ≈ 0.53 GB for the whole server side (sum of the peaks). Single process: API 205–208 MB.

**Cause.** The server set is about 90 % idle, so this is not a throughput limit. The Stocks work added by 50 viewers and
2 traders (≈ 1.8 s of CPU per 20 s: gateway ≈ 1.07 s, authority ≈ 0.58 s, PostgreSQL ≈ 0.15 s) runs on the same
physical core as the crypto API. Whenever a crypto request arrives while a Stocks process holds a hardware thread, it
either waits for a CPU (measured: the API's run-queue wait grows by ≈ 0.2 s per window, the Stocks processes' by
≈ 0.6 s) or runs beside it on the sibling hardware thread and shares the core's execution units (not measured
separately); both lengthen only the requests that collide, which moves p95 and leaves p50. The single-process layout has the same mixed p95
(11.94 vs 11.98 ms); its smaller Δ comes from its slower baseline. The CPU profiles of R6/R7 show no single hot spot
(gateway: HTTP/streams 21 %, Stocks code 19 %, Node internals 15 %, native 10 %, undici 9 %, timers 8 %, GC 4 %, JSON
2 %; authority ≈ 48 % Prisma; profiles of R6/R7, not of this run), and the R7 serializer prototype saved nothing measurable. **No defect with a minimal
fix was found:** the regression is the cost of running the Stocks processes on the crypto API's only physical core.

### R8 sustained result (same run, job `123487564684`, after pin, 3 measured minutes per arm, report only)

Two runs on AMD EPYC 9V74, artifact SHA-256 `740e0cf4…291e`. Every refusal counted (section "Sustained load").

| | sustained-1 | sustained-2 |
|---|---|---|
| Completed | yes (3 min) | **aborted at ≈ 118 s**: one trader request failed twice at the socket (`UND_ERR_SOCKET`) |
| Private requests per window minute (before / m1 / m2 / m3) | 93 / 232 / 228 / 226 | 93 / 232 / 221 / — |
| Busiest sliding minute, all / answered | 243 / 241 of 240 | 243 / 241 of 240 |
| Ingress 429 (all on trader commands) | 6 | 4 |
| Trader requests refused with 429 (each sent again after `Retry-After`) | 8 of 422 | 4 of 266 |
| Viewer polls answered of those scheduled | **49.5 %** (4 438 of 8 967) | **54.0 %** (3 187 of 5 901) |
| Viewer polls refused 429 / deferred for `Retry-After` | 470 / 4 058 | 169 / 2 545 |
| Viewer answered p95 per minute | 2.5–3.0 s | 2.6–3.0 s |
| Connections closed without an answer (viewer poll failing twice) | 33 (first at 60.0 s) | 25 (first at 60.0 s) |
| `503 AUTH_UNAVAILABLE` | 1 | 0 |
| Crypto p95 over the window, baseline → mixed | 8.72 → 10.93 ms (+25.4 %) | 8.39 → 10.73 ms (+27.9 %) |
| Order loss / double spend / viewer mutations | 0 / 0 / 0 | 0 / 0 / 0 |
| 429 without `Retry-After` | 0 | 0 |

**Rate-limit behaviour is correct:** every refusal is a 429 with `Retry-After` (or one `503 AUTH_UNAVAILABLE`), a
trader's refused or quote-stale step sent again with the same intent is executed exactly once, and the financial
invariants hold in both runs. A busiest sliding minute of 241 answered requests is consistent with the ingress's fixed
60 s window (a sliding minute may straddle two windows); the ingress answered 429 twice in each of its own windows.

**Capacity is not sufficient.** In sustained-1, in the 60 s before each ingress 429 the gateway had sent 78–103
identity batches and 137–164 trader commands (241–242 in total). The 2 traders' commands alone take 57–68 % of the
240/min quota; while viewers wait, the identity bucket sends up to 90 batches a minute (Q/160 per second). The gateway's ceiling (225) stops identity batches
but cannot stop commands sent after them, so the commands themselves exceed the 15-request margin: the comment in
`services/stocks-global/authority-adapter.mjs` ("so it never spends the room the traders' commands need") does not
hold under this load. When the ceiling is reached the gateway refuses every waiting viewer that cannot be checked
before its deadline with 429 and a `Retry-After` (1–60 s, until the minute has room), which is why only about half of the scheduled viewer polls are answered and
the answered ones wait 2.5–3 s. The scenario's viewers keep polling every 1 s during that wait, so up to 131 requests
are in flight against the gateway's `maxConnections = 128`; the connections over the limit are closed without an
HTTP answer, and in sustained-2 one trader request hit that twice and the driver stopped the run (counted, not hidden).

Possible remedies (none applied; each changes behaviour that needs the owner's decision): (a) the gateway paces
identity batches by the room the commands actually leave (≈ (225 − commands of the last minute) per minute, larger
batches instead of refusals; batches carry up to 64 viewers) so trader commands are never refused; (b) answer an
over-limit connection with `503` + `Retry-After` instead of closing it, or raise `maxConnections`; (c) poll the
viewers' state at the terminal's real 3 s or push it. The quota stays 240/min and Stocks BUY/SELL stay off.

### R8 remaining blockers

1. **Criterion not met:** crypto p95 +22.73 % (bootstrap +16.4 … +32.9 %) with the server on exactly 2 vCPUs and the
   clients isolated; required ≤ +5 %. Cause above; it does not shrink with isolated clients. Needs an owner decision:
   more server CPU for Stocks (its own core/host — a paid resource) or less Stocks CPU per viewer (cadence or push).
2. **Sustained load at the original 4 s scenario does not fit the 240/min quota:** trader commands refused by the
   ingress, half the viewer polls unanswered, connections closed at 128.
3. The GitHub runner is not the production host (CX23); results are CI_DIAGNOSTIC, not capacity acceptance.

## R9 (29.10): code-only changes for viewers, private requests and overload (owner task 6499374472)

Owner task of 29.10 after R8: no server, cores or paid services bought; no production, merge, deploy or flag change; no
weaker authorization, no change to revocation, the 240/min quota or the +5 % gate; Stocks BUY/SELL stays off for every
account; the acceptance scenario (50+2, 1 s viewer polls, 4 s trader cycle, 2 vCPUs) and the R8 FAIL stay as recorded.
Asked for: (1) the CPU and private-quota split between viewers and traders and a minimal change with a measurable
hypothesis and a stop condition (no R7 serializer, no SCHED_IDLE); (2) a code-only shared quote fan-out or opt-in push
for viewers; (3) graceful overload at 240/min and past 128 connections; (4) the real 3 s terminal polling as a second
diagnostic scenario; (5) unit, isolated HTTP/PG, simulated 3-minute quota tests and micro-profiling — no new full 50+2
run without evidence of effect and separate permission; without evidence, a design/cost tradeoff and NO-GO.

Everything below was measured locally (4-CPU dev container, Intel Xeon 2.80 GHz, no SMT): relative numbers for a
decision, not a verdict. No CI 50+2 run was requested (the commit carries no `RC50-RUN:` line).

### 1. Where the Stocks CPU and the private quota go (`testing/r9-cpu-split.bench.cjs`, report only)

The release chain (PostgreSQL authority + gateway on real PostgreSQL) on CPUs 0,1; the 50+2 clients and the synthetic
market (out of process, `STOCKS_SYNTHETIC_MARKET_ORIGIN`) on CPUs 2,3. Phases of 20 s with the acceptance plan's
cadence: viewers only (50 × 1 s), traders only (2 × 4 s cycle, 7 commands each), both; 2 rounds in alternating order.
Mean CPU per 20 s on base `ba396998` (`base-2`):

| Phase | Gateway | Authority (Prisma threads) | PostgreSQL | Private requests | Viewer p95 | Errors |
|---|---|---|---|---|---|---|
| viewers | 1 675 ms | 170 ms (≈ 30) | 65 ms | 42–43 identity batches | 679–687 ms | 0 |
| traders | 330 ms | 915 ms (≈ 300) | 210 ms | 70 commands | — | 0 |
| both | 2 185 ms | 1 040 ms (≈ 330) | 265 ms | 41 batches + 70 commands | 689–693 ms | 0 |

- **Viewers ≈ 55 %** of the Stocks server CPU (1 910 of 3 490 ms), almost all of it in the gateway: ≈ 1.7 ms per poll.
- **Traders ≈ 42 %** (1 455 ms): ≈ 13 ms of authority (Express + Prisma interactive transaction) and ≈ 3 ms of
  PostgreSQL per command.
- **Floor of a poll** (`node:http`, keep-alive, the same answer size, no application logic; 50 clients at 1 s):
  688 ms per 1 000 polls bare, 800 ms with the gateway's per-request plumbing (abort wiring, URL parse, one deferred
  turn), 819 ms with `AsyncLocalStorage`. Roughly half of the gateway's viewer cost is the HTTP request itself; no
  change to the poll handler can take the viewers below that floor. **Floor of a pushed event** (same ~1 KB, server-sent
  events to 50 open streams): 118 ms per 1 000 deliveries.
- **Private quota:** at the 4 s cycle the traders send 7 commands per cycle each = 210 per minute = 87.5 % of 240.
  50 viewers at 1 s need at least one identity batch per 2 s to be answered at all (30/min): 210 + 30 = 240, no margin.

**Hypothesis.** R8 showed the regression scales with the Stocks CPU on the crypto API's physical core (run-queue wait,
p50 unchanged). Under a linear model, +22.73 % → ≤ +5 % needs ≈ 78 % less Stocks CPU.
**Stop condition.** Ask for a CI acceptance run only if a bounded change shows **≥ 50 %** less server-side Stocks CPU in
the local *both* phase (lower than 78 % because the relation is not proven linear; below 50 % even a favourable
non-linearity leaves the run uninformative). Not met (sections 2 and 6), so no run was requested.

### 2. Viewer fan-out: opt-in event stream prototype (`viewer-stream.mjs`, off by default)

`createServer({ viewerStream: true })` adds `GET /__stocks_global/stream?id=…`; the release entrypoint never sets it
and the terminal does not use it. Per period (1 s) the instrument's public quote is read once (the shared quote
reader) and serialized once per instrument, then written to every subscriber of it.
- **Public only:** an event carries `instrumentId`, `serverTime` and the quote as the state answer projects it — no
  account, wallet, position, order, fill or CSRF token (asserted on the raw wire).
- **Live authorization per delivery:** before every event each subscriber's bearer is judged live again (multiplexed
  into the gateway's usual identity batches); a signed-out, blocked or account-switched stream gets `event: revoked`
  and is closed; nothing is remembered between two deliveries.
- **Freshness / backpressure:** no live quote → `event: unavailable` without a price; quota refusal → `event: wait`
  with `retryAfterMs` and no price that period; a subscriber with > 64 KB unread is closed; at most 64 streams
  (beyond that 503 `SOURCE_BUSY` + `Retry-After`).
- **Tests:** `viewer-stream.test.mjs` 5/5 (public fields only, one batch per period, revocation and account switch
  close only that stream, unavailable, off by default, bounds).
- **Measured** (`testing/r9-stream.bench.mjs`, gateway in its own process, 50 viewers, 20 s, 2 rounds): polling
  1 560 / 1 283 ms vs streaming 106 / 154 ms of gateway CPU — **≈ 11× less** for the viewers' gateway work.
- **Effect on the criterion (estimate, not measured in a 50+2 run):** the identity checks stay (authority ≈ 170 ms,
  PostgreSQL ≈ 65 ms per 20 s), so viewers go from ≈ 1 910 to ≈ 385 ms: **≈ −40–45 %** of the Stocks server CPU in
  the *both* phase, below the 50 % stop condition; the linear model projects Δp95 ≈ +12–13 %, still above +5 %.
  Using it would also change the frontend and the agreed scenario (viewers no longer poll the state every second) —
  an owner decision, not made here.

### 3. Private quota: the gateway follows the ingress window (`authority-adapter.mjs`)

R8 found the adapter's sliding ceiling (Q − Q/16 = 225) could not keep the traders' room: commands sent after a batch
went over the ingress's fixed 60 s window. Now:
- The adapter reads `RateLimit-Remaining` / `RateLimit-Reset` from every ingress answer (tied to the request's send
  sequence) and tracks the window's remaining room; before any header it falls back to the old ceiling.
- **A request the window cannot take is not sent:** a trader command is answered 429 `AUTH_RATE_LIMIT` with
  `Retry-After` until the window ends (or waits up to 1 s when the window ends sooner). The client sends again with
  the same intent (idempotent at the authority).
- **Identity batches leave the traders' expected commands their room:** in a burst (a page load, the 20 s acceptance
  window) the next 5 s of commands at the last 15 s' pace; once trading is sustained (a streak of ≥ 60 s without a
  30 s pause) the rest of the window at the last minute's rate, batches spread evenly when the spare room is under
  half. Margin Q/80; a viewer whose deadline falls inside the wait is refused at once with `Retry-After` (rounded
  down, ≥ 1 s) instead of timing out. **Floor for fairness:** while the window has room, one batch at least every 4 s.
- Clock and timers are injectable (`clock`, `timers`) for the simulated tests; defaults unchanged.

**Simulated 3 minutes** (`testing/quota-sim.mjs`: the real adapter in virtual time against a model of the ingress,
240 per fixed 60 s window; 50 viewers at 1 s, 2 traders × 7 commands per 4 s; clients back off on `Retry-After` as the
sustained mode does). The same model with the R8 adapter reproduces the CI sustained run's pattern.

| Case | Adapter | Ingress 429 | Trader commands ok / 429 / cycles skipped | Viewer polls answered | `AUTH_UNAVAILABLE` | Max Retry-After | Longest viewer gap | Concurrent viewer reads |
|---|---|---|---|---|---|---|---|---|
| original load | R8 | 6 | 469 / 6 (all from the ingress) / 23 | 55.6 % | 1 | 26 s | 28 s | 128 |
| original load | **R9** | **0** | 546 / 4 (gateway, before sending) / 12 | **66.5 %** | 0 | 21 s | 29 s | 125 |
| one viewer + one trader signed out at 60 s | R8 | 2 | 350 / 3 / 24 (+112 `AUTH_REQUIRED`) | 80.9 % | 0 | 26 s | 27 s | 69 |
| one viewer + one trader signed out at 60 s | **R9** | **0** | 350 / 2 / 18 (+154 `AUTH_REQUIRED`) | 82.9 % | 0 | 21 s | 29 s | 109 |
| over quota (traders every 2 s) | R8 | 6 | 539 / 6 (all from the ingress) / 102 | 26.7 % | 39 | 40 s | 42 s | 128 |
| over quota (traders every 2 s) | **R9** | **0** | 539 / 6 (gateway) / 102 | 27.2 % | **0** | 35 s | 43 s | 126 |

With R9, minutes 2 and 3 of the original load run 196 and 210 trader commands (every cycle in minute 3). The price:
answered viewers wait longer once the traders take 210 of 240 — answered p95 0.68 s in minute 1, ≈ 2.4–2.5 s in
minutes 2–3 (batches are spread to keep the traders' room); in the model the R8 adapter answered at 0.67 s but
refused more (the R8 CI sustained run measured 2.5–3.0 s; the model does not reproduce that metric). Only the
signed-out principals get `AUTH_REQUIRED`. `quota-sim.test.mjs` pins these outcomes (3/3; 0/3 against the R8 adapter). **Capacity is still
short**: at 210 commands a minute the viewers get ≈ 25 batches, so about a third of 1 s polls are refused or deferred.

**Isolated HTTP/PG** (`identity-load.pg.test.cjs`, real authority on PostgreSQL): harness schedule at the original
4 s cycle — 1 010 jobs, 0 errors, 0 missed, viewer p50/p95 671 / 687 ms, busiest minute 210 (49 batches + 70
commands + warm-up). Over-quota storm: the ingress answered **0** × 429 (239 private requests, 173 commands); the
gateway refused 59 trader and 196 viewer requests itself, each 429 with `Retry-After` 1–60 s; no refused command sent
again. The test's assertion changed accordingly (the ingress no longer receives the excess), and a new direct check
proves the ingress still refuses beyond its quota with 429 + `Retry-After` when sent to directly.

### 4. Past 128 connections: an answer instead of a silent close (`server.mjs`)

`maxConnections` stays 128. From 112 open connections a new API request is answered **503 `SOURCE_BUSY`,
`retryAfterMs: 1000`, `Retry-After: 1`, `Connection: close`** (the client learns when to come back and frees its
slot); a request whose bearer the authority has already confirmed for trading is still served (it still passes the
usual live check). The health route is exempt. Counters: open, peak, shed, dropped (Node's `drop` event).
`connection-admission.test.mjs`: at 112 idle connections a viewer gets the 503 with both headers and a closed
connection, the trader is served with `canTrade`, 0 dropped connections, the viewer is served again once the idle
connections go. The 50+2 sustained report counts the 503 separately (`viewer.refusedBusy`, not `VIEWER_OTHER_STATUS`).

### 5. The real terminal cadence as a second diagnostic (`driver.cjs`, `diagnostic-run-613.cjs --terminal-3s`)

`RC50_TERMINAL_3S=1` (or `--terminal-3s`) runs the same plan with viewers polling every 3 s, as `GlobalStocks.tsx`
does; workload `terminal-3s-diagnostic`, refused together with the 8 s diagnostic, never an acceptance (the
summarizer labels it, and a collection mixing workloads now fails closed — that check previously ran after the
status was set; fixed, with a test). Not run here: the acceptance stays 1 s.

### 6. The final R9 code in the acceptance phases (`r9c-2` vs `base-2`, same bench)

| Phase | Gateway | Authority | PostgreSQL | Private requests | Viewer p95 | Errors |
|---|---|---|---|---|---|---|
| both, base | 2 040 / 2 330 ms | 950 / 1 130 ms | 210 / 320 ms | 41 + 70 | 689–693 ms | 0 |
| both, R9 | 2 120 / 2 560 ms | 990 / 1 160 ms | 320 / 330 ms | 41 + 70 | 682–685 ms | 0 |

Within run-to-run noise: the acceptance window never reaches the quota or 112 connections and the stream is off, so
R9 neither saves nor costs CPU there. **R9 does not change the acceptance verdict** (FAIL +22.73 % stands).

### 7. Design/cost tradeoff (for the owner's decision; nothing applied)

| Option | Expected effect | Cost / risk |
|---|---|---|
| Viewer push (the prototype, made the terminal's path) | gateway viewer CPU ≈ −90 %, Stocks CPU ≈ −40–45 %, Δp95 ≈ +12–13 % (model) — not enough alone | frontend change; the acceptance scenario's 1 s state poll changes (owner decision); identity checks per delivery stay |
| Viewers at the terminal's real 3 s | gateway viewer CPU ≈ ÷ 3, identity batches about as many but smaller (≈ −30–35 % Stocks CPU, model) | changes the agreed scenario |
| Authority command path without Express + Prisma interactive transactions | trader CPU (≈ 42 %) could fall a lot | rewrite of the financial command path: large, needs a full financial review |
| Stocks on its own core/host | R6 "apart": the crypto p95 did not grow | paid resource — not bought |
| More quota for viewers | — | forbidden (240/min stays) |

With the trader path unchanged even zero viewer CPU leaves the traders' ≈ 42 %, which the linear model projects at
≈ +10 %; reaching +5 % on one shared physical core needs both a viewer change and a trader-path change, or more CPU.

### R9 remaining blockers

1. **Criterion not met** (unchanged): crypto p95 +22.73 % on 2 vCPUs with isolated clients; no code-only change
   measured here reaches the 50 % stop condition. **NO-GO.**
2. **Sustained load at the original scenario:** with R9 the ingress no longer refuses and trader commands keep their
   room, but 50 viewers at 1 s still exceed what 240 − 210 leaves; about a third of polls get 429 + `Retry-After`.
3. Not run: CI acceptance/sustained on R9 (needs separate permission and the stop condition), the 3 s diagnostic in CI.
