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

// Symbols perpetual futures are offered on — deliberately a short, curated
// list (not "every spot pair") so mark-price/funding infrastructure only
// has to be correct for markets we've actually vetted, same reasoning as
// the deposit chain allowlist.
export const FUTURES_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];
