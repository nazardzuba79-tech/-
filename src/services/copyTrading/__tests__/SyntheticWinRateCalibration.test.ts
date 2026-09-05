import { dailyPnlChart } from '../../../../frontend/src/lib/dailyPnlChart';
import { selectSyntheticPeriod } from '../../../../frontend/src/lib/syntheticCopyTrading';
import { advanceState, createInitialState, toResponse } from '../SyntheticCopyTradingEngine';
import { MemorySyntheticStateStore, SyntheticCopyTradingService } from '../SyntheticCopyTradingService';
import type { SyntheticCopyState } from '../types';

const NOW = new Date('2026-09-05T12:00:00Z');
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe('synthetic win-rate calibration and smaller daily losses', () => {
  test('97.2% comes from 729 actual winning trades out of 750, not a display override', () => {
    const state = createInitialState(NOW);
    const response = toResponse(state);
    const recent = selectSyntheticPeriod(response, '90D');
    const recentDays = state.dailyResults.slice(-90);
    const wins = recent.trades.filter(trade => trade.netPnl > 0);
    const losses = recent.trades.filter(trade => trade.netPnl < 0);
    expect(state.version).toBe(6);
    expect(recent.trades).toHaveLength(750);
    expect(wins).toHaveLength(729);
    expect(losses).toHaveLength(21);
    expect(wins.length / recent.trades.length * 100).toBe(97.2);
    expect(response.analytics.winningTrades).toBe(wins.length);
    expect(response.analytics.losingTrades).toBe(losses.length);
    expect(response.analytics.winRate).toBe(97.2);
    expect(response.analytics.allTime.winRate).toBe(97.2);
    for (const period of ['90D', 'ALL'] as const) {
      const selected = selectSyntheticPeriod(response, period);
      expect(selected.totalTrades).toBe(period === 'ALL' ? 3250 : 750);
      expect(selected.winningTrades).toBe(period === 'ALL' ? 3159 : 729);
      expect(selected.losingTrades).toBe(period === 'ALL' ? 91 : 21);
      expect(selected.winRate).toBe(97.2);
    }
    expect(sum(recentDays.map(day => day.numberOfTrades))).toBe(750);
    expect(sum(recentDays.map(day => day.wins))).toBe(729);
    expect(sum(recentDays.map(day => day.losses))).toBe(21);
    expect(sum(state.dailyResults.map(day => day.numberOfTrades))).toBe(3250);
    expect(sum(state.dailyResults.map(day => day.wins))).toBe(3159);
    expect(sum(state.dailyResults.map(day => day.losses))).toBe(91);
    expect(state.dailyResults.every(day => day.numberOfTrades >= 4 && day.numberOfTrades <= 12)).toBe(true);
    expect(new Set(state.dailyResults.map(day => day.numberOfTrades)).size).toBeGreaterThanOrEqual(5);
    // Activity remains spread across the period, not inserted only on the last day.
    for (let index = 0; index < 90; index += 30) {
      const count = sum(recentDays.slice(index, index + 30).map(day => day.numberOfTrades));
      expect(count).toBeGreaterThan(190);
      expect(count).toBeLessThan(310);
    }
  });

  test('seven small red days are genuine daily trade sums within the approved lifetime result', () => {
    const state = createInitialState(NOW);
    const recent = state.dailyResults.slice(-90);
    const reds = recent.filter(day => day.realizedPnl < 0);
    const greens = recent.filter(day => day.realizedPnl > 0);
    expect(reds).toHaveLength(7);
    expect(greens).toHaveLength(83);
    const largestGreen = Math.max(...greens.map(day => day.realizedPnl));
    expect(Math.max(...reds.map(day => -day.realizedPnl)) / largestGreen).toBeLessThan(0.15);
    for (const day of reds) {
      const trades = state.trades.filter(trade => trade.closedAt.slice(0, 10) === day.date);
      expect(trades.some(trade => trade.netPnl > 0)).toBe(true);
      expect(trades.some(trade => trade.netPnl < 0)).toBe(true);
      const pnl = sum(trades.map(trade => trade.netPnl));
      expect(pnl).toBeLessThan(0);
      expect(pnl).toBeCloseTo(day.realizedPnl, 3);
    }
    expect(greens.filter(day => day.losses > 0)).toHaveLength(14);
    const closing = state.equityHistory.at(-1)!.equity;
    const recentOpening = state.equityHistory.at(-91)!.equity;
    expect(sum(recent.map(day => day.realizedPnl))).toBeCloseTo(closing - recentOpening, 3);
    expect(sum(state.dailyResults.map(day => day.realizedPnl))).toBeCloseTo(4_711_027, 3);
    expect(sum(state.trades.map(trade => trade.netPnl))).toBeCloseTo(4_711_027, 3);
    expect(closing).toBe(4_837_429.6563);
    expect(toResponse(state).analytics.roi90).toBeCloseTo((closing / recentOpening - 1) * 100, 3);
    expect(state).toEqual(createInitialState(NOW));
  });

  test.each([0, 1, 7, 30, 90, 180])('+%i days keeps every period count-derived instead of fixing each rate at 97.2', days => {
    const initial = createInitialState(NOW);
    const state = days ? advanceState(initial, days) : initial;
    const response = toResponse(state);
    for (const period of ['7D', '30D', '90D', 'ALL'] as const) {
      const selected = selectSyntheticPeriod(response, period);
      const wins = selected.trades.filter(trade => trade.netPnl > 0);
      const losses = selected.trades.filter(trade => trade.netPnl < 0);
      expect(selected.totalTrades).toBe(wins.length + losses.length);
      expect(selected.winningTrades).toBe(wins.length);
      expect(selected.losingTrades).toBe(losses.length);
      expect(selected.winRate).toBeCloseTo(wins.length / selected.trades.length * 100, 8);
      const pnl = sum(selected.trades.map(trade => trade.netPnl));
      expect(selected.pnl).toBeCloseTo(pnl, 2);
      expect(dailyPnlChart(selected.daily).total).toBeCloseTo(pnl, 2);
      if (period === '90D') expect(response.analytics.winRate).toBeCloseTo(selected.winRate, 3);
      if (period === 'ALL') expect(response.analytics.allTime.winRate).toBeCloseTo(selected.winRate, 3);
    }
    // A seven-day sample has fewer than 250 trades, so this exact rational rate
    // cannot be its count-derived result; it must not inherit the 90D target.
    expect(selectSyntheticPeriod(response, '7D').winRate).not.toBe(97.2);
    expect(state.trades.slice(0, initial.trades.length)).toEqual(initial.trades);
    expect(state.dailyResults.slice(0, initial.dailyResults.length)).toEqual(initial.dailyResults);
    expect(state.equityHistory.slice(0, initial.equityHistory.length)).toEqual(initial.equityHistory);
  });

  test.each([1, 2] as const)('persisted v%i data retains history and its original outcome policy until explicit reset', async version => {
    const stored: SyntheticCopyState = { ...createInitialState(NOW), version, mode: 'FAST_FORWARD' };
    const store = new MemorySyntheticStateStore(stored);
    const save = jest.spyOn(store, 'save');
    const service = new SyntheticCopyTradingService(store, () => NOW);
    expect(await service.get()).toEqual(toResponse(stored));
    expect(save).not.toHaveBeenCalled();
    expect(await store.load()).toEqual(stored);
    await service.advance(30);
    const advanced = (await store.load())!;
    expect(advanced.version).toBe(version);
    expect(advanced.trades.slice(0, stored.trades.length)).toEqual(stored.trades);
    expect(advanced.dailyResults.slice(0, stored.dailyResults.length)).toEqual(stored.dailyResults);
    expect(advanced.equityHistory.slice(0, stored.equityHistory.length)).toEqual(stored.equityHistory);
    for (let index = stored.dailyResults.length; index < advanced.dailyResults.length; index++) {
      const day = advanced.dailyResults[index];
      expect(day.losses).toBe(index % 5 === 1 || day.realizedPnl < 0 ? 1 : 0);
    }
    await service.reset();
    expect((await store.load())!.version).toBe(6);
    expect((await service.get()).analytics.winRate).toBe(97.2);
  });
});
