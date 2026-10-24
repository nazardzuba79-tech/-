# Stocks PostgreSQL release contract — owner-approved boundary

Continues `4e7f41498fe744671981300eb7c28ace8ca8596c`. This report supersedes
the pending policy decision in `STOCKS_LEGACY_REVOCATION_DECISION_20261020.md`;
it does not change that report's historical failure evidence.

The owner explicitly authorized retiring legacy SQLite trading from the
supported production release contract on 2026-10-20. No merge, deployment,
production migration, paid resource or new load test is authorized or performed.

## Code changes

- Production server construction now requires an adapter created only after
  the release configuration and PostgreSQL readiness handshake pass. An
  arbitrary authority-shaped object, local path or replacement authentication
  callback cannot satisfy this fence.
- The provenance marker is a module-private WeakSet. It proves startup
  construction, **not user authorization**. The existing per-request and
  pre-COMMIT PostgreSQL Session/User checks remain authoritative.
- Direct `openAccounts` and `openStore` calls reject production before
  creating SQLite/JSON files. The supported release launcher continues to
  reject the presence of legacy configuration, even empty or `false` values.
- Five new boundary regressions were RED before these changes and GREEN
  afterward. The real compiled-route PG release subprocess still starts
  successfully and denies a revoked session.
- A new PostgreSQL regression loses the ACK after COMMIT, replays the receipt
  from two fresh OS processes without another debit, then verifies that a
  fresh process denies replay after Session revocation. Existing assertions
  and financial semantics are unchanged.

## CI contract

`stocks-focused-review.yml` retains the complete existing financial jobs on
Node 24 and exact Node 22.23.3. Their PostgreSQL TAP checks still require
nonzero PASS, zero FAIL and zero skipped tests. Both complete jobs are required
by the new `Stocks PostgreSQL release contract` aggregate check; failed,
cancelled or skipped dependencies cannot produce a successful aggregate.

Auth, queued revocation, active Session locking, pre-COMMIT expiry rollback,
DemoBalance concurrency with Demo Spot, idempotency, isolation, lost ACK,
restart, source freshness and transaction invariants remain covered.
The package, transport and bounded profiler checks remain in the release job.

The unchanged `two-trader-auth-lifetime.test.mjs` now runs in the independent
`Stocks legacy SQLite unsupported control` workflow on Node 22.23.3. It retains
its failing exit status, complete TAP artifact and explicit job summary.
There is no expected-failure inversion, `continue-on-error`, assertion edit,
skip, deletion or hidden failure. Its Git blob was
`d1af5fc7353857d3e5ae60e03fc2c0c2f2c16034`; since the gateway's finance became default OFF (#611 `d362fb80`,
ported in #613) the only change is the explicit fixture opt-in `financialEnabled: true` on its `createServer`
call, giving blob `5c6fa2ef169075061324e294041b0310b6780b9e` (identical to #611). No assertion changed and it
still fails exactly as before: 6 pass, 1 fail «revocation at the worker pre-COMMIT barrier», expected 401,
actual 200.

This intentional red legacy check must not be presented as repaired or as
part of the supported PG release contract. Remote branch protection was not
modified; the release owner must verify the intended required status mapping
when adopting this candidate. A green PG check alone never authorizes release.

## Local verification

All database tests used this task's owned loopback disposable PostgreSQL
17.11 fixture with synthetic identities and cash. It was stopped afterward.
These are bounded functional tests, not load/capacity tests.

| Check | Result |
| --- | --- |
| Node 22.23.3 compiled PG authority + real release subprocess | 23 PASS, 0 FAIL, 0 skipped |
| Node 24.22.0 PG authority + read-only preflight | 23 PASS, 0 FAIL, 0 skipped |
| Node 22 startup and direct storage/factory boundary | 18 PASS |
| Node 22 module loading, keep-alive, profiler, migration/package contracts | 37 PASS |
| Node 24 account contracts, two-trader isolation, existing-only restart, preflight, source bootstrap, harness assertions | 67 PASS |
| API default-off, viewer and wallet projection Jest | 39 PASS in 3 suites |
| Backend TypeScript build with Node 22.23.3 | PASS |
| CI YAML parse, default-off source check, legacy blob identity, git whitespace check | PASS |
| Unsupported legacy SQLite control | **6 PASS / 1 FAIL**, exit 1, no skips |
| Remote exact-head GitHub CI | **NOT RUN** — branch push safety unconfirmed |

The first Jest attempt could not resolve React because this isolated checkout
lacked frontend dependencies. The existing dependency directory with the
identical frontend lock SHA256
`5ef47c521c7676951fe94500474fdd13912afbc58c0253d8a4b8f804ba3d293d`
was linked for read-only reuse; the three affected suites then passed.
Both original failure and successful rerun logs are retained. No test was relaxed.

Legacy failure is still the actual security defect: after UPDATE/before COMMIT,
revocation receives HTTP **200 instead of 401**, and the synthetic reservation
changes **0 to 9**. PostgreSQL PASS does not resolve this unsupported path.

## Production exclusion: source evidence vs deployment proof

Source/isolated-runtime evidence:

- `release-entrypoint.mjs` validates Node 22.23.3, configuration and the actual
  PG authority before listening. No local fallback is selected.
- The release Docker recipe sets `NODE_ENV=production` and the gateway CMD
  selects that launcher. The new constructor/storage tests cover this mode.
- The API router stays disabled by default and its non-injected enabled
  constructor opens PostgreSQL only.
- The existing recipe does not run migrations, seed or reset on startup.
  Migration staging remains strict and byte-preserving.

**Actual image/configuration/ingress gate: BLOCKED.** No Docker executable is
available in this environment; no release image was built or attested. Source
guards are not proof of the deployed topology. Legacy code remains available
for explicitly non-production diagnostics; the image is not an arbitrary-code
sandbox. A configuration/command override must not be treated as approved.

Work must independently attest the final image digest, source/recipe provenance,
actual process entrypoints and Node version, production environment, enabled
PG-only API factory, listener inventory and ingress routes. The inventory must
exclude any old SQLite/JSON trading process and any route to it. Verify that
production mode and launcher are not overridden and that readiness points at
the approved API. No private bindings or secrets belong in public evidence.

## Preserved behavior and remaining release blockers

No changes to PostgreSQL transaction code, engine arithmetic, financial API
routes, JWT/session middleware, DemoBalance, fee/rounding rules, trader
eligibility, quote freshness, provider limits, 50+2/maxInflight 80 or crypto
p95 +5% acceptance thresholds. Work profiler integration and 5000 ms keep-alive
are retained. Frontend, Spot/Futures, Claude's work and Work operator files
are unchanged.

The previous independent gates remain open: historical migration raw-byte
baseline and OTC/KYC receipts; independently verified restore and schema
comparison; private two-trader identity bindings; provider data rights,
MOEX/SBER source restrictions and ingress; actual server capacity/coexistence;
owner release approval. No new performance result or production-readiness
claim is made here.

Fresh GitHub main: `f81df788a8ddcc5d925b827b6e783f6e21dc39fa`.
Draft stack #545/#547/#554 is unchanged; #554 HEAD remains
`ce670d8cc96e46864d3d31d39c1e3a608a0c06bc`. This candidate is not pushed into
that PR. Current Cloudflare/Northflank automatic deployment settings were not
independently confirmed, so delivery is a verified Git bundle rather than push.

## Application and rollback plan (review only)

Import the bundle into an isolated review checkout, verify its recorded SHA,
and inspect the complete delta from #554. After separately confirming push
triggers, publish the review branch and run both workflows on that exact SHA.
Require the PG aggregate while continuing to display the red legacy control.
Do not deploy until Work closes the actual topology and other release gates.

Rollback at this stage is rejecting the isolated review commit/bundle; no
production state changed. Any future runtime rollback needs its own approved
image/configuration plan. It must never re-enable legacy SQLite trading or
fall back to local balances. On PG authority failure, stop financial access.
