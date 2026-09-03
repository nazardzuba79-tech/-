import { selectSyntheticPeriod } from '../../../../frontend/src/lib/syntheticCopyTrading';
import { addUtcDays, maximumDrawdown } from '../analytics';
import { advanceState, createInitialState, toResponse } from '../SyntheticCopyTradingEngine';

const FIXED_NOW = new Date('2026-09-02T12:00:00.000Z');

describe('trader profile period projections', () => {
  test('7D, 30D, 90D and ALL are consistent projections of one ledger', () => {
    const response = toResponse(advanceState(createInitialState(FIXED_NOW), 90));
    const currentDate = response.equityHistory.at(-1)!.date;

    for (const period of ['7D', '30D', '90D', 'ALL'] as const) {
      const selected = selectSyntheticPeriod(response, period);
      const cutoff = period === 'ALL' ? '' : addUtcDays(currentDate, -Number(period.slice(0, -1)));
      const expectedTrades = period === 'ALL'
        ? response.trades
        : response.trades.filter((trade) => trade.closedAt.slice(0, 10) > cutoff);
      const expectedEquity = period === 'ALL'
        ? response.equityHistory
        : response.equityHistory.filter((point) => point.date >= cutoff);
      const pnl = expectedEquity.at(-1)!.equity - expectedEquity[0].equity;
      const wins = expectedTrades.filter((trade) => trade.result === 'WIN');
      const losses = expectedTrades.filter((trade) => trade.result === 'LOSS');
      const grossProfit = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
      const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));

      expect(selected.totalTrades).toBe(expectedTrades.length);
      expect(selected.winningTrades + selected.losingTrades).toBe(selected.totalTrades);
      expect(selected.winRate).toBeCloseTo(wins.length / expectedTrades.length * 100, 8);
      expect(selected.pnl).toBeCloseTo(pnl, 6);
      expect(selected.roi).toBeCloseTo(pnl / expectedEquity[0].equity * 100, 8);
      expect(selected.maximumDrawdown).toBeCloseTo(maximumDrawdown(expectedEquity), 8);
      expect(selected.profitFactor).toBeCloseTo(grossProfit / grossLoss, 8);
      expect(selected.daily.reduce((sum, day) => sum + day.realizedPnl, 0)).toBeCloseTo(selected.pnl, 1);
      expect(Number.isFinite(selected.sharpe)).toBe(true);
      expect(Number.isFinite(selected.sortino)).toBe(true);
      expect(Number.isFinite(selected.annualizedVolatility)).toBe(true);
    }
  });

  test('ALL keeps the complete inception history after time advances', () => {
    const before = toResponse(createInitialState(FIXED_NOW));
    const after = toResponse(advanceState(createInitialState(FIXED_NOW), 90));
    const beforeAll = selectSyntheticPeriod(before, 'ALL');
    const afterAll = selectSyntheticPeriod(after, 'ALL');

    expect(afterAll.equity.slice(0, beforeAll.equity.length)).toEqual(beforeAll.equity);
    expect(afterAll.totalTrades).toBeGreaterThan(beforeAll.totalTrades);
    expect(afterAll.tradingDays).toBe(beforeAll.tradingDays + 90);
    expect(afterAll.pnl).toBeGreaterThan(beforeAll.pnl);
  });
});
