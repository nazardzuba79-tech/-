/**
 * VOLTEX FUNDING — THE OWNER'S STANDARD RATES (set 2026-10-16).
 *
 * At every 8h UTC settlement (00:00 / 08:00 / 16:00) each open position
 * settles a fixed signed fraction of its value (quantity × mark at the
 * boundary): a LONG pays 0.01% (−0.0001), a SHORT receives 0.04% (+0.0004).
 * The same directions as the original demo model (LONG −0.1% / SHORT +0.4%),
 * ten times smaller. It is VOLTEX's own model, not provider funding, and not
 * zero-sum between longs and shorts.
 *
 * One source for every account kind: the native demo engine (from its pinned
 * start, see private-trading/native/fundingModel.ts) and real futures
 * positions (futures/FundingRateService.ts). A settlement already made keeps
 * the terms it was made under; a different number is a new `version`, never
 * an edit of this one.
 */
export const VOLTEX_FUNDING = Object.freeze({
  version: 'VOLTEX_FIXED_V2',
  /** Signed fraction of position value per settlement: positive is credited, negative debited. */
  longCashflow: '-0.0001',
  shortCashflow: '0.0004',
});

export type VoltexFundingTerms = Readonly<{ version: string; longCashflow: string; shortCashflow: string }>;

/** The signed per-settlement fraction `side` settles (positive = credited, negative = debited). */
export function voltexFundingRate(terms: VoltexFundingTerms, side: 'LONG' | 'SHORT'): string {
  return side === 'LONG' ? terms.longCashflow : terms.shortCashflow;
}
