# Issue #615: offline pipeline and chart admission

This continues the single source Draft PR #621 from `6acebb03a80cdfd32d44090a1bf723753aad43cf` in the newly published cloud checkout `/workspace/-`. No owner laptop, second terminal, new source PR, merge, deployment or production data/configuration was used. Exact publication SHA and CI links are recorded in #615/#621 after publication.

## Implemented behavior

`scripts/stocks-source-pipeline.mjs` reuses the existing CLMM instruction/transfer reconciler. Its command-line adapter reads and hashes every saved public receipt, verifies saved genesis/finalized signature/transaction scope, binds each execution to its actual event and transfers, and retains raw integer amounts, AMM fees and zero transfer fees separately. It does not call the network or accept caller-supplied PASS flags. The replay deliberately exits **2** while source acceptance is incomplete.

The pipeline library accepts verified minute envelopes. It orders executions by slot, canonical block transaction index and invocation log index; deduplicates signature/log pairs; rejects conflicting duplicates, contradictory block time/order and unsupported transfer fees; and produces deterministic UTC 1m/5m/1h OHLCV only when every constituent minute has all six proof gates. Price extrema use BigInt rational comparisons. Exact decimal strings accompany numeric chart values. Volume is raw base-token amount; the price convention is gross executed vault quote/base, including AMM fee, with zero transfer fees only. It does not apply the issuer's mutable scaled-UI multiplier or claim an original-equity price: `priceKind=raw-token`, `quoteCurrency=USDC`, `equityEquivalent=null`.

Missing/unknown constituent minutes invalidate a larger bucket. Complete no-trade minutes produce `NO_TRADES` gaps, never zero/forward-filled candles. Evicted history produces `OUTSIDE_RETENTION`. Defaults are 180 retained minutes, 10,000 executions and an 8 MiB serialized storage cap. Reads are capped at 1,500 buckets. Conflicts/over-budget ingests fail before changing stored intervals. A checksummed, versioned checkpoint is written through an exclusive temporary file, fsync and atomic rename; recovery verifies checksum, identity, bounds and execution invariants. One local writer is supported. An interrupted `.pending` file leaves the last checkpoint readable and blocks a new writer until inspected; no automatic lock deletion or distributed-writer guarantee is claimed.

`verifyFinalizedCoverage` compares independently enumerated pool signatures with **all** produced finalized full blocks between bracketing times. It checks the produced-slot list, parentSlot/previousBlockhash chain, loaded addresses, successful and failed pool-reference transactions, signature identity and canonical transaction indices. Missing blocks/signatures/address tables or unfinalized data fail closed. This verifier is implemented and tested; the saved historical packet does **not** contain its required complete inputs.

## Chart read contract

The existing `GlobalStocks.tsx` history handler calls `admitStockHistory` before updating its existing `GlobalChart`. No gateway/auth/order/financial route or trading flag was edited. The new read envelope is `voltex.solana-ohlcv.v1`, keyed by `SOLANA:<exact mint>:<exact pool>`, with exact network/program/USDC quote identity, requested interval, aligned range, candle trade counts/proof digests and explicit gaps. Every covered bucket must be represented once as a candle or a gap.

For emitted candles, `provenance.status=ACCEPTED`, `intervalComplete=true`, `finality=finalized`, `synthetic=false`, all six proof gates and valid receipt hashes are required. Here `intervalComplete` means **every emitted candle** is complete; it does not assert that an explicitly marked UNKNOWN gap is complete. A mixed page can contain accepted buckets and explicit gaps. A wholly UNKNOWN envelope admits no numeric rows. Synthetic output, mismatched identity, missing coverage, bad OHLCV, zero volume and unknown schemas are rejected. The frontend checks a trusted transport contract; a receipt hash or a frontend boolean alone is not an on-chain attestation. Only the verifier-backed source writer may eventually serve this contract.

An invalid response clears the source data; a revoked range removes cached candles in that range. Missing buckets render as lightweight-charts whitespace, plus a gap count. Indicator calculations restart after gaps and hover values are cleared when a candle is revoked. Raw token prices are labeled in all seven existing Stocks languages. Unchanged gap pages retain array identity so ordinary CEX polling does not rebuild chart series. Existing CEX pages without own-source provenance keep their established read contract; a SOLANA identity cannot use that fallback.

The original 1m/5m/1h UNKNOWN/incomplete acceptance assertions and no-write assertions remain unchanged. Additional mounted-terminal coverage checks valid-envelope admission followed by revocation. All positive price fixtures are disposable synthetic **tests**, not accepted real quotes.

## Real evidence and cost

Public inputs remain the original SPYx 13 + CRCLx 2 transactions / 30 reconciled transfers for 2026-10-25 10:39–10:40 UTC. No receipt RPC was repeated. Reports under `research/solana-xstocks/proof-615-20261026/` contain the actual pipeline output: **0 accepted intervals / 0 accepted markets**, empty candles and UNKNOWN gaps at every resolution. They are not evidence for 58 verified assets.

The pinned official Raydium PoolState source is now saved with Git blob and SHA256 metadata. Both saved current accounts are exactly 1,544 bytes; source-decoded config, tick spacing, status, fee-on and seed index are reported. This closes offline availability/strict current-layout checks, not deployed-binary correspondence or transaction-time full PoolState. The old 45-byte ProgramData header cannot establish a reproducible executable match.

Measured cloud replay recorded at code `57a8e65c` (Node v24.19.0, one run, not a capacity benchmark):

| Packet | New RPC | Retained state | Replay CPU user/system | Wall time |
| --- | ---: | ---: | ---: | ---: |
| SPYx | 0 | 6,244 bytes | 118,673 / 72,132 µs | 218.143 ms |
| CRCLx | 0 | 1,682 bytes | 35,155 / 37,854 µs | 85.106 ms |

Metrics are process-local observations and vary with runner load. No paid resources were created. A single **new**, read-only `getSlot(finalized)` attempt to `https://api.mainnet-beta.solana.com` was rejected during proxy CONNECT with **403 Forbidden**, before provider completion. Recorded in `rpc-network-blocker.json`: 1 attempt, 0 provider completions, 0 retries, no endpoint/policy workaround. The historical receipt calls were not repeated.

## Remaining facts and forward capture

Program/source reproducible attestation, complete historical blocks/signatures, full historical pool/config state, immutable mint multiplier/effective-time history and fee chronology remain UNKNOWN. The new adapter keeps these five gates false; only execution binding for the saved sample is true. Commercial display rights remain an independent external gate. No live source endpoint/collector or source display has been activated.

`forward-capture-assessment.json` replaces an unbounded historical retry loop with a bounded plan for the same two pools: one future aligned 60-second window, full state before/during, complete produced-block ancestry from before the snapshot through closure, independently bracketed signatures and all relevant pool/config/mint/program writes. Limits: 200 produced blocks, 225 RPC attempts, 2.5 MB per response, 256 MiB total, at least 3 seconds between requests, zero retries; stop at any 403/429/error/unsupported mutation or budget exhaustion. These are caps, not predictions or a provider quota guarantee. One minute cannot establish a complete 5m/1h bucket.

The plan was **not executed**, because ordinary access to the public RPC endpoint is denied. The next permitted access step is an environment-operator allowlist decision for that exact endpoint. Do not substitute providers/transports to bypass policy. Even with access, snapshots alone do not prove intervening mutations, and free public RPC alone does not provide reproducible program attestation. Unknown layouts or unsupported writes must continue to block admission.

## Validation and publication

Source tests on the final implementation: **96 PASS / 0 FAIL / 0 skipped** (52 existing + 44 new). Focused source-admission/gap/viewer/localization tests: **68 PASS / 0 FAIL / 0 skipped**. Frontend TypeScript/Vite build: **PASS**, with the existing large-chunk warning. The full frontend regression is still running at this checkpoint and its terminal result belongs in the PR/issue; no waiver or CI skip marker is used. Prisma Client generation succeeded using only disposable localhost:9 URLs; no bootstrap, migration or DB request was made. An initial ES2020 `.at` type error was corrected in the source, and the exact localization cardinality was updated for the two new fully translated messages.

Only the source test workflow changes: PR-only trigger, read-only permissions, exact source head checkout, Node 22.23.3, source/admission/gap/viewer tests. No dispatch/deploy step, secret, branch protection or production workflow change. Commit subjects start `[CF-Pages-Skip] [skip render]`, without a CI skip marker. Coordinator-provided Render preview/branch checks are retained; no external settings changed. Publication must fresh-check and fast-forward the existing #621 head without overwriting concurrent work.

Claude's #613 gateway, auth, balances, sessions, financial modules and 50+2 harness remain separate. BUY/SELL viewer controls remain silent NO-OP; all production/execution flags remain unchanged/OFF. The implementation and a green parser/test suite do not make Stocks integration-ready.

## Restart/storage follow-up from independent review

The initial `a5a373dd` candidate completed all **9/9 PR workflows successfully**, including exact-head source 90/90, focused frontend 68/68 and full frontend CI. Two independently reproduced storage invariants were then fixed together:

- A signature now has one `(slot, blockTime, transactionIndex)` identity across **all retained minutes**, including UNKNOWN candidates. Multiple log indices of the same transaction remain valid only with that identity. Recovery revalidates this invariant; a recomputed checksum cannot bless a contradictory two-block signature.
- Ingest now budgets the **entire prospective serialized checkpoint** (payload, SHA256 wrapper, newline and final metrics) before committing any state. Counter-width growth on duplicate intervals is included. A successful boundary ingest remains checkpointable; over-cap input leaves intervals, watermark and counters unchanged.
- Recovery enforces the saved byte cap, exact metric fields and unique stored minutes. It restores stored counters while revalidating executions, without charging new hydration CPU digits against a valid exact-cap checkpoint.

New regression tests on the actual old `a5a373dd` module produced **39 PASS / 5 FAIL**; the multi-log positive control passed. The fixed complete source suite is **96/96 PASS**, zero skipped, Node24.19.0. Exact-cap tests freeze only measured CPU counters for deterministic byte accounting, then restore real CPU for recovery. No source gate or UNKNOWN assertion is weakened. Frontend code is unchanged by this follow-up; no second manual full frontend run was started.

The one local Node24 full frontend run finished **295 suites PASS / 1 FAIL; 4,897 tests PASS / 21 FAIL**. The unchanged `adminConsoleInteractions` suite first hit a 5,000 ms timeout, then overlapping act warnings and cascading assertions. Its isolated unmodified run passed **24/24**. This local failure is retained, not waived; the same-tree Node22 full frontend CI succeeded. Raw full-CI log retrieval failed with connector `Transport closed`, and reading the official artifact's returned file URL was denied at proxy CONNECT 403 for `sdmntprcentralus.oaiusercontent.com`; no retry/workaround. Artifact metadata is `12669915583`, SHA256 `e2a777a4caf3dc0cf7a2898c6bee1f188f3cfb391c0ca09113591df6fd63529f`; its JSON was not inspected here, so no exact CI test count is invented.

### Trusted producer boundary

The only implemented envelope producer is the local `replayPacket(directory)` CLI adapter: it hashes saved receipts, checks saved genesis/finality/signature/transaction scope, reconciles exact invocation/transfer evidence, and constructs execution binding=true with **the other five gates=false**. It cannot promote this historical packet to accepted market data. The independent full-block verifier can check completeness if its required raw evidence is supplied; it is not a program or historical-state attestor.

`SourcePipeline.ingest` trusts its caller's verified-envelope booleans. It is an internal offline library, **not a safe writer for untrusted public input**. Its checksum/proof digests detect mismatch within this protocol, not authenticity by themselves. Frontend admission validates a response contract; it does not verify Solana consensus, binary correspondence or historical mint state. Before any future runtime writer/endpoint, a trusted server-side producer must derive every gate from verified raw evidence and bind those results to exact network/mint/pool/window and receipts, without passing through requester-supplied booleans. That complete producer/attestation path is not implemented or proven. No runtime endpoint, public writer or live source feed was opened. Real acceptance remains **0 intervals / 0 markets**.
