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
 * NOTHING DOWNSTREAM MOVES. No balance, no AUM, no follower PnL, no fee,
 * no ROI, no equity point and no daily return is touched by this file. The
 * modeled figures stay modeled and stay labelled `SYNTHETIC_REVIEW`.
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
  /** Modeled week plus the already-folded-in reported trade. */
  publishedReturnPct: 20.5094,
} as const);

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
}

/**
 * Attach the reported week to a Ksenia response, as a sibling of the
 * modeled figures and never as a replacement for one.
 *
 * Idempotent by construction: it assigns a fixed record rather than
 * accumulating into anything, so calling it twice cannot double anything —
 * which is the failure mode that matters for a number reported once.
 */
export function withKseniaReportedWeek<T>(input: T): T {
  const source = input as any;
  if (!source || source.trader?.id !== KSENIA_REPORTED_WEEK.traderId) return input;
  return { ...source, reportedWeeks: [{ ...KSENIA_REPORTED_WEEK }] as ReportedWeek[] } as T;
}
