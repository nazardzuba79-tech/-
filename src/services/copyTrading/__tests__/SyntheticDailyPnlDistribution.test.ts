import { dailyPnlChart } from '../../../../frontend/src/lib/dailyPnlChart';
import { selectSyntheticPeriod } from '../../../../frontend/src/lib/syntheticCopyTrading';
import { addUtcDays, calculateAnalytics } from '../analytics';
import { advanceState, createInitialState, toResponse } from '../SyntheticCopyTradingEngine';
import { MemorySyntheticStateStore, SyntheticCopyTradingService } from '../SyntheticCopyTradingService';
import type { SyntheticCopyState } from '../types';

const NOW = new Date('2026-09-05T12:00:00Z');
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const scaled = (value: number) => Math.round(value * 10_000);
const sumScaled = (values: number[]) => sum(values.map(scaled));

function independentlyCalculateRisk(equity: { equity: number }[]) {
  const returns = equity.slice(1).map((point, index) => point.equity / equity[index].equity - 1);
  const mean = sum(returns) / returns.length;
  const deviation = Math.sqrt(sum(returns.map(value => (value - mean) ** 2)) / (returns.length - 1));
  const losses = returns.filter(value => value < 0);
  const downside = losses.length ? Math.sqrt(sum(losses.map(value => value ** 2)) / losses.length) : 0;
  let peak = equity[0].equity;
  let drawdown = 0;
  for (const point of equity) {
    peak = Math.max(peak, point.equity);
    drawdown = Math.max(drawdown, (peak - point.equity) / peak * 100);
  }
  return {
    sharpe: deviation ? mean / deviation * Math.sqrt(365) : 0,
    sortino: downside ? mean / downside * Math.sqrt(365) : 0,
    volatility: deviation * Math.sqrt(365) * 100,
    drawdown,
  };
}

function verifyDistributedWindow(values: number[]) {
  expect(values).toHaveLength(90);
  const total = sum(values);
  expect(total).toBeGreaterThan(0);
  for (let offset = 0; offset < 90; offset += 30) {
    const contribution = sum(values.slice(offset, offset + 30)) / total;
    expect(contribution).toBeGreaterThan(0.2);
    expect(contribution).toBeLessThan(0.45);
  }
  expect(Math.max(...values) / total).toBeLessThan(0.04);
  expect(sum(values.slice(-7)) / total).toBeLessThan(0.15);
  expect(values.filter(value => value < 0).length).toBeGreaterThanOrEqual(7);
  expect(values.filter(value => value < 0).length).toBeLessThanOrEqual(12);
  const positive = values.filter(value => value > 0);
  expect(Math.max(...positive) / Math.min(...positive)).toBeGreaterThan(2);
  expect(new Set(values.map(value => value.toFixed(2))).size).toBeGreaterThan(80);
}

describe('synthetic daily PnL distribution', () => {
  test('fresh history distributes the same cumulative result across the full period', () => {
    const state = createInitialState(NOW);
    expect(state).toEqual(createInitialState(NOW));
    expect(state.version).toBe(6);
    const values = state.dailyResults.slice(-90).map(day => day.realizedPnl);
    verifyDistributedWindow(values);
    expect(values.filter(value => value < 0)).toHaveLength(7);
    const recentOpening = state.equityHistory.at(-91)!.equity;
    const closing = state.equityHistory.at(-1)!.equity;
    expect(sumScaled(values)).toBe(scaled(closing) - scaled(recentOpening));
    expect(sumScaled(state.dailyResults.map(day => day.realizedPnl))).toBe(scaled(4_711_027));
    expect(toResponse(state).analytics.roi90).toBeCloseTo((closing / recentOpening - 1) * 100, 3);
    const sevenDayTotals = values.slice(0, -6).map((_, index) => sum(values.slice(index, index + 7)));
    // A stronger cluster must exist away from the ending; do not flatten bars.
    expect(Math.max(...sevenDayTotals.slice(0, -7))).toBeGreaterThan(sevenDayTotals[sevenDayTotals.length - 1]);
  });

  test('ALL profit is distributed across every quarter, not a final-day or final-week residual spike', () => {
    const state = createInitialState(NOW);
    const values = state.dailyResults.map(day => day.realizedPnl);
    const total = sum(values);
    expect(values).toHaveLength(380);
    expect(Math.max(...values) / total).toBeLessThan(0.01);
    expect(sum(values.slice(-7)) / total).toBeLessThan(0.04);
    for (let quarter = 0; quarter < 4; quarter++) {
      const contribution = sum(values.slice(quarter * 95, (quarter + 1) * 95)) / total;
      expect(contribution).toBeGreaterThan(0.15);
      expect(contribution).toBeLessThan(0.35);
    }
    const meanWeek = total / values.length * 7;
    const finalWeek = sum(values.slice(-7));
    // Non-overlapping blocks make distinct stronger periods observable,
    // rather than counting the same spike in seven overlapping windows.
    const strongWeeks = Array.from({ length: Math.floor(values.length / 7) }, (_, index) => ({
      start: index * 7, pnl: sum(values.slice(index * 7, index * 7 + 7)),
    })).filter(week => week.start < values.length - 14 && week.pnl > meanWeek * 1.25 && week.pnl > finalWeek);
    expect(strongWeeks.length).toBeGreaterThanOrEqual(3);
    expect(new Set(strongWeeks.map(week => Math.floor(week.start / 95))).size).toBeGreaterThanOrEqual(3);
    const positive = values.filter(value => value > 0);
    expect(Math.max(...positive) / Math.min(...positive)).toBeGreaterThan(2);
    expect(new Set(values.map(scaled)).size).toBeGreaterThan(370);
    expect(values.at(-1)).toBeLessThan(Math.max(...values.slice(0, -7)));
  });

  test('small loss days have irregular spacing instead of a repeated weekly or ten-day waveform', () => {
    const values = createInitialState(NOW).dailyResults.map(day => day.realizedPnl);
    const lossDays = values.flatMap((pnl, index) => pnl < 0 ? [index] : []);
    const gaps = lossDays.slice(1).map((day, index) => day - lossDays[index]);
    expect(lossDays).toHaveLength(31);
    expect(gaps.every(gap => gap >= 5 && gap <= 17)).toBe(true);
    expect(new Set(gaps).size).toBeGreaterThanOrEqual(8);
    for (const period of [7, 10, 14]) {
      expect(new Set(lossDays.map(day => day % period)).size).toBeGreaterThan(1);
    }
    expect(Math.abs(Math.min(...values)) / Math.max(...values)).toBeLessThan(0.15);
  });

  test.each([0, 1, 7, 30, 90, 180])('+%i days keeps rolling PnL distributed and every period ledger-derived', days => {
    const initial = createInitialState(NOW);
    const state = days ? advanceState(initial, days) : initial;
    const response = toResponse(state);
    verifyDistributedWindow(state.dailyResults.slice(-90).map(day => day.realizedPnl));
    expect(state.equityHistory.slice(0, initial.equityHistory.length)).toEqual(initial.equityHistory);
    expect(state.dailyResults.slice(0, initial.dailyResults.length)).toEqual(initial.dailyResults);
    expect(state.trades.slice(0, initial.trades.length)).toEqual(initial.trades);
    expect(state.aumHistory.slice(0, initial.aumHistory.length)).toEqual(initial.aumHistory);
    const allTradeUnits = sumScaled(state.trades.map(trade => trade.netPnl));
    const allDailyUnits = sumScaled(state.dailyResults.map(day => day.realizedPnl));
    const equityUnits = scaled(state.equityHistory.at(-1)!.equity) - scaled(state.equityHistory[0].equity);
    expect(Number.isSafeInteger(allTradeUnits)).toBe(true);
    expect(allTradeUnits).toBe(allDailyUnits);
    expect(allDailyUnits).toBe(equityUnits);
    if (!days) expect(allTradeUnits).toBe(47_110_270_000);

    for (const [index, day] of state.dailyResults.entries()) {
      const trades = state.trades.filter(trade => trade.closedAt.slice(0, 10) === day.date);
      // Exact 0.0001-USDT ledger units catch accumulated rounding residuals
      // that a loose currency/display tolerance could hide on the last day.
      expect(sumScaled(trades.map(trade => trade.netPnl))).toBe(scaled(day.realizedPnl));
      expect(scaled(day.endEquity) - scaled(day.startEquity)).toBe(scaled(day.realizedPnl));
      expect(scaled(day.startEquity)).toBe(scaled(state.equityHistory[index].equity));
      expect(scaled(day.endEquity)).toBe(scaled(state.equityHistory[index + 1].equity));
      expect(sum(trades.map(trade => trade.fees))).toBeCloseTo(day.fees, 3);
      expect(sum(trades.map(trade => trade.funding))).toBeCloseTo(day.funding, 3);
      expect(trades.filter(trade => trade.netPnl >= 0)).toHaveLength(day.wins);
      expect(trades.filter(trade => trade.netPnl < 0)).toHaveLength(day.losses);
      for (const trade of trades) {
        expect(Math.abs(trade.grossPnl - trade.fees - trade.funding - trade.netPnl)).toBeLessThan(0.00011);
        expect(trade.result).toBe(trade.netPnl >= 0 ? 'WIN' : 'LOSS');
      }
    }

    const currentDate = state.equityHistory[state.equityHistory.length - 1].date;
    for (const period of ['7D', '30D', '90D', 'ALL'] as const) {
      const selected = selectSyntheticPeriod(response, period);
      const count = period === 'ALL' ? initial.dailyResults.length + days : Number(period.slice(0, -1));
      const cutoff = period === 'ALL' ? state.initialEquityDate : addUtcDays(currentDate, -count);
      const expectedTrades = state.trades.filter(trade => trade.closedAt.slice(0, 10) > cutoff);
      expect(selected.daily).toHaveLength(count);
      expect(selected.equity).toHaveLength(count + 1);
      expect(selected.equity[0].date).toBe(cutoff);
      expect(selected.daily.every(day => day.date > cutoff && day.date <= currentDate)).toBe(true);
      expect(selected.totalTrades).toBe(expectedTrades.length);
      const tradeTotal = sum(expectedTrades.map(trade => trade.netPnl));
      expect(sumScaled(expectedTrades.map(trade => trade.netPnl))).toBe(sumScaled(selected.daily.map(day => day.realizedPnl)));
      expect(sumScaled(expectedTrades.map(trade => trade.netPnl)))
        .toBe(scaled(selected.equity.at(-1)!.equity) - scaled(selected.equity[0].equity));
      expect(selected.pnl).toBeCloseTo(tradeTotal, 2);
      expect(dailyPnlChart(selected.daily).total).toBeCloseTo(tradeTotal, 2);
      expect(selected.roi).toBeCloseTo(tradeTotal / selected.equity[0].equity * 100, 5);
      expect(selected.averagePnl).toBeCloseTo(tradeTotal / expectedTrades.length, 5);
      const wins = expectedTrades.filter(trade => trade.netPnl >= 0);
      const losses = expectedTrades.filter(trade => trade.netPnl < 0);
      expect(selected.winRate).toBeCloseTo(wins.length / expectedTrades.length * 100, 8);
      expect(selected.profitFactor).toBeCloseTo(sum(wins.map(trade => trade.netPnl)) / -sum(losses.map(trade => trade.netPnl)), 8);
      const risk = independentlyCalculateRisk(selected.equity);
      expect(selected.sharpe).toBeCloseTo(risk.sharpe, 8);
      expect(selected.sortino).toBeCloseTo(risk.sortino, 8);
      expect(selected.annualizedVolatility).toBeCloseTo(risk.volatility, 8);
      expect(selected.maximumDrawdown).toBeCloseTo(risk.drawdown, 8);
      if (period === '90D') {
        expect(response.analytics.sharpe).toBeCloseTo(risk.sharpe, 4);
        expect(response.analytics.sortino).toBeCloseTo(risk.sortino, 4);
        expect(response.analytics.maximumDrawdown).toBeCloseTo(risk.drawdown, 3);
      }
      if (period === 'ALL') {
        // Published currency rounds to cents; tolerate exactly half a cent
        // plus floating-point summation noise over thousands of ledger rows.
        expect(Math.abs(response.analytics.allTime.pnl - tradeTotal)).toBeLessThanOrEqual(0.005001);
        expect(response.analytics.allTime.totalTrades).toBe(expectedTrades.length);
        expect(response.analytics.allTime.sharpe).toBeCloseTo(risk.sharpe, 4);
        expect(response.analytics.allTime.sortino).toBeCloseTo(risk.sortino, 4);
        expect(response.analytics.allTime.maximumDrawdown).toBeCloseTo(risk.drawdown, 3);
      }
    }
    if (days) {
      expect(state.trades.length).toBeGreaterThan(initial.trades.length);
      expect(response.analytics.allTime.pnl).toBeGreaterThan(toResponse(initial).analytics.allTime.pnl);
    }
  });

  test('one batch and split fast-forwards produce exactly the same append-only history', () => {
    const initial = createInitialState(NOW);
    const batch = advanceState(initial, 90);
    const split = advanceState(advanceState(advanceState(initial, 7), 30), 53);
    expect(split).toEqual(batch);
    expect(initial).toEqual(createInitialState(NOW));
  });

  test('reading persisted v1 data never silently resets or rewrites its history', async () => {
    // Model an existing stored environment independently of the fresh-state version.
    const legacy: SyntheticCopyState = { ...createInitialState(NOW), version: 1 };
    const stored = advanceState(legacy, 14);
    const store = new MemorySyntheticStateStore(stored);
    const save = jest.spyOn(store, 'save');
    const service = new SyntheticCopyTradingService(store, () => NOW);
    expect(await service.get()).toEqual(toResponse(stored));
    expect(save).not.toHaveBeenCalled();
    expect(await store.load()).toEqual(stored);
    await service.advance(7);
    const continued = (await store.load())!;
    expect(continued.version).toBe(1);
    expect(continued.equityHistory.slice(0, stored.equityHistory.length)).toEqual(stored.equityHistory);
    expect(continued.dailyResults.slice(0, stored.dailyResults.length)).toEqual(stored.dailyResults);
    expect(continued.trades.slice(0, stored.trades.length)).toEqual(stored.trades);
    await service.reset();
    expect((await store.load())!.version).toBe(6);
    expect(await service.get()).toEqual(toResponse(createInitialState(NOW)));
  });

  test.each([7, 30, 90] as const)('%i-day follower PnL excludes cutoff trades but includes subscription-start trades', days => {
    const state = advanceState(createInitialState(NOW), 90);
    const currentDate = state.equityHistory[state.equityHistory.length - 1].date;
    const cutoff = addUtcDays(currentDate, -days);
    for (const startDate of [addUtcDays(cutoff, -3), cutoff, addUtcDays(cutoff, 3)]) {
      const follower = { ...state.followers[0], copyStartDate: startDate, active: true };
      state.followers = [follower, { ...follower, id: 'inactive', active: false }];
      const basis = [...state.equityHistory].reverse().find(point => point.date < startDate)!.equity;
      const scale = follower.allocatedCapital / basis;
      const contribution = (pnl: number) => (pnl * follower.copyRatio
        - Math.abs(pnl) * (follower.slippageBps / 10_000 + follower.latencyMs / 50_000_000)) * scale;
      const eligible = state.trades.filter(trade => {
        const date = trade.closedAt.slice(0, 10);
        return date > cutoff && date >= startDate;
      });
      const expected = sum(eligible.map(trade => contribution(trade.netPnl)));
      const actual = calculateAnalytics(state)[`followerPnl${days}`];
      expect(actual).toBeCloseTo(expected, 2);
      if (startDate <= cutoff) {
        const extraCutoffPnl = sum(state.trades.filter(trade => trade.closedAt.slice(0, 10) === cutoff)
          .map(trade => contribution(trade.netPnl)));
        expect(Math.abs(actual - expected - extraCutoffPnl)).toBeGreaterThan(0.01);
      } else {
        expect(eligible.some(trade => trade.closedAt.slice(0, 10) === startDate)).toBe(true);
      }
    }
  });
});
