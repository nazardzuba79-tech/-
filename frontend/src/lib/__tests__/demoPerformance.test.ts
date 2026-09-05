import { marketplaceTraders, nazarTrader, PERIODS } from '../../pages/copy-trading-bolt/traders';
import { demoChartData, demoCurveStyle, getDemoEquityHistory, selectDemoPerformance } from '../../pages/copy-trading-bolt/demoPerformance';

describe('illustrative catalogue equity histories', () => {
  test('each alias has a deterministic positive daily history, independent of current wall clock', () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(0);
    try {
      for (const trader of marketplaceTraders) {
        const first = getDemoEquityHistory(trader);
        clock.mockReturnValue(4_000_000_000_000);
        const again = getDemoEquityHistory({ ...trader });
        expect(again).toBe(first);
        expect(first.length).toBe(Math.max(90, Math.round(trader.activeMonths * 30.44)) + 1);
        expect(first[0].equity).toBe(10_000);
        expect(first.at(-1)?.date).toBe('2026-09-05');
        expect(Object.isFrozen(first)).toBe(true);
        for (let index = 0; index < first.length; index++) {
          expect(first[index].equity).toBeGreaterThan(0);
          expect(Number.isFinite(first[index].equity)).toBe(true);
          expect(first[index].day).toBe(index);
          expect(Object.isFrozen(first[index])).toBe(true);
          if (index) expect(Date.parse(first[index].date) - Date.parse(first[index - 1].date)).toBe(86_400_000);
        }
      }
    } finally {
      clock.mockRestore();
    }
  });

  test('ALL/90D/30D/7D are exact common-history slices with the existing ROI endpoints', () => {
    for (const trader of marketplaceTraders) {
      const all = getDemoEquityHistory(trader);
      const roiTargets = { '7D': trader.roi7, '30D': trader.roi30, '90D': trader.roi90, ALL: trader.roiAll };
      for (const period of PERIODS) {
        const selected = selectDemoPerformance(trader, period);
        const count = period === 'ALL' ? all.length - 1 : parseInt(period, 10);
        expect(selected.source).toBe('illustrative-catalogue');
        expect(selected.equity).toEqual(all.slice(-count - 1));
        expect(selected.equity[0]).toBe(all[all.length - count - 1]);
        expect(selected.tradingDays).toBe(count);
        expect(selected.roi).toBeCloseTo(roiTargets[period], 10);
        expect(selected.rebasedEquity[0]).toBe(10_000);
        expect(selected.rebasedEquity.at(-1)).toBeCloseTo(10_000 * (1 + roiTargets[period] / 100), 7);
        const compounded = selected.dailyReturns.reduce((factor, value) => factor * (1 + value), 1);
        expect((compounded - 1) * 100).toBeCloseTo(selected.roi, 9);
      }
    }
  });

  test('abrupt gains vary in timing, while steady aliases are not converted into spike charts', () => {
    const styles = new Set(marketplaceTraders.map(demoCurveStyle));
    expect(styles).toEqual(new Set(['steady', 'breakout', 'recovery', 'choppy']));
    const burstDays = new Set<number>();
    for (const trader of marketplaceTraders.filter(item => demoCurveStyle(item) === 'breakout' && item.roi90 > 0)) {
      const selected = selectDemoPerformance(trader, '90D');
      const peak = Math.max(...selected.dailyReturns);
      const index = selected.dailyReturns.indexOf(peak);
      burstDays.add(index);
      expect(peak).toBeGreaterThan(selected.dailyReturns.reduce((sum, value) => sum + value, 0) / 90 * 5);
      expect(index).toBeLessThan(83); // Not every breakout is placed in the final week.
    }
    expect(burstDays.size).toBeGreaterThan(3);
    const choppy = selectDemoPerformance(marketplaceTraders.find(trader => trader.id === 'VX-029')!, '90D');
    expect(choppy.dailyReturns.some(value => value > 0)).toBe(true);
    expect(choppy.dailyReturns.some(value => value < 0)).toBe(true);
    expect(choppy.roi).toBeLessThan(0); // Losing profiles are not cosmetically made profitable.
  });

  test('steady and choppy aliases retain down days and real drawdowns rather than monotonic gain paths', () => {
    for (const trader of marketplaceTraders.filter(item => ['steady', 'choppy'].includes(demoCurveStyle(item)))) {
      const selected = selectDemoPerformance(trader, '90D');
      const upDays = selected.dailyReturns.filter(value => value > 0).length;
      const downDays = selected.dailyReturns.filter(value => value < 0).length;
      expect(upDays).toBeGreaterThan(0);
      expect(downDays).toBeGreaterThan(9);
      expect(selected.maximumDrawdown).toBeGreaterThan(0.1);
      expect(selected.annualizedVolatility).toBeGreaterThan(0);
      expect(selected.sortino).not.toBeNull();
    }
    const steady = selectDemoPerformance(marketplaceTraders.find(trader => trader.id === 'VX-002')!, '90D');
    const breakout = selectDemoPerformance(marketplaceTraders.find(trader => trader.id === 'VX-003')!, '90D');
    expect(Math.max(...breakout.dailyReturns)).toBeGreaterThan(Math.max(...steady.dailyReturns) * 2);
  });

  test('drawdown, volatility, Sharpe and Sortino are derived from the selected curve', () => {
    for (const trader of marketplaceTraders) {
      for (const period of PERIODS) {
        const selected = selectDemoPerformance(trader, period);
        const returns = selected.dailyReturns;
        const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
        const std = Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1));
        const downside = Math.sqrt(returns.reduce((sum, value) => sum + Math.min(0, value) ** 2, 0) / returns.length);
        let peak = selected.equity[0].equity;
        let maximum = 0;
        selected.equity.forEach(point => {
          peak = Math.max(peak, point.equity);
          maximum = Math.max(maximum, (peak - point.equity) / peak * 100);
        });
        expect(selected.maximumDrawdown).toBeCloseTo(maximum, 10);
        expect(selected.annualizedVolatility).toBeCloseTo(std * Math.sqrt(365) * 100, 10);
        if (std > 1e-12) expect(selected.sharpe).toBeCloseTo(mean / std * Math.sqrt(365), 10);
        else expect(selected.sharpe).toBeNull();
        if (downside > 1e-12) expect(selected.sortino).toBeCloseTo(mean / downside * Math.sqrt(365), 10);
        else expect(selected.sortino).toBeNull();
      }
    }
  });

  test('chart output shares the selected curve without fabricating market/BTC benchmarks', () => {
    const trader = marketplaceTraders[0];
    for (const period of PERIODS) {
      const selected = selectDemoPerformance(trader, period);
      const chart = demoChartData(trader, period);
      expect(chart.linePath.match(/[ML]/g)?.length).toBe(selected.equity.length);
      expect(chart.linePath).not.toMatch(/NaN|Infinity/);
      expect(chart.marketPath).toBe('');
      expect(chart.btcPath).toBe('');
      expect(chart.areaPath.startsWith(chart.linePath)).toBe(true);
      expect(chart.xLabels).toHaveLength(6);
    }
  });

  test('Nazara and invalid/incompatible inputs cannot silently acquire catalogue curves', () => {
    expect(() => getDemoEquityHistory(nazarTrader)).toThrow(/existing synthetic trade ledger/);
    expect(() => selectDemoPerformance(nazarTrader, 'ALL')).toThrow(/existing synthetic trade ledger/);
    expect(() => getDemoEquityHistory({ ...marketplaceTraders[0], roiAll: -100 })).toThrow(/ROI/);
    expect(() => getDemoEquityHistory({ ...marketplaceTraders[0], roi7: Number.NaN })).toThrow(/ROI/);
    expect(() => getDemoEquityHistory({ ...marketplaceTraders[0], activeMonths: 0 })).toThrow(/duration/);
    expect(() => getDemoEquityHistory({ ...marketplaceTraders[0], activeMonths: 2 })).toThrow(/anchors disagree/);
  });
});
