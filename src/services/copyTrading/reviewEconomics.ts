import { addUtcDays, maximumDrawdown, utcDay } from './analytics';
import type { PeriodSummary, SyntheticAnalytics, SyntheticCopyResponse, SyntheticCopyState, SyntheticTrade } from './types';
import type { CashflowReviewState, ReviewPeriod, ReviewPeriodEconomics } from './reviewEconomicsTypes';

const round = (value: number, places = 4) => Number(value.toFixed(places));
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const money = (values: number[]) => round(sum(values));
export const REVIEW_PERIODS: ReviewPeriod[] = ['7D', '30D', '90D', 'ALL'];

export function requireCashflowState(state: SyntheticCopyState): CashflowReviewState {
  if (state.version !== 7 || !('cashflow' in state)) throw new Error('Expected isolated cash-flow review state v7');
  return state as CashflowReviewState;
}

/** Calendar-day risk on cash-flow-neutral returns; target/risk-free return is 0. */
export function reviewRisk(returns: number[]) {
  const mean = returns.length ? sum(returns) / returns.length : 0;
  const variance = returns.length > 1 ? sum(returns.map(value => (value - mean) ** 2)) / (returns.length - 1) : 0;
  const deviation = Math.sqrt(variance);
  const downside = returns.length ? Math.sqrt(sum(returns.map(value => Math.min(value, 0) ** 2)) / returns.length) : 0;
  return {
    sharpe: deviation > 0 ? mean / deviation * Math.sqrt(365) : null,
    sortino: downside > 0 ? mean / downside * Math.sqrt(365) : null,
    annualizedVolatility: deviation * Math.sqrt(365) * 100,
  };
}

export function reviewSlice(state: CashflowReviewState, period: ReviewPeriod) {
  const end = utcDay(state.simulatedAt);
  const cutoff = period === 'ALL' ? state.initialEquityDate : addUtcDays(end, -parseInt(period));
  const daily = state.dailyResults.filter(day => day.date > cutoff && day.date <= end);
  const trades = state.trades.filter(trade => utcDay(trade.closedAt) > cutoff && utcDay(trade.closedAt) <= end);
  const equity = state.equityHistory.filter(point => point.date >= cutoff && point.date <= end);
  return { end, cutoff, daily, trades, equity };
}

export function calculateReviewPeriod(state: CashflowReviewState, period: ReviewPeriod): ReviewPeriodEconomics {
  const { cutoff, end, daily, trades, equity } = reviewSlice(state, period);
  const inWindow = (date: string) => date.slice(0, 10) > cutoff && date.slice(0, 10) <= end;
  const copied = state.cashflow.copiedTrades.filter(trade => inWindow(trade.closedAt));
  const feeEvents = state.cashflow.performanceFeeEvents.filter(event => inWindow(event.date));
  const grossFollowersPnl = money(copied.map(trade => trade.grossPnl));
  const performanceFeeEarnings = money(feeEvents.map(event => event.feeAmount));
  const gains = sum(trades.filter(trade => trade.netPnl > 0).map(trade => trade.netPnl));
  const losses = -sum(trades.filter(trade => trade.netPnl < 0).map(trade => trade.netPnl));
  return {
    roi: (daily.reduce((factor, day) => factor * (1 + day.dailyReturn), 1) - 1) * 100,
    masterPnl: money(trades.map(trade => trade.netPnl)),
    masterTradingVolume: round(sum(trades.map(trade => trade.entryPrice * trade.quantity)), 2),
    copiedTradingVolume: round(sum(copied.map(trade => trade.notional)), 2),
    grossFollowersPnl,
    performanceFeeEarnings,
    netFollowersPnl: round(grossFollowersPnl - performanceFeeEarnings),
    activeTradingDays: daily.filter(day => day.numberOfTrades > 0).length,
    calendarDays: daily.length,
    ...reviewRisk(daily.map(day => day.dailyReturn)),
    maximumDrawdown: maximumDrawdown(equity),
    profitFactor: losses > 0 ? gains / losses : null,
  };
}

function outcomes(trades: SyntheticTrade[]) {
  const wins = trades.filter(trade => trade.netPnl > 0);
  const losses = trades.filter(trade => trade.netPnl < 0);
  const holding = trades.map(trade => trade.holdingTimeMinutes).sort((a, b) => a - b);
  return { wins, losses, holding, winRate: trades.length ? wins.length / trades.length * 100 : 0,
    grossProfit: money(wins.map(trade => trade.netPnl)), grossLoss: -money(losses.map(trade => trade.netPnl)) };
}

export function calculateCashflowAnalytics(input: SyntheticCopyState): SyntheticAnalytics {
  const state = requireCashflowState(input);
  const all = calculateReviewPeriod(state, 'ALL');
  const p7 = calculateReviewPeriod(state, '7D');
  const p30 = calculateReviewPeriod(state, '30D');
  const p90 = calculateReviewPeriod(state, '90D');
  const recent = reviewSlice(state, '90D');
  const result = outcomes(recent.trades);
  const lifetime = outcomes(state.trades);
  const averageWinR = result.wins.length ? sum(result.wins.map(trade => trade.riskR)) / result.wins.length : 0;
  const averageLossR = result.losses.length ? -sum(result.losses.map(trade => trade.riskR)) / result.losses.length : 0;
  const active = state.followers.filter(follower => follower.active);
  const aum = round(sum(active.map(follower => follower.allocatedCapital)), 2);
  // Nullable authoritative ratios are in economics.periods. Legacy numeric
  // response fields remain compatible; consumers of v7 use those nullables.
  return {
    roi7: round(p7.roi, 3), roi30: round(p30.roi, 3), roi90: round(p90.roi, 3), roiAll: round(all.roi, 3),
    winRate: round(result.winRate, 3), maximumDrawdown: round(p90.maximumDrawdown),
    averageWinR: round(averageWinR), averageLossR: round(averageLossR),
    plRatio: averageLossR ? round(averageWinR / averageLossR) : 0,
    grossProfit: result.grossProfit, grossLoss: result.grossLoss,
    profitFactor: p90.profitFactor ?? 0,
    expectancy: recent.trades.length ? round(p90.masterPnl / recent.trades.length) : 0,
    expectancyR: round(result.winRate / 100 * averageWinR - (1 - result.winRate / 100) * averageLossR),
    sharpe: p90.sharpe ?? 0, sortino: p90.sortino ?? 0,
    calmar: p90.maximumDrawdown ? ((1 + p90.roi / 100) ** (365 / Math.max(1, p90.calendarDays)) - 1) / (p90.maximumDrawdown / 100) : 0,
    annualizedVolatility: p90.annualizedVolatility,
    totalTradingDays: all.calendarDays, totalTrades: state.trades.length,
    winningTrades: result.wins.length, losingTrades: result.losses.length,
    tradesLast7D: reviewSlice(state, '7D').trades.length,
    tradesLast30D: reviewSlice(state, '30D').trades.length,
    averageTradesPerDay: state.trades.length / Math.max(1, all.calendarDays),
    averageTradesPerWeek: state.trades.length / Math.max(1, all.calendarDays) * 7,
    averageHoldingTimeMinutes: result.holding.length ? sum(result.holding) / result.holding.length : 0,
    medianHoldingTimeMinutes: result.holding.length ? (result.holding[Math.floor((result.holding.length - 1) / 2)] + result.holding[Math.ceil((result.holding.length - 1) / 2)]) / 2 : 0,
    longestTradeMinutes: result.holding.at(-1) ?? 0, shortestTradeMinutes: result.holding[0] ?? 0,
    masterPnl: round(all.masterPnl, 2), followerPnl: round(all.netFollowersPnl, 2),
    followerPnl7: round(p7.netFollowersPnl, 2), followerPnl30: round(p30.netFollowersPnl, 2), followerPnl90: round(p90.netFollowersPnl, 2),
    aum, activeFollowers: active.length, tradingVolume: p90.masterTradingVolume,
    allTime: { roi: round(all.roi, 3), pnl: round(all.masterPnl, 2), totalTrades: state.trades.length,
      winningTrades: lifetime.wins.length, losingTrades: lifetime.losses.length,
      winRate: round(lifetime.winRate, 3), maximumDrawdown: all.maximumDrawdown,
      profitFactor: all.profitFactor ?? 0, sharpe: all.sharpe ?? 0, sortino: all.sortino ?? 0,
      tradingDays: all.calendarDays, averageTrade: state.trades.length ? all.masterPnl / state.trades.length : 0,
      followersPnl: round(all.netFollowersPnl, 2), aum },
  };
}

export function summarizeCashflowPeriods(state: CashflowReviewState, unit: 'week' | 'month'): PeriodSummary[] {
  const groups = new Map<string, typeof state.dailyResults>();
  for (const day of state.dailyResults) {
    const date = new Date(`${day.date}T00:00:00Z`);
    const key = unit === 'month' ? day.date.slice(0, 7) : addUtcDays(day.date, -(date.getUTCDay() + 6) % 7);
    const days = groups.get(key) ?? [];
    days.push(day);
    groups.set(key, days);
  }
  return [...groups].map(([period, days]) => {
    const trades = state.trades.filter(trade => utcDay(trade.closedAt) >= days[0].date && utcDay(trade.closedAt) <= days.at(-1)!.date);
    const history = state.equityHistory.filter(point => point.date >= addUtcDays(days[0].date, -1) && point.date <= days.at(-1)!.date);
    return { period, roi: round((days.reduce((factor, day) => factor * (1 + day.dailyReturn), 1) - 1) * 100, 3),
      pnl: money(trades.map(trade => trade.netPnl)), trades: trades.length,
      winRate: round(outcomes(trades).winRate, 3), maxDrawdown: maximumDrawdown(history) };
  });
}

export function toCashflowReviewResponse(input: SyntheticCopyState): SyntheticCopyResponse {
  const state = requireCashflowState(input);
  const periods = Object.fromEntries(REVIEW_PERIODS.map(period => [period, calculateReviewPeriod(state, period)])) as Record<ReviewPeriod, ReviewPeriodEconomics>;
  let cumulativePnl = 0;
  const cumulativePnlHistory = [{ date: state.initialEquityDate, pnl: 0 }, ...state.dailyResults.map(day => {
    cumulativePnl = round(cumulativePnl + day.realizedPnl);
    return { date: day.date, pnl: cumulativePnl };
  })];
  return {
    trader: { id: 'VX-001', name: 'Nazara', vip: true },
    simulation: { seed: state.seed, mode: state.mode, simulatedAt: state.simulatedAt, stateVersion: state.version },
    analytics: calculateCashflowAnalytics(state),
    economics: { methodology: 'DAILY_TWR', performanceFeeRate: state.cashflow.policy.performanceFeeRate,
      policy: state.cashflow.policy, periods, cumulativePnlHistory },
    trades: [...state.trades].sort((a, b) => b.closedAt.localeCompare(a.closedAt)),
    equityHistory: state.equityHistory, aumHistory: state.aumHistory,
    // Old DTO field names are retained, but on v7 these are public performance
    // index levels. Never serialize private account/capital/cash-flow ledgers.
    dailyResults: state.dailyResults.map((day, index) => ({ ...day,
      startEquity: state.equityHistory[index].equity, endEquity: state.equityHistory[index + 1].equity })),
    followers: state.followers,
    weekly: summarizeCashflowPeriods(state, 'week'), monthly: summarizeCashflowPeriods(state, 'month'),
  };
}
