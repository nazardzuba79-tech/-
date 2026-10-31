# QVTR isolated append-only candidate — 2026-10-31

This is an offline model and local administrative tool, never a public price provider. No production route, timer, migration, order engine or managed registry is changed. `HISTORY_LOCKED` and the public integer-hour ListingConfig schema remain intact. The source JSON in `config/isolated/` is a captured production read, not an importable replacement listing.

## Observed production

- Read-only authority: `qvtr-19568743`, active version 1, draft revision 1; countdown `running`.
- Listing: 2026-10-28 13:00 UTC; initial 0.0140; seed `qaventra-20261028-v1`; `tradable:false`.
- All fields present in the repository QVTR draft match the saved active configuration. Saved stable profile is COMPRESSION_BREAKOUT, wick model NATURAL_V1.
- Public Worker read: 2026-10-31 **14:34:47.925 UTC**; price **0.1623112598 USDT**, explicitly `TEST · NOT TRADABLE`.
- Last fully completed observed 1m candle: **14:33–14:34 UTC**, O 0.1624788745 / H 0.1625123668 / L 0.1619778789 / C **0.162218531**. The 14:34 candle was still forming and is not sealed as completed.
- Captured 1000 minute rows (999 completed); all completed OHLC are checked against the existing deterministic generator. This is a finite observed sample, not an export of all production storage.

## Candidate schedule (all UTC)

| Point | Time | Price |
|---|---|---:|
| Planned model boundary | Oct 31 15:00 (17:00 Kyiv) | 0.1619066813 |
| Acceleration checkpoint | Oct 31 18:30 (20:30 Kyiv) | 0.53830 (+3745% from listing) |
| Correction begins | Nov 1 02:00 (04:00 Kyiv) | 0.53830 |
| Provisional correction completion | Nov 1 18:30 (20:30 Kyiv) | 0.32298 (−40% from checkpoint) |
| Rejoin original phase endpoint | Nov 2 01:00 | 0.352 |
| Original consolidation end | Nov 3 01:00 | 0.352 |
| Original growth end | Nov 6 01:00 | 0.685 |
| Original pullback end | Nov 7 01:00 | 0.51 |
| Original recovery end | Nov 10 01:00 | 0.818 |

The planned boundary/anchor is **projected from the captured unchanged v1 model**, not an already observed production candle. No production amendment is prepared for execution. If the boundary or target has passed, a live-clock append refuses it; rebuilding the sealed offline artifact does not make it eligible for live use. A fresh verified boundary and owner-approved completion time are required for any later environment integration. Local micro-extrema may exceed a checkpoint; the unchanged hard maximum is 0.88858.

## Architecture and operation

`IsolatedScenarioJournal` is an inert service with no registration in the production application. It accepts a trusted caller principal; adapters must derive identity/role from server authentication. The supplied administrative adapter is a **local CLI**, protected by OS account and directory permissions, with the OS username recorded as author. It is not a remotely authenticated admin UI. No public/admin web route has been added.

Each append records revision, effectiveAt, createdAt, author, reason, full program, previous hash and hash. A filesystem `wx` lock serializes writers; expectedRevision rejects stale requests. Writes append one JSON line and fsync it. Reload verifies the source identity/hash chain, sequence, timestamps, price continuity and cap. There are no edit/delete operations. Interrupted/truncated records and stale locks fail closed; retain the file and investigate rather than auto-truncating history. The hash chain detects corruption; it is not a signature against a host administrator with write access. Local storage is not a distributed production store.

Effective boundaries are future, at least 60 seconds ahead, aligned to 5m. The old canonical generator owns every tick through the boundary. The new canonical generator opens at exactly its prior close; completed historical candles are retained verbatim at 1m/5m/15m/1h. A candle still forming at the boundary may acquire future extrema, but its previous ticks are preserved. All future intervals aggregate the same canonical minutes/ticks. The offline fractional-hour DTO reuses the existing controls schema, math and seeded ticks. A local presentation adapter folds canonical minutes to 5m because the frozen public aggregator assumes 5m inputs; all shared production source bytes remain unchanged. The proposal it cannot be published through the public ListingConfig schema.

```powershell
node scripts/qvtr-isolated-preview.cjs
node scripts/qa-qvtr-isolated-preview.cjs
# Artifacts: artifacts/qvtr-isolated/{index.html,proposal.json,journal.jsonl,series.json,preview-*.png}

# Local OS administrator, real clock; source is the captured fixture.
node scripts/isolated-scenario-admin.cjs history LOCAL_JOURNAL config/isolated/qvtr-source-20261031.json
node scripts/isolated-scenario-admin.cjs preview LOCAL_JOURNAL config/isolated/qvtr-source-20261031.json PROPOSAL_JSON
node scripts/isolated-scenario-admin.cjs append LOCAL_JOURNAL config/isolated/qvtr-source-20261031.json PROPOSAL_JSON EXPECTED_REVISION "Reason"
```

Preview does not persist a proposal. Only explicit local `append` creates a journal record. The artifact builder uses the captured observation clock solely to reproduce the historical offline experiment; the administrator CLI has no clock override. Existing journals reload without a duplicate append.

## Validation and release boundary

- RED control: unchanged QVTR does not produce 0.53830 at the accelerated target. GREEN: proposed path hits both exact checkpoints.
- Targeted tests cover observed OHLC parity, immutable historical OHLCV on four intervals, reload, multiple revisions, preview isolation, authorization, CAS, future limits, cap, anchor, tampering, truncation and WAVES endpoints.
- Browser artifact QA uses Chromium at 1440 and 390, four intervals each, reload, no horizontal overflow, no page errors and zero network requests. This verifies the offline preview only.
- Exact commit CI builds/screenshots an artifact named with the PR head SHA. No workflow has deployment credentials or a deployment step.
- The browser workflow pins Ubuntu 24.04: Playwright 1.56.1 rejects the newer Ubuntu 26.04 runner before launching a browser. The general OTC workflow also exposes the existing Banking referral month-overflow fixture (`setUTCMonth` from Oct31); its file and Banking runtime are byte-identical to main in this PR. That separate integration blocker is not a QVTR pass and has not been hidden or disabled.

Rollback of this code-only PR: discard the candidate branch/artifact. Retain any local audit journal; a later isolated scenario change must be another future revision. Production rollback is unnecessary because nothing was installed there. No production authorization is implied by this PR.

