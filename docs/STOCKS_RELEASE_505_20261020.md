# Stocks code-only release exclusion candidate — 20 October 2026

Status: **BLOCKED, not a production release or green-CI candidate.**
Continues night `76526f99eec90d1d50005f7efa0c5196d6d16c17`, atop draft #554
`ce670d8cc96e46864d3d31d39c1e3a608a0c06bc`. The containing commit is the
candidate identifier; delivery manifest records its full SHA.

Fresh GitHub fetch before work and again before delivery:
main `f81df788a8ddcc5d925b827b6e783f6e21dc39fa`;
#545 `3e6b88d3daf9d83068c9d911b5ba0e109a2511b6`;
#547 `6cb82e3d16f8bf36d3ec6f7e4ba20950ee633aea`;
#554 `ce670d8cc96e46864d3d31d39c1e3a608a0c06bc`.
All three remain open drafts, unmerged, with the intended stacked bases.
Their existing CI results are **not CI for this candidate**.

## P0: PostgreSQL-only release, with an explicitly unresolved legacy failure

The CTO-authorized exclusion option is implemented. It is not a repair of
the legacy SQLite session protocol:

* `release-entrypoint.mjs` validates exact Node 22.23.3, authority URL,
  capability key, issuer and two distinct immutable subject IDs **before**
  importing the gateway or opening a port. It rejects any presence of
  SQLite/JSON paths, legacy opt-in or the separate legacy identity endpoint.
* A bounded-time readiness request must confirm the actual PostgreSQL API
  path and matching principal digest. Redirects, 404/default-off, unavailable
  authority, wrong mode and different bindings fail closed. No retry/fallback.
* The readiness route exists only for the real, non-injected PG authority.
  It uses the gateway capability, verifies both current unblocked User IDs
  and resolves the three Stocks tables without reading account rows. It
  never binds an account, initializes cash, reads a balance or grants a
  cached trading permission. Human identity-to-ID binding still requires
  the owner's private verification.
* Every subsequent request retains existing JWT and database revocation
  checks. Readiness is not a session/authentication cache.
* Direct legacy `server.mjs` execution with `NODE_ENV=production` is rejected.
  Tests can still import the factory to expose the legacy defect.
* `Dockerfile.release` selects the PG-only gateway launcher. It never invokes
  Prisma migrations, seed or reset. The root Dockerfile is unchanged and
  **must not be used for this release**.

Actual subprocess RED/GREEN: baseline night server, using a canonical
Windows junction path and empty local JSON fixture, accepted production
legacy startup and listened; current executable rejects before listening or
creating files. An initial noncanonical baseline invocation exited without
running the executable guard; that inconclusive attempt is retained, not
counted as the RED proof.

The unchanged mandatory test
`two-trader-auth-lifetime.test.mjs`, “revocation at the worker pre-COMMIT
barrier cannot reserve test cash”, still **FAILS**: expected 401, actual 200,
synthetic reserved cash 0 -> 9. No test was deleted, skipped, weakened,
wrapped as expected failure, or marked continue-on-error. Its unconditional
CI step remains. A separately reviewed CI classification/exclusion decision
or an actual legacy protocol repair is needed; this document is not approval
to make that decision.

## Actual Node 22 + PostgreSQL proof

Runtime: official Windows Node **22.23.3**, bundled Undici **6.28.1**.
Node binary SHA256:
`9c9245166b4a8e182e0b797da9c20136117ff24368eaff1fec8343a123c8db0e`.

Disposable PostgreSQL **17.11**, a new loopback-only cluster and database
`stocks_disposable_release_20261020`, with synthetic users only. It was
stopped after tests. No production DB, `.env`, real identity, balance or
quote provider was used. This is not production image/PG-version parity.

The fixture explicitly selected the **compiled CommonJS Stocks router**,
actual gateway, HTTP authority adapter and real PG authority. Financial
barrier cases use the existing injectable hooks around that real PG
implementation; the new launcher case uses the router's **non-injected**
authority construction and spawns a real release subprocess.

| Verification | Result |
| --- | --- |
| PG financial suite + real release startup | **22 PASS, 0 FAIL, 0 skipped** |
| Release fail-closed subprocess/configuration cases | **13 PASS** |
| Node22 actual ESM/compiled route module checks | **5 PASS** |
| Actual gateway HTTP reuse/revocation | **2 PASS** |
| Final unified profiler/clock/lifecycle/summary | **19 PASS** |
| Strict migration review + new packaging tests | **11 PASS** |
| Route JWT/auth Jest | **12 PASS** |
| Engine, quote freshness, authority adapter, market bootstrap | **26 PASS** |
| Existing cash/permissions/restart/harness/legacy security group | **39 PASS, 1 FAIL**, 0 skipped |
| Backend TypeScript build | **PASS** |
| CI YAML, mandatory legacy-step assertion, diff check | **PASS** |
| GitHub CI for this new commit | **NOT RUN** |

PG cases cover acknowledged revocation before entry, queued intents,
Session-lock/revocation ACK ordering, expiry before COMMIT, lost ACK and
receipt replay, idempotency, simultaneous Demo Spot/Stocks reservation,
partial sales/cancellation/PnL, fractional quantities and account separation.
Revocation waiting on an already-held Session lock cannot acknowledge until
the transaction completes; the tests do not demand an impossible retroactive
rollback. Durable post-COMMIT receipts remain durable; a revoked session
cannot regain authority through replay.

The financial authority, engine, shared auth middleware, DemoTradingService,
schema/SQL, frontend, Spot/Futures and Claude History20 sources are unchanged
from the night candidate. There was no frontend rebuild or browser run for
this backend/harness-only change.

The CI source now adds disposable PostgreSQL execution through the compiled
router on Node22, retaining the Node24 job and all original financial
assertions. No claim that this unpushed workflow has run on GitHub.

## One profiler; Work artifact actually inspected

Retrieved the binary Work bundle from Git blob
`23be44cf668ca8d66cb2ecaea3ee83551d4ef3f9`: **80,426 bytes**, SHA256
`e00ed6ac52b8f57f865c7eadfd9d635664e714f0e10684729843961ddb905011`.
Bundle verification/import PASS at local review ref, head
`ce38bb1aec8464b69c02c1f36f9841bfaee572fa`, including diagnostic
`ed9e01c589f7b2a6c640fac5961e729414874ff8`. No blind merge.

Retain one observer implementation: `cpu-http-profile.cjs`, one lifecycle
`profile-session.cjs`, one summary helper. Import Work's pure
`profile-clock.cjs` for IPC brackets; **do not overlay** Work's separate
`cpu-profile.cjs`, `http-profile.cjs`, `profile-session.install`, runner or
source pins. Work's server/operator scripts were not edited.

| Contract | Night Codex | Reviewed Work | Consolidated |
| --- | --- | --- | --- |
| CPU window | 45 s | 5 s | **5 s maximum** |
| CPU nodes / samples | 20,000 / 60,000 | 10,000 / 12,000 | **10,000 / 12,000** |
| Serialized evidence cap | none | 4 MiB CPU profile | **4 MiB entire capture** |
| HTTP events | 20,000 | 24,000 | **20,000** |
| Stop overrun gate | cooperative timer only | 250 ms | **250 ms, including inspector stop** |
| Cross-process clock | not measured | IPC brackets | **same Work bracket utility, before/after** |

Drops, overrun, byte cap, CPU capture error and clock uncertainty invalidate
evidence. Lifecycle rejects invalid evidence after cleanup; it never retries
the supplied workload. Default-off installs no observers. The same 5001 ms
bound assertion fails against the night profiler and passes against this
candidate. Native Node22 header/correlation tests and keep-alive **5000 ms**
remain intact.

The existing acceptance runner/source admission and workload policy were
not altered. The consolidated lifecycle is a harness-only adapter, not a
new workload run or an automatically enabled runner. Work must select it
when preparing a separately authorized diagnostic entrypoint; do not
combine the two APIs. Raw profiles still do not measure PostgreSQL/native
Prisma CPU or prove the total 50+2 bottleneck. No new load test was run.

## Migration packaging: byte preservation, not permission to apply SQL

`stocks-release-package.cjs` is filesystem-only. It requires Work's verified
**44-file production snapshot and raw-file manifest**, copies those bytes
without EOL normalization and adds exactly these two pinned Git/LF payloads:

* `20261016000000_stocks_test_cash_authority`:
  `0cfe2bc2e8b0c847a5da87c87db76b0e8ed214e3df4ed29f1b953c22c459a5cb`
* `20261016170000_native_funding_model`:
  `3fb628ed357985986033bb7fdb3634fe8888f8a8e78cffa31cfafb84f78ff8d8`

Do not feed Windows checkout-transformed pending SQL. Export pending Git
blob bytes without changing historical files. The stage operation refuses
existing output, changed history, altered pending bytes and missing/extra
migrations. It reuses the unchanged strict raw-byte review gate. Tests use
44 explicitly synthetic CRLF history files plus the two actual Git blobs;
they prove copying/rejection logic, **not production provenance**.

The optional source-only Docker recipe verifies this package, pins
Node22.23.3, compiles the backend, and has separate `api` and `gateway`
targets with direct Node commands. It does not package the frontend or
establish ingress/network placement. It was **not built or deployed**.
Actual historical snapshot, production image bytes, pinned Prisma engine,
ledger EOL-variant provenance and restore proof remain Work's gates.
No checksum repair, `migrate resolve`, SQL application or ledger mutation.

## Delivery and remaining gates

Current browser inventory exposes only empty MCP Apps, not an authenticated
Cloudflare/Northflank browser. Their current automatic deployment triggers
cannot be verified here. Therefore no branch push/new Draft PR or GitHub
workflow dispatch; deliver a verified incremental bundle on #554 instead.
Existing #554 CI remains a separate old-head result.

Before any release:
1. Resolve/classify the strict legacy CI failure through explicit review.
2. Review the PG-only launcher and build exact images; independently verify
   real private principal bindings and ingress configuration.
3. Work: historical SQL/engine/ledger provenance, backups and restore,
   controlled migration/release approvals and rollback instructions.
4. Complete separately authorized 50+2/maxInflight80/crypto p95 <= +5%
   capacity evidence; no new CPU causation or resource sufficiency claim.
5. Confirm provider rights and source admission. MOEX/SBER remain blocked.

Review application: import/verify the bundle against #554, inspect the
night parent plus this delta, then run the unchanged mandatory CI. Do not
overlay Work profiler files. Rollback of this **unpublished source review**
is to retain #554/night unchanged or revert the new commit; no production
rollback operation or migration reversal has been performed.
