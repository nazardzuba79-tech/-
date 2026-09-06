export type SpotReturnPeriod = '24H' | '7D';
export type SpotPeriodReference = { price: number; time: number };
export type SpotPairReferences = { pair: string; day: SpotPeriodReference | null; week: SpotPeriodReference | null };
export type SpotPeriodReferencesResponse = { asOf: number; resolutionSeconds: number; references: SpotPairReferences[] };

/** Same native trading pair, rolling boundary, actual completed close.
 * Missing/expired references remain unavailable, never zero or a 24h proxy.
 * Timestamp validation also prevents old cached 7d data becoming an 8d return.
 */
export function spotPeriodReturn(lastPrice: string | number, reference: SpotPeriodReference | null | undefined, period: SpotReturnPeriod, asOf = Date.now()): number | null {
  const current = typeof lastPrice === 'string' && !lastPrice.trim() ? NaN : Number(lastPrice);
  const cutoff = asOf / 1000 - (period === '7D' ? 7 : 1) * 86400;
  if (!reference || !Number.isFinite(current) || current <= 0 || !Number.isFinite(reference.price) || reference.price <= 0
    || !Number.isFinite(reference.time) || reference.time > cutoff || cutoff - reference.time >= 900) return null;
  const change = (current / reference.price - 1) * 100;
  return Number.isFinite(change) ? change : null;
}
