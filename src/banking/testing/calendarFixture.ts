import { addCalendarMonthsClamped } from '../math';

/**
 * The calendar a Banking fixture runs on — TEST ONLY.
 *
 * Production counts a month as completed when `addCalendarMonthsClamped(openedAt, n)`
 * is not after "now" (math.ts: the day of month clamps to the target month's last day).
 * A fixture that dates a placement "n months ago" must use that same rule. The old
 * helper did `d.setUTCMonth(d.getUTCMonth() - n)`, which OVERFLOWS instead of clamping:
 * on 31 October "one month ago" became 31 September = 1 October, only 30 days back,
 * so a one-month placement had not completed its month and settled nothing (Issue #654).
 */

/** `BANKING_TEST_NOW` (an ISO instant) pins the clock; otherwise the real time. */
export function bankingFixtureNow(env: NodeJS.ProcessEnv = process.env): Date {
  const pinned = env.BANKING_TEST_NOW;
  if (!pinned) return new Date();
  const at = new Date(pinned);
  if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/.test(pinned) || !Number.isFinite(at.getTime()))
    throw new Error('BANKING_TEST_NOW must be an ISO date or UTC instant, e.g. 2026-10-31 or 2026-10-31T12:00:00Z');
  return at;
}

/** The opening instant exactly `n` completed calendar months before `now`, by production's rule. */
export const monthsBefore = (now: Date, n: number): Date => addCalendarMonthsClamped(now, -n);

/** `n` calendar months after `from`, clamped the way maturity dates are. */
export const monthsAfter = (from: Date, n: number): Date => addCalendarMonthsClamped(from, n);
