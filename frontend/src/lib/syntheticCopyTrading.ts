import type { ChartData, Period, Trade } from '../pages/copy-trading-bolt/traders';

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
  simulation: { seed: number; mode: 'REAL_TIME' | 'FAST_FORWARD'; simulatedAt: string };
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
  aumHistory: { date: string; aum: number }[];
  dailyResults: { date: string; startEquity: number; endEquity: number; realizedPnl: number; dailyReturn: number; drawdown: number }[];
  followers: { id: string; displayName: string; copyStartDate: string; allocatedCapital: number; currentEquity: number; realizedPnl: number; unrealizedPnl: number; roi: number; copiedTrades: number; copyRatio: number; slippageBps: number; latencyMs: number; active: boolean }[];
  weekly: { period: string; roi: number; pnl: number; trades: number; winRate: number; maxDrawdown: number }[];
  monthly: { period: string; roi: number; pnl: number; trades: number; winRate: number; maxDrawdown: number }[];
}

const periodDays: Record<Period, number> = { '7D': 7, '30D': 30, '90D': 90, ALL: Number.POSITIVE_INFINITY };

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
  const endDate = Date.parse(`${all[all.length - 1].date}T00:00:00Z`);
  const cutoff = endDate - periodDays[period] * 86_400_000;
  const selected = period === 'ALL' ? all : all.filter((point) => Date.parse(`${point.date}T00:00:00Z`) >= cutoff);
  const base = selected[0].equity;
  const trader = selected.map((point) => point.equity / base * 10_000);
  const market = trader.map((value) => 10_000 + (value - 10_000) * 0.16);
  const btc = trader.map((value) => 10_000 + (value - 10_000) * 0.42);
  const allValues = [...trader, ...market, ...btc];
  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const padding = (rawMax - rawMin) * 0.1 || 500;
  const min = rawMin - padding;
  const max = rawMax + padding;
  const traderPath = path(trader, min, max);
  const labels = Array.from({ length: 5 }, (_, index) => selected[Math.round(index * (selected.length - 1) / 4)]?.date.slice(5) ?? '');
  return {
    linePath: traderPath.line,
    areaPath: traderPath.area,
    marketPath: path(market, min, max).line,
    btcPath: path(btc, min, max).line,
    yLabels: Array.from({ length: 4 }, (_, index) => `$${Math.round(max - (max - min) * index / 3).toLocaleString('en-US')}`),
    xLabels: labels,
    endY: traderPath.endY,
  };
}
