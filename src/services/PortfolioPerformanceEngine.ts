/**
 * One canonical equity series per account, and every period figure derived
 * from it.
 *
 * The rule this file exists to enforce: 7D, 30D, 90D, 1Y and all-time are
 * five *windows over one series*, never five independently computed
 * numbers. Returns compound — a 30-day return is not four weekly returns
 * added up — so a period is always `end / start - 1` on the same curve, and
 * the absolute PnL shown beside it is `end - start` on that same curve.
 * Percentage, money and chart therefore cannot disagree.
 *
 * The second rule: money moving *into* or *out of* an account is not
 * performance. A $10,000 deposit is not a profit and a withdrawal is not a
 * loss, and an internal Spot <-> Futures transfer is neither (it never
 * changes the total, so it never reaches this file at all). Raw portfolio
 * value therefore cannot be used directly. What is used is the standard
 * time-weighted return: each day's return is measured after removing that
 * day's external flow, and the daily returns are chained into an index.
 *
 * The curve the UI plots is that index rescaled to end at the account's real
 * current value ("adjusted equity"), so the chart is denominated in dollars
 * the user recognises while still excluding their own deposits from the
 * slope.
 */

/** A day on the canonical series. `date` is a UTC calendar day, YYYY-MM-DD. */
export interface PerformancePoint {
  date: string;
  /** Cash-flow-adjusted portfolio value in USD on that day. */
  equity: number;
}

export type PerformancePeriod = '7d' | '30d' | '90d' | '1y' | 'all';

export const PERFORMANCE_PERIODS: PerformancePeriod[] = ['7d', '30d', '90d', '1y', 'all'];

/** Window length in days. `all` spans whatever the series covers. */
const PERIOD_DAYS: Record<Exclude<PerformancePeriod, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

export interface PeriodPerformance {
  period: PerformancePeriod;
  /**
   * False when the series does not reach back far enough to cover the
   * window. The caller shows an honest "not enough history" state; it never
   * substitutes a shorter window's number, which would silently report a
   * 12-day return as a 30-day one.
   */
  available: boolean;
  startDate: string | null;
  endDate: string | null;
  startEquity: number | null;
  endEquity: number | null;
  /** endEquity - startEquity, in USD. Excludes deposits and withdrawals. */
  absolutePnl: number | null;
  /** (endEquity / startEquity - 1) * 100. */
  percent: number | null;
  /** The points inside the window, for the chart. */
  points: PerformancePoint[];
}

const MS_PER_DAY = 86_400_000;

export function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function dayKeyToDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** Whole UTC days between two day keys (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((dayKeyToDate(b).getTime() - dayKeyToDate(a).getTime()) / MS_PER_DAY);
}

/**
 * A day's raw portfolio value plus the net external money that moved that
 * day. `netFlowUsd` is positive for deposits in, negative for withdrawals
 * out. Internal transfers are not flows: they move value between two
 * wallets that this total already spans.
 */
export interface RawEquityDay {
  date: string;
  totalValueUsd: number;
  netFlowUsd: number;
}

/**
 * Chain daily time-weighted returns into an index, then rescale so the
 * curve ends at the account's real present value.
 *
 * Day t's return removes that day's flow before comparing to yesterday:
 *
 *     r(t) = (value(t) - flow(t)) / value(t-1) - 1
 *
 * so a day whose entire change was a deposit returns 0%.
 *
 * Days where the previous value was zero (a brand-new account's first
 * funding) contribute no return: there is no capital to have earned on.
 */
export function buildAdjustedSeries(days: RawEquityDay[]): PerformancePoint[] {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return [];

  const index: number[] = [1];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].totalValueUsd;
    const curr = sorted[i].totalValueUsd;
    const flow = sorted[i].netFlowUsd;
    // No prior capital, or a nonsensical value: carry the index flat rather
    // than manufacturing a return out of a divide-by-zero.
    const ratio = prev > 0 ? (curr - flow) / prev : 1;
    const safe = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
    index.push(index[i - 1] * safe);
  }

  const finalValue = sorted[sorted.length - 1].totalValueUsd;
  const finalIndex = index[index.length - 1];
  const scale = finalIndex > 0 ? finalValue / finalIndex : 0;

  return sorted.map((d, i) => ({ date: d.date, equity: index[i] * scale }));
}

/**
 * One window over one series. Everything the UI shows for a period comes
 * from here, which is what keeps percentage, money and chart in agreement.
 */
export function computePeriod(
  series: PerformancePoint[],
  period: PerformancePeriod,
  now: Date = new Date()
): PeriodPerformance {
  const empty: PeriodPerformance = {
    period,
    available: false,
    startDate: null,
    endDate: null,
    startEquity: null,
    endEquity: null,
    absolutePnl: null,
    percent: null,
    points: [],
  };
  if (series.length < 2) return empty;

  const endPoint = series[series.length - 1];
  const todayKey = utcDayKey(now);

  let startIdx: number;
  if (period === 'all') {
    startIdx = 0;
  } else {
    const windowStartMs = dayKeyToDate(todayKey).getTime() - PERIOD_DAYS[period] * MS_PER_DAY;
    const windowStartKey = utcDayKey(new Date(windowStartMs));
    // The window's opening equity is the last observation at or before the
    // window start — that is the capital the period actually began with.
    // If the series starts later than the window does, the account simply
    // has not existed that long.
    if (series[0].date > windowStartKey) return empty;
    startIdx = 0;
    for (let i = 0; i < series.length; i++) {
      if (series[i].date <= windowStartKey) startIdx = i;
      else break;
    }
  }

  const startPoint = series[startIdx];
  if (startIdx >= series.length - 1) return empty;
  if (!(startPoint.equity > 0)) return empty;

  return {
    period,
    available: true,
    startDate: startPoint.date,
    endDate: endPoint.date,
    startEquity: startPoint.equity,
    endEquity: endPoint.equity,
    absolutePnl: endPoint.equity - startPoint.equity,
    percent: (endPoint.equity / startPoint.equity - 1) * 100,
    points: series.slice(startIdx),
  };
}

/** Every period, from the one series. */
export function computeAllPeriods(
  series: PerformancePoint[],
  now: Date = new Date()
): Record<PerformancePeriod, PeriodPerformance> {
  const out = {} as Record<PerformancePeriod, PeriodPerformance>;
  for (const p of PERFORMANCE_PERIODS) out[p] = computePeriod(series, p, now);
  return out;
}

/** Whole days of history the series covers — what "all time" actually spans. */
export function seriesAgeDays(series: PerformancePoint[]): number {
  if (series.length < 2) return 0;
  return daysBetween(series[0].date, series[series.length - 1].date);
}
