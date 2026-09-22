/**
 * ONE CLOSED TRADE PER STRATEGY PER UTC CALENDAR DAY.
 *
 * The owner's rule for Nazar (VX-001) and Ksenia (VX-KSENIA) is a cadence,
 * not a figure: every new UTC calendar day adds EXACTLY ONE closed trade to
 * each strategy's ledger. Not zero — a quiet session used to emit no row at
 * all, so the newest trade could be days behind the chart. Not two — the
 * generators also emitted a second execution to hit a win-rate ratio or a
 * "mixed session", which made a day worth +2.
 *
 * WHY IT IS A DATE AND NOT A FLAG. The histories before this rule are
 * published: they are what the cards, the ROI windows and the QA evidence
 * already show. Rewriting them to one-a-day would restate a year of results,
 * which the owner explicitly forbade. So the rule starts on a date, the
 * generators keep their original behaviour strictly before it, and every day
 * from it onward is a single execution.
 *
 * WHERE IT IS APPLIED. In the two day-appenders, and only there:
 *   - canonical/reviewPerformanceV8.ts  → advanceSimpleReturnMasterState (Nazar)
 *   - canonical/kseniaReview.ts         → advanceKseniaReview (Ksenia)
 * Both already append one day at a time, so a three-day gap is three
 * appends and therefore exactly three new trades — the catch-up the owner
 * described falls out of the cadence rather than needing its own branch.
 *
 * WHAT IT DOES NOT DO. It does not add a day. The service appends only for
 * UTC days that have actually elapsed and refuses to regenerate a day it has
 * already stored (see CopyPerformanceService), so a second request on the
 * same day still adds nothing. And it does not invent a figure: the day's
 * return is the one the strategy's own weekly regime already drew. The only
 * substitution is for a session the regime left at exactly zero, which
 * cannot produce a closed trade at all — see `quietSessionReturn`.
 */

/** The first UTC day on which a strategy day is exactly one closed trade. */
export const DAILY_PROGRESSION_EFFECTIVE_FROM = '2026-09-22';

/** ISO `YYYY-MM-DD`, compared as a string because both are zero-padded UTC. */
export function dailyProgressionApplies(date: string): boolean {
  return date >= DAILY_PROGRESSION_EFFECTIVE_FROM;
}

/**
 * The most a single execution may be asked to earn in one session, as a
 * fraction of the operating capital at risk.
 *
 * A day that used to be split across several executions now sits in one, and
 * an execution's margin cannot exceed the capital behind it. These ceilings
 * are what each generator's own pricing model can actually reconcile:
 * Nazar's already caps planned sessions at 21.8%, and Ksenia's minimum
 * leverage of 3 with a 5.5% adverse-move budget tops out just above 16.5%.
 * A session drawn above the ceiling is capped, never redistributed onto
 * another day — no past day is touched to make room for a new one.
 */
export const DAILY_PROGRESSION_MAX_RETURN = { nazar: 0.218, ksenia: 0.15 } as const;

/**
 * A stand-in return for a session the weekly regime left at exactly zero.
 *
 * Zero PnL cannot be expressed as a closed trade with an entry and an exit,
 * and a breakeven row is not "1 new closed trade" in any sense the owner
 * would recognise. So a quiet session gets a small, deterministic, genuinely
 * positive return instead — derived from the date, so the same day always
 * produces the same value on every replay and in every process.
 */
export function quietSessionReturn(random: () => number): number {
  return Number((0.004 + random() * 0.015).toFixed(6));
}
