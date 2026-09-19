# Native engine — concurrency audit

> Imported PR #123 design/audit notes. For this integration's actual validation and PostgreSQL test limitation, see [final-integration.md](./final-integration.md).

Scope: one account driven from two browser tabs, two server replicas, a
scheduled refresh overlapping a click, and a double click. What is
serialized where, what a duplicate would look like, and what was proven
by tests on this branch. Nothing here is a claim about the venue.

## The three layers

| Layer | Mechanism | What it guarantees | Where |
| --- | --- | --- | --- |
| Client | `NativeCommandLane` (one ordered promise chain per controller, bounded at 8, plain refreshes at the tail coalesce) | One command in flight per tab, in click order; a CLOSE clicked during a REFRESH is sent after it, never dropped; overflow is an explicit retriable `client_queue_full` | `frontend/src/lib/nativeCommandLane.ts` |
| Server process | per-account lane (`NATIVE_COMMAND_QUEUE_LIMIT = 16`; `native_queue_full` 429), entered synchronously | One command at a time per account per replica, in arrival order; a refresh queued after a close observes the close; the idempotency key is re-checked inside the lane | `service.ts` `serialized()` |
| Database | `SELECT … FOR UPDATE` on the account row + `UPDATE … WHERE revision = expected` (CAS) + unique `(userId, requestKey)` on the append-only revision table | Exactly one commit per revision across ALL replicas; a key that already committed returns its stored receipt and never executes twice; a key reused with other parameters is `idempotency_conflict` | `store.ts` `commit()` |

`native_busy` no longer exists (replaced by the lane in block A). Nothing
optimistic is queued on the client: the terminal paints an account only
from a server receipt whose revision is not older than what it shows
(`acceptsRevision`).

## The case that used to reach the trader

Two replicas (or one replica racing a scheduled refresh on another) both
read revision N. The database lets one through; the other's attempt fails
the CAS with `account_changed` **after** it had quoted, replayed and built
its instruction — and that refusal reached the trader as "Счёт изменился в
другой вкладке. Обновите расчёт" for a click nobody had refused.

Nothing of the losing attempt was persisted (the CAS refused the whole
transaction), so it is safe to decide again. `execute()` now retries the
attempt up to `NATIVE_COMMIT_ATTEMPTS = 3` times on `account_changed` and
on nothing else:

1. re-read the row (now at N+1);
2. re-check the same idempotency key — if the winner WAS this command from
   another tab, its receipt is returned, no work;
3. rebuild the instruction from the new row — a CLOSE whose position the
   winner closed is refused (`POSITION_NOT_OPEN`), a reduce order larger
   than what remains is refused, a new opening order is re-admitted;
4. quote the executed contract fresh again (`quote(symbol, true)`) —
   a retry never fills on the losing attempt's book;
5. replay and commit against N+1 through the same CAS.

After the third refusal the conflict is reported exactly as before. The
service counts retried conflicts in `service.conflicts` (audit only).

## What was proven (tests on this branch)

`nativeDemoService.test.ts` "two server instances on one account" — two
`NativeDemoService` instances (separate lanes) on ONE repository whose
`commit` is held until both attempts have arrived, so both read the same
revision:

- Two OPENs on different contracts: both commit (revisions 2 and 3), three
  commit calls (one CAS refusal), one retried conflict, both instructions in
  the journal in sequence order, the first not lost.
- The same order from both: ONE position of the summed quantity, two OPEN
  fills with two distinct action ids, two fees, revision 3 — never a
  duplicate position.
- A CLOSE whose position the other instance already closed: refused on the
  retry with `POSITION_NOT_OPEN`; one CLOSE event, one closing fee.
- The same idempotency key on both instances: one receipt, identical
  positions, zero conflicts.
- Bounded: a repository that always refuses makes exactly
  `NATIVE_COMMIT_ATTEMPTS` attempts, then reports `account_changed`; the
  row is unchanged and no position exists.
- `idempotency_conflict` (or any other refusal) is never retried.

`nativeDemo.integration.test.ts` (PostgreSQL, real `PrismaNativeRepository`,
two repositories/services): both concurrent OPENs commit; three commit
calls; one retried conflict; one merged position of 0.4 (0.2 + 0.2); two OPEN events; the retried order journaled on a book quoted after the winner's;
three revision rows; a same-key pair still executes once, and the key with
other parameters is refused; revisions stay append-only (`immutable`
trigger).

Already covered earlier on this branch (block A): a double click queues the
same key twice and answers with one receipt; a CLOSE arriving during a
REFRESH runs after it; refreshes queued together are answered once; the
lane is bounded and drains; accounts do not block each other.

## What this does NOT cover

- Two replicas hitting the same **provider** book: each attempt quotes
  fresh, and the observed-book consumption ledger is per account, so two
  accounts can consume the same public level. That is the venue's
  liquidity, not this engine's; it was already so.
- The lane is per process; across replicas only the database serializes.
  A third replica joining an N-way race gets up to three attempts like any
  other; a persistently hot row reports the conflict.
- Latency of a retried command is roughly doubled (a second quote, replay
  and commit); measured in the benchmark block as the worst case, not the
  p50.
