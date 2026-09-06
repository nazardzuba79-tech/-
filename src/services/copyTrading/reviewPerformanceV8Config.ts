import { REVIEW_ECONOMICS_CONFIG as V7 } from './reviewEconomicsConfig';

/** Owner-constrained fictional review scenario. These are scenario inputs,
 * never real market prices, customer funds, verified returns or issuer data.
 * Daily simple returns are added, NOT geometrically compounded. */
export const REVIEW_PERFORMANCE_V8_CONFIG = {
  version: 8 as const,
  seed: 202609058,
  inception: V7.inception,
  baseline: V7.baseline,
  masterPnl: V7.masterPnl,
  performanceFeeRate: V7.performanceFeeRate,
  copyMinimumPolicyEffectiveDate: V7.copyMinimumPolicyEffectiveDate,
  currentCopyMinimum: V7.currentCopyMinimum,
  feeCrystallization: V7.feeCrystallization,
  holidays: V7.holidays,
  tradingFeeRate: V7.tradingFeeRate,
  fundingRatePerEightHours: V7.fundingRatePerEightHours,
  assets: V7.assets,
  initialTrades: 471,
  winningTrades: 458,
  losingTrades: 13,
  returns: { '7D': 1.12, previous7D: 1.15, '30D': 2.71, '90D': 8.41, ALL: 37.27 },
  /** Sunday–Saturday strategy weeks. A return ceiling is enforced by generation,
   * not presentation clipping; 0.218 leaves room for monetary rounding. */
  maximumPlannedDailyReturn: 0.218,
  maximumWeeklyReturn: 1.20,
  weeklyRetentionGrowth: { min: 0.001, max: 0.0045 },
  firstFutureWeek: { start: '2026-09-06', end: '2026-09-12', return: 0.72 },
} as const;
