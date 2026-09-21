// Business minimum/warning, not permission to credit. Every deposit requires
// admin approval; deposit-chains?includeConfig=true supplies this to both UIs.
export const MIN_DEPOSIT_USD = 300;
export const DEPOSIT_USD_PEGGED_ASSETS = ['USDT', 'USDC', 'USD', 'DAI'] as const;

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
