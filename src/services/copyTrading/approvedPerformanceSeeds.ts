import { createHash } from 'crypto';
import { KSENIA_REVIEW, kseniaReviewResponse } from './canonical/kseniaReview';
import type { CashflowReviewState } from './canonical/reviewEconomicsTypes';
import { publishedKseniaSeedBytes, PUBLISHED_KSENIA_DATE, PUBLISHED_KSENIA_RESPONSE_SHA256 } from './publishedPerformanceSeedBytes';
export { PUBLISHED_KSENIA_STATE_SHA256, PUBLISHED_KSENIA_RESPONSE_SHA256 } from './publishedPerformanceSeedBytes';
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

/** Exact immutable modeled ledger exported read-only from the reviewed state.
 * Historical JSONB transport had already rounded some numeric tail digits;
 * generating the original model again would not preserve that published state.
 * This seed includes those existing tokens, every trade and follower fee event.
 * Compression is packaging only; no math, normalization, re-fit or DB access.
 * Each call decodes a fresh independent object for a missing NEW namespace. */
export function loadPublishedKseniaState(): CashflowReviewState {
  const bytes = publishedKseniaSeedBytes();
  const state = JSON.parse(bytes.toString('utf8')) as CashflowReviewState;
  if (state.version !== 8 || state.seed !== KSENIA_REVIEW.seed
      || state.simulatedAt !== PUBLISHED_KSENIA_DATE
      || !state.cashflow || !Array.isArray(state.cashflow.copiedTrades)
      || !Array.isArray(state.cashflow.performanceFeeEvents)) {
    throw new Error('Published Ksenia state schema mismatch');
  }
  if (sha256(JSON.stringify(kseniaReviewResponse(state))) !== PUBLISHED_KSENIA_RESPONSE_SHA256) {
    throw new Error('Published Ksenia response no longer matches the approved history');
  }
  return state;
}
