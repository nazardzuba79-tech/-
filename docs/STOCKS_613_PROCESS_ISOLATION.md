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
   `/portfolio` keeps its post-read re-check; the request-start identity check stays for everyone.
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
