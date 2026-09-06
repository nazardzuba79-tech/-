import { createReviewSyntheticState } from '../../../../src/services/copyTrading/canonical/reviewSyntheticHistory';
import { toResponse } from '../../../../src/services/copyTrading/canonical/SyntheticCopyTradingEngine';
import { dailyReturnChart } from '../dailyReturnChart';
import { selectSyntheticPeriod, syntheticPerformancePoints, syntheticChartData, syntheticNazaraTrader } from '../syntheticCopyTrading';

const SIMPLE = 'CASH_FLOW_ADJUSTED_SIMPLE_RETURN' as const;
const periods = ['7D', '30D', '90D', 'ALL'] as const;

test('v8 histogram sums canonical returns, never compounds them or changes bar geometry', () => {
  const days = [{ date: 'a', dailyReturn: .10, realizedPnl: 100 }, { date: 'b', dailyReturn: -.02, realizedPnl: -400 }];
  const simple = dailyReturnChart(days, SIMPLE);
  const legacy = dailyReturnChart(days, 'DAILY_TWR');
  expect(simple.roi).toBeCloseTo(8, 12);
  expect(legacy.roi).toBeCloseTo(7.8, 12);
  expect(simple.average).toBeCloseTo(4, 12);
  expect(simple.bars).toEqual(legacy.bars);
  expect(simple.ticks).toEqual(legacy.ticks);
});

describe('one canonical v8 strategy history across every presentation', () => {
  const baseline = toResponse(createReviewSyntheticState(new Date('2026-09-05T12:00:00Z')));
  const later = toResponse(createReviewSyntheticState(new Date('2026-12-04T12:00:00Z')));

  test('baseline anchors, actual outcomes and amounts reach the UI adapter without fallback constants', () => {
    expect(baseline.simulation.stateVersion).toBe(8);
    expect(baseline.economics?.methodology).toBe(SIMPLE);
    const selected = periods.map(period => selectSyntheticPeriod(baseline, period));
    [112, 271, 841, 3727].forEach((target, index) => expect(selected[index].roi).toBeCloseTo(target, 5));
    const all = selected[3];
    expect(all.pnl).toBeCloseTo(4_711_027, 4);
    expect(all.totalTrades).toBe(471);
    expect(all.winningTrades).toBe(434);
    expect(all.losingTrades).toBe(34);
    expect(all.winRate).toBe(434 / 468 * 100);
    expect(all.winRate.toFixed(1)).toBe('92.7');
    expect(syntheticNazaraTrader(baseline).winRate).toBeCloseTo(all.winRate, 3);
    expect(syntheticNazaraTrader(baseline).risk).toBe('High');
  });

  test('every window rebases additive ROI by subtraction and uses the same daily return/risk ledger', () => {
    for (const response of [baseline, later]) for (const period of periods) {
      const selected = selectSyntheticPeriod(response, period);
      const plot = dailyReturnChart(selected.daily, selected.methodology);
      const roiPoints = syntheticPerformancePoints(selected, 'ROI');
      const pnlPoints = syntheticPerformancePoints(selected, 'PnL');
      expect(selected.roi).toBeCloseTo(selected.daily.reduce((sum, day) => sum + day.dailyReturn * 100, 0), 9);
      expect(plot.roi).toBeCloseTo(selected.roi, 9);
      expect(roiPoints[0].value).toBeCloseTo(0, 9);
      expect(roiPoints.at(-1)!.value).toBeCloseTo(selected.roi, 7);
      expect(pnlPoints.at(-1)!.value).toBeCloseTo(selected.pnl, 4);
      expect(plot.bars.map(bar => bar.returnPct)).toEqual(selected.daily.map(day => day.dailyReturn * 100));
      expect(selected.sharpe).toBe(response.economics!.periods[period].sharpe);
      expect(selected.sortino).toBe(response.economics!.periods[period].sortino);
      expect(selected.maximumDrawdown).toBe(response.economics!.periods[period].maximumDrawdown);
      expect(syntheticChartData(response, period).linePath).not.toBe('');
    }
  });

  test('+90 exposes new current periods while retaining every ALL date/value without mutation', () => {
    const original = selectSyntheticPeriod(baseline, 'ALL');
    const after = selectSyntheticPeriod(later, 'ALL');
    expect(original.daily).toHaveLength(380);
    expect(after.daily).toHaveLength(470);
    expect(after.daily.slice(0, 380)).toEqual(original.daily);
    expect(after.equity.slice(0, 381)).toEqual(original.equity);
    expect(syntheticPerformancePoints(after, 'ROI').slice(0, 381)).toEqual(syntheticPerformancePoints(original, 'ROI'));
    expect(after.totalTrades).toBeGreaterThan(original.totalTrades);
    for (const period of periods.slice(0, 3)) expect(selectSyntheticPeriod(later, period).daily).toHaveLength(parseInt(period));
  });
});
