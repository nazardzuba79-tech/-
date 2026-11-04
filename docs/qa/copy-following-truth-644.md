# VOLTEX Copy Trading #644 — local watchlist truth gate

30 October 2026. Source: main-based Copy UX correction PR #643 plus this code-only follow-up.

The current CopyButton calls `toggleFollowing(trader.id)`, which only updates the browser-local `voltex_copy_following` key; it does not create a server subscription, mirror trades, or allocate balance. The read-only synthetic copy routes provide simulations and admin-only follower events, not subscriber execution.

Changed visible **Following** language to a **local watchlist**: `Наблюдать за трейдером`, `В наблюдении`, `Наблюдаю`, and a success toast explicitly saying no orders are copied. Existing local entries survive via the same key.

The previously approved eligibility check ($10,000) is still an entirely **client-side** threshold on the existing portfolio-history snapshot, not a server capital authorization. It remains untouched in this code-only change. Future work must make watchlist inclusion independent of capital or separate it from an actual copy-subscription CTA; do not market this as automatic copying.

No financial request, follower order, API, DB schema, deposit, wallet, listing, timer, merge, or production deploy in this change.

A real copy engine requires an authorized server-backed subscription and idempotent per-follower execution, consent/fees/risk policy, failure and revocation handling, and synthetic/isolated tests before any real-capital rollout.

## Watchlist-only separation (follow-up)

The review-only watchlist button is independent of portfolio amount, wallet history loading, retry, or errors. The Copy Trading page no longer mounts the portfolio-history deposit hook or CopyEligibilityProvider solely for a local bookmark, removing that unnecessary private account read. The historical $10,000 threshold, hook and dialog remain in source for future *separately authorized* server-side copy execution and are not presented or used by this watchlist CTA. The route still requires the ordinary VOLTEX authentication wrapper; local watchlist storage itself is not a server-synchronized subscription. Tests cover immediate toggle without a portfolio read and historical source normalization.
