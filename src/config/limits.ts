// Anti-abuse thresholds — kept in one place so the backend and any docs/UI
// referencing them don't drift. $1000 is high enough that airdrop farming
// and micro-arbitrage bots (which rely on shuffling small, cheap-to-repeat
// amounts) stop being worth the trouble, without blocking a genuine investor.
export const MIN_DEPOSIT_USD = 1000;

// How often PriceWatcherService re-checks every PENDING_TRIGGER order's
// condition against the real market price. Same order of magnitude as
// futures' LIQUIDATION_CHECK_INTERVAL_MS — frequent enough that a
// triggered stop/take-profit fires within a few seconds of the real price
// crossing it.
export const PRICE_WATCHER_CHECK_INTERVAL_MS = 5_000;
