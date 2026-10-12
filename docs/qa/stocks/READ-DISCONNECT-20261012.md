# Queued Stocks reads after client disconnect

This follow-up continues PR #497 / Issue #505 on top of
`de565eac17a8477e0dd4c50c2dc936b2bea21990`. It changes only the isolated
Stocks server and its account-worker admission path. It does not change order
rules, prices, account persistence, source freshness or any resource limit.

## Measured defect

A disposable, instrumented copy of the exact baseline recorded request arrival,
account admission, worker dispatch/start/end and response close. An existing
commit test hook held a test mutation while a second client's state request
disconnected. That abandoned `readView` was dispatched **458.097 ms after close**
and spent **0.529 ms in the worker**, then produced an unused response. The test
mutation committed and returned HTTP 200. The controlled 200 ms client deadline
is diagnostic only; it is not the original 3-second capacity gate.

A separate original 30-second, 50-mixed reader on an unrestricted Windows host
completed 1,250/1,250 requests, p95 77.680 ms. Its `readView` queue p95 was
69.176 ms versus worker wall p95 0.591 ms. This validates phase instrumentation;
it is **not** a passing result for the constrained Linux workload.

## Narrow fix and safety boundary

- A disconnected state GET removes only its own queued, undispatched `readView`.
- An already-aborted view is not admitted. Cancellation frees its timer, listener
  and queue-byte allocation and is counted separately as `cancelledReads`.
- Dispatch detaches the abort listener: active work is never interrupted.
- Shared account registration remains alive when a waiter disconnects. A closed
  waiter does not enqueue a later view after registration finishes.
- Financial commands, background observations, SQLite FULL/DELETE durability,
  commit-before-ACK, idempotency and unknown-outcome fencing are unchanged.
- No automatic financial retry, timeout increase, additional provider request,
  or change to the original reader/benchmark scripts is introduced.

The cancellation code is internal. It is not a new public account selector or a
UI trade error. The HTTP handler does not send an error onto a destroyed response.

## What this does not prove

The previous exact-head bounded 50-mixed result has 59 state deadlines across
three repeats. Its aggregate artifacts do not join each failed request to worker
phases. The controlled witness proves wasted work, **not the cause of those 59
deadlines or their elimination**. The strict crypto/history benchmark does not
use this account worker at all and cannot be fixed by this change.

Retained V8 profiles are main-thread wall-clock samples, including CPU throttle
gaps. Treating their wall percentages as exclusive function CPU would be wrong.
The constrained 18-second profile reduced SQL wall from 12,873.824 to
1,115.125 ms and SQL thread CPU from 21.066 to 6.259 ms, while queue occupancy
and deadlines remained. This is diagnostic evidence, not a replacement for the
original 30-second, three-repeat acceptance runs.

Provider budget is separate. The 135/min Binance execution-read trace means
13 selected symbols over ten selection waves plus five scheduler starts, under
the current REST adapter and two-second receipt-sharing cache. It is not a
universal minimum for all 20/50-user patterns. Commercial data rights remain
uncleared and MOEX/SBER remains blocked.

Keep the PR draft. Exact-head CI and unchanged original capacity results must be
reported with failures, even if the cancellation regression tests pass.
