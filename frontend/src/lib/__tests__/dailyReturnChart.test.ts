import { dailyReturnChart } from '../dailyReturnChart';
import { createInitialState, toResponse } from '../../../../src/services/copyTrading/SyntheticCopyTradingEngine';
import { createCashflowMasterState, advanceCashflowMasterState } from '../../../../src/services/copyTrading/reviewMasterLedger';
import { isReviewHoliday } from '../../../../src/services/copyTrading/reviewEconomicsConfig';
import { selectSyntheticPeriod } from '../syntheticCopyTrading';

const periods = ['7D', '30D', '90D', 'ALL'] as const;

function expectContained(plot: ReturnType<typeof dailyReturnChart>) {
  const top = Math.min(...plot.ticks.map(tick => tick.y));
  const bottom = Math.max(...plot.ticks.map(tick => tick.y));
  expect(Number.isFinite(plot.zero)).toBe(true);
  expect(plot.ticks.some(tick => tick.value === 0 && tick.y === plot.zero)).toBe(true);
  for (const bar of plot.bars) {
    expect(Number.isFinite(bar.height)).toBe(true);
    expect(bar.height).toBeGreaterThanOrEqual(0);
    expect(bar.y).toBeGreaterThanOrEqual(top - 1e-9);
    expect(bar.y + bar.height).toBeLessThanOrEqual(bottom + 1e-9);
    expect(bar.x).toBeGreaterThanOrEqual(0);
    expect(bar.x + bar.width).toBeLessThanOrEqual(plot.width + 1e-9);
  }
}

test('bars retain original dates, signs, zero and full-precision linear return percentages', () => {
  const days = [{ date: 'a', dailyReturn: .2 }, { date: 'b', dailyReturn: -.1 }, { date: 'c', dailyReturn: 0 }];
  const plot = dailyReturnChart(days);
  expect(plot.bars.map(bar => bar.date)).toEqual(['a', 'b', 'c']);
  expect(plot.bars.map(bar => bar.returnPct)).toEqual([20, -10, 0]);
  expect(plot.bars.map(bar => bar.dailyReturn)).toEqual(days.map(day => day.dailyReturn));
  expect(plot.bars[0].height).toBeCloseTo(plot.bars[1].height * 2, 10);
  expect(plot.bars[0].y + plot.bars[0].height).toBeCloseTo(plot.zero, 10);
  expect(plot.bars[1].y).toBe(plot.zero);
  expect(plot.bars[2].height).toBe(0);
  expect(plot.roi).toBeCloseTo((1.2 * .9 - 1) * 100, 10);
  expect(plot.average).toBeCloseTo(10 / 3, 10);
  expectContained(plot);
  const precise = dailyReturnChart([{ date: 'a', dailyReturn: .01234567890123 }, { date: 'b', dailyReturn: .02469135780246 }]);
  expect(precise.bars[0].returnPct).toBe(.01234567890123 * 100);
  expect(precise.bars[1].height / precise.bars[0].height).toBeCloseTo(2, 12);
});

test('bar heights describe return, not USDT amount or account size', () => {
  const pnl = 100;
  const differentCapital = dailyReturnChart([
    { date: 'small', dailyReturn: pnl / 1_000, realizedPnl: pnl },
    { date: 'large', dailyReturn: pnl / 10_000, realizedPnl: pnl },
  ]);
  expect(differentCapital.bars[0].height / differentCapital.bars[1].height).toBeCloseTo(10, 10);

  const equalReturns = [{ date: 'small', dailyReturn: .1, realizedPnl: 100 }, { date: 'large', dailyReturn: .1, realizedPnl: 1_000 }];
  const samePercent = dailyReturnChart(equalReturns);
  expect(samePercent.bars[0].height).toBe(samePercent.bars[1].height);
  const geometry = (plot: ReturnType<typeof dailyReturnChart>) => ({
    width: plot.width, zero: plot.zero, roi: plot.roi, average: plot.average, ticks: plot.ticks,
    bars: plot.bars.map(({ x, y, width, height, date, dailyReturn, returnPct }) => ({ x, y, width, height, date, dailyReturn, returnPct })),
  });
  expect(geometry(dailyReturnChart(equalReturns.map(day => ({ ...day, realizedPnl: -99_999_999 })))))
    .toEqual(geometry(samePercent));
  expect(geometry(dailyReturnChart(equalReturns.map(({ date, dailyReturn }) => ({ date, dailyReturn })))))
    .toEqual(geometry(samePercent));
});

test('empty, flat, negative-only and genuine outlier series are neither manufactured nor clipped', () => {
  const empty = dailyReturnChart([]);
  expect(empty.roi).toBe(0);
  expect(empty.average).toBe(0);
  expect(empty.bars).toEqual([]);
  for (const returns of [[0], [0, 0, 0], [-.01, -.03, -.02], [.0001, .1], [2.5, -.25, 0]]) {
    const plot = dailyReturnChart(returns.map((dailyReturn, index) => ({ date: String(index), dailyReturn })));
    expectContained(plot);
    expect(plot.bars.map(bar => bar.returnPct)).toEqual(returns.map(value => value * 100));
    expect(plot.roi).toBeCloseTo((returns.reduce((factor, value) => factor * (1 + value), 1) - 1) * 100, 10);
    if (returns.every(value => value === 0)) expect(plot.bars.every(bar => bar.height === 0)).toBe(true);
    if (returns.every(value => value < 0)) expect(plot.bars.every(bar => bar.y === plot.zero)).toBe(true);
  }
  const outlier = dailyReturnChart([{ date: 'a', dailyReturn: .0001 }, { date: 'b', dailyReturn: .1 }]);
  expect(outlier.bars[1].height / outlier.bars[0].height).toBeCloseTo(1_000, 8);
});

test('plotting immutable inputs never edits return history or money metadata', () => {
  const days = Object.freeze([
    Object.freeze({ date: 'a', dailyReturn: .01, realizedPnl: 10 }),
    Object.freeze({ date: 'b', dailyReturn: -.02, realizedPnl: -50 }),
    Object.freeze({ date: 'c', dailyReturn: 0, realizedPnl: 0 }),
  ]);
  const snapshot = JSON.stringify(days);
  const first = dailyReturnChart(days);
  expect(dailyReturnChart(days)).toEqual(first);
  expect(JSON.stringify(days)).toBe(snapshot);
  expect(first.bars[0]).not.toBe(days[0]);
});

describe('canonical synthetic daily returns', () => {
  const initial = createCashflowMasterState();
  const advanced = advanceCashflowMasterState(initial, 90);

  test('v7 periods independently reconcile each percentage with actual trade PnL / private capital at risk', () => {
    for (const state of [initial, advanced]) {
      const capitalByDate = new Map(state.cashflow.masterDays.map(day => [day.date, day.capitalAtRisk]));
      const pnlByDate = new Map<string, number>();
      for (const trade of state.trades) {
        const date = trade.closedAt.slice(0, 10);
        pnlByDate.set(date, (pnlByDate.get(date) ?? 0) + Math.round(trade.netPnl * 10_000));
      }
      const response = toResponse(state);
      for (const period of periods) {
        const selected = selectSyntheticPeriod(response, period);
        const plot = dailyReturnChart(selected.daily);
        expect(plot.width).toBeLessThanOrEqual(900);
        expect(plot.bars).toHaveLength(selected.daily.length);
        expectContained(plot);
        let independentFactor = 1;
        for (let index = 0; index < selected.daily.length; index++) {
          const day = selected.daily[index];
          const returnFromLedger = (pnlByDate.get(day.date) ?? 0) / 10_000 / capitalByDate.get(day.date)!;
          expect(day.dailyReturn).toBeCloseTo(returnFromLedger, 12);
          expect(plot.bars[index].returnPct).toBeCloseTo(returnFromLedger * 100, 10);
          expect(plot.bars[index].dailyReturn).toBe(day.dailyReturn);
          expect(plot.bars[index].date).toBe(day.date);
          independentFactor *= 1 + returnFromLedger;
        }
        expect(plot.roi).toBeCloseTo((independentFactor - 1) * 100, 8);
        expect(plot.roi).toBeCloseTo(selected.roi, 8);
        expect(plot.roi).toBeCloseTo(response.economics!.periods[period].roi, 8);
        expect(plot.average).toBeCloseTo(selected.daily.reduce((sum, day) => sum + day.dailyReturn * 100, 0) / selected.daily.length, 12);
      }
    }
  });

  test('all 22 holiday dates remain zero-height calendar bars, not removed or reassigned', () => {
    const plot = dailyReturnChart(initial.dailyResults);
    const holidayBars = plot.bars.filter(bar => isReviewHoliday(bar.date));
    expect(holidayBars).toHaveLength(22);
    expect(holidayBars.every(bar => bar.dailyReturn === 0 && bar.returnPct === 0 && bar.height === 0 && bar.y === plot.zero)).toBe(true);
    expect(plot.bars.map(bar => bar.date)).toEqual(initial.dailyResults.map(day => day.date));
  });

  test('+90 appends bars and keeps every existing date/return unchanged even when axes rescale', () => {
    const original = dailyReturnChart(initial.dailyResults);
    const after = dailyReturnChart(advanced.dailyResults);
    expect(original.bars).toHaveLength(380);
    expect(after.bars).toHaveLength(470);
    const facts = (bars: typeof original.bars) => bars.map(bar => ({ date: bar.date, dailyReturn: bar.dailyReturn, returnPct: bar.returnPct }));
    expect(facts(after.bars.slice(0, original.bars.length))).toEqual(facts(original.bars));
    expectContained(after);
    expect(initial.dailyResults).toHaveLength(380);
  });

  test('legacy v6 still renders its canonical dailyReturn without replacing it by dollar PnL', () => {
    const legacy = createInitialState(new Date('2026-09-05T12:00:00Z'));
    expect(legacy.version).toBe(6);
    const response = toResponse(legacy);
    for (const period of periods) {
      const selected = selectSyntheticPeriod(response, period);
      const plot = dailyReturnChart(selected.daily);
      expect(plot.bars.map(bar => bar.dailyReturn)).toEqual(selected.daily.map(day => day.dailyReturn));
      expect(plot.bars.map(bar => bar.returnPct)).toEqual(selected.daily.map(day => day.dailyReturn * 100));
      expect(plot.roi).toBeCloseTo((selected.daily.reduce((factor, day) => factor * (1 + day.dailyReturn), 1) - 1) * 100, 10);
      expectContained(plot);
    }
  });
});
