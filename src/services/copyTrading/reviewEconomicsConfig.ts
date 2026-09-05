/** Owner-constrained, explicitly synthetic REVIEW scenario; not live returns,
 * market candles, verified policy history, or a real balance/account ledger. */
export const REVIEW_ECONOMICS_CONFIG = {
  version: 7 as const,
  seed: 202609057,
  inception: '2025-08-21',
  baseline: '2026-09-05',
  factors: { '7D': 2.12, '30D': 3.71, '90D': 9.41, ALL: 38.27 },
  masterPnl: 4_711_027,
  initialTrades: 3250,
  recentTrades: 750,
  winRate: 0.972,
  performanceFeeRate: 0.10,
  copyMinimumPolicyEffectiveDate: '2026-03-01',
  currentCopyMinimum: 20_000,
  feeCrystallization: 'DAILY_GROSS_PNL_HIGH_WATER_MARK',
  holidays: [
    { start: '2025-12-18', end: '2026-01-05', reason: 'Synthetic trader holiday leave; crypto markets remain open.' },
    { start: '2026-04-10', end: '2026-04-12', reason: 'Chosen three-day synthetic Easter leave; crypto markets remain open.' },
  ],
  leverage: { min: 2, max: 8 },
  /** 2 bps on each entry/exit leg; synthetic execution-cost assumption. */
  tradingFeeRate: 0.0002,
  fundingRatePerEightHours: 0.00005,
  assets: [
    { symbol: 'BTCUSDT', referencePrice: 62000 },
    { symbol: 'ETHUSDT', referencePrice: 2450 },
    { symbol: 'SOLUSDT', referencePrice: 145 },
    { symbol: 'XRPUSDT', referencePrice: 0.58 },
    { symbol: 'BNBUSDT', referencePrice: 570 },
  ],
} as const;

export function isReviewHoliday(date: string): boolean {
  return REVIEW_ECONOMICS_CONFIG.holidays.some(pause => date >= pause.start && date <= pause.end);
}
