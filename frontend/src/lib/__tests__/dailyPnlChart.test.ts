import { dailyPnlChart } from '../dailyPnlChart';
import { createInitialState, advanceState, toResponse } from '../../../../src/services/copyTrading/SyntheticCopyTradingEngine';
import { selectSyntheticPeriod } from '../syntheticCopyTrading';

test('daily bars retain dates, signs, zero and linear relative sizes', () => {
  const plot = dailyPnlChart([{date: 'a', realizedPnl: 20}, {date: 'b', realizedPnl: -10}, {date: 'c', realizedPnl: 0}]);
  expect(plot.bars[0].height).toBeCloseTo(plot.bars[1].height * 2);
  expect(plot.bars[0].y + plot.bars[0].height).toBeCloseTo(plot.zero);
  expect(plot.bars[1].y).toBe(plot.zero);
  expect(plot.bars[2].height).toBe(0);
  expect(plot.total).toBe(10);
  expect(plot.average).toBeCloseTo(10 / 3);
});

test('all periods and +90 days preserve ledger totals and every daily bar', () => {
  const initial = createInitialState(new Date('2026-09-04T12:00:00Z'));
  for (const state of [initial, advanceState(initial, 90)]) {
    const response = toResponse(state);
    for (const period of ['7D', '30D', '90D', 'ALL'] as const) {
      const selected = selectSyntheticPeriod(response, period);
      const plot = dailyPnlChart(selected.daily);
      expect(plot.bars).toHaveLength(selected.daily.length);
      expect(plot.total).toBeCloseTo(selected.pnl, 2);
      expect(plot.total).toBeCloseTo(selected.trades.reduce((sum, t) => sum + t.netPnl, 0), 2);
      expect(plot.bars.map(b => b.realizedPnl)).toEqual(selected.daily.map(d => d.realizedPnl));
      expect(plot.bars.every(b => Number.isFinite(b.height) && b.height >= 0)).toBe(true);
    }
  }
});

test('empty, flat and genuine outlier series are not fabricated or clipped', () => {
  expect(dailyPnlChart([]).total).toBe(0);
  expect(dailyPnlChart([{date:'a',realizedPnl:0}]).bars[0].height).toBe(0);
  const plot = dailyPnlChart([{date:'a',realizedPnl:1},{date:'b',realizedPnl:1000}]);
  expect(plot.bars[1].height / plot.bars[0].height).toBeCloseTo(1000);
});
