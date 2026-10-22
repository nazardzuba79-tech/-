// Minimum for one credited package (one user, one asset, one network, the
// sum of its confirmed uncredited transfers). Reaching it only makes the
// package reviewable; every credit still requires an admin's confirmation,
// and below it confirmation is refused by the server. deposit-chains?
// includeConfig=true supplies this to both UIs.
export const MIN_DEPOSIT_USD = 500;
// Minimum-evaluation POLICY, not a market-rate claim: these assets count
// 1 unit = 1 USD when checking the minimum. Other assets need a fresh price.
export const DEPOSIT_USD_PEGGED_ASSETS = ['USDT', 'USDC', 'USD', 'DAI'] as const;
// A non-pegged asset's price may be at most this old (and not stale-served)
// to evaluate the minimum; otherwise the package needs review.
export const DEPOSIT_PRICE_MAX_AGE_MS = 2 * 60_000;
// On-chain proofs used for a credit must be at most this old when the
// credit transaction commits. Confirm re-proves every transfer first.
export const DEPOSIT_PROOF_MAX_AGE_MS = 5 * 60_000;

// How often PriceWatcherService re-checks every PENDING_TRIGGER order's
// condition against the real market price. Same order of magnitude as
// futures' LIQUIDATION_CHECK_INTERVAL_MS — frequent enough that a
// triggered stop/take-profit fires within a few seconds of the real price
// crossing it.
export const PRICE_WATCHER_CHECK_INTERVAL_MS = 5_000;

// Referral reward: paid to a referrer, in the SAME asset, every time a user
// they referred (User.referredById) gets a deposit CREDITED — see
// DepositService.claimDeposit. Applies to every credited deposit, not just
// the referred user's first one.
export const REFERRAL_REWARD_PERCENT = 5;

// Ceiling on how far a background sweep may slow down while it is finding
// nothing at all. It is also the worst case if a `wake()` call is ever
// missed — see IdleBackoffScheduler — which is why it is seconds rather
// than minutes: a delayed liquidation check is tolerable, a silent one is
// not. The sweeps only ever reach this while their tables are empty; one
// open position holds them at their base cadence.
export const IDLE_SWEEP_MAX_MS = 60_000;

// How long after a start the background loops keep the bounded backoff above
// before an empty sweep may put them to SLEEP (IdleBackoffScheduler `sleep`).
// A Render deploy starts the new instance while the old one still serves
// requests and only then stops it; anything the old instance commits in that
// overlap woke the OLD instance's loops, not these. Ten minutes covers that
// hand-over (Render gives the old instance 30 s to drain by default) with a
// wide margin, at a cost of about a dozen sweeps per loop per deploy.
export const WATCHER_SLEEP_GRACE_MS = 10 * 60_000;

// A successful mutating API request (POST/PUT/PATCH/DELETE, status < 400)
// nudges every sleeping loop to re-check its table once — the safety net for
// a code path that creates work but forgets its wake(). The database is awake
// for that request anyway, so this adds a few SELECTs while people are
// active and nothing at all while nobody is. At most one such re-check per
// this window; a request inside the window gets one trailing re-check.
export const ACTIVITY_RECONCILE_COOLDOWN_MS = 30_000;

// The scheduled re-check of every sleeping loop, for work that reached the
// database without any request to this instance (a manual SQL fix, another
// process). It rides the funding boundary (00:00/08:00/16:00 UTC), when the
// funding settlement has just woken the database anyway, so it adds no
// database wake of its own: this offset keeps it inside the minutes the
// compute stays up after funding (Neon suspends after 5 idle minutes).
export const RECONCILE_AFTER_FUNDING_MS = 2 * 60_000;
