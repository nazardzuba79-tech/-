import {
  ADMIN_PROFILE_EMAIL,
  ADMIN_PROFILE_HOLDINGS,
  PROFILE_REFERENCE_DAY,
  PROFILE_START_DAY,
  adminEquityIndex,
  adminPerformanceSeries,
  hasAdminPortfolioProfile,
} from '../AdminPortfolioProfile';
import { computeAllPeriods, computePeriod, seriesAgeDays } from '../PortfolioPerformanceEngine';

const REFERENCE = new Date(`${PROFILE_REFERENCE_DAY}T12:00:00.000Z`);
const A_WEEK_LATER = new Date('2026-09-11T12:00:00.000Z');
/** Roughly the profile's own valuation; only the scale, never the returns. */
const VALUE = 67_750_000;

describe('admin portfolio profile — who gets it', () => {
  it('is refused to an ordinary user', () => {
    expect(hasAdminPortfolioProfile({ role: 'USER', email: ADMIN_PROFILE_EMAIL })).toBe(false);
  });

  it('is refused to a different admin', () => {
    expect(hasAdminPortfolioProfile({ role: 'ADMIN', email: 'someone.else@example.com' })).toBe(false);
  });

  it('is refused to an anonymous caller', () => {
    expect(hasAdminPortfolioProfile(null)).toBe(false);
    expect(hasAdminPortfolioProfile(undefined)).toBe(false);
  });

  it('needs BOTH the ADMIN role and the exact address', () => {
    expect(hasAdminPortfolioProfile({ role: 'ADMIN', email: ADMIN_PROFILE_EMAIL })).toBe(true);
  });

  it('normalizes case and surrounding whitespace on the address', () => {
    expect(hasAdminPortfolioProfile({ role: 'ADMIN', email: `  ${ADMIN_PROFILE_EMAIL.toUpperCase()} ` })).toBe(true);
  });

  it('does not accept an address that merely contains the profile address', () => {
    expect(hasAdminPortfolioProfile({ role: 'ADMIN', email: `x${ADMIN_PROFILE_EMAIL}` })).toBe(false);
    expect(hasAdminPortfolioProfile({ role: 'ADMIN', email: `${ADMIN_PROFILE_EMAIL}.attacker.example` })).toBe(false);
  });
});

describe('admin portfolio profile — holdings are quantities only', () => {
  it('carries no prices and no USD totals, so valuation must come from live market data', () => {
    for (const h of ADMIN_PROFILE_HOLDINGS) {
      expect(Object.keys(h).sort()).toEqual(['asset', 'quantity']);
      expect(Number(h.quantity)).toBeGreaterThan(0);
    }
  });

  it('lists exactly the six assets the profile is defined as holding', () => {
    expect(ADMIN_PROFILE_HOLDINGS.map((h) => `${h.asset}:${h.quantity}`)).toEqual([
      'BTC:271',
      'ETH:561',
      'XRP:1200000',
      'USDT:32726245',
      'USDC:1200000',
      'EUR:700000',
    ]);
  });
});

describe('admin performance series — reference-date anchors', () => {
  const series = adminPerformanceSeries(VALUE, REFERENCE);
  const periods = computeAllPeriods(series, REFERENCE);

  // A small tolerance only: the curve carries deliberate seeded texture
  // between anchors, but the anchors themselves are pinned exactly.
  const expectPercent = (actual: number | null, target: number) => {
    expect(actual).not.toBeNull();
    expect(Math.abs(actual! - target)).toBeLessThan(0.01);
  };

  it('starts on the profile start day', () => {
    expect(series[0].date).toBe(PROFILE_START_DAY);
  });

  it('spans roughly 14 months at the reference date', () => {
    const days = seriesAgeDays(series);
    expect(days).toBeGreaterThan(420);
    expect(days).toBeLessThan(435);
  });

  it('7D is +28%', () => expectPercent(periods['7d'].percent, 28));
  it('30D is +132%', () => expectPercent(periods['30d'].percent, 132));
  it('90D is +317%', () => expectPercent(periods['90d'].percent, 317));
  it('1Y is +1926%', () => expectPercent(periods['1y'].percent, 1926));
  it('all-time is +2115%', () => expectPercent(periods.all.percent, 2115));

  it('ends every period at the account’s present value', () => {
    for (const p of Object.values(periods)) expect(p.endEquity).toBeCloseTo(VALUE, 6);
  });

  it('agrees between percentage, absolute PnL and the plotted endpoints', () => {
    for (const p of Object.values(periods)) {
      expect(p.available).toBe(true);
      const first = p.points[0];
      const last = p.points[p.points.length - 1];
      expect(first.equity).toBeCloseTo(p.startEquity!, 6);
      expect(last.equity).toBeCloseTo(p.endEquity!, 6);
      expect(p.absolutePnl).toBeCloseTo(p.endEquity! - p.startEquity!, 6);
      expect(p.percent).toBeCloseTo((p.endEquity! / p.startEquity! - 1) * 100, 9);
    }
  });

  it('compounds rather than sums: 30D is not four 7D returns added up', () => {
    const weekly = periods['7d'].percent!;
    expect(periods['30d'].percent!).not.toBeCloseTo(weekly * 4, 0);
    // It is, however, exactly the ratio of its own window's endpoints.
    const p30 = periods['30d'];
    expect(p30.percent).toBeCloseTo((p30.endEquity! / p30.startEquity! - 1) * 100, 9);
  });

  it('is not a straight line — it contains losing days as well as winning ones', () => {
    const idx = adminEquityIndex(REFERENCE);
    const down = idx.filter((p, i) => i > 0 && p.index < idx[i - 1].index).length;
    expect(down).toBeGreaterThan(idx.length * 0.1);
    expect(down).toBeLessThan(idx.length * 0.6);
  });
});

describe('admin performance series — it moves with the calendar', () => {
  const atReference = computeAllPeriods(adminPerformanceSeries(VALUE, REFERENCE), REFERENCE);
  const laterSeries = adminPerformanceSeries(VALUE, A_WEEK_LATER);
  const aWeekLater = computeAllPeriods(laterSeries, A_WEEK_LATER);

  it('every window reports a different figure a week on', () => {
    for (const key of ['7d', '30d', '90d', '1y', 'all'] as const) {
      expect(Math.abs(aWeekLater[key].percent! - atReference[key].percent!)).toBeGreaterThan(0.5);
    }
  });

  it('still derives every window from the one series', () => {
    for (const p of Object.values(aWeekLater)) {
      expect(p.percent).toBeCloseTo((p.endEquity! / p.startEquity! - 1) * 100, 9);
      expect(p.absolutePnl).toBeCloseTo(p.endEquity! - p.startEquity!, 6);
    }
  });

  it('extends the history rather than rewriting it', () => {
    const before = adminEquityIndex(REFERENCE);
    const after = adminEquityIndex(A_WEEK_LATER);
    expect(after.length).toBe(before.length + 7);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it('keeps its long-run character positive', () => {
    expect(aWeekLater.all.percent!).toBeGreaterThan(500);
  });
});

describe('admin performance series — determinism', () => {
  it('produces the identical past however many times it is asked', () => {
    const a = adminEquityIndex(REFERENCE);
    const b = adminEquityIndex(REFERENCE);
    expect(a).toEqual(b);
  });

  it('does not depend on the time of day, only the calendar day', () => {
    const morning = adminEquityIndex(new Date(`${PROFILE_REFERENCE_DAY}T00:30:00.000Z`));
    const evening = adminEquityIndex(new Date(`${PROFILE_REFERENCE_DAY}T23:30:00.000Z`));
    expect(morning).toEqual(evening);
  });

  it('scales cleanly with the account valuation without changing any return', () => {
    const cheap = computePeriod(adminPerformanceSeries(1_000, REFERENCE), '30d', REFERENCE);
    const rich = computePeriod(adminPerformanceSeries(90_000_000, REFERENCE), '30d', REFERENCE);
    expect(cheap.percent).toBeCloseTo(rich.percent!, 9);
    expect(cheap.absolutePnl).not.toBeCloseTo(rich.absolutePnl!, 0);
  });

  it('has no history at all before the profile start day', () => {
    expect(adminEquityIndex(new Date('2025-06-01T12:00:00.000Z'))).toEqual([]);
  });
});
