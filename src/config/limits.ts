// Authoritative credited-deposit policy. DepositService enforces it at credit
// time; deposit-chains?includeConfig=true supplies it to both deposit UIs.
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
