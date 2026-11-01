# Copy Trading integration candidate (#658 Track A)

Branch `claude/voltex-mobile-audit-7rpjni-copy-integration`, based on the linear
Draft stack `#643 → #645 → #646 → #647 → #648 → #649 → #650 → #651`
(head `7b325aeb`, all on main `c1f13828`). This branch adds the last missing
link: the follower can reach the existing Futures executor through
authenticated HTTP and the page, and a single test proves Spot and Futures
together. **It is a release CANDIDATE, default OFF, not a release.**

## What works end to end (proved by `scripts/test-copy-integration-review.cjs`)

| Flow | Source of truth | Result |
|---|---|---|
| Spot LIMIT | leader `POST /demo/orders` → `CopyDemoExecution` outbox in the same transaction → `startCopyDemoWorker` → follower `DemoOrder` at `ratio` | one follower order, filled by a real maker `DemoTrade`; position and cost from fills |
| Spot MARKET | leader market order; only its committed taker fills are copied | follower sells the filled share; realized PnL `10` USDT from fills |
| Spot STOP | `DELETE /copy-trading/demo/subscription` | open copied order cancelled, filled assets retained, later leader orders not copied |
| Futures OPEN | leader `NativeDemoService` OPEN → follower `POST …/futures-demo-observer/scan` → `POST …/futures-demo-execution/run` | one follower NativeDemo position at `ratio`; receipt names the follower position and filled quantity |
| Futures CLOSE | leader CLOSE → scan → run | follower copied position closed exactly; no phantom close |
| Futures STOP | `DELETE …/futures-demo-execution` | consent STOPPED; open copied position **retained**; later leader trades refused (`COPY_EXECUTION_STOPPED`) |
| No backfill | leader trade before consent | its CLOSE is refused `NO_COPY_ATTRIBUTED_POSITION`; nothing opened |
| Isolation | another signed-in user | sees no receipts; `run` refused `COPY_EXECUTION_CONSENT_REQUIRED` |
| Auth | no token / revoked session / forged body field / flag OFF | 401 / 401 / 400 / 403 |
| Money | `Balance`, `Order`, `Trade`, `FuturesOrder`, `FuturesPosition`, `Deposit`, `Withdrawal` | byte-identical before/after; Spot demo assets conserved |

Browser (same script, `COPY_INTEGRATION_BROWSER=1`, real backend + flagged build):
start copying, a real leader OPEN, press **Apply new trades**, the row shows
*Executed · Quantity 0.05*; leader CLOSE → second executed row; stop. Then the
page at 390 px in all seven languages: no overflow, no raw keys, no page errors,
no external requests except blocked web fonts.

## Load check (disposable, local — not production)

`scripts/bench-copy-integration.cjs`: 50 signed-in followers polling
`GET /copy-trading/demo` every 3 s and 2 leaders placing Spot orders every 4 s
with the copy worker on, against an unrelated user's `GET /demo/orders/open`,
baseline and load phases alternated. Local run (2 rounds × 20 s, one Node
process, local PostgreSQL 16): p95 baseline 14.51 ms, load 11.89 ms (no
degradation; the +5% criterion is met within this setup's noise), 300 copied
orders executed, 0 left pending, 0 worker errors. A first run showed a Prisma
P2028 from stopping the database while the worker was mid-pass — a harness
artefact, fixed by letting the worker settle before stopping. Production
hardware and the Futures path were not measured.

## What this branch adds on top of #651

- `src/api/routes/copyFuturesDemoExecution.ts`: `GET/PUT/DELETE /copy-trading/futures-demo-execution`
  and `POST …/run`. Every command runs as the follower's own session. `run`
  admits that session to the follower's own NativeDemo account with the same
  persisted REFRESH the terminal performs (deterministic key per session and
  expiry) and then delivers at most 10 pending source events.
- `FuturesDemoFollowerExecutor.snapshot()` and `.run()`; `futuresDemoExecutionEnabled()`.
- `src/index.ts`: router mounted; the NativeDemoService for it is constructed
  only when the gate is on.
- Frontend: `FuturesCopyPanel` + `futuresCopyText` (7 languages) on the existing
  review-only observer route. While copying is ON the observation-only notice
  ("orders are not copied") is withdrawn because it would be false.
- `prisma/rollback/copy-trading-658.sql` and `scripts/test-copy-migrations-rollback.sh`.
- `.github/workflows/copy-integration-review.yml`; `scripts/bench-copy-integration.cjs`.

## Gates (unchanged in kind)

Everything copy-related is hard-OFF unless **all** hold: `NODE_ENV=test`,
`DATABASE_URL` on loopback with a `copy_demo_*` database, `COPY_DEMO_ENABLED`,
`COPY_DEMO_ISOLATED_REVIEW`, `DEMO_SPOT_ENABLED`; Futures additionally
`COPY_FUTURES_DEMO_OBSERVER_ENABLED`, `COPY_FUTURES_DEMO_EXECUTION_ENABLED`, the
leader in `COPY_FUTURES_DEMO_APPROVED_LEADER_IDS` and the follower a native test
account. The page route exists only in a build with
`VITE_COPY_FUTURES_DEMO_OBSERVER_REVIEW=true`. **Production cannot turn this on
by setting flags** — the loopback/NODE_ENV gate must be changed in code first,
which is a separate owner decision.

## Merge order (if the owner approves)

1. Merge the stack bottom-up with merge commits: #643, #645, #646, #647, #648,
   #649, #650, #651 (each PR's base is the previous one's branch), then this PR.
   Or merge only this PR into main: it contains the whole stack.
2. Banking #656 is independent (it only fixes #651's OTC isolated-review job on
   the 31st); merge it first if a green run of that job on the 31st is wanted.
3. Migrations are four additive ones (seven new tables, no existing table
   touched). Apply with `prisma migrate deploy` after a backup.

## Rollback

1. Roll the API back to the previous image (routes disappear; nothing runs
   because no flag is on in production anyway).
2. Optional DB cleanup: `psql -f prisma/rollback/copy-trading-658.sql` (drops
   only the seven copy tables and their four `_prisma_migrations` rows). The
   CI step proves the schema after rollback equals `origin/main` and that the
   migrations re-apply.

## Not done / NO-GO for production copying

- **No background worker for Futures.** Copying runs when the follower presses
  *Apply new trades* (the page says so). A worker needs a service identity or a
  durable delegated session, which does not exist; not invented here.
- Source take-profit / stop-loss / liquidation, position add-ons and several
  copied positions at once are recorded and **refused**, not mirrored.
- Funding payments of the copied position are the follower's own account's.
- Native Demo initialisation moves the account's demo USDT into the Futures
  ledger (existing behaviour); Spot and Futures copy therefore use separate demo
  balances.
- Production gate change, deploy, migrations on the production database: owner
  approval required. Green CI is not a release permission.

## 1 Nov 2026 — automatic Futures copy and exits (still default OFF)

- **Automatic:** consent now creates one revocable delegated `Session` row for the
  follower (user agent "VOLTEX copy trading (automatic)", visible in their session
  list, no token ever issued, 7-day delegation). `FuturesCopyWorker` (3 s, bounded
  to 50 consents per pass) scans the leader's new committed events and runs them
  through the same executor and commit guard as the manual path, acting with that
  session. Requires `COPY_FUTURES_DEMO_AUTOMATIC=true` on top of every previous gate.
  Stop revokes the delegation at once; a user revoking it in the session list stops
  copying too.
- **Mirrored now:** leader add-ons (into the same copied position), several symbols
  at once, proportional partial closes (full close leaves no dust), and leader
  take-profit / stop-loss / liquidation exits (risk-reducing: not refused for
  price distance).
- **Still refused:** any follower position or resting order that the consent did
  not open (no mixing with own trading); a new consent while old copied history
  exists.
- Migration `20261101090000_copy_futures_demo_delegation` (two nullable columns on
  the new consent table); rollback SQL updated.
- Verified: `scripts/test-copy-futures-auto-postgres.cjs` 13/13 and the executor
  regression 12/12 on PostgreSQL 16.
