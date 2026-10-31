# QVTR — observed-NOW isolated review (PR #665)

The active mode is **OBSERVED_NOW_REVIEW_ONLY**, selected by `config/isolated/qvtr-review-current.json`. The prior scheduled 18:30 Kyiv / 16:30 UTC candidate is superseded. Its historical experiment files remain intact; the old builder and admission CLI explicitly reject that retired candidate. It is not the active review.

## Actual recorded start

- Source observation / T0: **2026-10-31 16:09:02.345 UTC / 18:09:02.345 Kyiv**.
- Actual read quote at that T0: **0.1589305735 USDT** (production QVTR v1's modeled, non-tradable quote; not a confirmed trade or independent external feed).
- Local receipt/admission clock: **16:09:01.670 UTC**. Both timestamps are retained: the source clock was 675 ms ahead of this workstation. Admission bounds source-ahead skew to 2 seconds and age to 5 seconds. The quote's authoritative timestamp is the model start, with no arbitrary scheduled delay.
- Record: `config/isolated/qvtr-observed-now-1793462941670.json`. It was created with exclusive `wx` + fsync during a real GET, not recreated from a past requested time.
- The earlier requested 17:58 Kyiv and the moment development began have passed. No model was activated then and no earlier launch is claimed. The actual new review starts at the recorded observation above; public history is untouched.

| Checkpoint | Kyiv | UTC | Price |
|---|---|---|---:|
| Actual review start | Oct31 18:09:02.345 | Oct31 16:09:02.345 | 0.1589305735 observed |
| Growth target | Oct31 20:30 | Oct31 18:30 | 0.53830 (+3745% from listing 0.0140) |
| Correction begins | Nov1 04:00 | Nov1 02:00 | 0.53830 |
| Approved correction completion | Nov1 20:30 | Nov1 18:30 | 0.32298 (-40% from 0.53830) |
| Rejoin WAVES endpoint | Nov2 03:00 | Nov2 01:00 | 0.352 |
| Original continuation | Nov3 / Nov6 / Nov7 / Nov10 03:00 | corresponding dates 01:00 | 0.352 / 0.685 / 0.51 / 0.818 |

The growth target is a gain from the listing price, not from the observed anchor. The cap remains 0.88858. The same canonical seeded engine supplies variable bodies, shadows and counter-moves. No alternate price generator is introduced.

## Capture now versus replay

```powershell
# Creates a NEW review at the actual current observation. No --start override.
node scripts/qvtr-now-review.cjs capture
# Reproduces the ALREADY CREATED private review, never a new admission.
node scripts/qvtr-now-review.cjs replay
node scripts/qa-qvtr-now-review.cjs
```

Capture reads only the public QVTR GET, verifies v1/listing identity/non-tradable/running state and source-model parity, records the actual source price and timestamp and rejects stale observations or a missed Oct31 18:30 UTC target. New captures create unique files with `wx`; old records are not overwritten. The selector points to the most recent review. Replay uses the captured timestamps explicitly and never inserts candles into public history. After the deadline, a new capture fails closed; only an explicitly identified replay of a pre-existing review is possible.

This is local OS/ACL-protected administration. There is no remotely authenticated production Admin UI/API adapter in this PR. `promotionAllowed:false` and distinct review scope are mandatory; the future-apply CLI rejects this review record. A future use needs a NEW fresh observation/admission before the target, not promotion/backdating of this record.

## History and canonical continuity

`qvtrObservedNowReview` retains all original ticks through T0, including a sub-minute cutover. It splices the first modeled minute from the existing old/new canonical 10-second ticks; all later minutes use the existing generator. It generates no independent prices. Completed historical candles and all queries for past instants (including forming-candle OHLCV precision) come from the original source on 1m/5m/15m/1h. The new curve starts at the observed anchor; fixed endpoints and serialized reload are tested. Source snapshot parity is verified against the actually read quote.

The original `IsolatedScenarioJournal` and its append-only future-version protection remain. Its 5m alignment, future lead, history hashes, CAS, author/reason and restart checks are not relaxed for this review. The new record is not a ListingConfig or a publishable future proposal. `HISTORY_LOCKED`, the shared generator source, production market routes, orders, P&L and balances are unchanged.

## Evidence and gates

The current workflow replays the committed NOW record; it no longer builds/adopts the superseded 18:30 Kyiv schedule. Tests cover fresh observed admission, exact actual start/anchor, stale/future-skew/changed source rejection, no backdated capture after deadline, exact targets, immutable history, canonical intervals, restart and promotion rejection. Chromium 1440/390 checks all four intervals, the exact recorded T0, reload, no overflow/errors/network requests; a replay must produce identical series bytes.

Artifacts are under `artifacts/qvtr-isolated/observed-now-1793462942345/`; screenshots are committed beside this report. The exact-head CI artifact is named with the PR head SHA. General CI's unchanged Banking referral Oct31 fixture failure is recorded separately on the PR; no financial assertions are removed.

No merge, deploy, migration, production-data mutation, public timer or quotation substitution occurs. To roll back, discard the unmerged code/selector while retaining observation records for audit. Publishing this forecast as live market prices or feeding it to real executions is not an available operation.
