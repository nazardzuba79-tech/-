# Decision required: legacy session revocation — Issue #505

**BLOCKED. Proposal only; no CI policy or runtime change authorized/applied.**

CTO work order: issue comment 6284291070. Runtime candidate remains
`b2524d68d6a922a149abe4a56a23d5d3dc9d3c6e`.
Fresh main `f81df788a8ddcc5d925b827b6e783f6e21dc39fa` and draft #554
`ce670d8cc96e46864d3d31d39c1e3a608a0c06bc` are unchanged.
The containing follow-up commit adds this decision record and handoff only.

## Exact RED, not a new performance investigation

Executed once on the exact candidate with official Node22.23.3:

```text
node --test --test-name-pattern="revocation at the worker pre-COMMIT" \
  services/stocks-global/two-trader-auth-lifetime.test.mjs
```

Result: **1 test, 0 PASS, 1 FAIL, 0 skipped**, exit1.
Expected HTTP401; actual200. Synthetic reserved cash changed from0 to9,
revision0 to1, and an OPEN order became durable. No fills occurred.
The raw TAP with the complete assertion/stack and durable before/after trace
is retained in `output/stocks-legacy-decision-20261020/b2524d68-legacy-red.tap`
in the task evidence directory. No assertion or fixture was altered.

The previous 39PASS/1FAIL group result is retained, not re-run or presented
as a fresh suite result. No full suite, new load test, DB setup or production
operation was performed in this follow-up.

## Why a small recheck patch would not establish financial safety

These are source references in the unchanged runtime candidate:

| Boundary | Existing contract |
| --- | --- |
| `identity.mjs`, `identityResolver` | GET `/api/v1/me`, returns only `{issuer, subject}`. No session ID/version, transaction lease, revocation subscription or commit acknowledgement protocol. |
| `server.mjs:171` | Awaits the authentication callback before obtaining the account context. Existing later request fences still precede the worker's financial commit. |
| `account-worker.mjs:54-56` | Worker payload contains principal, command, input and existing-only flag; no session/revocation fence. |
| `account-worker-runtime.mjs:11-19` | Synchronous test-only barrier uses `Atomics.wait`; it does not consult an identity authority. |
| `accounts.mjs:80-99` | `BEGIN IMMEDIATE`, read/mutate/validate, UPDATE, synchronous `beforeCommit()`, COMMIT, then snapshot/ACK. Callback promises are not awaited. |
| `two-trader-auth-lifetime.test.mjs:128-145` | Revokes the parent's independently mutable auth Map after UPDATE, releases the worker barrier, then requires HTTP401 **and unchanged durable state**. |

The worker sees identical messages and SQLite contents whether or not that
independent Map (or the real remote identity service) revokes after dispatch.
It therefore cannot distinguish the two executions using the present API.
SQLite's writer lock protects the ledger, not the identity authority.

Adding parent/worker RPC would communicate a recheck, but would not supply
an atomic revocation boundary:

```text
T0: identity service replies "session valid"
T1: revocation completes/acknowledges at the identity service
T2: worker COMMITs using the T0 reply
```

The original assertion must also hold for this interleaving. Repeating the
read merely moves T0. Passing a session boolean/version, a short-lived token,
an AbortSignal, or a cached grant cannot prevent T1. Blocking the parent
HTTP event loop around worker COMMIT could hide the Map race in this fixture,
but cannot lock the remote authority and would harm HTTP responsiveness.
Returning401 after COMMIT or performing a compensating write fails the
durable-state invariant and ACK semantics. None was implemented.

A correct repair needs a shared authority boundary: session-specific fencing
or a lease acquired from the authoritative session store, held until actual
COMMIT/ROLLBACK, with **every revocation producer participating**. It must
also specify expiry, lock ordering, disconnect/crash recovery, bounded waits,
restart, receipt replay and when revocation can acknowledge. Moving session
truth into SQLite would additionally require synchronization with existing
login/revocation producers; a new local table alone is not sufficient.

That changes the authentication/storage protocol, rather than adding a
local guard. The supplied `authenticate(req)` callback cannot furnish it.
Such a repair would affect the inactive legacy engine and potentially shared
auth outside the permitted narrow scope. Per CTO item2, runtime work stops
here instead of introducing a test-specific, financially unsafe GREEN.

## Existing PG exclusion proof, unchanged and reused

The reviewed release contract is already different:

1. `release-config.mjs:16-39` requires Node22.23.3, two distinct bindings,
   authority endpoint/key and forbids all legacy storage/identity options.
2. `release-entrypoint.mjs:6-13` validates configuration and PG readiness
   **before** importing/listening, then supplies only `accountAuthority`.
   It has no `accountsPath` or JSON fallback.
3. The readiness route is exposed only by the real non-injected PG factory;
   the adapter has no local storage fallback.
4. `Dockerfile.release` selects that gateway entrypoint. Direct legacy
   `server.mjs` execution in production mode is rejected.
5. Existing candidate evidence: startup13/13, actual Node22/compiled
   router/gateway/PG22/22, transport2/2, with no skipped tests.
   Reused evidence hashes are in the prior verified delivery manifest.
6. `postgres-authority.mjs:58-65,99-100,142-149` locks User/Session inside the
   financial transaction, rechecks before completion and acknowledges after
   commit. A revocation already acknowledged rejects; a revocation waiting on
   the held session lock acknowledges only after the transaction completes.

This proves the **reviewed launcher/source path and local tests**, not that
any production image/entrypoint/ingress has been attested or changed.
Importing legacy modules for fixtures is not authority fallback.
It does not make the still-mandatory legacy test pass.

## Separate owner decision proposed — NOT implemented

**Recommended for review: retire legacy SQLite trading from the supported
Stocks release contract**, keep the PG-only launcher mandatory and prohibit
legacy entrypoints/storage in approved release artifacts/configuration.
Then explicitly decide the failing legacy suite's CI disposition:

* Keep the original strict test and its RED evidence, without changing its
  expected401 or durable-state assertions.
* Require the equivalent actual PG revocation/expiry/queued-intent/lost-ACK
  checks, shared DemoBalance tests and fail-closed release startup tests.
* Decide expressly whether the unsupported legacy suite remains a release
  blocker or becomes a separately reported legacy debt suite. If the owner
  approves reclassification, implement it in a distinct reviewed change with
  visible legacy FAIL status and exact-head CI. Until then it remains
  **mandatory and blocking**.

Alternative: authorize a dedicated legacy authority-protocol redesign,
including the revocation producers and adversarial interleaving/crash tests.
That is materially larger than this repair and is not started here.

Neither recommendation is permission to delete/skip a test, mark it as
expected failure, add `continue-on-error`, or change branch protection.
No policy delta or speculative runtime patch is included in this candidate.

## Updated release checklist using Work's existing evidence

Work report6284233663 and its sanitized ZIP were read. ZIP40395bytes,
SHA256 `a84db4ac549761dc608007044048f23ecf79c7a45c32d0427bce8e387daa19b9`
was downloaded and verified; no server audit repeated.

* **Mandatory authorization gate:** resolve the owner decision above or
  correctly repair the legacy protocol; currently FAIL.
* **Exact-head publication/CI:** current CF/Northflank triggers remain
  unproven. Do not push/dispatch while this and the authorization gate remain.
  #554 green CI is not CI for b2524 or this follow-up.
* **Image/build provenance:** original KYC source/export receipt and final
  source+recipe+base→image receipt are still missing in Work's bounded search.
  Source-only Node22 recipe is not a built/verified release image.
* **Migration packaging:** retain44 actual historical raw bytes and only the
  two pinned pending payloads. Work reports matching production/candidate
  Prisma5.22.0 and production→ledger2RAW_MATCH/42VERIFIED_EOL_VARIANT/
  0UNEXPLAINED; historical candidate raw comparison remains44/44FAIL.
  Engine/EOL recognition does **not** satisfy or relax the raw-file gate.
  Obtain the historical snapshot/export receipt; build and verify a package
  using the existing byte-preserving tool. Separate explicit review for the
  EOL/ledger relationship and both pending migrations is still needed.
* **OTC/baseline:** initial apply/baseline receipt and full schema-definition
  comparison on a restored clone remain open. No repair/resolve.
* **Restore:** backup presence is not full restore/readback/key proof.
  Latest selected snapshot, independent secure restore environment, PG18.6,
  same-snapshot64-table/schema/role/ACL/sequence verification and measured RTO
  remain operator gates.
* **Private acceptance:** immutable owner/Ksenia binding proof, source/data
  rights, actual ingress and explicit release approval remain open.
* **Capacity:** Work's proposed2CPU experiment is not executed or authorized
  here and cannot erase the earlier1CPU failure. Retain50+2,
  maxInflight80 and crypto p95<=+5%; no new workload run.

One canonical profiler, keep-alive5000, all financial code, tests, CI,
44+2 packaging and the PG-only launcher remain byte-identical to b2524.
No new Work assignment, changes to Claude, merge, deployment, SQL execution,
paid resource or real financial operation.
