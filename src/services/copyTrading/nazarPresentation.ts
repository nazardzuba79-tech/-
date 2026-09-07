import { createDistributedNazarMasterState } from './canonical/reviewPerformanceV8';
import { populateReviewFollowers } from './canonical/reviewFollowerLedger';
import { advanceState, toResponse } from './canonical/SyntheticCopyTradingEngine';
import { dayDiff, utcDay } from './canonical/analytics';
import { REVIEW_PERFORMANCE_V8_CONFIG } from './canonical/reviewPerformanceV8Config';
import type { CashflowReviewState } from './canonical/reviewEconomicsTypes';

export const NAZAR_PRESENTATION_REVISION = 'nazar-distributed-sessions-v1';

/** Pure synthetic read model. The historical persistence constructor, stored
 * state, and automatic append process remain untouched. One replayed ledger
 * supplies master/follower trades, money, all ROI periods, risk and charts. */
export function createNazarPresentationState(asOf: Date): CashflowReviewState {
  let remaining = dayDiff(REVIEW_PERFORMANCE_V8_CONFIG.baseline, utcDay(asOf));
  if (!Number.isFinite(remaining) || remaining < 0) throw new Error('Presentation date precedes the canonical baseline');
  let state = createDistributedNazarMasterState();
  populateReviewFollowers(state);
  while (remaining > 0) {
    const days = Math.min(remaining, 365);
    state = advanceState(state, days) as CashflowReviewState;
    remaining -= days;
  }
  state.mode = 'REAL_TIME';
  return state;
}

export function nazarPresentationResponse(stored: CashflowReviewState) {
  if (stored.version !== 8 || stored.seed !== REVIEW_PERFORMANCE_V8_CONFIG.seed
      || stored.cashflow?.policy.methodology !== 'CASH_FLOW_ADJUSTED_SIMPLE_RETURN') {
    throw new Error('Nazar presentation requires its canonical synthetic source');
  }
  const state = createNazarPresentationState(new Date(stored.simulatedAt));
  return { ...toResponse(state), provenance: 'MODELED' as const,
    presentationRevision: NAZAR_PRESENTATION_REVISION };
}
