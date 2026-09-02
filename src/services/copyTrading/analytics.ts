import { DailyResult, EquitySnapshot, PeriodSummary, SyntheticAnalytics, SyntheticCopyState, SyntheticTrade } from './types';

const DAY_MS = 86_400_000;
const round = (value: number, digits = 6) => Number(value.toFixed(digits));

export function utcDay(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function addUtcDays(value: string | Date, days: number): string {
  const date = new Date(`${utcDay(value)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

export function equityAtOrBefore(history: EquitySnapshot[], date: string): EquitySnapshot {
  const found = [...history].reverse().find((point) => point.date <= date);
  return found ?? history[0];
}

export function rollingRoi(history: EquitySnapshot[], days: number): number {
  const current = history[history.length - 1];
  const previous = equityAtOrBefore(history, addUtcDays(current.date, -days));
  return current && previous ? (current.equity / previous.equity - 1) * 100 : 0;
}

export function maximumDrawdown(history: EquitySnapshot[]): number {
  let peak = history[0]?.equity ?? 0;
  let maximum = 0;
  for (const point of history) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maximum = Math.max(maximum, (peak - point.equity) / peak);
  }
  return maximum * 100;
}

function tradesSince(trades: SyntheticTrade[], date: string): SyntheticTrade[] {
  return trades.filter((trade) => utcDay(trade.closedAt) > date);
}

function followerPnlForWindow(state: SyntheticCopyState, startDate: string): number {
  return state.followers.filter((follower) => follower.active).reduce((followerSum, follower) => {
    const masterAtStart = equityAtOrBefore(state.equityHistory, follower.copyStartDate).equity;
    const scale = follower.allocatedCapital / Math.max(1, masterAtStart);
    const effectiveStart = follower.copyStartDate > startDate ? follower.copyStartDate : startDate;
    const pnl = state.trades.filter((trade) => utcDay(trade.closedAt) >= effectiveStart).reduce((sum, trade) => {
      const penalty = Math.abs(trade.netPnl) * (follower.slippageBps / 10_000 + follower.latencyMs / 50_000_000);
      return sum + trade.netPnl * scale * follower.copyRatio - penalty * scale;
    }, 0);
    return followerSum + pnl;
  }, 0);
}

export function calculateAnalytics(state: SyntheticCopyState): SyntheticAnalytics {
  const currentDate = state.equityHistory[state.equityHistory.length - 1].date;
  const windowStart = addUtcDays(currentDate, -90);
  const rollingEquity = state.equityHistory.filter((point) => point.date >= windowStart);
  const rollingTrades = tradesSince(state.trades, windowStart);
  const wins = rollingTrades.filter((trade) => trade.result === 'WIN');
  const losses = rollingTrades.filter((trade) => trade.result === 'LOSS');
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const averageWinR = wins.length ? wins.reduce((sum, trade) => sum + trade.riskR, 0) / wins.length : 0;
  const averageLossR = losses.length ? Math.abs(losses.reduce((sum, trade) => sum + trade.riskR, 0) / losses.length) : 0;
  const winRateFraction = rollingTrades.length ? wins.length / rollingTrades.length : 0;
  const returns = rollingEquity.slice(1).map((point, index) => point.equity / rollingEquity[index].equity - 1);
  const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const deviation = sampleStd(returns);
  const downside = returns.filter((value) => value < 0);
  const downsideDeviation = downside.length ? Math.sqrt(downside.reduce((sum, value) => sum + value ** 2, 0) / downside.length) : 0;
  // Crypto trades every day, so Sharpe, Sortino, volatility and Calmar use
  // 365-day (not equities-style 252-day) annualization.
  const annualizedReturn = returns.length ? (rollingEquity[rollingEquity.length - 1].equity / rollingEquity[0].equity) ** (365 / returns.length) - 1 : 0;
  const maxDrawdown = maximumDrawdown(rollingEquity);
  const holding = rollingTrades.map((trade) => trade.holdingTimeMinutes).sort((a, b) => a - b);
  const medianHolding = holding.length ? (holding[Math.floor((holding.length - 1) / 2)] + holding[Math.ceil((holding.length - 1) / 2)]) / 2 : 0;
  const activeFollowers = state.followers.filter((follower) => follower.active);
  const followerPnl = activeFollowers.reduce((sum, follower) => sum + follower.realizedPnl + follower.unrealizedPnl, 0);
  const aum = activeFollowers.reduce((sum, follower) => sum + follower.allocatedCapital, 0);
  const initial = state.equityHistory[0].equity;
  const current = state.equityHistory[state.equityHistory.length - 1].equity;

  return {
    roi7: round(rollingRoi(state.equityHistory, 7), 3),
    roi30: round(rollingRoi(state.equityHistory, 30), 3),
    roi90: round(rollingRoi(state.equityHistory, 90), 3),
    roiAll: round((current / initial - 1) * 100, 3),
    winRate: round(winRateFraction * 100, 3),
    maximumDrawdown: round(maxDrawdown, 3),
    averageWinR: round(averageWinR, 4),
    averageLossR: round(averageLossR, 4),
    plRatio: round(averageLossR ? averageWinR / averageLossR : 0, 4),
    grossProfit: round(grossProfit, 2),
    grossLoss: round(grossLoss, 2),
    profitFactor: round(grossLoss ? grossProfit / grossLoss : 0, 4),
    expectancy: round(rollingTrades.length ? (grossProfit - grossLoss) / rollingTrades.length : 0, 4),
    expectancyR: round(winRateFraction * averageWinR - (1 - winRateFraction) * averageLossR, 4),
    sharpe: round(deviation ? mean / deviation * Math.sqrt(365) : 0, 4),
    sortino: round(downsideDeviation ? mean / downsideDeviation * Math.sqrt(365) : 0, 4),
    calmar: round(maxDrawdown ? annualizedReturn / (maxDrawdown / 100) : 0, 4),
    annualizedVolatility: round(deviation * Math.sqrt(365) * 100, 4),
    totalTradingDays: state.dailyResults.length,
    totalTrades: state.trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    tradesLast7D: tradesSince(state.trades, addUtcDays(currentDate, -7)).length,
    tradesLast30D: tradesSince(state.trades, addUtcDays(currentDate, -30)).length,
    averageTradesPerDay: round(state.trades.length / Math.max(1, state.dailyResults.length), 3),
    averageTradesPerWeek: round(state.trades.length / Math.max(1, state.dailyResults.length) * 7, 3),
    averageHoldingTimeMinutes: round(holding.length ? holding.reduce((sum, value) => sum + value, 0) / holding.length : 0, 2),
    medianHoldingTimeMinutes: round(medianHolding, 2),
    longestTradeMinutes: holding[holding.length - 1] ?? 0,
    shortestTradeMinutes: holding[0] ?? 0,
    masterPnl: round(current - initial, 2),
    followerPnl: round(followerPnl, 2),
    followerPnl7: round(followerPnlForWindow(state, addUtcDays(currentDate, -7)), 2),
    followerPnl30: round(followerPnlForWindow(state, addUtcDays(currentDate, -30)), 2),
    followerPnl90: round(followerPnlForWindow(state, addUtcDays(currentDate, -90)), 2),
    aum: round(aum, 2),
    activeFollowers: activeFollowers.length,
    tradingVolume: round(rollingTrades.reduce((sum, trade) => sum + trade.entryPrice * trade.quantity, 0), 2),
  };
}

export function summarizePeriods(state: SyntheticCopyState, unit: 'week' | 'month'): PeriodSummary[] {
  const groups = new Map<string, DailyResult[]>();
  for (const day of state.dailyResults) {
    const date = new Date(`${day.date}T00:00:00Z`);
    let key: string;
    if (unit === 'month') key = day.date.slice(0, 7);
    else {
      const monday = new Date(date);
      const weekday = (monday.getUTCDay() + 6) % 7;
      monday.setUTCDate(monday.getUTCDate() - weekday);
      key = monday.toISOString().slice(0, 10);
    }
    groups.set(key, [...(groups.get(key) ?? []), day]);
  }
  return [...groups.entries()].map(([period, days]) => {
    const first = days[0];
    const last = days[days.length - 1];
    const trades = state.trades.filter((trade) => {
      const date = utcDay(trade.closedAt);
      return date >= first.date && date <= last.date;
    });
    const wins = trades.filter((trade) => trade.result === 'WIN').length;
    const equity = [{ date: first.date, equity: first.startEquity }, ...days.map((day) => ({ date: day.date, equity: day.endEquity }))];
    return {
      period,
      roi: round((last.endEquity / first.startEquity - 1) * 100, 3),
      pnl: round(last.endEquity - first.startEquity, 2),
      trades: trades.length,
      winRate: round(trades.length ? wins / trades.length * 100 : 0, 3),
      maxDrawdown: round(maximumDrawdown(equity), 3),
    };
  });
}
