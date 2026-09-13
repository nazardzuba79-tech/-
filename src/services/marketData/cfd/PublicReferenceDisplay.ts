import { referenceDecimal, type PublicReferenceView } from './PublicReferenceFeed';
interface PrimaryQuote {
  symbol: string; provider: string; last: number | null; lastDecimal?: string;
  status: string; stale: boolean; referenceStatus?: string;
  providerTimestamp: number | null; fetchedAt: number | null; executionAllowed: boolean;
  entitlementVerified?: boolean; changePercent24h?: string;
}
const providerName = (provider: string) => provider === 'biquote' ? 'BiQuote' : provider === 'deriv' ? 'Deriv'
  : provider === 'twelvedata' ? 'Twelve Data' : provider;
/** PUBLIC SERIALIZER ONLY. Never pass these rows to a financial consumer.
 * The primary executable quote stays in CfdMarketDataService unchanged.
 * Fallbacks use distinct benchmark identities; they are not price consensus.
 */
export function publicReferenceDisplay<Q extends PrimaryQuote>(q: Q, name: string,
  fallback: PublicReferenceView | undefined, maxQuoteAgeMs: number, now = Date.now()) {
  const primaryPrice = q.last === null ? null : referenceDecimal(q.lastDecimal ?? q.last);
  const primaryFresh = primaryPrice !== null && ['available', 'market_closed'].includes(q.referenceStatus ?? '')
    && typeof q.fetchedAt === 'number' && q.fetchedAt <= now + 1000 && now - q.fetchedAt <= 120_000
    && (q.providerTimestamp === null || q.providerTimestamp <= now + 1000 && now - q.providerTimestamp <= 120_000);
  const fallbackTime = fallback?.sourceTimestamp ?? (fallback?.observationDate ? Date.parse(`${fallback.observationDate}T00:00:00Z`) : -Infinity);
  const fallbackUsable = fallback !== undefined && fallback.symbol === q.symbol && referenceDecimal(fallback.priceDecimal) !== null
    && Number.isFinite(fallbackTime) && fallbackTime > 0 && fallbackTime <= now + 1000 && now - fallbackTime <= 30 * 86_400_000
    && Number.isFinite(fallback.receivedAt) && fallback.receivedAt > 0 && fallback.receivedAt <= now + 1000
    && Number.isFinite(fallback.validUntil);
  const fallbackFresh = fallbackUsable && fallback.status === 'available' && now <= fallback.validUntil;
  // A newer recent primary history beats older fallback history. A current daily
  // benchmark is a different, explicitly labelled reference, never an execution quote.
  if (!primaryFresh && fallbackUsable && (fallbackFresh || primaryPrice === null || fallbackTime > (q.providerTimestamp ?? -Infinity))) {
    const basis = fallback.provider === 'eia'
      ? `${fallback.symbol === 'WTIUSD' ? 'WTI Cushing' : 'Brent Europe'} · USD/barrel`
      : fallback.unit === 'provider_native_quote' ? `${fallback.currency} · unit unverified`
      : `${fallback.currency}/${fallback.unit}`;
    const label = [fallbackFresh ? '' : 'Last known', fallback.kind === 'daily_reference' ? 'Daily reference' : 'Indicative',
      fallback.attribution, fallback.observationDate ?? new Date(fallback.sourceTimestamp!).toISOString(), basis,
      fallback.derivation ? 'calculated cross rate' : ''].filter(Boolean).join(' · ');
    return { ...q, name, price: fallback.priceDecimal, last: null, lastDecimal: undefined, bid: null, ask: null, mid: null,
      provider: fallback.provider, providerSymbol: fallback.providerSymbol,
      status: fallbackFresh ? 'reference_only' : 'stale', stale: !fallbackFresh,
      referenceStatus: fallbackFresh ? 'available' : 'stale', executionAllowed: false, entitlementVerified: false,
      providerTimestamp: fallback.sourceTimestamp, fetchedAt: fallback.receivedAt, maxQuoteAgeMs,
      changePercent24h: undefined, referenceLabel: label, referenceKind: fallback.kind,
      referenceContract: fallback.contract, referenceUnit: fallback.unit, referenceCurrency: fallback.currency,
      referenceValidUntil: fallback.validUntil, observationDate: fallback.observationDate,
      referenceDerivation: fallback.derivation, displayOnly: true };
  }
  // Public/no-key display sources are allowed to keep the UI informative, but
  // the serializer makes their non-financial nature explicit and the client
  // independently refuses to submit orders from displayOnly rows.
  if (primaryFresh && q.entitlementVerified !== true) {
    const when = q.providerTimestamp === null ? null : new Date(q.providerTimestamp).toISOString();
    const closed = q.referenceStatus === 'market_closed';
    return { ...q, name, price: primaryPrice, maxQuoteAgeMs, status: closed ? 'market_closed' : 'reference_only',
      stale: false, executionAllowed: false, entitlementVerified: false, displayOnly: true,
      referenceLabel: [closed ? 'Market closed · Last known' : 'Live reference', providerName(q.provider), when].filter(Boolean).join(' · ') };
  }
  const label = primaryPrice !== null && !primaryFresh ? `Last known · ${providerName(q.provider)} · ${q.providerTimestamp === null || !Number.isFinite(q.providerTimestamp) ? 'source time unknown' : new Date(q.providerTimestamp).toISOString()}` : undefined;
  return { ...q, name, price: primaryPrice, maxQuoteAgeMs,
    ...(label ? { referenceLabel: label, executionAllowed: false, status: 'stale', stale: true,
      ...(q.entitlementVerified !== true ? { entitlementVerified:false, displayOnly:true } : {}) } : {}) };
}
/** Upper bound on additional latency; work remains single-flight in the feed.
 * Clear the timeout whichever branch wins, and consume every rejection. */
export async function waitForReferenceWork(work: Promise<unknown>, maxWaitMs = 1200): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([work.catch(() => undefined), new Promise<void>(resolve => { timer = setTimeout(resolve, maxWaitMs); })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
