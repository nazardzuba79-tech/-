import { createReviewSyntheticState } from '../reviewSyntheticHistory';
import { advanceState, createInitialState, toResponse } from '../SyntheticCopyTradingEngine';
import { calculateAnalytics } from '../analytics';
import { calculateReviewPeriod, requireCashflowState, REVIEW_PERIODS, reviewRisk, summarizeCashflowPeriods } from '../reviewEconomics';
import { selectSyntheticPeriod } from '../../../../frontend/src/lib/syntheticCopyTrading';

const amount = (value: number) => Math.round(value * 10_000);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const baseDate = new Date('2026-09-05T12:00:00Z');

describe('v7 independent review economics reconciliation', () => {
  const state = createReviewSyntheticState(baseDate);

  test('four nested ROIs come from trades and capital, never UI constants', () => {
    const independent = state.cashflow.masterDays.map(day => {
      const trades = state.trades.filter(trade => trade.closedAt.slice(0, 10) === day.date);
      const pnl = sum(trades.map(trade => trade.netPnl));
      expect(amount(pnl)).toBe(amount(day.tradingPnl));
      const daily = state.dailyResults.find(item => item.date === day.date)!;
      expect(daily.dailyReturn).toBeCloseTo(pnl / day.capitalAtRisk, 10);
      return 1 + pnl / day.capitalAtRisk;
    });
    const factor = (values: number[]) => values.reduce((a, b) => a * b, 1);
    for (const [days, target] of [[7, 2.12], [30, 3.71], [90, 9.41], [380, 38.27]]) {
      expect(factor(independent.slice(-days))).toBeCloseTo(target, 6);
    }
    expect(factor(independent.slice(-30, -7))).toBeCloseTo(3.71 / 2.12, 6);
    expect(factor(independent.slice(-90, -30))).toBeCloseTo(9.41 / 3.71, 6);
    expect(factor(independent.slice(0, -90))).toBeCloseTo(38.27 / 9.41, 6);
    expect(amount(sum(state.trades.map(trade => trade.netPnl)))).toBe(amount(4_711_027));
  });

  test('capital/cash-flow journal and trading PnL reconcile independently', () => {
    const flows = state.cashflow.masterCashFlows;
    const deposits = sum(flows.filter(flow => flow.type === 'DEPOSIT').map(flow => flow.amount));
    const withdrawals = sum(flows.filter(flow => flow.type === 'WITHDRAWAL').map(flow => flow.amount));
    const trading = sum(state.trades.map(trade => trade.netPnl));
    const final = state.cashflow.masterDays.at(-1)!;
    expect(amount(final.closingEquity)).toBe(amount(deposits + trading - withdrawals));
    expect(withdrawals).toBeGreaterThan(trading * .8);
    const deployed = state.cashflow.masterDays.map(day => day.capitalAtRisk);
    expect(Math.max(...deployed) / Math.min(...deployed)).toBeLessThan(1.8);
    expect(Math.abs(deployed[0] - 4_711_027 / 37.27)).toBeGreaterThan(10_000);
    for (const day of state.cashflow.masterDays) {
      expect(amount(day.closingEquity)).toBe(amount(day.openingEquity + day.deposits + day.tradingPnl - day.withdrawals));
      expect(day.capitalAtRisk).toBeGreaterThan(0);
      expect(amount(day.capitalAtRisk)).toBe(amount(day.openingEquity + day.deposits));
      expect(amount(day.withdrawals)).toBe(amount(sum(flows.filter(flow => flow.date === day.date && flow.type === 'WITHDRAWAL').map(flow => flow.amount))));
    }
    const roi = state.dailyResults.reduce((factor, day) => factor * (1 + day.dailyReturn), 1) - 1;
    expect(roi * 100).toBeCloseTo(3727, 4);
    expect((final.closingEquity / deployed[0] - 1) * 100).not.toBeCloseTo(3727, 0);
  });

  test('all holiday dates contain neither open nor closed positions, PnL, or owner flows', () => {
    const pauses = state.cashflow.policy.holidays;
    expect(pauses).toContainEqual(expect.objectContaining({ start: '2025-12-18', end: '2026-01-05' }));
    expect(pauses).toContainEqual(expect.objectContaining({ start: '2026-04-10', end: '2026-04-12' }));
    for (const pause of pauses) {
      const quiet = state.dailyResults.filter(day => day.date >= pause.start && day.date <= pause.end);
      expect(quiet).toHaveLength(pause.start === '2025-12-18' ? 19 : 3);
      for (const day of quiet) {
        expect(day.realizedPnl).toBe(0);
        expect(day.dailyReturn).toBe(0);
        expect(day.numberOfTrades).toBe(0);
      }
      expect(state.trades.filter(trade => trade.openedAt.slice(0, 10) <= pause.end && trade.closedAt.slice(0, 10) >= pause.start)).toHaveLength(0);
      expect(state.cashflow.masterCashFlows.filter(flow => flow.date >= pause.start && flow.date <= pause.end)).toHaveLength(0);
    }
  });

  test('trade pricing, bounded leverage, costs and notional volume agree', () => {
    const days = new Map(state.cashflow.masterDays.map(day => [day.date, day]));
    for (const trade of state.trades) {
      const gross = (trade.side === 'LONG' ? 1 : -1) * (trade.exitPrice - trade.entryPrice) * trade.quantity;
      expect(gross).toBeCloseTo(trade.grossPnl, 3);
      expect(amount(trade.grossPnl - trade.fees - trade.funding)).toBe(amount(trade.netPnl));
      const day = days.get(trade.openedAt.slice(0, 10))!;
      expect(day).toBeDefined();
      expect(trade.entryPrice * trade.quantity / trade.leverage).toBeLessThanOrEqual(day.capitalAtRisk + .01);
      expect(trade.leverage).toBeGreaterThanOrEqual(2);
      expect(trade.leverage).toBeLessThanOrEqual(12);
      expect(trade.quantity).toBeGreaterThan(0);
      expect(trade.returnPct).toBeCloseTo(trade.netPnl / (trade.entryPrice * trade.quantity / trade.leverage) * 100, 3);
    }
    for (const day of state.dailyResults) {
      const trades = state.trades.filter(trade => trade.openedAt.startsWith(day.date)).sort((a, b) => a.openedAt.localeCompare(b.openedAt));
      for (let index = 1; index < trades.length; index++) expect(trades[index].openedAt >= trades[index - 1].closedAt).toBe(true);
    }
  });

  test('public metrics reconcile and private master capital does not leak into response', () => {
    const response = toResponse(state);
    expect(response.economics?.methodology).toBe('DAILY_TWR');
    expect(response).not.toHaveProperty('cashflow');
    expect(response).not.toHaveProperty('masterCapitalHistory');
    expect(response.equityHistory[0].equity).toBe(100);
    response.dailyResults.forEach((day, index) => {
      expect(day.startEquity).toBe(response.equityHistory[index].equity);
      expect(day.endEquity).toBe(response.equityHistory[index + 1].equity);
    });
    expect(response.followers.filter(follower => follower.active)).toHaveLength(64);
    expect(sum(response.followers.map(follower => follower.allocatedCapital))).toBe(7_200_000);
    expect(response.economics?.performanceFeeRate).toBe(.10);
    expect(calculateAnalytics(state)).toEqual(response.analytics);
    for (const period of REVIEW_PERIODS) {
      const fromBackend = calculateReviewPeriod(state, period);
      const fromFrontend = selectSyntheticPeriod(response, period);
      expect(fromFrontend.roi).toBeCloseTo(fromBackend.roi, 7);
      expect(fromFrontend.pnl).toBeCloseTo(fromBackend.masterPnl, 3);
      expect(fromFrontend.followerPnl).toBeCloseTo(fromBackend.netFollowersPnl, 2);
      const cutoff = period === 'ALL' ? '' : new Date(+baseDate - parseInt(period) * 86_400_000).toISOString().slice(0, 10);
      const masterTrades = state.trades.filter(trade => trade.closedAt.slice(0, 10) > cutoff);
      const copied = state.cashflow.copiedTrades.filter(trade => trade.closedAt.slice(0, 10) > cutoff);
      const fees = state.cashflow.performanceFeeEvents.filter(event => event.date > cutoff);
      expect(fromBackend.masterTradingVolume).toBeCloseTo(sum(masterTrades.map(trade => trade.entryPrice * trade.quantity)), 1);
      expect(fromBackend.copiedTradingVolume).toBeCloseTo(sum(copied.map(trade => trade.notional)), 1);
      expect(amount(fromBackend.performanceFeeEarnings)).toBe(amount(sum(fees.map(event => event.feeAmount))));
      expect(amount(fromBackend.netFollowersPnl)).toBe(amount(fromBackend.grossFollowersPnl - fromBackend.performanceFeeEarnings));
      expect(fromBackend.masterTradingVolume).not.toBe(7_200_000);
    }
  });

  test('calendar-day risk independently handles holidays and undefined ratios', () => {
    const returns = [.10, -.05, 0, .02];
    const mean = .07 / 4;
    const variance = returns.reduce((total, value) => total + (value - mean) ** 2, 0) / 3;
    const calculated = reviewRisk(returns);
    expect(calculated.sharpe).toBeCloseTo(mean / Math.sqrt(variance) * Math.sqrt(365), 10);
    expect(calculated.sortino).toBeCloseTo(mean / Math.sqrt(.05 ** 2 / 4) * Math.sqrt(365), 10);
    expect(calculated.annualizedVolatility).toBeCloseTo(Math.sqrt(variance * 365) * 100, 10);
    expect(reviewRisk([0, 0, 0])).toEqual({ sharpe: null, sortino: null, annualizedVolatility: 0 });
    expect(reviewRisk([.01, .02]).sortino).toBeNull();
  });

  test('weekly/monthly PnL is trading PnL and Sunday/Monday boundaries are exact', () => {
    for (const unit of ['week', 'month'] as const) {
      const groups = summarizeCashflowPeriods(state, unit);
      expect(amount(sum(groups.map(group => group.pnl)))).toBe(amount(4_711_027));
      for (const group of groups) {
        if (unit === 'week') expect(new Date(`${group.period}T00:00:00Z`).getUTCDay()).toBe(1);
      }
    }
    const monday = summarizeCashflowPeriods(state, 'week').find(group => group.period === '2026-08-31')!;
    const rows = state.dailyResults.filter(day => day.date >= '2026-08-31' && day.date <= '2026-09-05');
    expect(amount(monday.pnl)).toBe(amount(sum(rows.map(day => day.realizedPnl))));
    expect(monday.roi).toBeCloseTo((rows.reduce((factor, day) => factor * (1 + day.dailyReturn), 1) - 1) * 100, 2);
  });

  test.each([7, 30, 90])('+%i days append without changing any old master history or fee event', days => {
    const advanced = requireCashflowState(advanceState(state, days));
    expect(advanced.trades.slice(0, state.trades.length)).toEqual(state.trades);
    expect(advanced.dailyResults.slice(0, state.dailyResults.length)).toEqual(state.dailyResults);
    expect(advanced.equityHistory.slice(0, state.equityHistory.length)).toEqual(state.equityHistory);
    const feesById = new Map(advanced.cashflow.performanceFeeEvents.map(event => [event.id, event]));
    for (const event of state.cashflow.performanceFeeEvents) expect(feesById.get(event.id)).toEqual(event);
    expect(advanced.trades.length).toBeGreaterThan(state.trades.length);
    expect(calculateReviewPeriod(advanced, 'ALL').masterPnl).toBeGreaterThan(4_711_027);
    const after = toResponse(advanced);
    for (const period of REVIEW_PERIODS) {
      const selection = selectSyntheticPeriod(after, period);
      expect(selection.daily).toHaveLength(period === 'ALL' ? 380 + days : parseInt(period));
    }
  });

  test('legacy default synthetic initializer is not silently migrated by review', () => {
    expect(createInitialState(baseDate).version).toBe(6);
    expect(state.version).toBe(7);
  });
});
