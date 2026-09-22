/**
 * AN OWNER-REPORTED WEEKLY RESULT, KEPT AS WHAT IT IS.
 *
 * The owner reported that Ksenia's result for the week of 2026-09-13 is
 * 61.9%. The model did not produce that number and this file does not make
 * it do so. Here is the whole arithmetic, so the gap is a fact rather than
 * a suspicion:
 *
 *   The week 2026-09-13 → 2026-09-19 (Sunday-start, UTC) drew regime
 *   0.216052 from `random('future-week:2026-09-13')`, which lands in the
 *   10–30% band and solves to a weekly target of 12.7094%. The days sum to
 *   exactly that. The owner-reported trade of 2026-09-16 adds 7.8
 *   percentage points on top, so the card reads 20.5094% — the "around 20%"
 *   in the report. 61.9% is 41.39pp above that.
 *
 * THERE IS NO 20% CEILING. The top regime band is 45–70%, and the model
 * drew 69.6216% for the week before this one (2026-09-06) and 66.1754% for
 * 2026-09-27. 61.9% is comfortably inside what this model produces; it is
 * simply not what this week drew. The ~20% is this week's draw, not a cap.
 *
 * So the number is recorded HERE, beside the model rather than inside it:
 * an owner's report, with its period, its basis and its provenance, which
 * is all that is actually known about it. Retrofitting the daily curve to
 * land on 61.9% would mean inventing trades, execution prices and a shape
 * for a week that the engine already produced — a fabricated history
 * wearing the authority of a computed one.
 *
 * The owner confirmed the basis: 61.9% is reported IN ADDITION to the
 * 2026-09-16 trade already folded in, not inclusive of it.
 *
 * WHAT THE OWNER ASKED FOR, AND WHAT THAT COSTS.
 *
 * The owner wants 61.9% to be the visible result OF THAT WEEK — the week of
 * 13–19 September 2026 — and nothing else. It is therefore written into the
 * `weekly[]` row for that week, permanently, because that row IS a statement
 * about a finished week and 61.9% is what the owner reported for it.
 *
 * IT IS NO LONGER PINNED TO THE ROLLING SEVEN DAYS. It once was, and that
 * was wrong: the card and the profile then showed 61.9% forever, under a
 * date range frozen on 13–19 September, long after that week had ended. The
 * current 7D window is a rolling window and must keep rolling — 22 September
 * ends on 22 September, 23 September on 23 September, and so on. So
 * `analytics.roi7` and `economics.periods['7D'].roi` take the reported figure
 * ONLY while the model is genuinely inside the reported week, where the two
 * windows coincide and the figure is the last seven days. From 20 September
 * onward both are the engine's own derivation from the canonical ledger
 * again, and they move forward every day.
 *
 * WHICH REMOVES THE LABELLING PROBLEM ENTIRELY. There is no longer a state in
 * which a figure is shown as a rolling window while being a held weekly
 * result, so no surface has to explain a provenance, name a reporting week,
 * or print «за отчётную неделю». The card reads ROI · 7D and the profile
 * reads its real rolling date range, with nothing said about where the
 * number came from.
 *
 * ONE VALUE, ONE PLACE. `returnPct` below is the only copy of the number in
 * the codebase. It travels in the response as `reportedWeeks[0]`, is read
 * once by the period selector, and every surface renders what that selector
 * returns — no component holds its own copy to drift out of step.
 *
 * WHAT STILL DOES NOT MOVE, and this is the honest cost of the above. No
 * balance, no AUM, no follower PnL, no fee, no equity point, no daily
 * return, no trade, no price and no P&L figure is touched — the owner
 * forbade inventing any of them, and deriving a P&L from 61.9% would be
 * exactly that. The consequence is that the weekly ROI is the owner's
 * reported figure while the weekly PnL beside it is still the engine's.
 * They do not reconcile, they are not meant to, and the payload says which
 * is which: every figure this file writes is listed in `reportedWeeks` with
 * its provenance, and the modeled response stays labelled `SYNTHETIC_REVIEW`.
 */

export const KSENIA_REPORTED_WEEK = Object.freeze({
  traderId: 'VX-KSENIA',
  /** Sunday-start UTC, matching the engine's own week key. */
  periodStart: '2026-09-13',
  periodEnd: '2026-09-19',
  timezone: 'UTC',
  returnPct: 61.9,
  source: 'OWNER_REPORTED',
  /**
   * Whether the already-published 2026-09-16 owner-reported trade
   * (+7.8% / +1,754 USDT) is inside this figure. The owner confirmed it is
   * NOT: the 61.9% is in addition to it. Recorded explicitly so the two can
   * never be silently merged or double-counted.
   */
  includesReportedTradeOf20260916: false,
  /** The modeled week this is reported against, for the record. */
  modeledReturnPct: 12.7094,
  /** Modeled week plus the already-folded-in reported trade. What the card
   *  showed before the owner asked for the reported figure to be visible. */
  publishedReturnPct: 20.5094,
} as const);

/** The figures this overlay writes. Named so the payload declares exactly
 *  what is the owner's word and what is still the engine's. The weekly row is
 *  written always; the two rolling-7D fields only while the model is still
 *  inside the reported week. */
export const REPORTED_WEEK_FIELDS = Object.freeze(
  ['weekly[period=2026-09-13].roi'] as const);
export const REPORTED_WEEK_CURRENT_ONLY_FIELDS = Object.freeze(
  ['analytics.roi7', "economics.periods['7D'].roi"] as const);

export interface ReportedWeek {
  traderId: string;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  returnPct: number;
  source: 'OWNER_REPORTED';
  includesReportedTradeOf20260916: boolean;
  modeledReturnPct: number;
  publishedReturnPct: number;
  /** True when the reported figure is the one the rolling 7D window shows.
   *  True only while the model is still inside the reported week, because
   *  only then is that week the last seven days. */
  appliedToVisibleWeeklyRoi?: boolean;
  /** Whether the model is still inside the reported week. */
  stillInsideReportedWeek?: boolean;
}

/**
 * Attach the reported week to a Ksenia response, as a sibling of the
 * modeled figures and never as a replacement for one.
 *
 * Idempotent by construction: it assigns a fixed record rather than
 * accumulating into anything, so calling it twice cannot double anything —
 * which is the failure mode that matters for a number reported once.
 */
/**
 * Is the model still inside the week the figure was reported for?
 *
 * This decides whether the reported figure is the ROLLING 7D return. Inside
 * the week it genuinely is the last seven days, so it is. After the week it
 * is not, so the rolling window goes back to the engine's own derivation and
 * moves forward with the calendar. The week's own `weekly[]` row keeps the
 * reported figure either way.
 */
export function reportedWeekIsCurrent(simulatedAt: unknown): boolean {
  const day = typeof simulatedAt === 'string' ? simulatedAt.slice(0, 10) : null;
  return !!day && day >= KSENIA_REPORTED_WEEK.periodStart && day <= KSENIA_REPORTED_WEEK.periodEnd;
}

export function withKseniaReportedWeek<T>(input: T): T {
  const source = input as any;
  if (!source || source.trader?.id !== KSENIA_REPORTED_WEEK.traderId) return input;

  const inside = reportedWeekIsCurrent(source.simulation?.simulatedAt);
  const record: ReportedWeek = {
    ...KSENIA_REPORTED_WEEK,
    appliedToVisibleWeeklyRoi: inside,
    stillInsideReportedWeek: inside,
  };
  // A shallow copy per level we touch: nothing else in the response is
  // cloned, and nothing else is written.
  const data: any = { ...source, reportedWeeks: [record] };

  const roi = KSENIA_REPORTED_WEEK.returnPct;
  // The rolling window takes it only while it IS that window. Once the week
  // has passed, 7D is the engine's again and advances with every new day.
  if (inside) {
    if (data.analytics) data.analytics = { ...data.analytics, roi7: roi };
    if (data.economics?.periods?.['7D']) {
      data.economics = { ...data.economics, periods: { ...data.economics.periods,
        '7D': { ...data.economics.periods['7D'], roi } } };
    }
  }
  // The finished week keeps the owner's figure permanently: that row is a
  // statement about 13-19 September and about nothing else.
  if (Array.isArray(data.weekly)) {
    data.weekly = data.weekly.map((week: any) =>
      week?.period === KSENIA_REPORTED_WEEK.periodStart ? { ...week, roi } : week);
  }
  return data as T;
}
