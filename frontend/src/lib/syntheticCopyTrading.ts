import { nazarTrader, type ChartData, type Period, type Trade, type Trader } from '../pages/copy-trading-bolt/traders';

/** Public v7 economics: deliberately excludes the master's private capital and cash flows. */
export interface SyntheticPeriodEconomics {
  roi: number; masterPnl: number; masterTradingVolume: number; copiedTradingVolume: number;
  grossFollowersPnl: number; performanceFeeEarnings: number; netFollowersPnl: number;
  activeTradingDays: number; calendarDays: number;
  sharpe: number | null; sortino: number | null; profitFactor: number | null;
  maximumDrawdown: number; annualizedVolatility: number;
}

export interface SyntheticReviewEconomics {
  methodology: 'DAILY_TWR';
  performanceFeeRate: number;
  policy: {
    methodology: 'DAILY_TWR'; performanceFeeRate: number; feeCrystallization: string;
    copyMinimumPolicyEffectiveDate: string; currentCopyMinimum: number;
    holidays: { start: string; end: string; reason: string }[];
  };
  periods: Record<Period, SyntheticPeriodEconomics>;
  cumulativePnlHistory: { date: string; pnl: number }[];
}

export interface SyntheticTradeDto {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  leverage: number;
  openedAt: string;
  closedAt: string;
  grossPnl: number;
  fees: number;
  funding: number;
  netPnl: number;
  returnPct: number;
  holdingTimeMinutes: number;
  riskR: number;
  result: 'WIN' | 'LOSS';
}

export interface SyntheticCopyTradingResponse {
  trader: { id: string; name: string; vip: boolean };
  simulation: { seed: number; mode: 'REAL_TIME' | 'FAST_FORWARD'; simulatedAt: string; stateVersion?: number };
  economics?: SyntheticReviewEconomics;
  analytics: {
    roi7: number; roi30: number; roi90: number; roiAll: number;
    winRate: number; maximumDrawdown: number; averageWinR: number; averageLossR: number;
    plRatio: number; grossProfit: number; grossLoss: number; profitFactor: number;
    expectancy: number; expectancyR: number; sharpe: number; sortino: number; calmar: number;
    annualizedVolatility: number; totalTradingDays: number; totalTrades: number;
    winningTrades: number; losingTrades: number; tradesLast7D: number; tradesLast30D: number;
    averageTradesPerDay: number; averageTradesPerWeek: number; averageHoldingTimeMinutes: number;
    medianHoldingTimeMinutes: number; longestTradeMinutes: number; shortestTradeMinutes: number;
    masterPnl: number; followerPnl: number; followerPnl7: number; followerPnl30: number; followerPnl90: number;
    aum: number; activeFollowers: number; tradingVolume: number;
    allTime: {
      roi: number; pnl: number; totalTrades: number; winningTrades: number; losingTrades: number;
      winRate: number; maximumDrawdown: number; profitFactor: number; sharpe: number; sortino: number;
      tradingDays: number; averageTrade: number; followersPnl: number; aum: number;
    };
  };
  trades: SyntheticTradeDto[];
  equityHistory: { date: string; equity: number }[];
  aumHistory: { date: string; aum: number; followerCount?: number }[];
  dailyResults: { date: string; startEquity: number; endEquity: number; realizedPnl: number; dailyReturn: number; drawdown: number }[];
  followers: { id: string; displayName: string; copyStartDate: string; allocatedCapital: number; currentEquity: number; realizedPnl: number; unrealizedPnl: number; roi: number; copiedTrades: number; copyRatio: number; slippageBps: number; latencyMs: number; active: boolean; startingAllocation?: number; grossPnl?: number; performanceFees?: number; netPnl?: number; copiedVolume?: number; highWaterMark?: number }[];
  weekly: { period: string; roi: number; pnl: number; trades: number; winRate: number; maxDrawdown: number }[];
  monthly: { period: string; roi: number; pnl: number; trades: number; winRate: number; maxDrawdown: number }[];
}

const periodDays: Record<Period, number> = { '7D': 7, '30D': 30, '90D': 90, ALL: Number.POSITIVE_INFINITY };

/** Identity is available while loading; economics must come from the actual response. */
export function syntheticNazaraTrader(data?: SyntheticCopyTradingResponse | null): Trader {
  if (!data) return { ...nazarTrader };
  const { analytics, economics } = data;
  return {
    ...nazarTrader, name: data.trader.name,
    roi7: economics?.periods['7D'].roi ?? analytics.roi7,
    roi30: economics?.periods['30D'].roi ?? analytics.roi30,
    roi90: economics?.periods['90D'].roi ?? analytics.roi90,
    roiAll: economics?.periods.ALL.roi ?? analytics.roiAll,
    winRate: analytics.winRate,
    drawdown: economics?.periods.ALL.maximumDrawdown ?? analytics.maximumDrawdown,
    copiers: data.followers.filter(follower => follower.active).length,
    aum: data.followers.filter(follower => follower.active).reduce((sum, follower) => sum + follower.allocatedCapital, 0),
    volume: economics?.periods.ALL.masterTradingVolume ?? analytics.tradingVolume,
    activeMonths: data.dailyResults.length / 30.44,
    performanceFee: economics?.performanceFeeRate ?? Number.NaN,
  };
}

/** Rank actual markets, retaining XRP as an explicitly tracked strategy market. */
export function syntheticMainMarkets(trades: Pick<SyntheticTradeDto, 'symbol'>[]): string[] {
  const counts = trades.reduce<Record<string, number>>((result, trade) => {
    const symbol = trade.symbol.replace('/USDT', '').replace(/USDT$/, '');
    result[symbol] = (result[symbol] ?? 0) + 1;
    return result;
  }, {});
  const markets = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3).map(([symbol]) => symbol);
  if (counts.XRP && !markets.includes('XRP')) markets.push('XRP');
  return markets;
}

export function formatSyntheticHistoryDate(date: string, includeYear = true): string {
  // Snapshots use YYYY-MM-DD; follower joins can carry a full ISO timestamp.
  const dateOnly = date.slice(0, 10);
  const parsed = new Date(`${dateOnly}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOnly) || !Number.isFinite(parsed.getTime())) return '—';
  return parsed.toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', ...(includeYear ? { year: 'numeric' as const } : {}), timeZone: 'UTC',
  });
}

/** v7 period boundaries and ledger timestamps use the same explicit UTC clock. */
export function formatSyntheticTradeTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleString('ru-RU', { timeZone: 'UTC' });
}

/** Preserve meaningful execution differences for low-price strategy markets. */
export function formatSyntheticTradePrice(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  const digits = value > 0 && value < 1
    ? Math.min(12, Math.max(6, -Math.floor(Math.log10(value)) + 3))
    : value < 10 ? 4 : 2;
  return value.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Milestones select recorded daily snapshots; neither counts nor AUM are inferred. */
export function syntheticAumMilestones(history: SyntheticCopyTradingResponse['aumHistory']) {
  if (!history.length) return [];
  const first = history[0].date;
  const last = history[history.length - 1].date;
  const addMonths = (months: number) => {
    const date = new Date(`${first}T00:00:00Z`);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    const monthEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, monthEnd));
    return date.toISOString().slice(0, 10);
  };
  const secondWeek = new Date(Date.parse(`${first}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
  const checkpoints = [
    { label: 'Старт', date: first }, { label: 'Вторая неделя', date: secondWeek },
    { label: '1 месяц', date: addMonths(1) }, { label: '2 месяца', date: addMonths(2) },
    { label: '6 месяцев', date: addMonths(6) }, { label: 'Текущая дата', date: last },
  ];
  return checkpoints.filter((point, index) => point.date <= last
    && checkpoints.findIndex(other => other.date === point.date) === index).flatMap(checkpoint => {
    const snapshot = [...history].reverse().find(point => point.date <= checkpoint.date);
    return snapshot ? [{ ...snapshot, label: checkpoint.label }] : [];
  });
}

export interface SyntheticPeriodAnalytics {
  period: Period;
  roi: number;
  pnl: number;
  winRate: number;
  maximumDrawdown: number;
  averagePnl: number;
  profitFactor: number | null;
  averageTradesPerWeek: number;
  averageHoldingTimeMinutes: number;
  annualizedVolatility: number;
  sharpe: number | null;
  sortino: number | null;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  tradingDays: number;
  calendarDays: number;
  followerPnl: number;
  economics?: SyntheticPeriodEconomics;
  cumulativePnl: { date: string; pnl: number }[];
  equity: SyntheticCopyTradingResponse['equityHistory'];
  daily: SyntheticCopyTradingResponse['dailyResults'];
  trades: SyntheticCopyTradingResponse['trades'];
}

function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

function maxDrawdown(history: SyntheticCopyTradingResponse['equityHistory']): number {
  let peak = history[0]?.equity ?? 0;
  let maximum = 0;
  for (const point of history) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maximum = Math.max(maximum, (peak - point.equity) / peak);
  }
  return maximum * 100;
}

/**
 * Produces every period-sensitive profile KPI from one slice of the engine's
 * ledger/equity history. The cutoff mirrors the backend analytics convention:
 * the equity point at the boundary is the opening balance, while trades and
 * daily results after that boundary belong to the selected window.
 */
export function selectSyntheticPeriod(data: SyntheticCopyTradingResponse, period: Period): SyntheticPeriodAnalytics {
  const allEquity = data.equityHistory;
  const currentDate = allEquity[allEquity.length - 1]?.date ?? data.simulation.simulatedAt.slice(0, 10);
  const cutoff = period === 'ALL'
    ? ''
    : new Date(Date.parse(`${currentDate}T00:00:00Z`) - periodDays[period] * 86_400_000).toISOString().slice(0, 10);
  const equity = period === 'ALL' ? allEquity : allEquity.filter((point) => point.date >= cutoff);
  const trades = (period === 'ALL' ? data.trades : data.trades.filter((trade) => trade.closedAt.slice(0, 10) > cutoff))
    .slice()
    .sort((a, b) => Date.parse(b.closedAt) - Date.parse(a.closedAt));
  const daily = period === 'ALL' ? data.dailyResults : data.dailyResults.filter((day) => day.date > cutoff);
  // v7 equity is a cash-flow-neutral performance index, never a USDT balance.
  // Preserve legacy arithmetic exactly: those ledgers store monetary equity.
  const openingEquity = equity[0]?.equity ?? 0;
  const closingEquity = equity[equity.length - 1]?.equity ?? openingEquity;
  const pnl = data.economics?.methodology === 'DAILY_TWR'
    ? daily.reduce((sum, day) => sum + day.realizedPnl, 0)
    : closingEquity - openingEquity;
  const wins = trades.filter((trade) => trade.result === 'WIN');
  const losses = trades.filter((trade) => trade.result === 'LOSS');
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const economics = data.economics?.periods[period];
  const returns = data.economics?.methodology === 'DAILY_TWR'
    ? daily.map(day => day.dailyReturn)
    : equity.slice(1).map((point, index) => point.equity / equity[index].equity - 1);
  const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const deviation = sampleStd(returns);
  const downside = returns.filter((value) => value < 0);
  const downsideDeviation = downside.length
    ? Math.sqrt(downside.reduce((sum, value) => sum + value ** 2, 0) / (economics ? returns.length : downside.length))
    : 0;
  const holdingTotal = trades.reduce((sum, trade) => sum + trade.holdingTimeMinutes, 0);
  const followerPnl = economics ? economics.netFollowersPnl : period === '7D' ? data.analytics.followerPnl7
    : period === '30D' ? data.analytics.followerPnl30
      : period === '90D' ? data.analytics.followerPnl90
        : data.analytics.allTime.followersPnl;

  let accumulatedPnl = 0;
  const cumulativePnl = [
    ...(equity[0] ? [{ date: equity[0].date, pnl: 0 }] : []),
    ...daily.map(day => ({ date: day.date, pnl: accumulatedPnl += day.realizedPnl })),
  ];
  return {
    period,
    roi: (returns.reduce((factor, value) => factor * (1 + value), 1) - 1) * 100,
    pnl,
    winRate: trades.length ? wins.length / trades.length * 100 : 0,
    maximumDrawdown: economics?.maximumDrawdown ?? maxDrawdown(equity),
    averagePnl: trades.length ? trades.reduce((sum, trade) => sum + trade.netPnl, 0) / trades.length : 0,
    profitFactor: economics ? economics.profitFactor : grossLoss ? grossProfit / grossLoss : 0,
    averageTradesPerWeek: trades.length / Math.max(1, daily.length) * 7,
    averageHoldingTimeMinutes: trades.length ? holdingTotal / trades.length : 0,
    annualizedVolatility: economics?.annualizedVolatility ?? deviation * Math.sqrt(365) * 100,
    sharpe: economics ? economics.sharpe : deviation ? mean / deviation * Math.sqrt(365) : 0,
    sortino: economics ? economics.sortino : downsideDeviation ? mean / downsideDeviation * Math.sqrt(365) : 0,
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    tradingDays: economics?.activeTradingDays ?? daily.length,
    calendarDays: daily.length,
    followerPnl,
    economics,
    cumulativePnl,
    equity,
    daily,
    trades,
  };
}

/** Native calendar points only: cash flows never become PnL or chart smoothing. */
export function syntheticPerformancePoints(data: SyntheticPeriodAnalytics, mode: 'ROI' | 'PnL'): { date: string; value: number }[] {
  if (mode === 'PnL') return data.cumulativePnl.map(point => ({ date: point.date, value: point.pnl }));
  const base = data.equity[0]?.equity;
  if (base === undefined || base <= 0) return [];
  return data.equity.map(point => ({ date: point.date, value: (point.equity / base - 1) * 100 }));
}

function duration(minutes: number): string {
  if (minutes >= 1_440) return `${(minutes / 1_440).toFixed(1)} дн.`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`;
  return `${minutes} мин`;
}

export function syntheticRecentTrades(data: SyntheticCopyTradingResponse): (Trade & { openedAt: string; closedAt: string })[] {
  return data.trades.slice(0, 12).map((trade) => ({
    asset: trade.symbol,
    side: trade.side === 'LONG' ? 'Long' : 'Short',
    entry: trade.entryPrice.toLocaleString('ru-RU', { maximumFractionDigits: 6 }),
    exit: trade.exitPrice.toLocaleString('ru-RU', { maximumFractionDigits: 6 }),
    pnl: `${trade.netPnl >= 0 ? '+' : '−'}${Math.abs(trade.netPnl).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} USDT`,
    roi: `${trade.returnPct >= 0 ? '+' : '−'}${Math.abs(trade.returnPct).toFixed(2)}%`,
    duration: duration(trade.holdingTimeMinutes),
    date: new Date(trade.closedAt).toLocaleDateString('ru-RU'),
    openedAt: new Date(trade.openedAt).toLocaleString('ru-RU'),
    closedAt: new Date(trade.closedAt).toLocaleString('ru-RU'),
    positive: trade.result === 'WIN',
  }));
}

function path(values: number[], min: number, max: number): { line: string; area: string; endY: number } {
  const width = 900;
  const top = 20;
  const bottom = 245;
  const range = Math.max(0.000001, max - min);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width : index / (values.length - 1) * width;
    const y = bottom - (value - min) / range * (bottom - top);
    return [x, y] as const;
  });
  const line = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return { line, area: `${line} L900 ${bottom} L0 ${bottom} Z`, endY: points[points.length - 1]?.[1] ?? bottom };
}

export function syntheticChartData(data: SyntheticCopyTradingResponse, period: Period): ChartData {
  const all = data.equityHistory;
  if (!all.length) return { linePath: '', areaPath: '', marketPath: '', btcPath: '', yLabels: [], xLabels: [], endY: 245 };
  const endDate = Date.parse(`${all[all.length - 1].date}T00:00:00Z`);
  const cutoff = endDate - periodDays[period] * 86_400_000;
  const selected = period === 'ALL' ? all : all.filter((point) => Date.parse(`${point.date}T00:00:00Z`) >= cutoff);
  const base = selected[0].equity;
  const trader = selected.map((point) => (point.equity / base - 1) * 100);
  const allValues = trader;
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const padding = (rawMax - rawMin) * 0.1 || 1;
  const min = rawMin - padding;
  const max = rawMax + padding;
  const traderPath = path(trader, min, max);
  const labels = Array.from({ length: 5 }, (_, index) => {
    const date = selected[Math.round(index * (selected.length - 1) / 4)]?.date;
    return date ? formatSyntheticHistoryDate(date, period === 'ALL') : '';
  });
  return {
    linePath: traderPath.line,
    areaPath: traderPath.area,
    marketPath: '',
    btcPath: '',
    yLabels: Array.from({ length: 4 }, (_, index) => `${(max - (max - min) * index / 3).toFixed(1)}%`),
    xLabels: labels,
    endY: traderPath.endY,
  };
}
