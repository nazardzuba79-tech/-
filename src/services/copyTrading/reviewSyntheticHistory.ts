import { advanceState } from './SyntheticCopyTradingEngine';
import { dayDiff, utcDay } from './analytics';
import { createCashflowMasterState } from './reviewMasterLedger';
import { populateReviewFollowers } from './reviewFollowerLedger';

/** Explicit review-only presentation migration boundary. No Prisma/accounts.
 * Pin the approved bootstrap so subsequent review builds append elapsed days
 * instead of shifting inception and recalibrating ALL on every deployment.
 * A new revision is an intentional synthetic scenario reset, not a live ledger.
 */
export const REVIEW_SYNTHETIC_BASELINE = '2026-09-05';
export const REVIEW_SYNTHETIC_STATE_ID = 'nazara-review-v7';

export function createReviewSyntheticState(now = new Date()) {
  let state = createCashflowMasterState();
  populateReviewFollowers(state);
  let remaining = dayDiff(REVIEW_SYNTHETIC_BASELINE, utcDay(now));
  if (remaining < 0) throw new Error('Review date precedes the approved synthetic baseline');
  while (remaining > 0) {
    const days = Math.min(remaining, 365);
    state = advanceState(state, days) as typeof state;
    remaining -= days;
  }
  state.mode = 'REAL_TIME';
  return state;
}
