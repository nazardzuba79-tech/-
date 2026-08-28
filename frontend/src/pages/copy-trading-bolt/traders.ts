// Ported verbatim from the approved Bolt.new archive's src/traders.ts —
// same trader roster, same math, same formatting helpers. The only
// removed exports are USER_DEPOSIT/COPY_ELIGIBLE (the archive's hardcoded
// stand-ins for account data): this app has a real account balance, so
// eligibility is computed from it instead — see CopyEligibilityContext.tsx.
export type RiskLevel = 'Low' | 'Moderate' | 'High' | 'Very High';
export type StrategyCategory = 'trend' | 'swing' | 'quant' | 'arbitrage' | 'futures' | 'long-term' | 'multi-asset';

export type Trader = {
  id: string;
  name: string;
  initials: string;
  tone: string;
  vip?: boolean;
  verified?: boolean;
  strategy: string;
  category: StrategyCategory;
  roi7: number;
  roi30: number;
  roi90: number;
  winRate: number;
  drawdown: number;
  copiers: number;
  accountSize: number;
  volume: number;
  risk: RiskLevel;
  activeMonths: number;
  copierProfit?: number;
  performanceFee?: number;
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

export const nazarTrader: Trader = {
  id: 'VX-001',
  name: 'Nazar',
  initials: 'N',
  tone: 'gold',
  vip: true,
  verified: true,
  strategy: 'Professional Strategy',
  category: 'multi-asset',
  roi7: 122,
  roi30: 271,
  roi90: 841,
  winRate: 97.1,
  drawdown: 9,
  copiers: 32,
  accountSize: 3_400_000,
  volume: 4.8,
  risk: 'Moderate',
  activeMonths: 14,
  copierProfit: 520_000,
  performanceFee: 0.20,
};

export const marketplaceTraders: Trader[] = [
  { id: 'VX-002', name: 'Alex Morgan', initials: 'AM', tone: 'blue', verified: true, strategy: 'BTC Trend Trader', category: 'trend', roi7: 9.4, roi30: 28.6, roi90: 76.2, winRate: 81.7, drawdown: 13.1, copiers: 126, accountSize: 240_000, volume: 8.2, risk: 'High', activeMonths: 18 },
  { id: 'VX-003', name: 'Marcus Webb', initials: 'MW', tone: 'orange', strategy: 'Momentum Trader', category: 'multi-asset', roi7: 7.8, roi30: 22.1, roi90: 61.4, winRate: 75.6, drawdown: 15.2, copiers: 54, accountSize: 125_000, volume: 4.3, risk: 'High', activeMonths: 9 },
  { id: 'VX-004', name: 'Sarah Chen', initials: 'SC', tone: 'green', verified: true, strategy: 'Quantitative Strategy', category: 'quant', roi7: 6.2, roi30: 18.4, roi90: 52.7, winRate: 78.3, drawdown: 9.8, copiers: 89, accountSize: 580_000, volume: 15.6, risk: 'Moderate', activeMonths: 22 },
  { id: 'VX-005', name: 'James Foster', initials: 'JF', tone: 'slate', strategy: 'Futures Specialist', category: 'futures', roi7: 5.6, roi30: 16.9, roi90: 48.3, winRate: 69.2, drawdown: 16.8, copiers: 46, accountSize: 125_000, volume: 9.7, risk: 'High', activeMonths: 11 },
  { id: 'VX-006', name: 'Elena Voss', initials: 'EV', tone: 'rose', verified: true, strategy: 'Swing Trader', category: 'swing', roi7: 4.8, roi30: 17.2, roi90: 41.5, winRate: 72.4, drawdown: 8.3, copiers: 84, accountSize: 42_800, volume: 2.1, risk: 'Moderate', activeMonths: 15 },
  { id: 'VX-007', name: 'Andre Costa', initials: 'AC', tone: 'orange', strategy: 'Momentum Trader', category: 'multi-asset', roi7: 4.4, roi30: 13.6, roi90: 36.1, winRate: 71.2, drawdown: 12.7, copiers: 37, accountSize: 76_400, volume: 3.2, risk: 'Moderate', activeMonths: 8 },
  { id: 'VX-008', name: 'Yuki Tanaka', initials: 'YT', tone: 'blue', strategy: 'DeFi Specialist', category: 'multi-asset', roi7: 4.2, roi30: 14.1, roi90: 38.9, winRate: 73.5, drawdown: 11.4, copiers: 31, accountSize: 27_500, volume: 1.8, risk: 'Moderate', activeMonths: 10 },
  { id: 'VX-009', name: 'David Park', initials: 'DP', tone: 'green', strategy: 'Algorithmic Trader', category: 'quant', roi7: 3.5, roi30: 12.8, roi90: 34.6, winRate: 74.1, drawdown: 7.2, copiers: 37, accountSize: 76_400, volume: 3.8, risk: 'Low', activeMonths: 13 },
  { id: 'VX-010', name: 'Mei Lin', initials: 'ML', tone: 'slate', strategy: 'High Growth Strategy', category: 'multi-asset', roi7: 3.8, roi30: 11.2, roi90: 29.4, winRate: 68.9, drawdown: 14.6, copiers: 54, accountSize: 42_800, volume: 2.6, risk: 'High', activeMonths: 7 },
  { id: 'VX-011', name: 'Omar Hassan', initials: 'OH', tone: 'blue', strategy: 'Multi-Asset Trader', category: 'multi-asset', roi7: 2.8, roi30: 10.3, roi90: 27.6, winRate: 70.4, drawdown: 6.7, copiers: 46, accountSize: 580_000, volume: 12.3, risk: 'Moderate', activeMonths: 16 },
  { id: 'VX-012', name: 'Carlos Mendez', initials: 'CM', tone: 'orange', strategy: 'Short-Term Trader', category: 'multi-asset', roi7: 3.1, roi30: 9.7, roi90: 24.8, winRate: 66.8, drawdown: 10.2, copiers: 14, accountSize: 42_800, volume: 2.8, risk: 'High', activeMonths: 6 },
  { id: 'VX-013', name: 'Sophie Laurent', initials: 'SL', tone: 'green', verified: true, strategy: 'Quantitative Strategy', category: 'quant', roi7: 2.5, roi30: 8.1, roi90: 19.6, winRate: 72.8, drawdown: 6.7, copiers: 46, accountSize: 125_000, volume: 4.6, risk: 'Moderate', activeMonths: 14 },
  { id: 'VX-014', name: 'Lisa Turnbull', initials: 'LT', tone: 'slate', verified: true, strategy: 'Market Neutral', category: 'multi-asset', roi7: 2.1, roi30: 8.4, roi90: 22.7, winRate: 71.8, drawdown: 5.4, copiers: 21, accountSize: 1_200_000, volume: 6.4, risk: 'Low', activeMonths: 20 },
  { id: 'VX-015', name: 'Rachel Kim', initials: 'RK', tone: 'rose', strategy: 'BTC Trend Trader', category: 'trend', roi7: 1.7, roi30: 6.9, roi90: 18.4, winRate: 68.2, drawdown: 5.1, copiers: 31, accountSize: 14_200, volume: 0.9, risk: 'Low', activeMonths: 12 },
  { id: 'VX-016', name: 'Raj Patel', initials: 'RP', tone: 'blue', strategy: 'Algorithmic Trader', category: 'quant', roi7: 1.9, roi30: 5.7, roi90: 16.3, winRate: 65.4, drawdown: 7.9, copiers: 14, accountSize: 42_800, volume: 1.9, risk: 'Moderate', activeMonths: 9 },
  { id: 'VX-017', name: 'Hannah Berg', initials: 'HB', tone: 'orange', strategy: 'Multi-Asset Trader', category: 'multi-asset', roi7: 1.4, roi30: 4.2, roi90: 12.6, winRate: 66.1, drawdown: 5.8, copiers: 14, accountSize: 76_400, volume: 2.9, risk: 'Moderate', activeMonths: 8 },
  { id: 'VX-018', name: 'Thomas Wright', initials: 'TW', tone: 'green', strategy: 'Long-Term Investor', category: 'long-term', roi7: 1.2, roi30: 4.8, roi90: 14.2, winRate: 67.5, drawdown: 3.8, copiers: 8, accountSize: 240_000, volume: 1.2, risk: 'Low', activeMonths: 24 },
  { id: 'VX-019', name: 'Olivia Hayes', initials: 'OL', tone: 'slate', strategy: 'Momentum Trader', category: 'multi-asset', roi7: 1.1, roi30: 3.9, roi90: 8.7, winRate: 64.7, drawdown: 6.2, copiers: 21, accountSize: 42_800, volume: 1.4, risk: 'Moderate', activeMonths: 5 },
  { id: 'VX-020', name: 'Emma Wilson', initials: 'EW', tone: 'blue', strategy: 'Low Risk Strategy', category: 'long-term', roi7: 0.9, roi30: 3.4, roi90: 10.8, winRate: 63.7, drawdown: 3.5, copiers: 21, accountSize: 580_000, volume: 2.3, risk: 'Low', activeMonths: 17 },
  { id: 'VX-021', name: 'Nina Petrova', initials: 'NP', tone: 'orange', verified: true, strategy: 'Arbitrage Strategy', category: 'arbitrage', roi7: 0.8, roi30: 3.2, roi90: 9.7, winRate: 79.1, drawdown: 2.1, copiers: 5, accountSize: 1_200_000, volume: 22.4, risk: 'Low', activeMonths: 19 },
  { id: 'VX-022', name: 'Priya Sharma', initials: 'PS', tone: 'green', strategy: 'Swing Trader', category: 'swing', roi7: 0.6, roi30: 2.1, roi90: 5.4, winRate: 64.3, drawdown: 4.2, copiers: 12, accountSize: 27_500, volume: 0.7, risk: 'Low', activeMonths: 7 },
  { id: 'VX-023', name: 'Sebastian Cross', initials: 'SX', tone: 'slate', strategy: 'Arbitrage Strategy', category: 'arbitrage', roi7: 0.3, roi30: 1.2, roi90: 3.8, winRate: 61.8, drawdown: 2.8, copiers: 2, accountSize: 240_000, volume: 8.9, risk: 'Low', activeMonths: 11 },
  { id: 'VX-024', name: 'Maya Roberts', initials: 'MR', tone: 'rose', strategy: 'Long-Term Investor', category: 'long-term', roi7: -0.4, roi30: 0.8, roi90: 2.1, winRate: 58.4, drawdown: 5.6, copiers: 5, accountSize: 125_000, volume: 0.9, risk: 'Low', activeMonths: 13 },
  { id: 'VX-025', name: 'Lucas Silva', initials: 'LS', tone: 'blue', strategy: 'DeFi Specialist', category: 'multi-asset', roi7: -1.3, roi30: 2.4, roi90: 7.8, winRate: 59.8, drawdown: 9.3, copiers: 8, accountSize: 14_200, volume: 0.8, risk: 'Moderate', activeMonths: 5 },
  { id: 'VX-026', name: 'Felix Brandt', initials: 'FB', tone: 'orange', strategy: 'BTC Trend Trader', category: 'trend', roi7: -0.8, roi30: 1.6, roi90: 4.9, winRate: 62.4, drawdown: 7.1, copiers: 5, accountSize: 27_500, volume: 0.6, risk: 'Moderate', activeMonths: 6 },
  { id: 'VX-027', name: 'Viktor Mueller', initials: 'VM', tone: 'slate', strategy: 'Futures Specialist', category: 'futures', roi7: -2.4, roi30: 3.8, roi90: 11.7, winRate: 61.5, drawdown: 12.4, copiers: 14, accountSize: 27_500, volume: 3.1, risk: 'High', activeMonths: 8 },
  { id: 'VX-028', name: 'Daniel R.', initials: 'DR', tone: 'rose', strategy: 'High Growth Strategy', category: 'multi-asset', roi7: -5.8, roi30: -1.9, roi90: -7.2, winRate: 58.7, drawdown: 16.8, copiers: 7, accountSize: 42_800, volume: 2.4, risk: 'Very High', activeMonths: 4 },
  { id: 'VX-029', name: 'Grace Liu', initials: 'GL', tone: 'blue', strategy: 'Algorithmic Trader', category: 'quant', roi7: -1.2, roi30: -4.7, roi90: -8.3, winRate: 49.8, drawdown: 21.3, copiers: 3, accountSize: 8_500, volume: 0.4, risk: 'Very High', activeMonths: 3 },
  { id: 'VX-030', name: 'Ivan Korol', initials: 'IK', tone: 'green', strategy: 'Futures Specialist', category: 'futures', roi7: -3.6, roi30: -7.2, roi90: -12.1, winRate: 52.3, drawdown: 24.6, copiers: 2, accountSize: 27_500, volume: 1.7, risk: 'Very High', activeMonths: 4 },
  { id: 'VX-031', name: 'Anton Volkov', initials: 'AV', tone: 'orange', strategy: 'Short-Term Trader', category: 'multi-asset', roi7: -4.2, roi30: -8.6, roi90: -15.4, winRate: 47.2, drawdown: 28.1, copiers: 0, accountSize: 8_500, volume: 0.3, risk: 'Very High', activeMonths: 2 },
];

const ALL_TIME_FACTOR = 1240 / 841;

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

export function formatAccountSize(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value}`;
}

export function formatVolume(value: number): string {
  return `$${value.toFixed(1)}M`;
}

export function getRoiForPeriod(trader: Trader, period: string): number {
  switch (period) {
    case '7D': return trader.roi7;
    case '30D': return trader.roi30;
    case '1Y': return trader.roi90 * 2.8;
    default: return trader.roi90;
  }
}

export function computeAllTime(trader: Trader): number {
  if (trader.vip) return 1240;
  return Math.round(trader.roi90 * (trader.activeMonths / 14) * ALL_TIME_FACTOR * 10) / 10;
}

export function compositeScore(trader: Trader): number {
  return trader.roi90 * 0.5 + trader.winRate * 2 - trader.drawdown * 3;
}

const strategyDescriptions: Record<StrategyCategory, string> = {
  'trend': 'A systematic trend-following approach that captures sustained market movements with disciplined entry and exit rules.',
  'swing': 'A swing trading strategy targeting medium-term price movements across major crypto assets.',
  'quant': 'A quantitative approach using statistical models and algorithmic execution to extract consistent returns.',
  'arbitrage': 'An arbitrage strategy that exploits price inefficiencies across venues with minimal directional exposure.',
  'futures': 'A futures-focused approach using leverage strategically to amplify returns while managing margin risk.',
  'long-term': 'A long-term investment approach focused on fundamental value and macro trends in the crypto market.',
  'multi-asset': 'A diversified multi-asset strategy that allocates across the crypto spectrum to balance risk and return.',
};

export function getTraderEarnings(trader: Trader): number {
  if (!trader.copierProfit || !trader.performanceFee) return 0;
  return Math.round(trader.copierProfit * trader.performanceFee);
}

export function formatUsd(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return `${value}`;
}

export function getStrategyDescription(trader: Trader): string {
  return strategyDescriptions[trader.category];
}

export function generateProfileData(trader: Trader) {
  const totalTrades = Math.max(20, Math.round(trader.volume * 18));
  const winningTrades = Math.round(totalTrades * trader.winRate / 100);
  const losingTrades = totalTrades - winningTrades;
  const avgProfit = trader.roi90 > 0 ? Math.min(8, Math.max(1.2, trader.roi90 / 50)) : 1.5;
  const avgLoss = -(avgProfit * 0.38);
  const grossProfit = winningTrades * avgProfit;
  const grossLoss = Math.abs(losingTrades * avgLoss);
  const profitFactor = grossLoss > 0 ? Math.round((grossProfit / grossLoss) * 10) / 10 : 5.0;
  const holdingTimes: Record<StrategyCategory, string> = {
    'long-term': '3d 12h',
    'arbitrage': '0h 42m',
    'trend': '1d 6h',
    'swing': '8h 42m',
    'quant': '4h 18m',
    'futures': '6h 24m',
    'multi-asset': '7h 30m',
  };
  return {
    totalTrades,
    winningTrades,
    losingTrades,
    avgProfit: `+${avgProfit.toFixed(1)}%`,
    avgLoss: `${avgLoss.toFixed(1)}%`,
    profitFactor: profitFactor.toFixed(1),
    holdingTime: holdingTimes[trader.category],
    volume: `$${trader.volume.toFixed(1)}M`,
    allTime: computeAllTime(trader),
    newThisWeek: Math.max(0, Math.round(trader.copiers * 0.08)),
    avgCopierDeposit: Math.round(trader.accountSize * 0.04 / 100) * 100,
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

function hashId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

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
    const isWin = ((i + 1) / count * 100) <= trader.winRate;
    const roiPct = isWin ? 0.8 + (h % 45) / 10 : -(0.3 + (h % 25) / 10);
    const priceVar = (h % 100) / 1000;
    const entryPrice = asset.base * (1 + priceVar);
    const exitPrice = side === 'Long' ? entryPrice * (1 + roiPct / 100) : entryPrice * (1 - roiPct / 100);
    const positionSize = trader.accountSize * 0.05;
    const pnl = (positionSize * roiPct) / 100;
    const hours = h % 14;
    const minutes = (h * 7) % 60;
    const date = new Date(2026, 7, 28 - (i * 2 + 1));
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    trades.push({
      asset: asset.symbol,
      side,
      entry: formatPrice(entryPrice),
      exit: formatPrice(exitPrice),
      pnl: `${pnl >= 0 ? '+' : '-'}$${Math.abs(Math.round(pnl)).toLocaleString()}`,
      roi: `${roiPct > 0 ? '+' : ''}${roiPct.toFixed(1)}%`,
      duration: `${hours}h ${minutes.toString().padStart(2, '0')}m`,
      date: dateStr,
      positive: isWin,
    });
  }
  return trades;
}

export function sortTraders(traders: Trader[], sortBy: string, period: string): Trader[] {
  const getRoi = (t: Trader) => getRoiForPeriod(t, period);
  switch (sortBy) {
    case 'Highest ROI': return [...traders].sort((a, b) => getRoi(b) - getRoi(a));
    case 'Best Win Rate': return [...traders].sort((a, b) => b.winRate - a.winRate);
    case 'Lowest Drawdown': return [...traders].sort((a, b) => a.drawdown - b.drawdown);
    case 'Most Copied': return [...traders].sort((a, b) => b.copiers - a.copiers);
    case 'Highest Trading Volume': return [...traders].sort((a, b) => b.volume - a.volume);
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
    if (filters.account === '<10k' && t.accountSize >= 10_000) return false;
    if (filters.account === '10k-50k' && (t.accountSize < 10_000 || t.accountSize >= 50_000)) return false;
    if (filters.account === '50k-100k' && (t.accountSize < 50_000 || t.accountSize >= 100_000)) return false;
    if (filters.account === '100k+' && t.accountSize < 100_000) return false;
    return true;
  });
}

export function searchTraders(traders: Trader[], query: string): Trader[] {
  const q = query.toLowerCase().trim();
  if (!q) return traders;
  return traders.filter((t) =>
    t.name.toLowerCase().includes(q) ||
    t.strategy.toLowerCase().includes(q) ||
    t.id.toLowerCase().includes(q)
  );
}
