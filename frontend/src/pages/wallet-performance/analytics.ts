/**
 * Everything the performance page shows, derived from ONE input: the
 * canonical adjusted-equity series the backend already serves at
 * `GET /wallet/performance`.
 *
 * This file deliberately contains no fetching, no sample data and no second
 * opinion about what the account earned. `PortfolioPerformanceEngine`
 * remains the single source of truth: it builds the time-weighted series
 * (see its own doc comment) and measures the five periods off it. What is
 * here is arithmetic *on top of* that series — daily deltas, drawdown,
 * dispersion — so every figure on the page traces back to the same curve
 * the compact Wallet card plots.
 *
 * Two consequences of that inheritance, and they are the reason this is
 * derived rather than recomputed:
 *
 * - The series is already cash-flow adjusted. A deposit raises the raw
 *   balance but is removed before the day's return is taken, so a funding
 *   day lands at ~0% here and cannot appear as a giant profit bar. The same
 *   holds in reverse for withdrawals. Internal Spot <-> Futures transfers
 *   never move the total at all, so they cannot reach this file.
 * - Daily PnL sums back to the period's PnL by construction: the deltas
 *   telescope, so `sum(daily.pnl) === endEquity - startEquity`. The
 *   histogram and the cumulative curve cannot disagree.
 *
 * Every metric that cannot be computed honestly returns `null` rather than
 * a filler value; the UI renders those as "not enough data".
 */

/** A day on the canonical series — the backend's `PerformancePoint`. */
export interface EquityPoint {
  date: string;
  equity: number;
}

export interface DailyPnl {
  date: string;
  /** equity(t) - equity(t-1), in USD. */
  pnl: number;
  /** (equity(t) / equity(t-1) - 1) * 100. */
  returnPct: number;
  /** Closing equity that day, so a tooltip can show the level too. */
  equity: number;
}

/**
 * A day is "flat" rather than a win or a loss when its return rounds to
 * nothing. Compared on the ratio, not on dollars: a cent of drift is
 * meaningful on a $40 account and pure noise on a $40M one.
 */
const FLAT_EPSILON = 1e-9;

/** Trading days per year used to annualise. Crypto does not close. */
const ANNUALISATION_DAYS = 365;

/**
 * Day-over-day change across the window.
 *
 * Returns one entry per *transition*, so a window of n points yields n-1
 * rows — the opening point is the capital the period started with, not a
 * day that earned anything.
 */
export function dailyPnlSeries(points: EquityPoint[]): DailyPnl[] {
  if (points.length < 2) return [];
  const out: DailyPnl[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].equity;
    const curr = points[i].equity;
    out.push({
      date: points[i].date,
      pnl: curr - prev,
      returnPct: prev > 0 ? (curr / prev - 1) * 100 : 0,
      equity: curr,
    });
  }
  return out;
}

export interface DrawdownPoint {
  date: string;
  equity: number;
  /** Highest equity seen at or before this day. */
  peak: number;
  /** (equity / peak - 1) * 100 — zero or negative, never positive. */
  drawdownPct: number;
}

export interface Drawdown {
  series: DrawdownPoint[];
  /** The deepest point, as a negative percentage. 0 when the curve never fell. */
  maxDrawdownPct: number | null;
  /** The same fall in dollars, peak to trough. Negative. */
  maxDrawdownUsd: number | null;
  peakDate: string | null;
  troughDate: string | null;
}

/**
 * Peak-to-trough decline on the same equity curve everything else uses.
 *
 * The running peak only ever rises, so the drawdown at each day is that
 * day's distance below the best level the account had reached by then —
 * the standard definition, and the one that stays honest when the curve
 * makes a new high mid-window.
 */
export function drawdown(points: EquityPoint[]): Drawdown {
  const empty: Drawdown = {
    series: [],
    maxDrawdownPct: null,
    maxDrawdownUsd: null,
    peakDate: null,
    troughDate: null,
  };
  if (points.length < 2) return empty;

  const series: DrawdownPoint[] = [];
  let peak = points[0].equity;
  let peakDate = points[0].date;
  let worstPct = 0;
  let worstUsd = 0;
  let worstPeakDate: string | null = null;
  let worstTroughDate: string | null = null;

  for (const p of points) {
    if (p.equity > peak) {
      peak = p.equity;
      peakDate = p.date;
    }
    const pct = peak > 0 ? (p.equity / peak - 1) * 100 : 0;
    series.push({ date: p.date, equity: p.equity, peak, drawdownPct: pct });
    if (pct < worstPct) {
      worstPct = pct;
      worstUsd = p.equity - peak;
      worstPeakDate = peakDate;
      worstTroughDate = p.date;
    }
  }

  return {
    series,
    maxDrawdownPct: worstPct,
    maxDrawdownUsd: worstUsd,
    peakDate: worstPeakDate,
    troughDate: worstTroughDate,
  };
}

export interface DayExtreme {
  date: string;
  pnl: number;
  returnPct: number;
}

export interface PerformanceStats {
  /** Points on the window, including the opening one. */
  observations: number;
  /** Days that actually earned or lost — one fewer than observations. */
  tradingDays: number;
  totalPnl: number | null;
  roiPct: number | null;
  startEquity: number | null;
  endEquity: number | null;
  profitableDays: number;
  losingDays: number;
  flatDays: number;
  /** Share of non-flat days that were up, in percent. */
  winRatePct: number | null;
  avgDailyPnl: number | null;
  bestDay: DayExtreme | null;
  worstDay: DayExtreme | null;
  maxDrawdownPct: number | null;
  maxDrawdownUsd: number | null;
  /** Annualised standard deviation of daily returns, in percent. */
  volatilityPct: number | null;
  sharpe: number | null;
  sortino: number | null;
  /** Gross gains divided by gross losses. Null when there were no losses. */
  profitLossRatio: number | null;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n-1). Undefined for fewer than two values. */
function stdev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs);
  const variance = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/**
 * Statistics for one window.
 *
 * Risk-free rate is taken as zero for Sharpe and Sortino. This deployment
 * carries no rate curve, and inventing one would quietly change every
 * number here; zero is the conventional, stated simplification rather than
 * a hidden guess.
 */
export function performanceStats(points: EquityPoint[]): PerformanceStats {
  const daily = dailyPnlSeries(points);
  const dd = drawdown(points);

  const base: PerformanceStats = {
    observations: points.length,
    tradingDays: daily.length,
    totalPnl: null,
    roiPct: null,
    startEquity: points.length > 0 ? points[0].equity : null,
    endEquity: points.length > 0 ? points[points.length - 1].equity : null,
    profitableDays: 0,
    losingDays: 0,
    flatDays: 0,
    winRatePct: null,
    avgDailyPnl: null,
    bestDay: null,
    worstDay: null,
    maxDrawdownPct: dd.maxDrawdownPct,
    maxDrawdownUsd: dd.maxDrawdownUsd,
    volatilityPct: null,
    sharpe: null,
    sortino: null,
    profitLossRatio: null,
  };
  if (daily.length === 0) return base;

  const start = points[0].equity;
  const end = points[points.length - 1].equity;

  let profitable = 0;
  let losing = 0;
  let flat = 0;
  let gains = 0;
  let losses = 0;
  let best = daily[0];
  let worst = daily[0];

  for (const d of daily) {
    const r = d.returnPct / 100;
    if (r > FLAT_EPSILON) {
      profitable++;
      gains += d.pnl;
    } else if (r < -FLAT_EPSILON) {
      losing++;
      losses += Math.abs(d.pnl);
    } else {
      flat++;
    }
    if (d.pnl > best.pnl) best = d;
    if (d.pnl < worst.pnl) worst = d;
  }

  const returns = daily.map((d) => d.returnPct / 100);
  const sd = stdev(returns);
  const avgReturn = mean(returns);
  // Downside deviation over the whole sample, not just the losing days:
  // the standard Sortino denominator treats an up day as zero downside
  // rather than dropping it, which would flatter a volatile account.
  const downside = Math.sqrt(mean(returns.map((r) => (r < 0 ? r * r : 0))));
  const decided = profitable + losing;

  return {
    ...base,
    totalPnl: end - start,
    roiPct: start > 0 ? (end / start - 1) * 100 : null,
    profitableDays: profitable,
    losingDays: losing,
    flatDays: flat,
    winRatePct: decided > 0 ? (profitable / decided) * 100 : null,
    avgDailyPnl: (end - start) / daily.length,
    bestDay: { date: best.date, pnl: best.pnl, returnPct: best.returnPct },
    worstDay: { date: worst.date, pnl: worst.pnl, returnPct: worst.returnPct },
    volatilityPct: sd === null ? null : sd * Math.sqrt(ANNUALISATION_DAYS) * 100,
    sharpe: sd === null || sd === 0 ? null : (avgReturn / sd) * Math.sqrt(ANNUALISATION_DAYS),
    sortino: downside > 0 ? (avgReturn / downside) * Math.sqrt(ANNUALISATION_DAYS) : null,
    profitLossRatio: losses > 0 ? gains / losses : null,
  };
}

export type Granularity = 'day' | 'week' | 'month';

export interface PeriodBucket {
  key: string;
  label: string;
  startDate: string;
  endDate: string;
  startEquity: number;
  endEquity: number;
  pnl: number;
  roiPct: number | null;
  bestDay: DayExtreme | null;
  worstDay: DayExtreme | null;
  days: number;
}

/** Monday-anchored ISO week key for a YYYY-MM-DD day. */
function weekKey(date: string): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function bucketKey(date: string, granularity: Granularity): string {
  if (granularity === 'day') return date;
  if (granularity === 'month') return date.slice(0, 7);
  return weekKey(date);
}

/**
 * Which row size reads well for a window. Ninety daily rows is a wall of
 * numbers nobody scans; twelve monthly ones on a week of history says
 * nothing. Chosen by window, not by row count.
 */
export function granularityFor(period: string): Granularity {
  if (period === '7d' || period === '30d') return 'day';
  if (period === '90d') return 'week';
  return 'month';
}

/**
 * Group the window into contiguous buckets.
 *
 * Each bucket opens at the equity the previous one closed at, so the
 * buckets chain: their PnLs sum to the window's PnL exactly, with no gap
 * at the seams and nothing counted twice.
 *
 * `maxRows` keeps a long history from rendering hundreds of rows; the most
 * recent buckets are the ones kept, and the caller is told how many were
 * dropped.
 */
export function bucketBreakdown(
  points: EquityPoint[],
  granularity: Granularity,
  maxRows = 60
): { buckets: PeriodBucket[]; truncated: number } {
  const daily = dailyPnlSeries(points);
  if (daily.length === 0) return { buckets: [], truncated: 0 };

  const buckets: PeriodBucket[] = [];
  let openEquity = points[0].equity;

  for (let i = 0; i < daily.length; i++) {
    const key = bucketKey(daily[i].date, granularity);
    const last = buckets[buckets.length - 1];
    if (!last || last.key !== key) {
      buckets.push({
        key,
        label: key,
        startDate: daily[i].date,
        endDate: daily[i].date,
        startEquity: openEquity,
        endEquity: daily[i].equity,
        pnl: 0,
        roiPct: null,
        bestDay: null,
        worstDay: null,
        days: 0,
      });
    }
    const b = buckets[buckets.length - 1];
    b.endDate = daily[i].date;
    b.endEquity = daily[i].equity;
    b.days++;
    const extreme: DayExtreme = { date: daily[i].date, pnl: daily[i].pnl, returnPct: daily[i].returnPct };
    if (!b.bestDay || extreme.pnl > b.bestDay.pnl) b.bestDay = extreme;
    if (!b.worstDay || extreme.pnl < b.worstDay.pnl) b.worstDay = extreme;
    openEquity = daily[i].equity;
  }

  for (const b of buckets) {
    b.pnl = b.endEquity - b.startEquity;
    b.roiPct = b.startEquity > 0 ? (b.endEquity / b.startEquity - 1) * 100 : null;
  }

  const truncated = Math.max(0, buckets.length - maxRows);
  return { buckets: truncated > 0 ? buckets.slice(-maxRows) : buckets, truncated };
}
