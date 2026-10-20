# PR559 bounded code-only follow-up

Parent: `a934cd15c9df8dbefdc46cb2650a18f943b42bc5`.
Owner/CTO scope: Issue558 comment6293020955. Containing commit SHA and bundle
checksum are recorded in the delivery receipt, not a self-referential file.
No push, new PR, label, CI dispatch/rerun, merge or deployment is authorized here.

## Changes

* Docker build and runtime stages now copy the shared
  `services/stocks-simulator/engine.mjs` dependency. Only this math/engine file is
  included, not the simulator server, provider, storage or launcher.
* Offline TypeScript-AST inspection follows gateway static imports, reexports,
  literal dynamic imports and worker URLs. Both image stages must contain every
  relative module. Unreviewed computed imports fail. The current closure is
  25 local modules plus `ws`; external imports must resolve from locked installed
  dependencies, and the recipe must copy node_modules to runtime. The check also
  runs in the Docker build stage before strict SQL verification and compilation.
* The old literal `if (!enabled) return router` CI assertion is replaced by the
  full existing route Jest suite with stronger behavioral assertions. The suite
  is moved, not duplicated or reduced. Existing PG tests, zero-skip/zero-failure
  gates, exact-source aggregate and unsupported SQLite workflow are unchanged.
* The compiled Node22 route test now exercises the real PostgreSQL authority
  factory with fake DB adapters: readiness requires the internal key and verifies
  only schema/bindings; normal sessions may read identity; both financial verbs
  (GET wallet, POST command) return authenticated 403 while finance is OFF;
  absent authentication returns 401; a forged viewer remains denied with finance
  explicitly ON. Financial writes/transactions remain at zero.
* Image failures retain bounded sanitized stdout/stderr, status/signal and partial
  image IDs/CMD/ENTRYPOINT/Node/hash records in console and step summary. An
  unexpected module error remains FAIL; failed cases never become successful
  fail-closed proofs. Each stream is bounded to 8192 UTF-8 bytes plus a truncation
  marker; credential patterns are redacted.
* A future separately approved label run must build the captured PR source HEAD,
  equal to its helper HEAD, rather than accidentally rebuilding the old f97
  Dockerfile. f97 remains the required ancestor; both original strict SQL-checker
  files must be byte-identical to f97. The 44-file manifest and two pending SQL
  hashes remain pinned. Trigger, branch/label restrictions, permissions, runner
  limits and deployment exclusions are unchanged. This is preparation only.

## Actual local evidence

Exact runtime: official Windows Node22.23.3, isolated ZIP verified against the
official SHASUMS256 file (`2b0ff57b049cda1bbcea2240eec20467018713c1efe1f048169ca2b88f3a7cac06755d142a226b8`).
No system installation or Docker installation.

| Check | Result |
| --- | --- |
| Old Docker recipe closure | RED: `RUNTIME_MODULE_NOT_PACKAGED build: services/stocks-global/engine.mjs -> services/stocks-simulator/engine.mjs` |
| Final closure regressions, including single-stage and node_modules omission | 4 PASS, 0 FAIL/SKIP |
| Image diagnostic/CLI/workflow tests | 5 PASS, 0 FAIL/SKIP |
| SQL-byte and exact-source guard tests | 6 PASS, 0 FAIL/SKIP |
| Route Jest (all existing assertions retained) | 15 PASS |
| Backend TypeScript compile | PASS |
| Actual compiled Node22 route/factory contract | 6 PASS, 0 FAIL/SKIP |
| Finance-OFF mutation control | RED as intended: removing the guard from generated dist causes expected403/actual422; original compiled bytes restored, final contract GREEN |
| Docker image execution | NOT_RUN: Docker unavailable locally |
| Full frontend/backend suites, PostgreSQL integration suites, load/capacity | NOT_RUN: outside this bounded validation |
| New GitHub CI | NOT_RUN: requires separate exact-head approval |

The initial new closure checker rejected `ws` until its already existing locked
node_modules packaging was explicitly checked. No dependency or lockfile change
was needed. Node emits its existing experimental SQLite module warning during
the real authority import; this is not a SQLite trading/storage invocation.

## Unchanged evidence and next gate

PR559 run39436792657 remains FAIL at no-authority smoke; its missing stderr cannot
be reconstructed. The missing dependency is confirmed from source, not claimed as
an observed container stack trace. The original PG aggregate FAIL and legacy
SQLite expected401/actual200 FAIL remain visible. No production readiness claim.

Next step requires owner approval to publish the new exact candidate and execute
one new image-only run. Positive PostgreSQL image startup, TLS ingress, provenance/
ledger/restore, private bindings, licensed data and capacity gates remain separate.
Rollback of this code-only patch is the parent review commit; no production state
or balances were changed, so no production rollback is performed or needed.
