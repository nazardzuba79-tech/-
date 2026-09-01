// Centralised data model for Copy Trading. Every figure the UI shows is
// either a field here or derived from one by a function here — nothing is
// typed into a component. That is what makes it replaceable later: swap
// this module's constants for an API response and the views are unchanged.
//
// Eligibility is deliberately NOT in this file: the $20,000 gate is
// computed from the account's real deposit, see CopyEligibilityContext.tsx.

export type RiskLevel = 'Low' | 'Moderate' | 'High' | 'Very High';
export type StrategyCategory = 'trend' | 'swing' | 'quant' | 'arbitrage' | 'futures' | 'long-term' | 'multi-asset';

/** The four periods the whole page speaks in. 'ALL' is a trader's full
 * history — for Nazar that is ~12 months (see NAZAR_HISTORY_MONTHS). */
export type Period = '7D' | '30D' | '90D' | 'ALL';
export const PERIODS: Period[] = ['7D', '30D', '90D', 'ALL'];
export const PERIOD_LABEL_RU: Record<Period, string> = {
  '7D': '7Д',
  '30D': '30Д',
  '90D': '90Д',
  ALL: 'Всё время',
};

export type Trader = {
  id: string;
  /** A trading alias, not a personal name — this is how strategy leaders
   * are identified on every real copy-trading venue. */
  name: string;
  initials: string;
  tone: string;
  vip?: boolean;
  verified?: boolean;
  /** Where the trader operates from. VOLTEX is a Singapore-based
   * international venue, so the roster is spread across its real regions
   * rather than concentrated in one. */
  region: string;
  strategy: string;
  category: StrategyCategory;
  roi7: number;
  roi30: number;
  roi90: number;
  /** Return since the trader started copy trading here — always over
   * `activeMonths`, never an annualised extrapolation. */
  roiAll: number;
  winRate: number;
  drawdown: number;
  copiers: number;
  /** Client funds currently copied through this trader (AUM). */
  aum: number;
  volume: number;
  risk: RiskLevel;
  activeMonths: number;
  performanceFee: number;
};

export type Trade = {
  asset: string;
  side: 'Long' | 'Short';
  entry: string;
  exit: string;
  pnl: string;
  roi: string;
  duration: string;
  date: string;
  positive: boolean;
};

/** How long Nazar has been running copy trading here. Every all-time
 * figure below is over exactly this window — the UI never presents it as
 * an annualised or projected number. */
export const NAZAR_HISTORY_MONTHS = 12;

export const nazarTrader: Trader = {
  id: 'VX-001',
  name: 'Nazar',
  initials: 'N',
  tone: 'gold',
  vip: true,
  verified: true,
  region: 'Singapore',
  strategy: 'Professional Strategy',
  category: 'multi-asset',
  roi7: 122,
  roi30: 271,
  roi90: 841,
  roiAll: 3741,
  winRate: 97.1,
  drawdown: 9,
  copiers: 32,
  aum: 7_200_000,
  volume: 4.8,
  risk: 'Moderate',
  activeMonths: NAZAR_HISTORY_MONTHS,
  performanceFee: 0.2,
};

// ---------------------------------------------------------------------------
// Nazar's economics — derived, not typed in
// ---------------------------------------------------------------------------
//
// The four ROI figures above are the input. They are internally consistent
// only as an ACCELERATING curve, which is worth spelling out because the
// naive reading is a contradiction:
//
//   if the last 90 days returned x9.41, four such quarters would be
//   x9.41^4 = x7,842 (+784,100%), not the stated x38.41 (+3,741%).
//
// They coexist because the strategy scaled up recently. Splitting the
// stated numbers into consecutive segments gives the implied pace:
//
//   months 4-12 (the first 9): x4.08 total   ~17%/month
//   days 31-90:                x2.54 total   ~59%/month
//   days 8-30:                 x1.67 total
//   last 7 days:               x2.22
//
// Each segment is individually plausible for a momentum book that grew its
// size and conviction over the year; it is the compounding of the FASTEST
// segment across the whole year that would not be. So the ladder stands and
// the curve is front-loaded — which is also why almost all copier profit
// below lands in recent windows.
//
// Everything financial then follows from one function (cumulativeFactor)
// plus the copier cohorts. Nothing downstream is a typed-in figure, so the
// numbers cannot drift out of agreement with each other.

/** [months ago, cumulative growth factor from then until now] — read
 * straight off Nazar's own ROI ladder, so the curve and the displayed
 * percentages are the same data. */
const GROWTH_ANCHORS: [number, number][] = [
  [0, 1],
  [7 / 30, 1 + 122 / 100],
  [1, 1 + 271 / 100],
  [3, 1 + 841 / 100],
  [12, 1 + 3741 / 100],
];

/** Growth multiple over the last `monthsAgo` months, interpolated
 * log-linearly between the anchors (log-linear because returns compound —
 * linear interpolation would understate the middle of every segment). */
function cumulativeFactor(monthsAgo: number): number {
  if (monthsAgo <= 0) return 1;
  for (let i = 0; i < GROWTH_ANCHORS.length - 1; i++) {
    const [m0, f0] = GROWTH_ANCHORS[i];
    const [m1, f1] = GROWTH_ANCHORS[i + 1];
    if (monthsAgo <= m1) {
      const t = (monthsAgo - m0) / (m1 - m0);
      return Math.exp(Math.log(f0) + t * (Math.log(f1) - Math.log(f0)));
    }
  }
  return GROWTH_ANCHORS[GROWTH_ANCHORS.length - 1][1];
}

/** The copier book, as cohorts that joined at different points. A single
 * average copier cannot reproduce this book: someone who joined on day one
 * is up x38, someone who joined a fortnight ago is up x2.7, and the mix is
 * what determines both AUM and total profit. Weighted toward recent
 * joiners, which is what a 12-month-old product with 32 clients looks
 * like. */
const COPIER_COHORTS: { count: number; joinedMonthsAgo: number; principalEach: number }[] = [
  { count: 2, joinedMonthsAgo: 12, principalEach: 20_000 },
  { count: 2, joinedMonthsAgo: 9, principalEach: 25_000 },
  { count: 4, joinedMonthsAgo: 6, principalEach: 25_000 },
  { count: 5, joinedMonthsAgo: 3, principalEach: 35_000 },
  { count: 8, joinedMonthsAgo: 1, principalEach: 50_000 },
  { count: 11, joinedMonthsAgo: 0.5, principalEach: 60_000 },
];

const PERIOD_MONTHS: Record<Period, number> = { '7D': 7 / 30, '30D': 1, '90D': 3, ALL: NAZAR_HISTORY_MONTHS };

export type CopierEconomics = {
  copiers: number;
  /** Total the copiers put in, summed across cohorts. */
  principal: number;
  /** What that principal is worth today, before withdrawals. */
  equity: number;
  /** equity - principal: everything the strategy has made for copiers. */
  lifetimeProfit: number;
  /** Profit generated inside each window, counting each cohort only from
   * the point it actually joined. */
  profitByPeriod: Record<Period, number>;
  /** equity - AUM. The balancing item: profit copiers have taken off the
   * table, which is why AUM is lower than the equity generated. */
  withdrawn: number;
  aum: number;
  performanceFee: number;
  /** lifetimeProfit x performanceFee — never typed in separately. */
  lifetimeEarnings: number;
  earningsByPeriod: Record<Period, number>;
  averagePrincipal: number;
};

function computeCopierEconomics(trader: Trader): CopierEconomics {
  let principal = 0;
  let equity = 0;
  for (const cohort of COPIER_COHORTS) {
    principal += cohort.count * cohort.principalEach;
    equity += cohort.count * cohort.principalEach * cumulativeFactor(cohort.joinedMonthsAgo);
  }

  const profitByPeriod = {} as Record<Period, number>;
  for (const period of PERIODS) {
    const windowMonths = PERIOD_MONTHS[period];
    let profit = 0;
    for (const cohort of COPIER_COHORTS) {
      const stake = cohort.count * cohort.principalEach;
      const now = stake * cumulativeFactor(cohort.joinedMonthsAgo);
      // A cohort that joined inside the window contributes its whole gain;
      // one that predates it contributes only what it made since the
      // window opened. Dividing today's equity by the window factor is the
      // same as growing its balance at the window's start forward.
      const atWindowStart =
        cohort.joinedMonthsAgo <= windowMonths ? stake : now / cumulativeFactor(windowMonths);
      profit += now - atWindowStart;
    }
    profitByPeriod[period] = Math.round(profit);
  }

  const lifetimeProfit = Math.round(equity - principal);
  const earningsByPeriod = {} as Record<Period, number>;
  for (const period of PERIODS) earningsByPeriod[period] = Math.round(profitByPeriod[period] * trader.performanceFee);

  return {
    copiers: COPIER_COHORTS.reduce((sum, c) => sum + c.count, 0),
    principal: Math.round(principal),
    equity: Math.round(equity),
    lifetimeProfit,
    profitByPeriod,
    withdrawn: Math.round(equity - trader.aum),
    aum: trader.aum,
    performanceFee: trader.performanceFee,
    lifetimeEarnings: Math.round(lifetimeProfit * trader.performanceFee),
    earningsByPeriod,
    averagePrincipal: Math.round(principal / COPIER_COHORTS.reduce((sum, c) => sum + c.count, 0)),
  };
}

export const nazarEconomics: CopierEconomics = computeCopierEconomics(nazarTrader);

// ---------------------------------------------------------------------------
// The rest of the marketplace
// ---------------------------------------------------------------------------
//
// Aliases rather than personal names, spread across the regions a
// Singapore-based international venue actually draws from. The performance
// spread is deliberate and covers the whole range a real leaderboard has:
// a few excellent books, a long middle, several flat ones, and genuinely
// losing traders with deep drawdowns. Without the weak end, "top trader"
// would mean nothing.

export const marketplaceTraders: Trader[] = [
  // --- strong ---
  { id: 'VX-002', name: 'QuantEdge', initials: 'QE', tone: 'blue', verified: true, region: 'Singapore', strategy: 'Quantitative Strategy', category: 'quant', roi7: 9.4, roi30: 31.2, roi90: 96.4, roiAll: 412.7, winRate: 84.2, drawdown: 11.4, copiers: 1284, aum: 3_820_000, volume: 18.4, risk: 'Moderate', activeMonths: 26, performanceFee: 0.15 },
  { id: 'VX-003', name: 'RedDotCapital', initials: 'RD', tone: 'rose', verified: true, region: 'Singapore', strategy: 'Momentum Trader', category: 'multi-asset', roi7: 7.8, roi30: 26.4, roi90: 78.3, roiAll: 288.4, winRate: 81.6, drawdown: 14.8, copiers: 842, aum: 1_940_000, volume: 12.7, risk: 'High', activeMonths: 21, performanceFee: 0.12 },
  { id: 'VX-004', name: 'SakuraQuant', initials: 'SQ', tone: 'rose', verified: true, region: 'Japan', strategy: 'Algorithmic Trader', category: 'quant', roi7: 6.1, roi30: 21.7, roi90: 64.2, roiAll: 214.6, winRate: 79.8, drawdown: 9.2, copiers: 617, aum: 2_460_000, volume: 15.2, risk: 'Moderate', activeMonths: 24, performanceFee: 0.15 },
  { id: 'VX-005', name: 'SeoulSigma', initials: 'SS', tone: 'green', verified: true, region: 'South Korea', strategy: 'Trend Strategy', category: 'trend', roi7: 5.4, roi30: 18.9, roi90: 57.6, roiAll: 186.2, winRate: 77.4, drawdown: 12.1, copiers: 493, aum: 1_180_000, volume: 9.8, risk: 'Moderate', activeMonths: 19, performanceFee: 0.12 },

  // --- solid middle ---
  { id: 'VX-006', name: 'MeridianFX', initials: 'MF', tone: 'blue', region: 'United Kingdom', strategy: 'Multi-Asset Trader', category: 'multi-asset', roi7: 4.6, roi30: 15.2, roi90: 44.8, roiAll: 142.3, winRate: 74.6, drawdown: 13.4, copiers: 356, aum: 892_000, volume: 7.4, risk: 'Moderate', activeMonths: 17, performanceFee: 0.12 },
  { id: 'VX-007', name: 'MoonRabbit', initials: 'MR', tone: 'orange', region: 'Taiwan', strategy: 'Swing Trader', category: 'swing', roi7: 4.2, roi30: 14.1, roi90: 41.2, roiAll: 118.7, winRate: 73.2, drawdown: 11.8, copiers: 428, aum: 674_000, volume: 5.6, risk: 'Moderate', activeMonths: 15, performanceFee: 0.1 },
  { id: 'VX-008', name: 'NordicEdge', initials: 'NE', tone: 'slate', verified: true, region: 'Sweden', strategy: 'Market Neutral', category: 'arbitrage', roi7: 2.1, roi30: 7.4, roi90: 23.6, roiAll: 96.4, winRate: 86.3, drawdown: 3.2, copiers: 289, aum: 4_120_000, volume: 28.6, risk: 'Low', activeMonths: 31, performanceFee: 0.18 },
  { id: 'VX-009', name: 'VedaCapital', initials: 'VC', tone: 'orange', region: 'India', strategy: 'Long-Term Investor', category: 'long-term', roi7: 1.8, roi30: 6.9, roi90: 22.4, roiAll: 88.1, winRate: 71.8, drawdown: 6.4, copiers: 214, aum: 1_460_000, volume: 3.2, risk: 'Low', activeMonths: 28, performanceFee: 0.1 },
  { id: 'VX-010', name: 'PandaBlock', initials: 'PB', tone: 'green', region: 'Hong Kong', strategy: 'DeFi Specialist', category: 'multi-asset', roi7: 3.7, roi30: 12.4, roi90: 36.8, roiAll: 102.6, winRate: 72.4, drawdown: 15.2, copiers: 331, aum: 528_000, volume: 6.1, risk: 'High', activeMonths: 14, performanceFee: 0.1 },
  { id: 'VX-011', name: 'KopiTiam', initials: 'KT', tone: 'orange', region: 'Singapore', strategy: 'Swing Trader', category: 'swing', roi7: 3.1, roi30: 10.8, roi90: 31.4, roiAll: 76.2, winRate: 70.6, drawdown: 10.4, copiers: 187, aum: 412_000, volume: 4.2, risk: 'Moderate', activeMonths: 12, performanceFee: 0.1 },
  { id: 'VX-012', name: 'AtlasVolt', initials: 'AV', tone: 'blue', region: 'Germany', strategy: 'Futures Specialist', category: 'futures', roi7: 3.4, roi30: 11.6, roi90: 33.2, roiAll: 84.7, winRate: 68.9, drawdown: 17.6, copiers: 246, aum: 386_000, volume: 11.4, risk: 'High', activeMonths: 13, performanceFee: 0.12 },
  { id: 'VX-013', name: 'HanRiver', initials: 'HR', tone: 'slate', region: 'South Korea', strategy: 'Trend Strategy', category: 'trend', roi7: 2.6, roi30: 9.2, roi90: 27.8, roiAll: 68.4, winRate: 69.7, drawdown: 12.8, copiers: 164, aum: 298_000, volume: 3.8, risk: 'Moderate', activeMonths: 11, performanceFee: 0.1 },
  { id: 'VX-014', name: 'OrionByte', initials: 'OB', tone: 'green', region: 'Netherlands', strategy: 'Algorithmic Trader', category: 'quant', roi7: 2.2, roi30: 8.1, roi90: 24.6, roiAll: 61.2, winRate: 73.4, drawdown: 7.8, copiers: 208, aum: 742_000, volume: 8.6, risk: 'Low', activeMonths: 16, performanceFee: 0.12 },
  { id: 'VX-015', name: 'TigerBourse', initials: 'TB', tone: 'orange', region: 'Malaysia', strategy: 'Momentum Trader', category: 'multi-asset', roi7: 2.8, roi30: 9.7, roi90: 26.1, roiAll: 58.9, winRate: 67.2, drawdown: 14.1, copiers: 142, aum: 264_000, volume: 4.6, risk: 'High', activeMonths: 10, performanceFee: 0.1 },

  // --- modest but genuinely positive ---
  { id: 'VX-016', name: 'YuanFlow', initials: 'YF', tone: 'rose', region: 'Hong Kong', strategy: 'Arbitrage Strategy', category: 'arbitrage', roi7: 0.9, roi30: 3.4, roi90: 11.2, roiAll: 42.6, winRate: 88.4, drawdown: 2.1, copiers: 96, aum: 2_180_000, volume: 34.2, risk: 'Low', activeMonths: 22, performanceFee: 0.18 },
  { id: 'VX-017', name: 'KiwiChain', initials: 'KC', tone: 'green', region: 'New Zealand', strategy: 'Long-Term Investor', category: 'long-term', roi7: 1.2, roi30: 4.6, roi90: 14.8, roiAll: 46.2, winRate: 68.1, drawdown: 5.4, copiers: 74, aum: 486_000, volume: 1.8, risk: 'Low', activeMonths: 20, performanceFee: 0.08 },
  { id: 'VX-018', name: 'RhineDelta', initials: 'RH', tone: 'slate', region: 'Switzerland', strategy: 'Market Neutral', category: 'arbitrage', roi7: 0.7, roi30: 2.8, roi90: 9.4, roiAll: 31.8, winRate: 84.6, drawdown: 2.8, copiers: 58, aum: 1_640_000, volume: 19.6, risk: 'Low', activeMonths: 18, performanceFee: 0.15 },
  { id: 'VX-019', name: 'NexaTrade', initials: 'NX', tone: 'blue', region: 'United Arab Emirates', strategy: 'Multi-Asset Trader', category: 'multi-asset', roi7: 1.4, roi30: 5.2, roi90: 15.6, roiAll: 34.2, winRate: 66.8, drawdown: 8.9, copiers: 112, aum: 218_000, volume: 3.4, risk: 'Moderate', activeMonths: 9, performanceFee: 0.1 },
  { id: 'VX-020', name: 'AlphaKite', initials: 'AK', tone: 'orange', region: 'Australia', strategy: 'Swing Trader', category: 'swing', roi7: 1.1, roi30: 4.1, roi90: 12.9, roiAll: 28.6, winRate: 65.4, drawdown: 9.6, copiers: 67, aum: 148_000, volume: 2.1, risk: 'Moderate', activeMonths: 8, performanceFee: 0.08 },
  { id: 'VX-021', name: 'IberiaQuant', initials: 'IQ', tone: 'green', region: 'Spain', strategy: 'Quantitative Strategy', category: 'quant', roi7: 0.8, roi30: 3.2, roi90: 10.4, roiAll: 24.1, winRate: 69.2, drawdown: 6.2, copiers: 51, aum: 196_000, volume: 2.8, risk: 'Low', activeMonths: 11, performanceFee: 0.1 },

  // --- flat / barely moving ---
  { id: 'VX-022', name: 'Zenya', initials: 'ZY', tone: 'slate', region: 'Japan', strategy: 'Long-Term Investor', category: 'long-term', roi7: 0.3, roi30: 1.4, roi90: 4.2, roiAll: 12.8, winRate: 62.4, drawdown: 4.8, copiers: 38, aum: 124_000, volume: 0.9, risk: 'Low', activeMonths: 14, performanceFee: 0.08 },
  { id: 'VX-023', name: 'BlueLionSG', initials: 'BL', tone: 'blue', region: 'Singapore', strategy: 'Trend Strategy', category: 'trend', roi7: -0.4, roi30: 1.1, roi90: 3.6, roiAll: 9.4, winRate: 59.8, drawdown: 7.2, copiers: 29, aum: 86_000, volume: 1.2, risk: 'Moderate', activeMonths: 7, performanceFee: 0.08 },
  { id: 'VX-024', name: 'ChakraTrade', initials: 'CT', tone: 'orange', region: 'India', strategy: 'Momentum Trader', category: 'multi-asset', roi7: 0.6, roi30: 0.9, roi90: 2.4, roiAll: 6.1, winRate: 58.2, drawdown: 8.4, copiers: 22, aum: 64_000, volume: 1.4, risk: 'Moderate', activeMonths: 6, performanceFee: 0.08 },

  // --- newer, small books ---
  { id: 'VX-025', name: 'SandboxAlpha', initials: 'SA', tone: 'rose', region: 'Indonesia', strategy: 'Swing Trader', category: 'swing', roi7: 2.4, roi30: 6.8, roi90: 14.2, roiAll: 14.2, winRate: 64.1, drawdown: 11.6, copiers: 14, aum: 38_000, volume: 0.8, risk: 'Moderate', activeMonths: 3, performanceFee: 0.06 },
  { id: 'VX-026', name: 'DragonTick', initials: 'DT', tone: 'green', region: 'Vietnam', strategy: 'Futures Specialist', category: 'futures', roi7: 1.8, roi30: 5.4, roi90: 9.8, roiAll: 9.8, winRate: 61.4, drawdown: 16.2, copiers: 9, aum: 21_000, volume: 1.6, risk: 'High', activeMonths: 3, performanceFee: 0.06 },
  { id: 'VX-027', name: 'AsianWhale', initials: 'AW', tone: 'slate', region: 'Thailand', strategy: 'High Growth Strategy', category: 'multi-asset', roi7: 6.2, roi30: 18.4, roi90: 42.6, roiAll: 42.6, winRate: 63.8, drawdown: 28.4, copiers: 47, aum: 92_000, volume: 5.4, risk: 'Very High', activeMonths: 4, performanceFee: 0.1 },

  // --- losing ---
  { id: 'VX-028', name: 'TurboLeverage', initials: 'TL', tone: 'orange', region: 'Brazil', strategy: 'Futures Specialist', category: 'futures', roi7: -4.6, roi30: -8.2, roi90: -14.7, roiAll: -21.4, winRate: 48.6, drawdown: 34.2, copiers: 18, aum: 46_000, volume: 4.1, risk: 'Very High', activeMonths: 8, performanceFee: 0.06 },
  { id: 'VX-029', name: 'NightOwlFX', initials: 'NO', tone: 'blue', region: 'Poland', strategy: 'Short-Term Trader', category: 'multi-asset', roi7: -2.8, roi30: -6.4, roi90: -11.2, roiAll: -18.6, winRate: 46.2, drawdown: 29.8, copiers: 11, aum: 32_000, volume: 2.4, risk: 'Very High', activeMonths: 6, performanceFee: 0.06 },
  { id: 'VX-030', name: 'VoltHunter', initials: 'VH', tone: 'rose', region: 'Turkey', strategy: 'High Growth Strategy', category: 'multi-asset', roi7: -1.6, roi30: -3.8, roi90: -7.4, roiAll: -9.2, winRate: 52.4, drawdown: 22.6, copiers: 6, aum: 18_000, volume: 1.1, risk: 'High', activeMonths: 5, performanceFee: 0.06 },
  { id: 'VX-031', name: 'DeltaOne', initials: 'D1', tone: 'green', region: 'Canada', strategy: 'Algorithmic Trader', category: 'quant', roi7: -0.9, roi30: -2.4, roi90: -4.8, roiAll: -6.4, winRate: 54.8, drawdown: 18.4, copiers: 4, aum: 12_000, volume: 0.6, risk: 'High', activeMonths: 4, performanceFee: 0.06 },
];

/** Nazar first, then everyone else — the single list the tabs and search
 * filter over, so no view can accidentally drop him or duplicate him. */
export const allTraders: Trader[] = [nazarTrader, ...marketplaceTraders];

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatPercent(value: number): string {
  if (value > 0) return `+${value.toFixed(1)}%`;
  if (value < 0) return `${value.toFixed(1)}%`;
  return '0.0%';
}

export function roiClass(value: number): string {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'neutral';
}

/** Compact USD with the $ sign — for AUM, profit and other aggregates. */
export function formatAccountSize(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return `${sign}$${Math.round(abs)}`;
}

/** Compact USD without the $ sign, for places that print the currency
 * separately ("7.7M USDT"). */
export function formatUsd(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}K`;
  return `${sign}${Math.round(abs)}`;
}

export function formatVolume(value: number): string {
  return `$${value.toFixed(1)}M`;
}

/** What the broad crypto market returned over each period. Used only to
 * put a trader's own return in context ("vs market"), which previously was
 * three fixed strings shown identically on every trader — including the
 * losing ones, where "vs market +18.4%" was simply false. */
export const MARKET_BENCHMARK: Record<Period, number> = {
  '7D': 1.8,
  '30D': 6.4,
  '90D': 14.2,
  ALL: 38.6,
};

export function getRoiForPeriod(trader: Trader, period: Period): number {
  switch (period) {
    case '7D': return trader.roi7;
    case '30D': return trader.roi30;
    case '90D': return trader.roi90;
    default: return trader.roiAll;
  }
}

export function compositeScore(trader: Trader): number {
  return trader.roi90 * 0.5 + trader.winRate * 2 - trader.drawdown * 3;
}

const strategyDescriptions: Record<StrategyCategory, string> = {
  trend: 'Систематическое следование за трендом: удерживает устойчивые движения рынка по строгим правилам входа и выхода.',
  swing: 'Свинг-стратегия на среднесрочных движениях основных криптоактивов.',
  quant: 'Количественный подход: статистические модели и алгоритмическое исполнение ради стабильной доходности.',
  arbitrage: 'Арбитраж ценовых неэффективностей между площадками с минимальной направленной экспозицией.',
  futures: 'Работа на фьючерсах с точечным использованием плеча и жёстким контролем маржи.',
  'long-term': 'Долгосрочный подход на основе фундаментальной оценки и макротрендов крипторынка.',
  'multi-asset': 'Диверсифицированная мультиактивная стратегия: распределение по всему спектру крипторынка ради баланса риска и доходности.',
};

export function getStrategyDescription(trader: Trader): string {
  return strategyDescriptions[trader.category];
}

// ---------------------------------------------------------------------------
// Deterministic "live" movement
// ---------------------------------------------------------------------------
//
// Figures move once a UTC day rather than being frozen constants, and the
// movement is seeded so it is stable for the whole day instead of jumping
// on every render. The point is structural: nothing downstream reads a
// literal, so replacing this with a real feed changes only this section.

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function dayIndex(): number {
  return Math.floor(Date.now() / 86_400_000);
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** A real running total never lands on a round number. Adds a small,
 * deterministic, once-a-day offset so the figure reads as live rather
 * than as a marketing rounding — the underlying model value is unchanged. */
function dailyJitter(id: string, magnitude: number): number {
  const seed = hashId(id) + dayIndex() * 97;
  return Math.round((seededRandom(seed) * 2 - 1) * magnitude);
}

/** Copier profit for a period. Nazar's comes from the cohort model; every
 * other trader's is derived from their own AUM and period ROI, so the
 * relationship (profit is what the book actually made) holds for all. */
export function getCopierProfit(trader: Trader, period: Period = '30D'): number {
  if (trader.id === nazarTrader.id) {
    return nazarEconomics.profitByPeriod[period] + dailyJitter(trader.id + period, 900);
  }
  const roi = getRoiForPeriod(trader, period) / 100;
  // Today's AUM already contains the gain, so the capital that earned it
  // is aum / (1 + roi) — using aum directly would overstate the profit.
  const base = trader.aum / (1 + roi);
  return Math.round(base * roi) + dailyJitter(trader.id + period, 60);
}

/** Always the fee applied to the copier profit above — never a separate
 * figure that could disagree with it. Floored at zero: a performance fee
 * is only charged on gains, so a losing period earns the trader nothing
 * rather than a negative fee (which is what a plain multiplication
 * produced, and which no venue actually pays out). */
export function getTraderEarnings(trader: Trader, period: Period = '30D'): number {
  return Math.max(0, Math.round(getCopierProfit(trader, period) * trader.performanceFee));
}

export function getLifetimeCopierProfit(trader: Trader): number {
  if (trader.id === nazarTrader.id) return nazarEconomics.lifetimeProfit + dailyJitter(trader.id + 'life', 2400);
  return getCopierProfit(trader, 'ALL');
}

export function getLifetimeTraderEarnings(trader: Trader): number {
  return Math.max(0, Math.round(getLifetimeCopierProfit(trader) * trader.performanceFee));
}

export function generateProfileData(trader: Trader) {
  // Trade count grows with both how much the book turns over and how long
  // it has been running — volume alone gave a 12-month strategy fewer
  // trades than a 3-month one with the same turnover.
  const totalTrades = Math.max(24, Math.round(trader.volume * 12 + trader.activeMonths * 14));
  const winningTrades = Math.round((totalTrades * trader.winRate) / 100);
  const losingTrades = totalTrades - winningTrades;
  const avgProfit = trader.roi90 > 0 ? Math.min(8, Math.max(1.2, trader.roi90 / 50)) : 1.5;

  // Profit factor is the modelled quantity and the average loss follows
  // from it, not the other way round. Fixing the loss at a share of the
  // average win instead made the factor a hostage to the win rate: at
  // Nazar's 97.1% it came out above 100, which no real book reports.
  // Deriving it this way also produces the shape a very high win rate
  // actually implies — many small gains against rare, much larger losses.
  // Position-level loss size is not account drawdown: a 40% loss on a 5%
  // position is 2% of the account, so this stays consistent with the max
  // drawdown shown elsewhere.
  const targetProfitFactor = trader.roi90 > 0 ? Math.min(9, Math.max(1.1, 1.2 + trader.roi90 / 150)) : 0.72;
  const avgLoss = losingTrades > 0 ? -((winningTrades * avgProfit) / (losingTrades * targetProfitFactor)) : -avgProfit;
  const grossProfit = winningTrades * avgProfit;
  const grossLoss = Math.abs(losingTrades * avgLoss);
  const profitFactor = grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 10) / 10 : 5.0;
  const holdingTimes: Record<StrategyCategory, string> = {
    'long-term': '3d 12h',
    arbitrage: '0h 42m',
    trend: '1d 6h',
    swing: '8h 42m',
    quant: '4h 18m',
    futures: '6h 24m',
    'multi-asset': '7h 30m',
  };
  const isNazar = trader.id === nazarTrader.id;
  return {
    totalTrades,
    winningTrades,
    losingTrades,
    avgProfit: `+${avgProfit.toFixed(1)}%`,
    avgLoss: `${avgLoss.toFixed(1)}%`,
    profitFactor: profitFactor.toFixed(1),
    holdingTime: holdingTimes[trader.category],
    volume: `$${trader.volume.toFixed(1)}M`,
    newThisWeek: Math.max(0, Math.round(trader.copiers * 0.08)),
    // Nazar's average comes from the cohort model so it agrees with his
    // AUM; every other trader's is a share of their own book.
    avgCopierDeposit: isNazar ? nazarEconomics.averagePrincipal : Math.round((trader.aum * 0.04) / 100) * 100,
    totalCopiedVolume: Math.round(trader.volume * trader.copiers * 0.12 * 100) / 100,
  };
}

const ASSET_DATA = [
  { symbol: 'BTC/USDT', base: 62_140 },
  { symbol: 'ETH/USDT', base: 3_348 },
  { symbol: 'SOL/USDT', base: 152.2 },
  { symbol: 'BNB/USDT', base: 582.4 },
  { symbol: 'XRP/USDT', base: 0.62 },
  { symbol: 'AVAX/USDT', base: 28.4 },
];

function formatPrice(price: number): string {
  if (price < 1) return `$${price.toFixed(3)}`;
  if (price < 100) return `$${price.toFixed(2)}`;
  return `$${Math.round(price).toLocaleString()}`;
}

export function generateTrades(trader: Trader): Trade[] {
  const seed = hashId(trader.id);
  const trades: Trade[] = [];
  const count = 6;
  for (let i = 0; i < count; i++) {
    const h = (seed + i * 137) % 10_000;
    const asset = ASSET_DATA[h % ASSET_DATA.length];
    const side: 'Long' | 'Short' = h % 3 === 0 ? 'Short' : 'Long';
    const isWin = ((i + 1) / count) * 100 <= trader.winRate;
    const roiPct = isWin ? 0.8 + (h % 45) / 10 : -(0.3 + (h % 25) / 10);
    const priceVar = (h % 100) / 1000;
    const entryPrice = asset.base * (1 + priceVar);
    const exitPrice = side === 'Long' ? entryPrice * (1 + roiPct / 100) : entryPrice * (1 - roiPct / 100);
    const positionSize = trader.aum * 0.05;
    const pnl = (positionSize * roiPct) / 100;
    const hours = h % 14;
    const minutes = (h * 7) % 60;
    const date = new Date(CHART_TODAY.getTime() - (i * 2 + 1) * 86_400_000);
    trades.push({
      asset: asset.symbol,
      side,
      entry: formatPrice(entryPrice),
      exit: formatPrice(exitPrice),
      pnl: `${pnl >= 0 ? '+' : '-'}$${Math.abs(Math.round(pnl)).toLocaleString()}`,
      roi: `${roiPct > 0 ? '+' : ''}${roiPct.toFixed(1)}%`,
      duration: `${hours}h ${minutes.toString().padStart(2, '0')}m`,
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      positive: isWin,
    });
  }
  return trades;
}

// ---------------------------------------------------------------------------
// Performance chart
// ---------------------------------------------------------------------------

export type ChartData = {
  linePath: string;
  areaPath: string;
  marketPath: string;
  btcPath: string;
  yLabels: string[];
  xLabels: string[];
  endY: number;
};

const CHART_TODAY = new Date(2026, 7, 28);

function periodDays(trader: Trader, period: Period): number {
  if (period === '7D') return 7;
  if (period === '30D') return 30;
  if (period === '90D') return 90;
  return Math.round(trader.activeMonths * 30.44);
}

function buildSmoothSeries(startValue: number, endValue: number, seed: number, points = 11): number[] {
  const series: number[] = [];
  for (let i = 0; i <= points; i++) {
    if (i === 0) { series.push(startValue); continue; }
    if (i === points) { series.push(endValue); continue; }
    const t = i / points;
    const eased = t * t * (3 - 2 * t);
    const trend = startValue + (endValue - startValue) * eased;
    const noiseScale = Math.abs(endValue - startValue) * 0.05 + Math.abs(startValue) * 0.008;
    const noise = (seededRandom(seed + i * 53) - 0.5) * 2 * noiseScale;
    series.push(trend + noise);
  }
  return series;
}

function seriesToPath(series: number[], min: number, max: number): { line: string; area: string } {
  const width = 900;
  const top = 20;
  const bottom = 245;
  const range = Math.max(1, max - min);
  const pts = series.map((v, i) => {
    const x = (i / (series.length - 1)) * width;
    const y = bottom - ((v - min) / range) * (bottom - top);
    return [x, y] as const;
  });
  let line = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    line += ` Q${x0.toFixed(1)} ${y0.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  line += ` L${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
  return { line, area: `${line} V280 H0 Z` };
}

function formatChartAxisValue(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${Math.round(value)}`;
}

function xLabelsForPeriod(trader: Trader, period: Period): string[] {
  const days = periodDays(trader, period);
  const labels: string[] = [];
  for (let i = 0; i < 6; i++) {
    const daysAgo = Math.round(days * (1 - i / 5));
    const date = new Date(CHART_TODAY.getTime() - daysAgo * 86_400_000);
    labels.push(date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }));
  }
  return labels;
}

/** Growth of $10,000 over the selected period, plus two comparison lines.
 * Each period draws a genuinely different curve because it starts from
 * that period's own ROI — the endpoint is pinned to the displayed
 * percentage, so chart and number can never disagree. */
export function getChartData(trader: Trader, period: Period): ChartData {
  const seedBase = hashId(trader.id) + periodDays(trader, period) * 31 + dayIndex();
  const startValue = 10_000;
  const endValue = startValue * (1 + getRoiForPeriod(trader, period) / 100);
  const traderSeries = buildSmoothSeries(startValue, endValue, seedBase);
  const marketSeries = buildSmoothSeries(startValue, startValue + (endValue - startValue) * 0.16, seedBase + 4001);
  const btcSeries = buildSmoothSeries(startValue, startValue + (endValue - startValue) * 0.42, seedBase + 7919);

  const allValues = [...traderSeries, ...marketSeries, ...btcSeries];
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const pad = (rawMax - rawMin) * 0.1 || rawMax * 0.05;
  const min = rawMin - pad;
  const max = rawMax + pad;

  const traderPath = seriesToPath(traderSeries, min, max);
  const yLabels: string[] = [];
  for (let i = 0; i < 4; i++) yLabels.push(formatChartAxisValue(max - ((max - min) * i) / 3));
  const range = Math.max(1, max - min);

  return {
    linePath: traderPath.line,
    areaPath: traderPath.area,
    marketPath: seriesToPath(marketSeries, min, max).line,
    btcPath: seriesToPath(btcSeries, min, max).line,
    yLabels,
    xLabels: xLabelsForPeriod(trader, period),
    endY: 245 - ((traderSeries[traderSeries.length - 1] - min) / range) * (245 - 20),
  };
}

// ---------------------------------------------------------------------------
// Search / sort / filter
// ---------------------------------------------------------------------------

export function sortTraders(traders: Trader[], sortBy: string, period: Period): Trader[] {
  const getRoi = (t: Trader) => getRoiForPeriod(t, period);
  switch (sortBy) {
    case 'Highest ROI': return [...traders].sort((a, b) => getRoi(b) - getRoi(a));
    case 'Best Win Rate': return [...traders].sort((a, b) => b.winRate - a.winRate);
    case 'Lowest Drawdown': return [...traders].sort((a, b) => a.drawdown - b.drawdown);
    case 'Most Copied': return [...traders].sort((a, b) => b.copiers - a.copiers);
    case 'Largest AUM': return [...traders].sort((a, b) => b.aum - a.aum);
    case 'Newest Traders': return [...traders].sort((a, b) => a.activeMonths - b.activeMonths);
    default: return [...traders].sort((a, b) => compositeScore(b) - compositeScore(a));
  }
}

export function filterTraders(traders: Trader[], filters: {
  performance: string;
  risk: string;
  strategy: string;
  account: string;
}): Trader[] {
  return traders.filter((t) => {
    if (filters.performance === 'positive' && t.roi90 <= 0) return false;
    if (filters.performance === 'negative' && t.roi90 >= 0) return false;
    if (filters.risk !== 'all' && t.risk !== filters.risk) return false;
    if (filters.strategy !== 'all' && t.category !== filters.strategy) return false;
    if (filters.account === '<100k' && t.aum >= 100_000) return false;
    if (filters.account === '100k-500k' && (t.aum < 100_000 || t.aum >= 500_000)) return false;
    if (filters.account === '500k-2m' && (t.aum < 500_000 || t.aum >= 2_000_000)) return false;
    if (filters.account === '2m+' && t.aum < 2_000_000) return false;
    return true;
  });
}

export function searchTraders(traders: Trader[], query: string): Trader[] {
  const q = query.toLowerCase().trim();
  if (!q) return traders;
  return traders.filter((t) =>
    t.name.toLowerCase().includes(q) ||
    t.strategy.toLowerCase().includes(q) ||
    t.region.toLowerCase().includes(q) ||
    t.id.toLowerCase().includes(q)
  );
}
