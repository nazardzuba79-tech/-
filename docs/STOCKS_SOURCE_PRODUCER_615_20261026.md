# #615 source producer boundary follow-up

Base: fresh source head `227b6ddd714e3b51b64a2b6852d46d7cee5b22b0` in the existing Draft PR #621, preserving concurrent code `278fab958f722717bd39968c82245138b0765294`. Claude integrates the earlier fixed `446970c1` separately into #613. This follow-up changes no frontend/nativeCandles/auth/financial code and does not write to Claude's branch.

## Existing factory retained

`replayPacket(directory)` already constructs a minute envelope from receipt hashes, saved genesis/finality/signature/transaction scope, decoded events and the existing CLMM invocation/transfer reconciler. It accepts no gates parameter, and constructs five gates=false plus executionBinding=true itself. `SourcePipeline.ingest` remains a trusted-caller library; the synthetic positive machinery in `stocks-source-pipeline.test.mjs` is not a public writer or proof of a real market. There is no second producer or runtime endpoint.

The narrow addition binds this **historical archive adapter** to the already-published repository evidence. It reuses acquisition's existing `PILOTS` identities and a path-only `source-producer-profiles.json` index. Its four anchors are the two original `*-replay-final/manifest.json` records and the two concurrently published `windows-executions-1793034915829/*/manifest.json` records. There is no new ticker/mint/pool registry or scan of caller-controlled folders. It checks:

- approved SPYx/CRCLx profile and exact network/mint/pool/window;
- a complete, unique set of receipt file/URL/method/parameters/status/SHA256 identities matching the pinned archive;
- a complete, unique set of transaction signatures/slots/times/canonical indices matching that archive;
- the original raw receipt SHA256 checks and existing pool/event/instruction/transfer verifiers afterward.

Receipt/transaction row order and capture bookkeeping are not acceptance facts. Manifest `PASS`, gates, attestation claims, productionReady or numeric OHLCV cannot raise a gate or supply prices. Rehashing a rewritten receipt and updating its manifest is insufficient because the published archive's receipt binding is the anchor. Raw-byte corruption is still rejected by the original verifier.

This is **repository-archive integrity and scope binding**, not independent cryptographic proof of Solana consensus or a deployed program. The trusted archive/code can only establish the limited facts already recorded there. A caller that controls the repository trust anchor itself is outside this adapter's boundary. New future captures are not silently accepted under this historical profile; they require separately reviewed evidence provenance and verifier support.

## Missing evidence is named, not promoted

The producer report now gives a reason for each false gate:

| Gate | Missing fact |
| --- | --- |
| programIdentity | Full executable plus reproducible deployed-source attestation; the 45-byte ProgramData header is insufficient |
| poolState | Full execution-time pool/config state and reconstruction of all intervening relevant mutations |
| mintChronology | Historical on-chain mint/scaled-multiplier changes and effective times |
| feeChronology | Historical mint transfer-fee configuration, epochs and intervening changes |
| completeness | Independently enumerated complete produced blocks and signature streams bracketing the entire interval |

Both published epochs are preserved: the original 13 SPYx + 2 CRCLx transactions and the concurrent Windows packet's 8 SPYx + 3 CRCLx transactions (26 distinct candidate transactions / 52 transfers in total). Each bundle still yields **0 accepted intervals / 0 markets**, empty OHLCV and UNKNOWN gaps. This cloud follow-up acquired none of those receipts and performed no RPC. No manifest declaration substitutes for these facts. Commercial/display rights remain separate.

## Minimal forward-capture protocol, not another collector

`forwardCaptureProtocol(ticker, from, to)` produces an offline `voltex.solana-forward-capture.v1` planning record for one aligned 60-second UTC window and one of the same two pilots. It reuses the published assessment's caps: 200 produced blocks, 225 RPC attempts, 2.5 MB per response, 256 MiB total, at least 3 seconds spacing, zero retries. These are upper bounds, not provider quota guarantees or measured capacity.

Its phases specify full pre-window account/executable state and context slots; complete finalized produced blocks plus independent signatures from before that snapshot through closure; all relevant during/after writes, canonical positions, epochs and effective times; reuse of `verifyFinalizedCoverage` and existing reconciliation offline; and program/state/chronology verification before any acceptance. Unknown layouts/mutations/fees, missing history, HTTP403/429 or budget exhaustion must stop capture. Snapshots alone cannot prove intervening updates.

The function has no network operation, callback, collector activation or gate-input parameter. It always returns `PLAN_ONLY_NOT_EXECUTED`, zero network requests/accepted intervals, and the five missing-evidence requirements. Its absolute UTC bounds are protocol metadata, not a freshness attestation; an eventual authorized collector must select a genuinely future window and capture pre-state before it. Normal network authorization for the blocked public RPC endpoint and implemented verifiers are still required. No capture, new RPC, blocked artifact fetch or proxy/provider workaround occurred here.

## Verification and publication scope

Local Node24.19.0: **143 PASS / 0 FAIL / 0 skipped** (108 concurrent-head checks + 35 producer/protocol checks). New negative fixtures are temporary copies of the public archive; positive synthetic execution fixtures stay in the existing separate pipeline test file. Cases include forged gates, identity/window/signature/index mismatch, missing/duplicate receipts/transactions, endpoint/finality rebinding, rehashed fake signatures, raw corruption, bookkeeping/order controls, protocol window bounds and a fetch-disabled zero-HTTP check.

The concurrent Linux/Windows source-test matrix, capture transport tests, immutable-byte .gitattributes and all new public receipts remain unchanged. Only source workflow test wiring adds the producer test file. PR-only/read-only permissions, exact-head checkout and Node22.23.3 remain unchanged; no dispatch/deploy step, timeout or production workflow change. No repeat manual full frontend run: frontend bytes are unchanged. Exact published SHA and CI results belong in the same #615/#621 checkpoint. This follow-up is not a claim of a complete trusted live producer, accepted market feed, integration readiness, merge or deployment authorization.

## Concurrent-head reconciliation

Fresh publication checks discovered `227b6ddd` before any update_ref call. The prepared old-base object `7adbbb753cc223708e0d5d21238b9b0a4716ae14` was never attached to the PR branch. The follow-up was reconciled locally onto227b6ddd, retaining all81 concurrent changed paths and both append-only handoff tails. Source scope binding was extended to the already-published second epoch, so neither existing fresh-evidence regression is rejected or weakened. No Windows session, acquisition process or #613 branch was controlled. Publication was paused before any stale-head ref update. The coordinator independently audited227b6ddd (108/108 Linux,108/108 Windows,68/68 frontend,9/9 workflows) and authorized safe continuation on that head; a new exact-head check is still required before publication.
