# Private reference UI revision — scope and acceptance

Reference: user-supplied Bybit screenshot (2048 × 1135 physical pixels), reviewed in a normalized 1664 × 922 layout, plus VOLTEX Canva Final A.

The active positions table uses the existing private account state, server-derived realized fees/funding and unrealized ROI, native entry-price lines and confirmation callbacks. Share is next to unrealized P&L. Unknown USD conversions remain unavailable. Realized and unrealized results are not interchangeable.

The entry label follows native Lightweight Charts priceToCoordinate and the native entry line/axis label uses the stored entry price. It must never be pinned to a screen coordinate or moved into view when its price is outside the chart. Price/quantity/P&L updates come from the private server state.

Still unverified/incomplete (do not label the task 1:1 or production-ready):
- The reference font family and original browser DPR are not independently identified.
- The preserved Canva graphic currently comes from its 450 × 600 API preview, normalized to portrait export dimensions. The high-resolution uploaded original remains the quality target; an upscale is not pixel-identical.
- Limit reduce-only closes and reverse-position actions are not implemented by the existing private engine. Their controls must remain explicitly disabled rather than silently opening opposite positions or executing market closes.
- Borrowing, real-money account modes and other unrelated Bybit product tabs are not fabricated in private mode.
- The new reference-browser tests use isolated synthetic fixtures and native charts. They are not a production account check or a full real-provider historical replay.

The temporary blob-preparation helper and write-capable workflow have been removed. Final workflow is read-only. No production deployment or database activation is implied by this revision.
