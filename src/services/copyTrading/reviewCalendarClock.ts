import { advanceState, toResponse } from './SyntheticCopyTradingEngine';
import { dayDiff, utcDay } from './analytics';
import { createReviewSyntheticState } from './reviewSyntheticHistory';

/** Read-only review clock, not a production account service or scheduler.
 * A new UTC date appends complete synthetic calendar days. Immutable JSON is
 * cached per date; a process restart recreates exactly the same deterministic
 * history. No account writes, external market calls, or build-time-only clock.
 */
export function createReviewCalendarClock(now: () => Date = () => new Date()) {
  let state: ReturnType<typeof createReviewSyntheticState> | undefined;
  let date = '';
  let json = '';
  return {
    snapshot(): string {
      const today = utcDay(now());
      if (today === date) return json;
      if (!state || today < date) {
        // Clock rollback is deterministic as well; no persisted ledger is
        // rewritten. This cache is never an authoritative customer account.
        state = createReviewSyntheticState(new Date(`${today}T12:00:00Z`));
      } else {
        let remaining = dayDiff(date, today);
        while (remaining > 0) {
          const days = Math.min(365, remaining);
          state = advanceState(state, days) as typeof state;
          remaining -= days;
        }
        state.mode = 'REAL_TIME';
      }
      json = JSON.stringify(toResponse(state));
      date = today;
      return json;
    },
  };
}
