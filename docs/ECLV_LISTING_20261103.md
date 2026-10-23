# ECLAVO (ECLV/USDT) — proposed 3 Nov 2026 listing

This is a **candidate config and QA**, NOT a published listing, chain token, venue order, or investor price forecast. It intentionally does not create a live Admin Listings row or start any countdown. Production TYVN/AITH, Spot/Futures, databases, balances and permissions are unchanged.

## Dates and product
- Candidate: **ECLAVO** — **ECLV/USDT** (provisional identity, verify uniqueness again before real publication).
- Proposed first candle: **Tuesday 2026-11-03 13:00 UTC = 15:00 Europe/Kyiv (winter) = 16:00 Moscow**. The user specified the date, not a clock time; 13:00 UTC mirrors the already approved TYVN release and may be adjusted while this remains an unpublished candidate.
- Opening modeled price **0.0140 USDT**; quote USDT; initial scenario start only, not a real exchange price.
- `tradable:false`, `ownerAllocation:"0"` (zero admin asset allocation), no automatic top-up and no real cash-out.
- Seed pinned to `zoryntha-20261103-v1`. Do not regenerate after publication.
- Branded SVG logo is embedded as a compact data URL (<64 KiB) with a distinctive eclipse-style E in silver/cobalt, not the TYVN gold T. Before approval, verify icon at 20-24 px in Spot header and search rail, at 64-84 px in the pre-listing panel, desktop and mobile.

## Distinct simulated price movement (not the TYVN path)
This is a designed synthetic `scenario-controls-v2` DEEP_RECOVERY trajectory; it is **not claimed to be historical BTC/ETH data**.

| Phase | Duration | Price at the end |
| --- | ---: | ---: |
| Initial opening | 0 h | 0.0140 |
| Accelerated growth | 24 h | 0.1092 |
| Range/holding | 24 h | 0.1092 |
| Growth | 96 h | 0.315 |
| Pullback | 36 h | 0.2142 |
| Recovery | 72 h | 0.435 |
| After 252 h | indefinite range | bounded by 0.518 |

- First 24h modelled gain: **+680%**, math: `0.0140 × (1 + 680/100) = 0.1092`.
- Ceiling: **0.518**, equals `0.0140 × (1 + 3600/100)`; prices and wicks are capped by the simulation.
- This deliberately differs from TYVN first-day +1725%, ceiling +9247%.
- Frequent 5–15% intra-phase pullbacks, high candle diversity, pronounced wicks, moderate pauses; the same deterministic server simulation generates the whole market. No claim of actual market demand or organic liquidity.

## Release gates / TODO before announcing or publishing
1. Owner approves final project identity, listing clock time, price path and visual asset. Current identity and 13:00 UTC are **proposals**; do not falsely mark approved.
2. Confirm ticker is not reserved or already active in the **live** Admin Listings store / all pair sources, not just GitHub or web search. A superficial web search cannot guarantee global uniqueness.
3. Run the new focused `eclvDraft.test.ts` along with existing Listing Config/Scenario/Countdown regressions; confirm 1440/390 px in a disposable authenticated browser.
4. Through existing secure Admin Listings channel, create **exactly one** private Draft matching the reviewed JSON, and preview first 24h, full trajectory and next day. Verify private checksum/seed/price/date.
5. Only following explicit owner publication approval, publish `staged` first and start `running` timer **once**, preserving the immutable seed and making the prelisting public; verify Worker catalogue and Spot/Markets in production.
6. Before 3 Nov, verify timers across reload, permissions, `tradable:false`, and no unintended financial writes. Test countdown -> first 1m/5m/1h chart in an isolated simulated-clock fixture (never fast-forward production).
7. Observe real production candle transition when 3 Nov arrives; avoid suggesting it is already proven before the date.

**Separate integration constraints:** Do not merge or enable incomplete Demo Spot/Liquidity PR #596/#599; there is no linkage to owner-funded balances. Never claim any synthetic plot represents a real asset or live third-party trading.
