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

## Known limit (unchanged here)

The gateway calls the authority's identity route on every gateway request. 50
viewers polling once per second make about 3,000 calls per minute, far above the
private ingress quota of 120–240 per minute. The 50+2 harness mounts the router
without the ingress in both arms, as before, so it does not measure this quota.
Raising or restructuring the quota needs its own review
(`docs/STOCKS_PRIVATE_AUTHORITY_QUOTA_20261020.md`).
