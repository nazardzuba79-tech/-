# QVTR future-boundary isolated candidate — 2026-10-31

This code-only candidate belongs to Draft PR #665. It is a local model, never a public price provider. Production routes, timers, listings, financial executions and balances are unchanged. `HISTORY_LOCKED` and every existing shared generator source byte remain intact.

## Exact committed candidate

- Plan: `config/isolated/qvtr-candidate-20261031.json`.
- Full sealed proposal: `config/isolated/qvtr-future-20261031-1630.json` (program, effectiveAt, source hash/version, projected anchor and deadline).
- Source: `config/isolated/qvtr-source-20261031-refresh.json`; the prior snapshot is retained unchanged.
- Future boundary: **2026-10-31 16:30 UTC / 18:30 Kyiv**. Earliest affected interval starts there. Projected anchor: **0.1573959405 USDT**, derived from unchanged source v1 at the future boundary, not claimed as an already observed production price.
- Local real-clock admission deadline: **16:29 UTC** (60-second minimum lead). If missed, rebuild a new future-boundary candidate; never backdate or replay it into public history.
- Source SHA256: `c8b1daedc8841f9ecc3883c3fb791e5c22c73c16b9d5b27c647b1d7a8ddf0036`.

| Point | UTC | Kyiv | Price |
|---|---|---|---:|
| New model boundary | Oct 31 16:30 | Oct 31 18:30 | 0.1573959405 projected |
| Acceleration checkpoint | Oct 31 18:30 | Oct 31 20:30 | 0.53830 (+3745% from 0.0140) |
| Correction begins | Nov 1 02:00 | Nov 1 04:00 | 0.53830 |
| Approved correction completion | Nov 1 18:30 | Nov 1 20:30 | 0.32298 (−40%) |
| Rejoin original phase endpoint | Nov 2 01:00 | Nov 2 03:00 | 0.352 |
| Original consolidation end | Nov 3 01:00 | Nov 3 03:00 | 0.352 |
| Original growth end | Nov 6 01:00 | Nov 6 03:00 | 0.685 |
| Original pullback end | Nov 7 01:00 | Nov 7 03:00 | 0.51 |
| Original recovery end | Nov 10 01:00 | Nov 10 03:00 | 0.818 |

The owner approved the correction completion in the latest instruction. Local micro-extrema may exceed a checkpoint; the hard ceiling remains 0.88858. The original WAVES endpoints, remaining durations, seed, varied wicks and short counter-moves remain. This is an explicitly labeled model, not actual executions, liquidity or investment performance.

## Read-only production evidence

- Authority: `qvtr-19568743`, active version 1, draft revision 1; countdown `running`, `tradable:false`.
- Listing 2026-10-28 13:00 UTC; initial price 0.0140; seed `qaventra-20261028-v1`; saved profile COMPRESSION_BREAKOUT / NATURAL_V1.
- All repository QVTR draft fields match the saved active configuration; it also matches the prior authority snapshot exactly.
- Public observation **2026-10-31 15:16:20.375 UTC**: price **0.1595784109 USDT**, `TEST · NOT TRADABLE`.
- Last completed observed minute: **15:15–15:16 UTC**, O 0.1679653097 / H 0.1681817939 / L 0.1609247284 / C **0.1609564247**; the 15:16 candle was still forming.
- All 957 overlapping completed OHLCV rows from the previous snapshot remain identical. All completed OHLC rows in the refreshed 1000-row sample are checked against the unchanged canonical generator. This is finite observed evidence, not an export of all production storage.

## Append-only implementation and isolation

`IsolatedScenarioJournal` is an inert service with no registration in production. Each append stores revision, future effectiveAt, createdAt, author, reason, program, previous hash and hash. Preview does not append. A filesystem `wx` lock plus expectedRevision serialize operators; append fsyncs one new JSON line. Reload verifies source identity/hash chain, ordering, timestamps, price continuity and cap. There are no edit/delete methods. Interrupted records and stale locks fail closed; investigate rather than truncate. Hashes detect corruption, not a host administrator capable of rewriting files. This filesystem store is not distributed production storage.

The caller principal must come from a trusted adapter. The provided adapter is a **local OS/ACL-protected administrator CLI**, recording the OS username; no remotely authenticated admin-web route is installed. CLI admission also checks the committed proposal's source-config hash and listing/version/revision metadata. It has no clock override.

Boundaries are aligned to 5m, at least 60 seconds in the future and strictly increasing per journal. The prior generator owns all ticks through the boundary. New canonical ticks start at its exact prior close. Completed historical OHLCV remain verbatim on 1m/5m/15m/1h. A still-forming coarse candle may acquire future extrema while retaining its prior ticks. Fractional-hour stages reuse existing controls validation and canonical seeded tick generation; local presentation folding handles minute-to-5m aggregation without changing the frozen public helper. Public ListingConfig cannot import this offline DTO.

The former 15:00 experiment and its journal are not rewritten. A separate candidate namespace `qvtr-20261031-1630` branches from unchanged production v1. It is not another listing, and no local experiment is treated as production state. The artifact builder refuses a pre-existing candidate journal with a different effectiveAt/program. The sealed proposal is checked against generated controls before rendering.

## Run and inspect

```powershell
node scripts/qvtr-isolated-preview.cjs
node scripts/qa-qvtr-candidate-admission.cjs
node scripts/qa-qvtr-isolated-preview.cjs
# Outputs: artifacts/qvtr-isolated/qvtr-20261031-1630/

# Real-clock local admission only; keep this journal separate from the old experiment.
node scripts/isolated-scenario-admin.cjs preview LOCAL_JOURNAL config/isolated/qvtr-source-20261031-refresh.json config/isolated/qvtr-future-20261031-1630.json
node scripts/isolated-scenario-admin.cjs append LOCAL_JOURNAL config/isolated/qvtr-source-20261031-refresh.json config/isolated/qvtr-future-20261031-1630.json 0 "Approved isolated future candidate"
node scripts/isolated-scenario-admin.cjs history LOCAL_JOURNAL config/isolated/qvtr-source-20261031-refresh.json
```

The artifact builder uses the captured observation clock solely to reproduce its sealed model. The real-clock admission QA must still succeed before the deadline, otherwise exact-head CI fails the candidate as expired. QA verifies preview writes nothing, wrong hash/version and expired proposals are rejected without a journal, one future revision is actually saved locally, duplicate CAS changes no bytes, and reload preserves the audit chain. Disposable QA journals are included only in the isolated artifact.

Browser QA checks 1440/390, four timeframes, exact candidate date/approval labels, reload, no horizontal overflow/errors and zero external requests. The CI artifact is named by the exact PR head SHA; no workflow step has deployment credentials. Chromium uses pinned Ubuntu 24.04, supported by Playwright 1.56.1.

## Safe-apply gates and rollback

- Isolated local admission requires source identity/version/hash to match, a fresh authoritative source check, current-time lead ≥60 seconds, green candidate CI and no intervening revision.
- No production adapter, market-data publication or financial integration is included. Any such integration needs separate design/review and explicit owner authorization. Do not feed this model into real client executions or relabel it as independent market data.
- General CI has known failures in unchanged tests: OTC preservation's Banking referral month-overflow fixture on Oct31; Admin account deletion browser teardown's `route.fetch: Request context disposed`. Their source files and runtime are unchanged from main. These are recorded separately from candidate CI, not disabled or counted as PASS. Read current exact-head outcomes on the PR.
- Rollback: discard the unmerged candidate/artifact. Retain local audit journals; a later isolated scenario amendment must be a new future revision. Production rollback is unnecessary because nothing was installed there.
