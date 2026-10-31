# QVTR 1 November 08:00 Kyiv — isolated review amendment

This **does not amend the public QVTR/USDT market**. It is a safety-gated, review-only change to existing PR #665; it cannot be promoted to public pricing or financial execution.

## New request
- Growth begins only when a **new, fresh, observed quote is captured**, not at the previously recorded 18:09 Kyiv October 31 review. No retroactive start is claimed.
- Sunday 2026-11-01 08:00 Kyiv = **2026-11-01 06:00 UTC**: **0.53830 USDT** = 0.0140 × (1 + 3745/100).
- Immediately after this target, modeled correction is 40% of peak to **0.32298 USDT**. Existing agreed completion **Nov1 20:30 Kyiv / 18:30 UTC** is retained.
- Rejoin original WAVES at **Nov2 03:00 Kyiv / 01:00 UTC**, 0.352; then original 0.352, 0.685, 0.51, 0.818 endpoints, same 0.88858 upper boundary.
- Start is a fresh observation only when the read-only capture succeeds, recording source serverTime and observed lastPrice. A previous review is not silently activated or backdated.

## Technical contract
`qvtrNov1Isolated.ts` refuses missing/changed QVTR v1, `tradable:true`, source quote drift, observations older than 5s / future by over 2s, an already elapsed target or an anchor >= target. It verifies the unchanged old source model, exact target, correction and rejoin; preview selects the old canonical source for every earlier price and a new modeled continuation only for later display. The public stage schema is unchanged; this offline DTO permits fractional-hour durations. This does not prove immutable real trade history or production eligibility.

## Safety and release
The captured values are **synthetic model outputs**, not independent venue quotations or actual fills. No real trading, wallet valuation, PnL, deposits or user-facing undisclosed price alteration. A public release requires an independently reviewed design that clearly distinguishes modeled pricing and cannot mislead users or affect financial execution.

Do not merge, deploy or import into production. CI/test evidence is isolated. The old Oct31 20:30 review remains archived as a separate, non-promotable fixture.
