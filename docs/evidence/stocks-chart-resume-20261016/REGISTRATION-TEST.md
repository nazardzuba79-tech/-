# Registration accounting test precondition

Source `82a7df6fc3b50188a0d47cd7bc391fabff3c910b`, run 38849553327,
isolated-simulator job 116807507215, failed at
`account-registration-batch.test.mjs:224`:

```
not ok 33 - active group members retain request/byte limits and queued expiry never creates an owner later
duration_ms: 6501.555487
error: registration/financial worker must enter its commit barrier
expected: true
actual: false
entered (.../account-registration-batch.test.mjs:22:12)
TestContext.<anonymous> (.../account-registration-batch.test.mjs:229:46)
```

The complete original job log is retained in the local CI evidence. This
source failed; it must not be reported as a complete CI PASS. Its production
account-worker and registration test inputs were unchanged from preceding
source `6d44e287`.

## Demonstrated setup race

Three registration requests receive 150 ms queue deadlines while an earlier
financial operation is blocked before COMMIT. Releasing the barrier still
requires the real SQLite FULL COMMIT and worker-message delivery. Expiry can
legitimately reject these requests before the test's expected registration
barrier is reached. The original caught registration rejection did not retain
its codes, so the CI log proves the missing barrier, not the exact individual
outcomes or runner stall cause.

A new independent test holds the earlier real commit barrier until all three
**real 150 ms timers** reject. It confirms three ACCOUNT_BUSY results, exactly
three timeouts, no registration-barrier entry and no queued owner persisted,
then releases the earlier commit and verifies durable state. No sleep,
retries, slower deadline or synthetic repository result is used.

## Test-only correction

The active-group accounting test now controls only its parent-side 150 ms
queue timers and monotonic clock. Real worker threads, SQLite FULL commits,
barriers and five-millisecond barrier polling remain. Logical time is held
until the real three-member registration group becomes active. The test
asserts all three dispatch timers were cancelled and no request remains queued.

The fourth queued request remains pending at 149 ms and invokes its original
expiry callback exactly at 150 ms. Timeout count must increase once, active
members must remain three, and all original request/byte bounds, owner counts,
excluded-owner, durability and drained-byte assertions remain. Unexpected
active-group rejection is propagated instead of becoming only a barrier error.
The test lifecycle restores all mocks before the real-timer negative test.

Independent real-wall-clock 60/100 ms tests and the elapsed-deadline dispatch
test are unchanged. No production source, SQLite setting, financial rule,
performance fixture or workload acceptance criterion changed.

## Local validation

Both complete files, `account-registration-batch.test.mjs` and
`account-worker.test.mjs`: **30 PASS**, zero failed/skipped/cancelled.
The complete existing isolated-simulator CI command (all 24 test files)
also passed **208/208**, zero failed/skipped/cancelled, in 7,910.637 ms locally.
Actual Linux CI for the next commit remains required. This deterministic
unit-test correction does not excuse ACCOUNT_BUSY or timeouts in load tests.
