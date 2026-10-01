# OTC crypto-to-cash — prerequisite safety blocker

Status: **BLOCKED before feature implementation. Not production-ready.**

Owner brief: `PROMPT_CLAUDE_VOLTEX_OTC_CRYPTO_TO_CASH.md`, section 6 explicitly
requires checking all shared balance writers and reporting a concrete blocker if
safe reserves require a broader trading-accounting change.

## Repository and scope

- Fresh `origin/main`, verified again after the diagnostic: `46456d61b6114dbd8edb80fdc3a5e962053f4f15`.
- Isolated review branch: `codex/otc-cash-safety-review`.
- Historical `integration/claude-codex` is absent. The current main includes the
  released OTC presentation and deposit-copy/light-Tools integration. The older
  `chatgpt/integrate-latest-20260930` diverges (24 main-only, 9 branch-only commits)
  and was not substituted for the owner's explicitly requested current main.
- Only a standalone diagnostic and documentation changed. No application code,
  Prisma schema, migration, page, provider, production data or environment changed.
- No merge, deploy, production connection, real order, account, deposit or payout.
- No finished-feature PR was opened: the brief's financial prerequisite failed.

## Real PostgreSQL reproduction

Run from the repository root:

```text
node scripts/diagnose-otc-balance-safety.cjs
```

The runner uses the existing local `node_modules/.cache/deposit-qa` tooling
(`pg` and `@embedded-postgres/windows-x64`, Linux equivalent supported by the
runner but not tested). It creates a **new cluster** on a random loopback port,
applies the repository migrations only there, generates the current Prisma client
in a unique cache directory and starts a child with an allowlisted environment.
It never loads `.env` or accepts an externally supplied database connection.
No inherited provider credentials or database URLs reach the child. Fetch is
disabled. The local PostgreSQL process is stopped in `finally`; temporary fixture
evidence is retained, not recursively deleted.

Verified environment: Node 24.21.0, Prisma 5.22.0, PostgreSQL 18.4; default isolation
`read committed`. Production isolation/configuration was not inspected.

The **actual, unmodified** `WithdrawalService`, `OrderService` and `MatchingEngine`
run against real database transactions. Proxies only pause after real queries to
make a valid interleaving deterministic. They do not return mocked balances,
statuses, trades, locks or transaction outcomes. The fifth case explicitly
overrides transaction isolation to evaluate a proposed naive mitigation.

`FixtureOtcReserve` exists only in the disposable database. Its writer takes a
row lock and performs a conditional arithmetic `available -= Q; locked += Q`
with the owned reserve insert in the same transaction. This represents the
required new reserve, **not an implemented OTC product**.

| Diagnostic | Reproduced result |
| --- | --- |
| Withdrawal reads 100; fixture reserves 60; withdrawal requests 80 | Both obligations persist: 140 against 100. Final available 20, locked 80; the 60 owned reserve was overwritten. |
| Spot placement reads 100; fixture reserves 60; BUY requires 80 | Same 140 obligations against 100; a real OPEN order also exists in the book. |
| Two Spot cancellations read the same OPEN order holding 30; another reserve owns 60 | Both cancellations succeed. Available 10 → 70, locked 90 → 30; the remaining owned reserve is still 60. |
| Two withdrawal rejections read the same PENDING withdrawal holding 30; another reserve owns 60 | Both rejections succeed. Available 10 → 70, locked 90 → 30; only one withdrawal was rejected. |
| Apply SERIALIZABLE to Spot; concurrent real credit after matching | PostgreSQL aborts with `P2034`. Database retains maker OPEN / remaining 1 and no taker or Trade row. Maker is gone from the in-memory book. Buyer balance correctly rolls back, book does not. |

Two complete, independent disposable-cluster runs reproduced all five findings.
Each returned **exit 2**, deliberately meaning **BLOCKED**, not PASS. Syntax check
and whitespace check passed. Early harness debugging runs are not counted as
completed reproductions. No full product suite/build/browser QA is claimed:
feature development stopped at the explicit prerequisite gate.

## Root causes / affected source at the inspected main

- `src/services/WithdrawalService.ts:55–70`: unlocked read followed by absolute
  available/locked updates; default transaction isolation. Rejection at 240–272
  checks status with a plain read, without a conditional once-only transition.
- `src/services/OrderService.ts:493–505`: same stale reservation overwrite.
  Cancellation at 514–550 checks status and then updates unconditionally; a
  second request can release the same hold twice. `adjustBalance` at 571–587 also
  writes both totals calculated from a prior read.
- `src/services/OrderService.ts:415`: the book mutates before database settlement
  and transaction commit. The service has no rollback/rebuild boundary here.
  The diagnostic's SERIALIZABLE conflict is a **counterexample to that proposed
  mitigation**, not a claim that current Spot already uses SERIALIZABLE.
- Additional shared stale writers found by inspection:
  `src/api/routes/futures.ts:433–465` (both directions of wallet transfers),
  `src/services/PurchaseService.ts:28–42`,
  `src/services/BalanceAdjustmentService.ts:44–58`.
  Those cross-product races were not integration-tested in this blocked phase.
- Banking's conditional arithmetic debit at `src/banking/service.ts:121–125`
  does not make other, stale absolute writers safe. All credits, debits and
  release paths must be reconciled, including deposit/referral credits.
- User deletion currently deletes Balance/Order rows and unpaid withdrawals in
  `src/services/AdminUserDeletionService.ts`; a real OTC obligation will also need
  explicit deletion protection. No OTC schema or delete behavior was added.

This is not solved by an OTC-only lock, a nonnegative Balance constraint, or UI
validation. Double releases can leave both totals nonnegative while consuming
another request's funds. Blindly adding SERIALIZABLE/retries to Spot is not safe
without coordinating the in-memory book with commit/rollback/unknown outcomes.
These are shared monetary state-machine and matching consistency changes, not
just a new reserve helper in an isolated OTC module.

## Required next stage (not silently implemented)

Obtain owner approval for a cross-product financial-safety prerequisite:

1. Inventory and convert every real Balance writer to one compatible atomic
   debit/credit/hold protocol, with appropriate balance and obligation ownership
   checks. Cover both directions of Spot/Futures transfers and their own locks.
2. Make existing order/withdrawal financial transitions exactly-once under
   concurrent requests; cover conditional orders/OCO/trigger/edit/cancel/fill,
   withdrawal approval/rejection/sent and their conflicting transitions.
3. Coordinate Spot matching, database commit, rollback and unknown commit
   outcomes. Do not retry a transaction against an already-mutated book.
4. Turn these reproductions into safety regressions and add the requested
   withdrawal/order/transfer/banking/Futures concurrency matrix, including audit
   failure and deletion races, before adding real OTC obligations.
5. Then implement the requested OTC lifecycle/UI/private chat and route-policy
   gating. No country/city/partner is approved by this diagnostic. Complete the
   full requested validation and open the single finished-feature PR only when
   its safety claims are supported. Merge/deploy remain forbidden.

Do not deploy this diagnostic as a feature, and do not enable real OTC reserves
on the inspected main. No new cron, polling, network provider or infrastructure
is introduced by this local diagnostic.

## Primary references consulted

- [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html): row locks do not prevent ordinary non-locking reads.
- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html): concurrency behavior and serialization aborts.
- [Prisma transactions](https://www.prisma.io/docs/orm/fundamentals/transactions): transaction isolation and write-conflict handling. Repository remains on its installed Prisma 5.22.0; no upgrade.
