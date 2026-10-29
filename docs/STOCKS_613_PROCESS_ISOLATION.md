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

## Resources

Same host and no new server. One more Node process for the authority; its own
Prisma pool counts against PostgreSQL `max_connections`. In the 50+2 harness every
process (driver, crypto API, authority, gateway, PostgreSQL) stays inside the same
2-vCPU `taskset`; nothing is added to that budget.

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
   exactly as before. Cost of the design: a signed-out trader's very next request may reach the
   gateway's route work (quote read, demand lease) before its command is refused with 401; it never
   reaches an account, a financial write or an answer.
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

