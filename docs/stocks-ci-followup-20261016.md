# PR 528: bounded quote admission and CI follow-up

Parent: `9dd11aded1337346abd5844b15ec9846bf1e5478`. Fresh-fetched main: `2e7acf158000404133db85723bac13695215e25c` (inspected, not merged). This is local review work, not release or production acceptance.

## Quote admission

The previous HTTP quote reader rejected the third distinct instrument immediately. The retained local 50-viewer/two-trader diagnostic observed 174 viewer `SOURCE_BUSY` responses for twenty cold instruments and 130 for twenty warm instruments (182/138 across all roles, including eight trader read errors per cell), without HTTP timeouts. The original launcher continued after a raw CRLF source mismatch. Later canonical Git equivalence does not repair that fail-open preflight: those runs are diagnostic evidence, not pre-admitted acceptance.

The reader now retains two active **instrument** flights and admits at most 32 distinct queued instruments and 256 readers. Native and full-currency readers share a flight. Admission has a nonrenewable, monotonic two-second deadline, checked both before grant and before the actual first continuation. Same-instrument followers do not consume another pending slot. Existing caller cancellation is retained from the start of the HTTP request; queueing does not reset the Wallet deadline or the load harness's three-second client deadline. There is no new three-second server guarantee. MarketHub's existing six-second physical request deadline is unchanged.

Cancelling a reader does not cancel surviving readers. Cancelling the final queued reader removes unstarted work. Active permits remain held until the actual native/FX work settles, even after disconnection. An unstarted FX promotion with no remaining full-currency readers is dropped, while native readers survive; a later full reader can request promotion. Shutdown rejects queued work and drains active work.

The two-second quote cache, original native acquisition time, 80-entry cache bound, quote DTO, provider limits, prices, freshness checks, FX conversion, order matching, accounting, FULL durability and idempotency are unchanged. History admission and SQLite queues are untouched. Instrument flights are not physical HTTP requests: a native quote may start multiple provider reads.

This queue addresses burst rejection only. Twenty instruments still exceed the unchanged 100-per-host rolling-minute limits in the established request-budget model. `RATE_LIMIT` must remain visible. Real-source sustained throughput, strict CPU/I/O capacity, crypto coexistence and production resources remain unproved. No additional real provider load was generated for this change.

## Confirmed CI corrections

- **Stocks stage fixture:** its old funded-Bob/two-ledger assertions contradicted the new read-only viewer contract. It now asserts zero viewer balances/reserves/history, exactly one owner ledger, zero viewer financial queue and SQL writes, byte-identical closed SQLite data, and the same outcome after restore. Owner trades, P&L, reserve, replay, lost-ACK, FULL backup and restore assertions remain intact.
- **SupportWidget:** the owner explicitly approved this separate three-file correction. The component consumed its prefill guard before an asynchronous profile response, even when closing discarded that response. Two new deterministic regressions fail against the old component (24 pass, 2 fail). Only an accepted response now consumes the guard; all 26 tests pass. A third regression checks old-session response isolation. The OTC QA retains the immediate Escape/reopen and exact read-only email assertion, with a bounded wait for that exact value.
- **CFD diagnostics:** the retained 9dd run has 74 passes and three failures. Its first two screenshot waits encounter an unavailable initial ticker snapshot, then the existing 60-second failure cache. The fast-switch candle wait lacks the main chart response evidence. Passive diagnostics now retain actual requested interval/limit, status, safe error code, bar count and final chart state. No deadline, retry, assertion or provider request was changed. A successful future run cannot erase these failures or establish their unknown upstream cause.

## Local validation

| Check | Result |
| --- | --- |
| Existing Stocks-global suites, including original account and financial assertions | 202 PASS, 0 FAIL, 0 skipped |
| New deterministic quote admission tests | 20 PASS, 0 FAIL, 0 skipped |
| Unchanged Wallet FX, demand, rate-budget, history cancellation/deadline subset | 41 PASS |
| Passive CFD trace helper | 36 PASS |
| Support form | 26 PASS, including the two reproduced negative cases and session isolation |
| Full frontend Jest after Support fix | 275 suites / 4,403 tests PASS; 0 FAIL or skipped |
| Frontend TypeScript and production build | PASS; existing chunk-size warning retained |
| Exact queue runtime: clean stage viewer/restart/restore | 5 cases / 80 assertions PASS |
| Exact queue runtime: standalone package | 59 assertions PASS |
| Stage/package closure guards | 6 PASS |

The first local build command used the wrong root Vite path and failed before compilation. The corrected command used the existing frontend Vite installation and succeeded. Both logs are retained. The new build is in a separate directory; the frozen 9dd build, evidence packet and pristine seed remain unchanged.

The affected twenty-instrument cold/warm HTTP proof must use the repaired fail-closed launcher and bind this new source before execution. No one-instrument or full capacity matrix is substituted or repeated here. Exact-head GitHub CI is required after the final source freeze; prior 9dd results are 41 successful workflows and three failed workflows, not inherited green checks.

## Remaining gates

### Affected local quote-admission proof

The once-only, source-bound follow-up at `1587ee6f13f86dc5e4e87e342a87496bc1bedb56` completed 20-instrument cold and warm cases: 1,038 HTTP requests in 61.6884813 seconds. The repaired launcher verified raw and Git-canonical inputs before spawning the workload. The historical 9dd launcher anomaly remains an unqualified diagnostic baseline; this does not retroactively admit it.

| Cell | All-role SOURCE_BUSY before / after | Timeout | After p95 / p99 |
| --- | --- | --- | --- |
| 20 instruments, cold | 182 / 0 | 0 | 639.246 / 731.838 ms |
| 20 instruments, warm | 138 / 0 | 0 | 583.949 / 681.377 ms |

The queue replaces immediate refusals with bounded waiting; these latency values must not be presented as a latency improvement over the fast-failing baseline. Cold retains two initial trader `QUOTE_STALE` recovery responses. Expected authorization and balance-edit refusals are retained; there are no unexpected transport or mutation errors. Each case passes 159 in-run and 26 offline financial checks. Viewer-only reads perform zero SQL calls and zero financial-queue admissions. Maximum active instrument flights is 2, maximum queued keys 18, and all flights/waiters drain to zero.

See the [hash-verified report](evidence/stocks-quote-admission-20261016/affected-results.md) and [numeric summary](evidence/stocks-quote-admission-20261016/affected-summary.json). CPU/RSS cover the whole unconstrained Windows harness, not the Stocks service alone. Observer overhead, Linux resource quotas, physical fsync, crypto coexistence and real-provider capacity remain unproved. No original strict acceptance threshold or provider budget was changed, and no full matrix was repeated.

Real owner/Xenia issuer-subject bindings and an authoritative existing test-cash adapter are still absent. The local fixture Wallet is not the actual DemoBalance integration. Commit-time revocation fencing, strict capacity/coexistence, actual production resources, MOEX data and commercial redistribution rights remain unresolved. A Stocks archive associated with PR #471 has now been recovered and previewed separately, but its identity as the requested owner-selected v0 design is unconfirmed. Its Apple view has no trading ticket and its chart frame was blank in the retained preview. Figma Professional B and implementation screenshots must not be relabeled as that reference. No merge, deploy, production mutation or real financial operation was performed.
