/**
 * ONE CLOSED TRADE PER STRATEGY PER UTC CALENDAR DAY.
 *
 * From the effective date onward, each new UTC day contributes exactly one
 * closed execution to Nazar and Ksenia. Existing published history before the
 * boundary is never rewritten. Same-day reads add nothing; missed days are
 * appended one-by-one by CopyPerformanceService, so N missed UTC days yield N
 * new closed trades.
 *
 * This rule changes execution COUNT only. It never invents or clips the
 * strategy day's return. If the strategy regime produced exactly 0%, that day
 * is represented by one real priced BREAKEVEN execution with 0 net PnL.
 */

/** The first UTC day on which a strategy day is exactly one closed trade. */
export const DAILY_PROGRESSION_EFFECTIVE_FROM = '2026-09-22';

/** ISO YYYY-MM-DD strings are zero-padded UTC dates, so lexical order is safe. */
export function dailyProgressionApplies(date: string): boolean {
  return date >= DAILY_PROGRESSION_EFFECTIVE_FROM;
}
