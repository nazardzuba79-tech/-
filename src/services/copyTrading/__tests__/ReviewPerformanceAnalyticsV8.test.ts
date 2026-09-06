import { createSimpleReturnMasterState } from '../reviewPerformanceV8';
import { createCashflowMasterState } from '../reviewMasterLedger';
import { calculateAnalytics, maximumDrawdown } from '../analytics';
import {
  calculateReviewPeriod, REVIEW_PERIODS, reviewPeriodReturn, reviewPerformanceDrawdown,
  reviewRisk, summarizeCashflowPeriods,
} from '../reviewEconomics';
import { advanceState, applyFollowerEvent, toResponse } from '../SyntheticCopyTradingEngine';

const moneyUnits = (amount: number) => Math.round(amount * 10_000);

describe('simple-return review methodology without geometric reinvestment', () => {
  test('v8 sums daily returns while the v7 compatibility path still compounds', () => {
    const returns = [.5, -.1, .2, -.15, 0];
    expect(reviewPeriodReturn({ version: 8 }, returns)).toBeCloseTo(45, 10);
    expect(reviewPeriodReturn({ version: 7 }, returns)).toBeCloseTo((1.5 * .9 * 1.2 * .85 - 1) * 100, 10);
    expect(reviewPeriodReturn({ version: 8 }, [])).toBe(0);
    expect(reviewPeriodReturn({ version: 8 }, [.000123456789, -.000012345678])).toBe((.000123456789 - .000012345678) * 100);
  });

  test('v8 drawdown uses period-rebased additive performance, not private equity or old index level', () => {
    const daily = [.5, -.1, .2, -.15].map((dailyReturn, index) => ({ date: `2026-01-0${index + 1}`, dailyReturn }));
    const geometric = [100, 150, 135, 162, 137.7].map((equity, index) => ({ date: String(index), equity }));
    const highHistoricalIndex = geometric.map(point => ({ ...point, equity: point.equity + 8_000 }));
    // Selected additive index is100,150,140,160,145: its largest drop is15/160.
    expect(reviewPerformanceDrawdown({ version: 8 }, daily, geometric)).toBeCloseTo(15 / 160 * 100, 10);
    expect(reviewPerformanceDrawdown({ version: 8 }, daily, highHistoricalIndex)).toBeCloseTo(15 / 160 * 100, 10);
    expect(reviewPerformanceDrawdown({ version: 7 }, daily, geometric)).toBe(maximumDrawdown(geometric));
    expect(reviewPerformanceDrawdown({ version: 8 }, [], geometric)).toBe(0);
    expect(reviewPerformanceDrawdown({ version: 8 }, [{ date: 'a', dailyReturn: -1.4 }], geometric)).toBeCloseTo(140, 10);
  });

  test('calendar risk retains all daily observations including zero and does not cap extreme ratios', () => {
    const returns = [.5, -.1, .2, -.15, 0];
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const deviation = Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1));
    const downside = Math.sqrt(returns.reduce((sum, value) => sum + Math.min(0, value) ** 2, 0) / returns.length);
    const risk = reviewRisk(returns);
    expect(risk.sharpe).toBeCloseTo(mean / deviation * Math.sqrt(365), 10);
    expect(risk.sortino).toBeCloseTo(mean / downside * Math.sqrt(365), 10);
    expect(risk.annualizedVolatility).toBeCloseTo(deviation * Math.sqrt(365) * 100, 10);
    expect(reviewRisk([.1, .100001]).sharpe).toBeGreaterThan(100_000);
    expect(reviewRisk([0, 0, 0])).toEqual({ sharpe: null, sortino: null, annualizedVolatility: 0 });
  });
});

describe('v8 economics dispatch and baseline reconciliation', () => {
  const state = createSimpleReturnMasterState();

  test('all four anchors use one trade/capital ledger and simple public index', () => {
    const response = toResponse(state);
    const targets = { '7D': 112, '30D': 271, '90D': 841, ALL: 3727 };
    const capital = new Map(state.cashflow.masterDays.map(day => [day.date, day.capitalAtRisk]));
    const tradePnl = new Map<string, number>();
    state.trades.forEach(trade => {
      const date = trade.closedAt.slice(0, 10);
      tradePnl.set(date, (tradePnl.get(date) ?? 0) + moneyUnits(trade.netPnl));
    });
    for (const period of REVIEW_PERIODS) {
      const days = period === 'ALL' ? state.dailyResults : state.dailyResults.slice(-parseInt(period));
      const independentReturns = days.map(day => (tradePnl.get(day.date) ?? 0) / 10_000 / capital.get(day.date)!);
      const independentRoi = independentReturns.reduce((sum, value) => sum + value, 0) * 100;
      const result = calculateReviewPeriod(state, period);
      expect(result.roi).toBeCloseTo(independentRoi, 7);
      expect(result.roi).toBeCloseTo(targets[period], 4);
      expect(result.roi).toBeCloseTo(response.economics!.periods[period].roi, 10);
      expect(result.masterPnl).toBeCloseTo(days.reduce((sum, day) => sum + moneyUnits(day.realizedPnl), 0) / 10_000, 4);
    }
    const previousWeek = state.dailyResults.slice(-14, -7).reduce((sum, day) => sum + day.dailyReturn, 0) * 100;
    expect(previousWeek).toBeCloseTo(115, 4);
    expect(response.economics!.periods.ALL.masterPnl).toBe(4_711_027);
    expect(response.equityHistory[0].equity).toBe(100);
    let cumulativeRoi = 0;
    state.dailyResults.forEach((day, index) => {
      cumulativeRoi += day.dailyReturn * 100;
      expect(response.equityHistory[index + 1].equity).toBeCloseTo(100 + cumulativeRoi, 7);
      expect(response.dailyResults[index].startEquity).toBe(response.equityHistory[index].equity);
      expect(response.dailyResults[index].endEquity).toBe(response.equityHistory[index + 1].equity);
    });
    expect(response.economics!.methodology).toBe('CASH_FLOW_ADJUSTED_SIMPLE_RETURN');
    expect(response.economics!.policy.methodology).toBe('CASH_FLOW_ADJUSTED_SIMPLE_RETURN');
    expect(response).not.toHaveProperty('cashflow');
    expect(response).not.toHaveProperty('masterDays');
    expect(response).not.toHaveProperty('masterCashFlows');
    expect(response).not.toHaveProperty('operatingCapitalTarget');
  });

  test('total count, win rate, average trade and risk come from the new 471-trade history', () => {
    const analytics = calculateAnalytics(state);
    const wins = state.trades.filter(trade => trade.netPnl > 0);
    const losses = state.trades.filter(trade => trade.netPnl < 0);
    expect(state.trades).toHaveLength(471);
    expect(wins).toHaveLength(458);
    expect(losses).toHaveLength(13);
    expect(analytics.totalTrades).toBe(471);
    expect(analytics.winningTrades).toBe(458);
    expect(analytics.losingTrades).toBe(13);
    expect(analytics.winRate).toBeCloseTo(458 / 471 * 100, 3);
    expect(analytics.allTime.averageTrade).toBeCloseTo(4_711_027 / 471, 6);
    expect(analytics.averageHoldingTimeMinutes).toBeCloseTo(state.trades.reduce((sum, trade) => sum + trade.holdingTimeMinutes, 0) / 471, 10);
    const p90 = calculateReviewPeriod(state, '90D');
    if (p90.maximumDrawdown > 0) expect(analytics.calmar)
      .toBeCloseTo((p90.roi / 100 * 365 / p90.calendarDays) / (p90.maximumDrawdown / 100), 10);
    expect(calculateAnalytics(state)).toEqual(toResponse(state).analytics);
  });

  test('weekly/monthly summaries use sums and preserve every closed-trade PnL', () => {
    for (const unit of ['week', 'month'] as const) {
      const summaries = summarizeCashflowPeriods(state, unit);
      expect(summaries.reduce((sum, group) => sum + moneyUnits(group.pnl), 0)).toBe(moneyUnits(4_711_027));
      expect(summaries.reduce((sum, group) => sum + group.trades, 0)).toBe(471);
      for (let index = 0; index < summaries.length; index++) {
        const group = summaries[index];
        const next = summaries[index + 1]?.period ?? '9999';
        const days = state.dailyResults.filter(day => day.date >= group.period && day.date < next);
        expect(group.roi).toBeCloseTo(days.reduce((sum, day) => sum + day.dailyReturn, 0) * 100, 2);
      }
    }
  });

  test('v8 weekly summaries match Sunday–Saturday capital plans while v7 stays Monday–Sunday', () => {
    const advanced = advanceState(state, 7) as typeof state;
    const summaries = summarizeCashflowPeriods(advanced, 'week');
    const firstFutureWeek = summaries.find(group => group.period === '2026-09-06');
    const futureDays = advanced.dailyResults.filter(day => day.date >= '2026-09-06' && day.date <= '2026-09-12');
    expect(futureDays).toHaveLength(7);
    expect(firstFutureWeek).toBeDefined();
    expect(firstFutureWeek!.roi).toBe(72);
    expect(firstFutureWeek!.pnl).toBe(futureDays.reduce((sum, day) => sum + moneyUnits(day.realizedPnl), 0) / 10_000);
    expect(firstFutureWeek!.trades).toBe(futureDays.reduce((sum, day) => sum + day.numberOfTrades, 0));
    expect(summaries.every(group => new Date(`${group.period}T00:00:00Z`).getUTCDay() === 0)).toBe(true);

    const legacy = createCashflowMasterState();
    const legacySummaries = summarizeCashflowPeriods(legacy, 'week');
    expect(legacySummaries.every(group => new Date(`${group.period}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
    const finalLegacyWeek = legacySummaries.at(-1)!;
    expect(finalLegacyWeek.period).toBe('2026-08-31');
    const legacyReturns = legacy.dailyResults.filter(day => day.date >= finalLegacyWeek.period);
    expect(finalLegacyWeek.roi).toBe(Number(((legacyReturns.reduce((factor, day) => factor * (1 + day.dailyReturn), 1) - 1) * 100).toFixed(3)));
  });

  test('changing external cash-flow metadata does not alter trading return, drawdown or risk', () => {
    const snapshot = JSON.parse(JSON.stringify(state)) as typeof state;
    snapshot.cashflow.masterCashFlows = [{ id: 'irrelevant-withdrawal', date: '2026-09-05', timing: 'AFTER_TRADING', type: 'WITHDRAWAL', amount: 999_999 }];
    snapshot.cashflow.masterDays.forEach(day => { day.openingEquity = 1; day.closingEquity = 1; day.withdrawals = 999_999; });
    for (const period of REVIEW_PERIODS) expect(calculateReviewPeriod(snapshot, period)).toEqual(calculateReviewPeriod(state, period));
    expect(() => applyFollowerEvent(state, { type: 'STOP', followerId: 'F-001' })).toThrow(/allocation-ledger/);
  });

  test.each([7, 30, 90])('+%i-day dispatch appends without reinterpreting or recalibrating prior points', days => {
    const advanced = advanceState(state, days);
    expect(advanced.version).toBe(8);
    expect(advanced.dailyResults.slice(0, 380)).toEqual(state.dailyResults);
    expect(advanced.trades.slice(0, 471)).toEqual(state.trades);
    expect(advanced.equityHistory.slice(0, 381)).toEqual(state.equityHistory);
    const response = toResponse(advanced);
    expect(response.analytics.totalTrades).toBe(advanced.trades.length);
    expect(response.economics!.periods.ALL.roi).toBeCloseTo(advanced.dailyResults.reduce((sum, day) => sum + day.dailyReturn, 0) * 100, 8);
    if (days === 7) expect(response.economics!.periods['7D'].roi).toBeCloseTo(72, 4);
  });

  test('explicit v7 master still dispatches to geometric ROI and its previous count conventions', () => {
    const legacy = createCashflowMasterState();
    const response = toResponse(legacy);
    expect(response.economics!.methodology).toBe('DAILY_TWR');
    expect(response.analytics.totalTrades).toBe(3_250);
    expect(response.analytics.winningTrades).toBe(729);
    expect(response.analytics.losingTrades).toBe(21);
    expect(response.analytics.roi7).toBe(112);
    for (const period of REVIEW_PERIODS) {
      const daily = period === 'ALL' ? legacy.dailyResults : legacy.dailyResults.slice(-parseInt(period));
      expect(response.economics!.periods[period].roi).toBeCloseTo((daily.reduce((factor, day) => factor * (1 + day.dailyReturn), 1) - 1) * 100, 10);
    }
  });
});
