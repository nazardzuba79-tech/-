import { advanceState } from './SyntheticCopyTradingEngine';
import { dayDiff, utcDay } from './analytics';
import { createSimpleReturnMasterState } from './reviewPerformanceV8';
import { createCashflowMasterState } from './reviewMasterLedger';
import { populateReviewFollowers } from './reviewFollowerLedger';
import type { CashflowReviewState } from './reviewEconomicsTypes';

/** Explicit review-only presentation migration boundary. No Prisma/accounts.
 * Pin the approved bootstrap so each UTC-date construction appends elapsed
 * days instead of shifting inception and recalibrating historical returns.
 * A new revision is an intentional synthetic scenario reset, not a live ledger.
 */
export const REVIEW_SYNTHETIC_BASELINE = '2026-09-05';
export const REVIEW_SYNTHETIC_STATE_ID = 'nazara-review-v8';
export const LEGACY_REVIEW_SYNTHETIC_STATE_ID = 'nazara-review-v7';

function completeReviewBootstrap<T extends CashflowReviewState>(state: T, now: Date): T {
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

export function createReviewSyntheticState(now = new Date()) {
  return completeReviewBootstrap(createSimpleReturnMasterState(), now);
}

/** Explicit compatibility constructor for preserved v7 histories/tests. It is
 * never selected by the current review bootstrap or a legacy production API. */
export function createLegacyV7ReviewSyntheticState(now = new Date()) {
  return completeReviewBootstrap(createCashflowMasterState(), now);
}
