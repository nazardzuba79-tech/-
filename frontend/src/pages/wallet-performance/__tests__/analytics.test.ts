import {
  bucketBreakdown,
  dailyPnlSeries,
  drawdown,
  granularityFor,
  performanceStats,
  type EquityPoint,
} from '../analytics';
import { buildAdjustedSeries, computePeriod, type RawEquityDay } from '../../../../../src/services/PortfolioPerformanceEngine';

/** Consecutive UTC days from a fixed anchor, so tests never depend on today. */
function days(n: number, from = '2026-01-01'): string[] {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  return Array.from({ length: n }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

function series(values: number[], from = '2026-01-01'): EquityPoint[] {
  return days(values.length, from).map((date, i) => ({ date, equity: values[i] }));
}

describe('dailyPnlSeries', () => {
  it('emits one row per transition, not per point', () => {
    expect(dailyPnlSeries(series([100, 110, 120]))).toHaveLength(2);
  });

  it('telescopes: the daily rows sum to the window PnL', () => {
    const pts = series([1000, 1050, 990, 1240, 1180]);
    const total = dailyPnlSeries(pts).reduce((a, d) => a + d.pnl, 0);
    expect(total).toBeCloseTo(pts[pts.length - 1].equity - pts[0].equity, 9);
  });

  it('reports the day-over-day return, not the cumulative one', () => {
    const [first, second] = dailyPnlSeries(series([100, 110, 121]));
    expect(first.returnPct).toBeCloseTo(10, 9);
    expect(second.returnPct).toBeCloseTo(10, 9);
  });

  it('has nothing to say about a window with fewer than two points', () => {
    expect(dailyPnlSeries([])).toEqual([]);
    expect(dailyPnlSeries(series([100]))).toEqual([]);
  });
});

describe('capital flows are not performance', () => {
  // These build the canonical series through the real engine, then run the
  // page's analytics over it — the same path production takes.
  const flat = (n: number, value: number, flows: Record<number, number> = {}): RawEquityDay[] =>
    days(n).map((date, i) => ({
      date,
      totalValueUsd: value + Object.entries(flows).reduce((a, [k, v]) => (Number(k) <= i ? a + v : a), 0),
      netFlowUsd: flows[i] ?? 0,
    }));

  it('a deposit does not appear as a profitable day', () => {
    // $10,000 flat, then $50,000 deposited on day 3, then flat again.
    const raw = flat(6, 10_000, { 3: 50_000 });
    const pts = buildAdjustedSeries(raw);
    const daily = dailyPnlSeries(pts);
    for (const d of daily) expect(Math.abs(d.returnPct)).toBeLessThan(1e-9);
    const stats = performanceStats(pts);
    expect(stats.totalPnl).toBeCloseTo(0, 6);
    expect(stats.profitableDays).toBe(0);
    // And no single bar carries the deposit.
    expect(Math.max(...daily.map((d) => Math.abs(d.pnl)))).toBeLessThan(1e-6);
  });

  it('a withdrawal does not appear as a losing day', () => {
    const raw = flat(6, 60_000, { 3: -20_000 });
    const pts = buildAdjustedSeries(raw);
    const daily = dailyPnlSeries(pts);
    for (const d of daily) expect(Math.abs(d.returnPct)).toBeLessThan(1e-9);
    expect(performanceStats(pts).losingDays).toBe(0);
  });

  it('an internal Spot <-> Futures transfer cannot reach the series at all', () => {
    // A transfer moves value between two wallets the total already spans,
    // so the snapshot total is unchanged and netFlowUsd stays 0.
    const raw = flat(5, 25_000);
    const withTransfer = raw.map((d) => ({ ...d })); // identical totals
    expect(buildAdjustedSeries(withTransfer)).toEqual(buildAdjustedSeries(raw));
    expect(performanceStats(buildAdjustedSeries(withTransfer)).totalPnl).toBeCloseTo(0, 9);
  });

  it('separates real gain from a same-day deposit', () => {
    // Day 1: $10,000. Day 2: deposit $5,000 and the book also gains $1,000.
    const raw: RawEquityDay[] = [
      { date: days(2)[0], totalValueUsd: 10_000, netFlowUsd: 0 },
      { date: days(2)[1], totalValueUsd: 16_000, netFlowUsd: 5_000 },
    ];
    const daily = dailyPnlSeries(buildAdjustedSeries(raw));
    // (16,000 - 5,000) / 10,000 - 1 = +10%, not +60%.
    expect(daily[0].returnPct).toBeCloseTo(10, 9);
  });
});

describe('drawdown', () => {
  it('measures peak to trough on the same curve', () => {
    const dd = drawdown(series([100, 120, 90, 110]));
    expect(dd.maxDrawdownPct).toBeCloseTo(-25, 9); // 120 -> 90
    expect(dd.maxDrawdownUsd).toBeCloseTo(-30, 9);
    expect(dd.peakDate).toBe('2026-01-02');
    expect(dd.troughDate).toBe('2026-01-03');
  });

  it('is zero for a curve that only rises', () => {
    expect(drawdown(series([100, 105, 130])).maxDrawdownPct).toBe(0);
  });

  it('re-bases after a new high', () => {
    // Falls 10% early, then makes a high and falls 20% from it.
    const dd = drawdown(series([100, 90, 200, 160]));
    expect(dd.maxDrawdownPct).toBeCloseTo(-20, 9);
    expect(dd.peakDate).toBe('2026-01-03');
  });

  it('never reports a positive drawdown', () => {
    for (const p of drawdown(series([50, 80, 60, 95, 70])).series) {
      expect(p.drawdownPct).toBeLessThanOrEqual(0);
    }
  });

  it('says nothing when there is no history', () => {
    expect(drawdown([]).maxDrawdownPct).toBeNull();
    expect(drawdown(series([100])).maxDrawdownPct).toBeNull();
  });
});

describe('performanceStats', () => {
  const pts = series([1000, 1100, 1045, 1150, 1150]);

  it('agrees with the canonical period figures', () => {
    const s = performanceStats(pts);
    expect(s.totalPnl).toBeCloseTo(150, 9);
    expect(s.roiPct).toBeCloseTo(15, 9);
    expect(s.startEquity).toBe(1000);
    expect(s.endEquity).toBe(1150);
  });

  it('classifies up, down and flat days', () => {
    const s = performanceStats(pts);
    expect(s.profitableDays).toBe(2);
    expect(s.losingDays).toBe(1);
    expect(s.flatDays).toBe(1);
    expect(s.tradingDays).toBe(4);
    expect(s.winRatePct).toBeCloseTo((2 / 3) * 100, 9);
  });

  it('picks the real best and worst days', () => {
    const s = performanceStats(pts);
    expect(s.bestDay?.date).toBe('2026-01-04');
    expect(s.bestDay?.pnl).toBeCloseTo(105, 9);
    expect(s.worstDay?.date).toBe('2026-01-03');
    expect(s.worstDay?.pnl).toBeCloseTo(-55, 9);
  });

  it('averages over trading days, and the average times the days is the total', () => {
    const s = performanceStats(pts);
    expect(s.avgDailyPnl! * s.tradingDays).toBeCloseTo(s.totalPnl!, 9);
  });

  it('returns null rather than a filler when a metric cannot be computed', () => {
    const one = performanceStats(series([1000, 1100]));
    // A single return has no dispersion, so these are undefined, not zero.
    expect(one.volatilityPct).toBeNull();
    expect(one.sharpe).toBeNull();
    // No losing day means the profit/loss ratio has no denominator.
    expect(one.profitLossRatio).toBeNull();
    expect(one.sortino).toBeNull();

    const none = performanceStats([]);
    expect(none.totalPnl).toBeNull();
    expect(none.roiPct).toBeNull();
    expect(none.bestDay).toBeNull();
    expect(none.tradingDays).toBe(0);
  });

  it('computes dispersion metrics when there is enough data', () => {
    const s = performanceStats(series([1000, 1100, 1045, 1150, 1120]));
    expect(s.volatilityPct).toBeGreaterThan(0);
    expect(Number.isFinite(s.sharpe!)).toBe(true);
    expect(Number.isFinite(s.sortino!)).toBe(true);
    expect(s.profitLossRatio).toBeGreaterThan(0);
  });

  it('carries the drawdown from the same series', () => {
    const s = performanceStats(series([100, 120, 90, 110]));
    expect(s.maxDrawdownPct).toBeCloseTo(-25, 9);
  });
});

describe('bucketBreakdown', () => {
  it('chains buckets so their PnLs sum to the window PnL', () => {
    const pts = series(Array.from({ length: 40 }, (_, i) => 1000 + i * 7 - (i % 5) * 11));
    for (const g of ['day', 'week', 'month'] as const) {
      const { buckets } = bucketBreakdown(pts, g);
      const sum = buckets.reduce((a, b) => a + b.pnl, 0);
      expect(sum).toBeCloseTo(pts[pts.length - 1].equity - pts[0].equity, 6);
    }
  });

  it('leaves no gap at the seams', () => {
    const { buckets } = bucketBreakdown(series(Array.from({ length: 30 }, (_, i) => 500 + i * 3)), 'week');
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i].startEquity).toBeCloseTo(buckets[i - 1].endEquity, 9);
    }
  });

  it('opens the first bucket on the window start, not on its own first day', () => {
    const pts = series([1000, 1010, 1020]);
    const { buckets } = bucketBreakdown(pts, 'day');
    expect(buckets[0].startEquity).toBe(1000);
    expect(buckets[0].pnl).toBeCloseTo(10, 9);
  });

  it('keeps the most recent rows and reports what it dropped', () => {
    const pts = series(Array.from({ length: 90 }, (_, i) => 1000 + i));
    const { buckets, truncated } = bucketBreakdown(pts, 'day', 30);
    expect(buckets).toHaveLength(30);
    expect(truncated).toBe(89 - 30);
    expect(buckets[buckets.length - 1].endDate).toBe(pts[pts.length - 1].date);
  });

  it('chooses granularity by window', () => {
    expect(granularityFor('7d')).toBe('day');
    expect(granularityFor('30d')).toBe('day');
    expect(granularityFor('90d')).toBe('week');
    expect(granularityFor('1y')).toBe('month');
    expect(granularityFor('all')).toBe('month');
  });

  it('has nothing to show for an empty window', () => {
    expect(bucketBreakdown([], 'day')).toEqual({ buckets: [], truncated: 0 });
  });
});

describe('the page and the compact Wallet card cannot disagree', () => {
  it('derives the same PnL and ROI the canonical period reports', () => {
    const raw: RawEquityDay[] = days(20).map((date, i) => ({
      date,
      totalValueUsd: 10_000 * (1 + i * 0.01),
      netFlowUsd: 0,
    }));
    const canonical = buildAdjustedSeries(raw);
    const period = computePeriod(canonical, '7d', new Date(`${days(20)[19]}T12:00:00.000Z`));
    const stats = performanceStats(period.points);
    expect(stats.totalPnl).toBeCloseTo(period.absolutePnl!, 6);
    expect(stats.roiPct).toBeCloseTo(period.percent!, 6);
    expect(stats.startEquity).toBeCloseTo(period.startEquity!, 6);
    expect(stats.endEquity).toBeCloseTo(period.endEquity!, 6);
  });
});
