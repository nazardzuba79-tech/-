// Anti-abuse thresholds — kept in one place so the backend and any docs/UI
// referencing them don't drift. $1000 is high enough that airdrop farming
// and micro-arbitrage bots (which rely on shuffling small, cheap-to-repeat
// amounts) stop being worth the trouble, without blocking a genuine investor.
export const MIN_DEPOSIT_USD = 1000;
