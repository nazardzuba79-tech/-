# Issue 615: bounded cloud-only on-chain evidence, 25 October 2026

## Verdict

**Partial technical evidence; NOT a verified price feed or completed interval acceptance.** No production/frontend/trading changes. The existing #613 integration candidate is untouched; no duplicate PR or indexer created. This is one local continuation of the existing research branch, not a replacement catalogue.

Source base: `86ab8044403d368df69b00e93e37b89f0644bcd3`, a descendant of existing `research/stocks-onchain-proof-615-20261025` at `8d69ac8e35fb07d1c7275d17df5402eac292770a`. Fresh main `63d6b02cd38fe9ff52742c35ce46fa327827dd33`; #613 `18064917420ecea2d393dc92e2c66ba89e29e472`.

## Measured result

The explicit interval is **2026-10-25 10:39:00 inclusive to 10:40:00 exclusive UTC**. No adaptive selection of a favorable interval.

| Evidence | SPYx | CRCLx |
|---|---|---|
| Fresh official issuer exact mint | PASS | PASS |
| Finalized pool owner + exact mint pair | PASS, slot 461227523 | PASS, slot 461227871 |
| Both vault mint + authority + token program | PASS | PASS |
| Current mint decimals | 8, matches pool | 8, matches pool |
| Bounded signature history | 100 rows, bracketed | 100 rows, bracketed |
| Successful transactions in interval | 13 | 2 |
| Exact-program/exact-pool SwapEvent-shaped candidates | 13 | 2 |
| Canonical ordering of observed same-slot transactions | PASS via finalized block signatures | PASS via finalized block signatures |
| Fully verified swap/price/volume interval | **NO** | **NO** |
| Issuer-adjusted stock price or OHLCV generated | **NO** | **NO** |

These are **2 fresh structural identity proofs and 15 event candidates, not 15 economically verified fills**. CRCLx is a new structural observation beyond the original historical seven; do not label this eight fully proven markets. The other 56 discovery candidates were not newly chain-verified. Historical 58 iframe loads, 36 snapshot-screened candidates and earlier seven pool proofs remain separate observations, not upgraded by this capture.

Final manifests are `research/solana-xstocks/proof-615-20261025/{SPYx,CRCLx}-replay-final/manifest.json`. Each gives mint, pool, vaults, slots, full transaction signatures, event offsets, amount and fee fields, exact RPC parameters, timestamps and SHA-256 receipt hashes. The final replay uses **zero network requests**, revalidating cached receipts against the final script. Original request timestamps remain intact; replay time is not a new on-chain observation.

## Bounds and honest failure receipts

- 34 actual RPC requests across recorded attempts and resumptions, plus two standalone read-only diagnostics (getSlot and mint metadata), **36 total**. No 429, no automatic HTTP retries. HTTP issuer requests are separately recorded, not counted as RPC.
- Requests are allowlisted read-only RPC, finalized commitment, 3-second spacing, maximum 60 RPC, maximum 300 history signatures and 20 transaction reads per invocation. Unknown event layouts, errors, missing finality/time, bad stacks, wrong mint, duplicate signatures and unbracketed windows fail closed.
- First local attempt mistakenly used the truncated CAIP identifier as the genesis hash. The failure receipt is retained and the pin was corrected to the full independently documented genesis hash; a regression test protects it. This was a local verifier mistake, **not** a wrong Solana network.
- The next attempt stopped on RPC `-32015` because a version-1 transaction required `maxSupportedTransactionVersion: 1`. Compatibility was corrected and only missing requests were sent; successful raw receipts were hash-checked and reused. No error or signature was dropped.
- The CLI exits 2 while interval acceptance is incomplete, even when evidence capture succeeds. No output directory can silently overwrite an earlier capture.

## Why the interval is not accepted

1. Exact deployed CLMM program account/ProgramData identity and last deployment slot `459932378` are captured. Pinned public source is **not** proof that its binary matches that deployment. Source/binary correspondence remains unverified.
2. Current finalized pool/vault/mint snapshots do not independently establish every historical configuration at transaction execution.
3. One bounded RPC history page bracketed the interval, but independent completeness/pagination guarantees are not proven. Null/missing history must not become an empty-trade minute.
4. Current Token-2022 scaled UI configuration and issuer multiplier history/current responses are captured, not a complete on-chain multiplier/transfer-fee chronology. Fees in events are retained separately; no net execution price convention is silently chosen.
5. Exact-program/exact-pool event candidates still need instruction/account binding and unambiguous token-transfer reconciliation, including CPI/multiple-swap cases. Vault deltas alone are not used as swap evidence.
6. Display/commercial rights are not established by technical public-chain access.

No OHLCV or zero/forward-filled candles were generated. `swapEventVerified`, `intervalComplete`, `multiplierChronologyVerified`, `commercialRightsVerified` and `productionReady` stay false. Unknown Orca/Meteora decoders are not classified PASS.

## Reproduce

Offline, no network:

```sh
node --test scripts/stocks-verify-clmm-proof.test.mjs
node scripts/stocks-verify-clmm-proof.mjs SPYx 2026-10-25T10:39:00Z 2026-10-25T10:40:00Z /tmp/spyx-new-output research/solana-xstocks/proof-615-20261025/SPYx-final
```

The replay command deliberately exits 2 (NO GO); its manifest records zero RPC. Use a new output path each time. For a newly authorized bounded live interval, omit the cache directory; never reuse an old receipt as fresh current evidence.

**Tests:** Node `v24.22.1`, 25/25 PASS, zero skipped/todo; script syntax and `git diff --check` PASS. Includes real public receipt replay (15 candidates), incorrect pools/programs/directions, unsupported lengths, event fees, failed/truncated CPI logs, window boundaries, duplicate/unfinalized history, genesis pin and one-shot output. These are verifier tests, not full repo CI, Node22 qualification, browser QA or deployment acceptance. No CI dispatch occurred.

## Existing catalogue integration, not a second catalogue

The research manifest is an evidence envelope keyed by exact `(network,mint,pool)`, not a runtime price source. A future frontend-owner change may import only explicit reviewed evidence into the existing `onchainPoolCatalogue.ts`; never join by ticker alone, and never convert iframe/Gecko availability to swap verification. Preserve existing default-OFF/local-only guards and all silent financial controls. This task deliberately edits **no** `frontend/src/pages/stocks/**` file.

## #613 next-stage gates

Fresh current-head-associated checks: **37 check runs: 34 success, 2 failures, 1 skipped**. Stocks PG/release/hosted/ingress passed. Failures: legacy unsupported SQLite revocation and Support `verify` in run `40117991696` (job `120943228326`). These PR runs may use a synthetic merge tree; do not call all of them head-only tests. Support's exact name-body assertion failure is not proven to originate in Stocks. No test weakened or rerun.

Earlier Stage A functional PASS is retained. Existing crypto p95 +5% failure/inconclusive evidence remains; no new benchmark authorized or run here. On-chain proof, commercial rights, release routing/configuration/identity/restore and explicit merge/deploy approval remain separate gates. No automatic release.

Publication is blocked because current external auto-deployment settings cannot be independently verified from this cloud session. Branch, patch, bundle and raw receipts are saved locally for recovery; **nothing pushed**, no PR created, no production config changed.

## Sources

- [Official Raydium source, pinned commit](https://github.com/raydium-io/raydium-clmm/blob/edfc5c0a0cd8084ed694668391174a35b5246cf5/programs/amm/src/states/pool.rs). Current Borsh event length is 221 bytes; AMM fees at offsets 205/213 and transfer fees at 144/160. No claim that a length change was found.
- [Solana full genesis hash vs CAIP identifier](https://solana.com/docs/payments/agentic-payments/x402).
- [Issue 615 acceptance](https://github.com/nazardzuba79-tech/-/issues/615#issuecomment-6396166453).
- [Canonical PR 613](https://github.com/nazardzuba79-tech/-/pull/613).

## Offline reconciliation continuation — 2026-10-25 11:02 UTC

Supersedes the earlier `INSTRUCTION_BINDING` blocker for the fixed 15 receipts only.
No new RPC calls. New `stocks-reconcile-clmm-receipts.mjs` maps every recorded invocation to its compiled outer/inner instruction and stack height, resolving writable then readonly loaded addresses. All 13 SPYx and 2 CRCLx transactions reconcile:

- exact CLMM `swap_v2` discriminator, pool, ordered vault/mint pair, token programs;
- event sender and both user token accounts against that particular invocation, not any same-program invocation in the transaction;
- exactly two direct, unnested TransferChecked child calls, expected source/mint/destination/authority, integer amounts, decimals and historical token program;
- both historical pre/post vault balance records: mint, owner, decimals, token program and exact signed raw-amount delta. Thus historical **vault identity and observed transfer outcome** are no longer wholly unavailable.

All observed transfer fees are zero; nonzero-fee paths fail closed instead of extrapolating a fee schedule. Raw integer quote/base rational arithmetic is recorded solely for reproducibility, not published as prices. The report preserves zero accepted intervals, null published OHLCV and no production-ready state.

Issuer multiplier chains are internally consistent, terminal-page complete, contain no recorded in-window change, and agree with subsequently captured mint state: SPYx 1.005714560286254; CRCLx 1. Current agreement is **not** historical mint-update execution proof. No adjusted price is accepted.

### Precisely what still blocks acceptance

| Gate | Available fact | Unavailable fact / next necessary evidence |
| --- | --- | --- |
| Instruction/event binding | Implemented and passes all 15 saved receipts, under pinned source schema | No unfinished binding implementation for this zero-fee SwapV2 sample; other instruction variants intentionally unsupported |
| Historical vault transfer identity | Implemented; transaction metadata and child CPI agree exactly | Full historical PoolState/config accounts are absent; current pool snapshot cannot prove every historical configuration field |
| Deployed program schema | Current ProgramData header says last deployment slot459932378, earlier than sampled swaps; source pinned edfc5c0a | No complete executable capture/hash or reproducible source-to-deployed-binary attestation; saved 45-byte header cannot supply either |
| Minute completeness | Single RPC signature page brackets the interval; observed same-slot ordering checked | No independent complete block/transaction stream for every slot in the minute. Saved getBlock receipts only cover observed same-slot groups; offline code cannot prove omitted transactions do not exist |
| Multiplier chronology | Issuer chain and later mint snapshot agree; implemented consistency checks | Historical mint state or complete mint-update instruction history at/before interval absent; issuer can revise history. Current snapshot cannot establish historical schedule execution |
| Fee chronology | All 30 observed transfers reconcile without transfer fees | Sample zero-fee execution does not establish mint fee/config history for omitted transactions; no fee schedule is invented |
| Commercial display | No permission changed | Explicit source/provider rights decision remains external, separate from mathematical proof |

These are missing facts in the fixed packet, not requests to expand to58 pools. Independent implementation possible from this packet is now completed for its supported sample. Further acceptance requires narrowly authorized additional historical/attestation evidence, not another replay of the same receipts.

Tests: original25 plus new27 = **52/52 PASS on Node24.22.1 and Node22.23.3**, zero skips. New negative controls reject corrupted pool/vault/mint/program/sender/user accounts, CPI amount/decimals/layout/nesting, historical vault metadata/delta, loaded keys, and inconsistent/paginated/in-window multiplier histories. One initial test-only assert.throws argument typo produced20/21 before correction; no verifier assertion was weakened. No browser/full CI claimed. Pinned SwapV2 source copied from official Raydium revision above; source license belongs to upstream.

## 2026-10-26 publication reconciliation

This document's earlier local-only/push-blocked statements describe the 25 October checkpoint. The public source-only delta from `86ab8044` to `668a377a` is now restored on main `63d6b02cd38fe9ff52742c35ce46fa327827dd33`, without its parent frontend preview, Wallet/History data, or Claude #613 runtime. Both capture and reconciliation scripts plus immutable public receipts are preserved byte-for-byte. Exact Node 22.23.3 replay: **52/52 PASS, no skipped tests, zero new RPC**. No fully accepted intervals, production OHLCV, or rights acceptance are claimed.

The separate `stocksSourceAdmission.test.ts` is a coordinator-owned **future feature acceptance test**, not a claim that an active Solana adapter or a new source API exists. The existing mounted terminal has no source-proof admission boundary: synthetic UNKNOWN/incomplete rows currently reach the chart at 1m/5m/1h (three RED cases), while empty history remains empty (one PASS). Existing CEX provenance cannot be assessed from this synthetic response. The dedicated CI job honestly fails until an agreed source-admission contract is implemented; assertions are not disabled and failures are not ignored. This draft is reviewable, **not merge-ready or release-ready**.

Publication protection: new unmatched review branch; commit subject starts `[CF-Pages-Skip] [skip render]`, no CI skip marker. New workflow is PR-only, read-only permission, exact head checkout, tests only, no secrets, manual dispatch or deployment. Existing deploy workflows unchanged. Coordinator freshly checked Render previews OFF and no service tracking this new branch. Northflank's last confirmed configuration had no projects/VCS; current login prevents a fresh read, a disclosed freshness limitation rather than a proven trigger. No settings, production, balances, trading flags, main or merges changed. Exact pushed SHA and CI results belong in the PR and Issue #615.
