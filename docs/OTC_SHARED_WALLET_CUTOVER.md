# PR #372 — shared-wallet cutover, NOT authorization to execute

Status: prepared and exercised on disposable PostgreSQL only. No production
inventory, audit, migration, interruption, configuration change or deployment
has been performed. **Do not merge while Render auto-deploy is on.** OTC stays
`enabled:false, routes:[], approvedUserIds:[]`; ordinary minimum deposit is
**500 USD**. OTC activation is a separate decision after this release.

## Why this is a stop/start release

Tested old source: actual Git archive of `a457809f2412da6b6074a6d398aa1ca9248c6ac1`
(fresh main, including Academy/Help and #373), not a hand-written approximation.
New source: the exact reviewed PR checkout. CI records both identities.
Re-run against a newly fetched base whenever main or the deployed revision changes.
If production runs a different revision, repeat the mixed-version test with that
exact revision too; current-main evidence is not evidence for arbitrary binaries.

The disposable test pauses actual old service code after its balance read,
commits a new writer, then resumes the old write. Lost updates are reproduced in
Spot placement, withdrawal, manual credit, funding, liquidation and conditional
order refund. New-only advisory locks cannot fence those old writes. These are
**passing incompatibility reproductions**, NOT evidence that overlap is safe.

`scripts/start-render-single-service.cjs` starts a collector and API in EACH
instance. Its SIGTERM forwarding/1.5-second wrapper exit is not a global drain.
`src/index.ts` starts `background.start()` before `app.listen`; its SIGTERM
handler stops schedulers/disconnects Prisma, but is not an HTTP admission fence
and does not prove every in-flight callback completed. OTC off changes neither.

Inventory every process with financial DB access, not just browser traffic:

| Entry | Writers that must stop |
| --- | --- |
| API routes | Spot placement/cancel/update/OCO, withdrawals/mark-sent, purchases, admin adjustments/deletion, wallet transfer, deposit approval/referral credit, Banking, Futures/CFD, private/native trading |
| `createServerBackground` | funding, Futures liquidation and TP/SL, CFD liquidation, Spot `PriceWatcherService`, private owner pass, native limit pass; coordinator can wake these |
| `index.ts` outside that group | deposit watcher scheduler, market registry/collector; inspect any separate scheduled/worker deployment and internal signed-event producer |
| External actors | operator scripts, admin sessions, CI/jobs, other services/preview deployments with the same DB credentials, manual payout desks |

Deposit discovery is not credit; approval is `DepositBatchService.confirm`,
whose credit/referral increments are already atomic. It must still stop: an old
absolute writer can overwrite a correctly committed credit. Banking's existing
row-locked/atomic paths also do not make unrelated old absolute writes safe.

Render documents new/old overlap and delayed termination; a restart also rolls
instances and reuses the old configuration. A Free instance has no paid
pre-deploy hook. This procedure uses the existing service and a **stdlib-only
hold process**, not a new service, runtime financial gate or paid component.
It does not depend on whether a suspended service can deploy/resume safely.

Sources checked 2026-10-01: [deployment lifecycle](https://render.com/docs/deploys#zero-downtime-deploys),
[restart and configuration](https://render.com/docs/deploys#restarting-a-service),
[pre-deploy availability](https://render.com/docs/deploys#pre-deploy-command).

## Gate 0 — separate owner permission and preflight

Owner must approve the interruption window, exact source SHAs, temporary start
command/auto-deploy settings, privileged read-only inventory, backup, migration,
audit, later admission, and any separate reconciliation. None is authorized by
this document. Name one release operator; prohibit concurrent deployments and
manual financial actions during the window. Record current settings and pending
deploys privately, without URLs/passwords/tokens in evidence or Git.

1. Fresh-fetch main and PR; require all relevant CI on the exact proposed head.
   Check integration with Academy/Help/#373. Record actual production revision,
   all service/process IDs, DB/role identity and shutdown delays. If any writer
   cannot be inventoried/stopped, **NO-GO**.
2. Prepare and verify the exact release artifact without production credentials.
   Ensure the build command has no migration/seeding/data writes. The reviewed
   start command currently includes `npx prisma migrate deploy`: the hold command
   below must replace the **whole** command, not be appended after migrations.
3. Take/verify a recoverable backup and restore rehearsal under existing approved
   facilities. If unavailable, stop; do not provision a paid service implicitly.
4. Authorized read-only inventory must enumerate IDs/counts of open Futures/CFD
   and private/native positions, active Futures orders/protections, Spot
   conditional/OCO orders, Banking due operations, deposits/claims/batches,
   withdrawal states (especially APPROVED/unknown broadcast), and existing OTC
   reserves/payouts if those tables already exist. Record all ordinary Spot
   LIMIT orders, fills and balance holds for reconciliation, NOT deletion.
5. **Default NO-GO with open risk positions, armed conditional/protection orders,
   or unresolved in-flight external payouts.** A pause stops liquidations, TP/SL
   and funding; funding does not backfill missed boundaries. This procedure does
   not promise continuous risk protection and does not auto-close/cancel anything.
   Owner must arrange a separately reviewed/customer-authorized resolution or a
   different risk-managed transition before using this procedure. Ordinary held
   LIMIT orders, pending unsent withdrawals and uncredited deposits may survive
   intact; lock them out of operator processing, record IDs and audit them below.
   Schedule outside funding/Banking boundaries with a bounded maintenance window.
   Exceeding the window is an incident, not permission to replay/skip obligations.

Preflight while live is provisional: repeat the risk/obligation inventory AFTER
old writers stop. A position could have opened between the live check and stop.
If found, stay held and invoke the owner incident/risk plan; do not silently run
old/new together, invent funding, or resume an incompatible old binary.

## Gate 1 — establish a writer-free last-good deployment

1. With permission, turn auto-deploy **Off** for every writer deployment BEFORE
   merge. Clear/disable other deploy initiators and confirm no queued/in-progress
   deployments remain (canceling one may start a queued one). Restrict operator
   access for the window. Merely adding `[skip render]` is insufficient.
2. Suspend/stop other financial workers and jobs under their approved procedures.
   Pause incoming manual approval/broadcast work. Do not change balances/rows to
   achieve this. Missing proof for any process is **NO-GO**.
3. On the existing API service, replace the entire start command with this exact
   standalone command. It works with the OLD artifact too: no repository import,
   dotenv, Prisma, migrations, scheduler, collector, API or outbound calls.
   Save for a **new manual deployment** of the known deployed OLD SHA; do NOT use
   “Restart service”, which can retain the old start configuration.

<!-- hold-start-command -->
```sh
node -e "require('node:http').createServer((q,s)=>{s.setHeader('Cache-Control','no-store');s.setHeader('Content-Type','application/json');s.statusCode=q.url==='/health'?200:503;s.end(JSON.stringify({status:'maintenance',financialWriters:false}));}).listen(Number(process.env.PORT||3000),'0.0.0.0')"
```

4. Require the hold deployment to finish successfully and become the last-good
   deploy, with that start command recorded. An HTTP 200 `/health` means ONLY
   the hold server is up. It does not establish financial shutdown. Public API,
   including direct `onrender.com`, returns 503; existing WebSockets must drain.
5. Wait for Render's full old-instance termination, not just traffic switch.
   Verify instance/process termination events for ALL old API/collector/workers
   and their children; wait beyond the documented drain plus the ACTUAL configured
   shutdown limit. Through a privileged explicit read-only DB connection, inspect
   `pg_stat_activity`, open transactions and prepared transactions. Exclude only
   the named audit/operator connection and platform-owned internal sessions.
   Require **zero old application backends, including idle connections**, zero
   application transactions and zero application prepared transactions. Pooler
   backends can outlive clients: unexplained sessions are a blocker, not something
   to exclude by guess. Do not log query text or credentials.
6. Record termination evidence + repeat DB session snapshot + post-stop obligation
   inventory. A blank maintenance page or elapsed time alone is never proof.
   If the platform/DB role cannot provide this evidence, stop and request owner
   authorization/support; do not execute migration. There is no `pg_terminate_backend`
   production shortcut in this runbook.

Example SQL for the separately authorized observer, inside `BEGIN READ ONLY`:
```sql
SELECT pid, usename, application_name, backend_type, state, xact_start, backend_start
FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();
SELECT gid, owner, database, prepared FROM pg_prepared_xacts
WHERE database=current_database();
```
End with `ROLLBACK`. Privilege-limited/NULL visibility is NOT a clean result.

Old writers may finish or roll back while the hold deploy drains. There is still
NO new writer during that period. The disposable test kills an actual archived
old process mid-transaction, verifies its backend is gone, and proves its partial
order/hold rolled back before migration. Committed outcomes must instead remain.

## Gate 2 — migration, read-only audit, explicit decision (API remains held)

1. Recheck hold command, auto-deploy Off, no writers/sessions and no deployment
   queued. Only now may owner-authorized merge occur. It must not start services.
2. In the prepared exact release artifact, using separately authorized operator
   credentials securely injected for this process only, apply **only pending
   reviewed migrations**: `npx prisma migrate deploy`. Inspect migration history
   before/after; do not run reset, db push, seed, rollback or migration repair.
   The added migration is `20261001000000_otc_cash_requests`, additive only.
   This is an operator-host command, not a paid Render pre-deploy/shell assumption.
3. While all writers remain held, run `node dist/otc/auditReserves.js` with ONLY
   explicit `OTC_AUDIT_DATABASE_URL`. No DATABASE_URL fallback or dotenv. The audit
   enforces SQL READ ONLY + Repeatable Read, reports zero rows changed, wallet/
   active-order/trade counts and issue IDs/categories. Keep its protected output
   with the release evidence. Also run the existing explicit READ ONLY Futures
   audit (`FUTURES_AUDIT_DATABASE_URL`, `dist/futures/auditActiveOrders.js`) under
   separate authorization and reconcile the post-stop inventory from Gate 0.
4. Exit **0 CLEAN** is necessary, not sufficient: require both audits completed,
   IDs/counts accounted for, no unknown commit/broadcast/payout outcomes, unchanged
   obligations, and all risk preconditions still true. Exit **2 issues** or
   **1 unavailable**, a partial/timed-out audit, changed schema, unknown source
   revision or missing evidence means **NO-GO**; retain the hold process.
5. For each discrepancy produce a separate proposed reconciliation keyed by
   order/trade/reserve/deposit/position ID with ownership, ledger/history and
   external settlement evidence. Owner must approve any correction separately.
   Never auto-refund, add a balancing hold, delete fills, cancel a legacy maker,
   close a position, retry an ambiguous transaction or edit history. Repeat the
   full audit after any separately approved correction, still before admission.

### Audit coverage and known limits

`auditReserves` checks missing/negative wallet rows, exact owned Spot/OCO/
withdrawal/OTC reserve coverage, maker shape using the SAME predicate as
`SpotBookTransaction`, original minus persisted fills versus remaining quantity,
conditional shape/locked asset, orphan OCO and invalid/orphan/mismatched trades.
One invalid maker can prevent new placement, trigger AND cancellation for that
pair; this is why auditing only before OTC activation is too late.
It is not a full Futures/CFD/Banking/chain-accounting auditor. The additional
inventory/existing Futures audit and manual settlement reconciliation are gates,
not implied by a Spot `CLEAN`. Production is not assumed empty or already clean.

## Gate 3 — admit only the reviewed new writer

Owner signs the exact new/merge SHA, clean post-migration reports and stop proof.
Keep other writers stopped. Restore the recorded normal start command for a NEW
manual deployment of that exact compatible SHA. No arbitrary “latest commit”,
rollback or old restart. The additive migration is already applied; the normal
Prisma deploy step must report no unexpected pending migrations.

This transition overlaps ONLY stdlib hold + new version. The new API may start
financial backgrounds before listening, so Gate 2/owner sign-off MUST already
be complete before triggering it. Require the live `/health` commit to match,
successful startup/recovery logs and no reconciliation errors. Resume other
writers only at compatible revisions after explicit review. Keep auto-deploy off
until the owner approves future deployment policy. OTC remains disabled.

## Failure/rollback matrix — keep obligations, never resurrect old writers

| Failure | Required action |
| --- | --- |
| Hold deploy fails | Old app may still be live. No migration/new version; restart Gate 1 after owner decision. |
| Old termination/session proof missing | No migration. Hold all new writers; incident/owner decision. |
| Migration fails or succeeds but audit fails/unavailable | Remain on last-good hold. Preserve schema, every balance/order/fill/reserve and pending operation; no destructive rollback or automatic repair. |
| New build fails before start | Last-good hold remains. Investigate exact artifact, rerun required gates. |
| New process starts then fails health/startup | It may already have committed background work! Replace/verify hold again, establish zero writers, re-inventory/audit; never assume DB rollback. |
| Failure after admission / ambiguous commit or payout | Stop admitting work using reviewed hold procedure, preserve IDs and evidence; reconcile actual DB/external outcome before retry or forward fix. |

Do not click Render rollback to the old financial deploy: financial rows/schema
are not rolled back with code. Retain the known hold deployment/command as the
recovery target. A hold process is safe under either schema; an old financial
binary is NOT a recovery target. No storage rewind may erase committed customer
obligations. Never automatically replay funding/credits/payouts on restart.

## Reproduction and evidence

```text
git fetch origin
git rev-parse origin/main
node scripts/diagnose-otc-balance-safety.cjs --cutover --base <exact-main-SHA>
```

This creates a new loopback-only PostgreSQL cluster, archives actual old sources,
applies old migrations first, seeds legacy obligations, kills a real old child,
applies the real additive migration, runs SQL READ ONLY audits and tests mixed
writers. Network providers use fixtures; no production URL is accepted.
The hold command in THIS document is executed by the test as a child process.
CI uploads the fresh `cutover-postgres` log under the exact PR SHA/run/attempt.
All previous wallet/OTC/preservation and balance assertions remain enabled.

Code/test readiness and procedure readiness do not authorize release. Actual
production state, platform stop evidence, owner interruption/risk decisions,
production migration/audits and final admission remain separately blocked on
owner permission. No production dry-run has been claimed.
