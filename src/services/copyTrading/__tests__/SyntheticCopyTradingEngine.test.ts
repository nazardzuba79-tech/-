import { addUtcDays, calculateAnalytics, equityAtOrBefore, maximumDrawdown, rollingRoi } from '../analytics';
import { advanceState, createInitialState, toResponse } from '../SyntheticCopyTradingEngine';
import { MemorySyntheticStateStore, SyntheticCopyTradingService } from '../SyntheticCopyTradingService';

const FIXED_NOW = new Date('2026-09-02T12:00:00.000Z');

function verifyConsistency(response: ReturnType<typeof toResponse>) {
  const { analytics, equityHistory, dailyResults, trades, followers } = response;
  expect(analytics.roi7).toBeCloseTo(rollingRoi(equityHistory, 7), 3);
  expect(analytics.roi30).toBeCloseTo(rollingRoi(equityHistory, 30), 3);
  expect(analytics.roi90).toBeCloseTo(rollingRoi(equityHistory, 90), 3);
  expect(analytics.maximumDrawdown).toBeCloseTo(maximumDrawdown(equityHistory.slice(-91)), 3);
  expect(analytics.winRate).toBeCloseTo(analytics.winningTrades / (analytics.winningTrades + analytics.losingTrades) * 100, 3);
  expect(analytics.profitFactor).toBeCloseTo(analytics.grossProfit / analytics.grossLoss, 3);
  expect(analytics.plRatio).toBeCloseTo(analytics.averageWinR / analytics.averageLossR, 2);
  expect(analytics.expectancyR).toBeCloseTo((analytics.winRate / 100) * analytics.averageWinR - (1 - analytics.winRate / 100) * analytics.averageLossR, 3);
  expect(analytics.aum).toBeCloseTo(followers.filter((follower) => follower.active).reduce((sum, follower) => sum + follower.allocatedCapital, 0), 2);
  expect(analytics.followerPnl).toBeCloseTo(followers.reduce((sum, follower) => sum + follower.realizedPnl + follower.unrealizedPnl, 0), 2);
  for (const day of dailyResults) {
    const dayTrades = trades.filter((trade) => trade.closedAt.slice(0, 10) === day.date);
    expect(day.numberOfTrades).toBe(dayTrades.length);
    expect(day.realizedPnl).toBeCloseTo(day.endEquity - day.startEquity, 2);
    expect(day.realizedPnl).toBeCloseTo(dayTrades.reduce((sum, trade) => sum + trade.netPnl, 0), 1);
    expect(day.dailyReturn).toBeCloseTo(day.endEquity / day.startEquity - 1, 6);
  }
}

describe('synthetic Copy Trading performance engine', () => {
  test('initial history is deterministic, calibrated and fully derived', () => {
    const first = createInitialState(FIXED_NOW);
    const second = createInitialState(FIXED_NOW);
    expect(first).toEqual(second);
    const response = toResponse(first);
    expect(response.trader).toEqual({ id: 'VX-001', name: 'Nazara', vip: true });
    expect(response.analytics.roi7).toBeCloseTo(122, 1);
    expect(response.analytics.roi30).toBeCloseTo(271, 1);
    expect(response.analytics.roi90).toBeCloseTo(841, 1);
    expect(response.analytics.winRate).toBeGreaterThanOrEqual(96.5);
    expect(response.analytics.winRate).toBeLessThanOrEqual(98);
    expect(response.analytics.plRatio).toBeGreaterThan(0.65);
    expect(response.analytics.plRatio).toBeLessThan(0.9);
    expect(response.analytics.profitFactor).toBeGreaterThanOrEqual(3.5);
    expect(response.analytics.profitFactor).toBeLessThanOrEqual(6);
    expect(response.analytics.maximumDrawdown).toBeGreaterThanOrEqual(6);
    expect(response.analytics.maximumDrawdown).toBeLessThanOrEqual(9);
    expect(response.analytics.activeFollowers).toBe(32);
    verifyConsistency(response);
  });

  test('time progression replaces every rolling window and changes the generated history', () => {
    let state = createInitialState(FIXED_NOW);
    const checkpoints = [7, 30, 90];
    for (const days of checkpoints) {
      const before = toResponse(state);
      const beforeTradeIds = new Set(before.trades.map((trade) => trade.id));
      const oldWindowBoundary = addUtcDays(before.equityHistory.at(-1)!.date, -days);
      const oldWindowIds = before.trades.filter((trade) => trade.closedAt.slice(0, 10) <= oldWindowBoundary).map((trade) => trade.id);
      state = advanceState(state, days);
      const after = toResponse(state);
      expect(after.analytics.totalTrades).toBeGreaterThan(before.analytics.totalTrades);
      expect(after.trades.some((trade) => !beforeTradeIds.has(trade.id))).toBe(true);
      expect(after.equityHistory.at(-1)!.equity).not.toBe(before.equityHistory.at(-1)!.equity);
      expect(after.analytics.roi7).not.toBe(before.analytics.roi7);
      expect(after.analytics.sharpe).not.toBe(before.analytics.sharpe);
      expect(after.analytics.followerPnl).not.toBe(before.analytics.followerPnl);
      expect(oldWindowIds.length).toBeGreaterThan(0);
      const newBoundary = addUtcDays(after.equityHistory.at(-1)!.date, -days);
      expect(after.trades.filter((trade) => trade.closedAt.slice(0, 10) > newBoundary).some((trade) => oldWindowIds.includes(trade.id))).toBe(false);
      verifyConsistency(after);
    }
  });

  test('service supports +1/+7/+30/+90 and reset without touching exchange state', async () => {
    const store = new MemorySyntheticStateStore();
    const service = new SyntheticCopyTradingService(store, () => FIXED_NOW);
    const initial = await service.get();
    for (const days of [1, 7, 30, 90] as const) {
      const before = await service.get();
      const after = await service.advance(days);
      expect(after.analytics.totalTradingDays - before.analytics.totalTradingDays).toBe(days);
      expect(after.analytics.totalTrades).toBeGreaterThan(before.analytics.totalTrades);
    }
    const reset = await service.reset();
    expect(reset).toEqual(initial);
    const increased = await service.followerEvent({ type: 'INCREASE', followerId: 'F-001', amount: 25_000 });
    expect(increased.analytics.aum).toBeCloseTo(initial.analytics.aum + 25_000, 2);
    const stopped = await service.followerEvent({ type: 'STOP', followerId: 'F-001' });
    expect(stopped.analytics.activeFollowers).toBe(31);
    expect(stopped.analytics.aum).toBeLessThan(increased.analytics.aum);
  });

  test('real-time mode catches up each missing UTC day and persists the result', async () => {
    const initialState = createInitialState(FIXED_NOW);
    const store = new MemorySyntheticStateStore(initialState);
    const service = new SyntheticCopyTradingService(store, () => new Date('2026-09-09T12:00:00.000Z'));
    const caughtUp = await service.get();
    expect(caughtUp.simulation.mode).toBe('REAL_TIME');
    expect(caughtUp.analytics.totalTradingDays).toBe(initialState.dailyResults.length + 7);
    expect(caughtUp.analytics.totalTrades).toBeGreaterThan(initialState.trades.length);
    expect((await store.load())!.simulatedAt).toBe(caughtUp.simulation.simulatedAt);
  });

  test('all published risk statistics are finite and recomputable', () => {
    const response = toResponse(advanceState(createInitialState(FIXED_NOW), 90));
    const recomputed = calculateAnalytics({
      ...createInitialState(FIXED_NOW),
      ...advanceState(createInitialState(FIXED_NOW), 90),
    });
    expect(response.analytics).toEqual(recomputed);
    for (const key of ['sharpe', 'sortino', 'calmar', 'annualizedVolatility', 'expectancy', 'expectancyR'] as const) {
      expect(Number.isFinite(response.analytics[key])).toBe(true);
    }
    const oldStart = equityAtOrBefore(response.equityHistory, addUtcDays(response.equityHistory.at(-1)!.date, -90));
    expect(oldStart.date).not.toBe(response.equityHistory[0].date);
  });
});
