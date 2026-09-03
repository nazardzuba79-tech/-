// Risk-limit tier table for perpetual futures — the same shape real
// exchanges publish (Binance/Bybit "leverage brackets"): the bigger a
// position's notional value, the lower the max leverage it's allowed and
// the higher the maintenance margin it must keep, because a bigger
// position is both harder to unwind without moving the market and riskier
// for the insurance fund if it gets liquidated late.
//
// `maintenanceAmount` (a fixed USDT deduction per tier) is what keeps the
// required maintenance margin continuous across tier boundaries — the
// same mechanism Binance's own bracket tables use. It's derived, not
// arbitrary: maintenanceAmount[i] = cap[i-1] * (mmr[i] - mmr[i-1]) + maintenanceAmount[i-1].
export interface LeverageTier {
  notionalCap: number; // upper bound in USDT for this tier; Infinity for the last one
  maxLeverage: number;
  maintenanceMarginRate: number; // e.g. 0.004 = 0.4%
  maintenanceAmount: number; // USDT
}

export const LEVERAGE_TIERS: LeverageTier[] = [
  { notionalCap: 50_000, maxLeverage: 100, maintenanceMarginRate: 0.004, maintenanceAmount: 0 },
  { notionalCap: 250_000, maxLeverage: 50, maintenanceMarginRate: 0.005, maintenanceAmount: 50 },
  { notionalCap: 1_000_000, maxLeverage: 20, maintenanceMarginRate: 0.01, maintenanceAmount: 1_300 },
  { notionalCap: 5_000_000, maxLeverage: 10, maintenanceMarginRate: 0.025, maintenanceAmount: 16_300 },
  { notionalCap: Infinity, maxLeverage: 5, maintenanceMarginRate: 0.05, maintenanceAmount: 141_300 },
];

export function getLeverageTier(notionalUsd: number): LeverageTier {
  return LEVERAGE_TIERS.find((t) => notionalUsd <= t.notionalCap) ?? LEVERAGE_TIERS[LEVERAGE_TIERS.length - 1];
}

// Brand-new accounts are capped well below the tier-1 ceiling regardless
// of position size — a fresh account 100xing on day one is exactly the
// failure mode this limit exists to prevent.
export const NEW_ACCOUNT_MAX_LEVERAGE = 10;
export const NEW_ACCOUNT_PERIOD_DAYS = 30;

// A leverage choice at or above this multiplier gets an extra confirmation
// step in the UI before the position can be opened.
export const HIGH_LEVERAGE_WARNING_THRESHOLD = 20;

export const MIN_LEVERAGE = 1;
export const MAX_LEVERAGE = 100;

// How often the funding rate is computed and settled — perpetual futures
// standard is every 8 hours, at 00:00 / 08:00 / 16:00 UTC.
export const FUNDING_INTERVAL_HOURS = 8;

// How often the liquidation engine re-checks every open position's margin
// against its liquidation price.
export const LIQUIDATION_CHECK_INTERVAL_MS = 5_000;

// The contracts that are always offered, whatever the market data says.
// Everything else is admitted by FuturesMarketRegistry against the rules
// below; these three are the floor, so the terminal is never empty even
// with the upstream price feed down.
export const CORE_FUTURES_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

// Listing rules for perpetuals. The old approach was a hand-typed list of
// three symbols, which meant the market panel could only ever show three
// markets. These express the same caution as a rule instead: a contract is
// listed only if it settles in USDT, currently has a live index price (so
// mark price, funding and liquidation all have something real to work
// from), and trades enough that a leveraged position can actually be
// unwound. Anything failing those is not listed, so we never offer
// leverage on a market we cannot price or exit.
export const PERP_QUOTE_ASSET = 'USDT';
export const MIN_PERP_24H_QUOTE_VOLUME = 1_000_000; // USDT
export const MAX_PERP_MARKETS = 40;

// How often the listed set is recomputed. Deliberately slow: the panel
// should not reshuffle under a trader's cursor, and nothing about an
// intraday volume wobble needs to change which contracts exist.
export const FUTURES_MARKET_REFRESH_MS = 15 * 60 * 1_000;
