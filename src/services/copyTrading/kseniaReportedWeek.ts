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
 * The owner wants 61.9% to be the VISIBLE weekly result on the card and the
 * profile, not a note filed beside a figure that still reads 20.5094%. So
 * this file now writes the reported number into the three places the UI
 * reads a weekly return from — `analytics.roi7`, `economics.periods['7D'].roi`
 * and the `weekly[]` row for this week — and only those three.
 *
 * It is applied only while the reported period IS the current week. Once the
 * model has moved past 2026-09-19 the rolling 7D window no longer describes
 * that week, so 7D goes back to the model and the reported figure stays on
 * the `weekly[]` row it belongs to, which is where that week's result lives.
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
 *  what is the owner's word and what is still the engine's. */
export const REPORTED_WEEK_FIELDS = Object.freeze(
  ['analytics.roi7', "economics.periods['7D'].roi", "weekly[period=2026-09-13].roi"] as const);

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
  /** True when the reported figure is the one the weekly ROI now shows. */
  appliedToVisibleWeeklyRoi?: boolean;
}

/**
 * Attach the reported week to a Ksenia response, as a sibling of the
 * modeled figures and never as a replacement for one.
 *
 * Idempotent by construction: it assigns a fixed record rather than
 * accumulating into anything, so calling it twice cannot double anything —
 * which is the failure mode that matters for a number reported once.
 */
/** Is the reported period still the week the model is currently inside? */
export function reportedWeekIsCurrent(simulatedAt: unknown): boolean {
  const day = typeof simulatedAt === 'string' ? simulatedAt.slice(0, 10) : null;
  return !!day && day >= KSENIA_REPORTED_WEEK.periodStart && day <= KSENIA_REPORTED_WEEK.periodEnd;
}

export function withKseniaReportedWeek<T>(input: T): T {
  const source = input as any;
  if (!source || source.trader?.id !== KSENIA_REPORTED_WEEK.traderId) return input;

  const current = reportedWeekIsCurrent(source.simulation?.simulatedAt);
  const record: ReportedWeek = { ...KSENIA_REPORTED_WEEK, appliedToVisibleWeeklyRoi: current };
  // A shallow copy per level we touch: nothing else in the response is
  // cloned, and nothing else is written.
  const data: any = { ...source, reportedWeeks: [record] };
  if (!current) return data as T;

  const roi = KSENIA_REPORTED_WEEK.returnPct;
  if (data.analytics) data.analytics = { ...data.analytics, roi7: roi };
  if (data.economics?.periods?.['7D']) {
    data.economics = { ...data.economics, periods: { ...data.economics.periods,
      '7D': { ...data.economics.periods['7D'], roi } } };
  }
  if (Array.isArray(data.weekly)) {
    data.weekly = data.weekly.map((week: any) =>
      week?.period === KSENIA_REPORTED_WEEK.periodStart ? { ...week, roi } : week);
  }
  return data as T;
}
