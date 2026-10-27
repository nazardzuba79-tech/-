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
  readiness that re-reads the bindings, both server gates.
- PostgreSQL authority: `User`/`Session` `FOR NO KEY UPDATE` and
  `StocksTestAccount`/`DemoBalance` `FOR UPDATE` fences, blocked users refused
  inside the transaction, atomic commands, receipts and idempotent replays.
- Private ingress: loopback-only listener, exact Host/path/method, no forwarded
  headers, constant-time capability, finite transport quota (120–240 per minute,
  default 240), 128 connections, 15 s / 10 s / 5 s deadlines.
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

## Known limit (unchanged here)

The gateway calls the authority's identity route on every gateway request. 50
viewers polling once per second make about 3,000 calls per minute, far above the
private ingress quota of 120–240 per minute. The 50+2 harness mounts the router
without the ingress in both arms, as before, so it does not measure this quota.
Raising or restructuring the quota needs its own review
(`docs/STOCKS_PRIVATE_AUTHORITY_QUOTA_20261020.md`).
