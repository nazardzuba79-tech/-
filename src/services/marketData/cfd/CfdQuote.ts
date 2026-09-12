/** Dealer accounting deliberately continues to use the provider's single last
 * reference price. Bid/ask are carried as facts, never synthesized into a spread. */
export type CfdAvailability = 'live' | 'reference_only' | 'stale' | 'unavailable' | 'entitlement_required' | 'market_closed' | 'malformed';
export interface CfdQuote {
  provider: string; symbol: string; providerSymbol: string;
  bid: number | null; ask: number | null; last: number | null; mid: number | null;
  /** Exact provider decimal for BigNumber accounting; never round through binary float. */
  lastDecimal?: string;
  providerTimestamp: number | null; fetchedAt: number | null;
  stale: boolean; status: CfdAvailability;
  /** Display freshness is independent of the strict execution age gate. */
  referenceStatus?: 'available' | 'stale' | 'unavailable' | 'market_closed';
  /** Verified provider entitlement, required independently of reported status. */
  entitlementVerified: boolean;
  /** Approval for NEW positions only; never gates closing or risk management. */
  executionAllowed: boolean;
  changePercent24h?: string;
}
export interface CfdQuoteSource {
  isConfigured(): boolean;
  readonly maxQuoteAgeMs: number;
  getQuotes(): Promise<CfdQuote[]>;
  /** Fresh entitled quote, regardless of whether new positions are enabled. */
  getFreshQuote(symbol: string): Promise<CfdQuote>;
}
export class CfdQuoteUnavailable extends Error {
  readonly code = 'cfd_quote_temporarily_unavailable';
  constructor(readonly reason: string) { super(`CFD price temporarily unavailable: ${reason}`); }
}
export const DEFAULT_MAX_QUOTE_AGE_MS = 5_000;
export function quoteAgeLimit(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 250 || n > 10_000) throw new Error('CFD_MAX_QUOTE_AGE_MS must be between 250 and 10000');
  return n;
}
/** Shared risk gate for CLOSE, LIQUIDATION and marking existing positions. */
export function assertCfdFreshQuote(quote: CfdQuote | undefined, symbol: string, maxAgeMs: number, now = Date.now()): number | string {
  quoteAgeLimit(maxAgeMs);
  if (!quote || quote.symbol !== symbol || quote.entitlementVerified !== true || quote.status !== 'live' || quote.stale !== false) throw new CfdQuoteUnavailable('unavailable_or_stale');
  for (const time of [quote.fetchedAt, quote.providerTimestamp]) {
    if (time === null || !Number.isFinite(time) || time <= 0 || time > now + 1_000 || now - time > maxAgeMs) throw new CfdQuoteUnavailable('quote_age');
  }
  if (quote.last === null || !Number.isFinite(quote.last) || quote.last <= 0) throw new CfdQuoteUnavailable('malformed_price');
  if (quote.lastDecimal !== undefined) {
    if (typeof quote.lastDecimal !== 'string' || !/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(quote.lastDecimal)
      || Number(quote.lastDecimal) !== quote.last) throw new CfdQuoteUnavailable('malformed_price');
    return quote.lastDecimal;
  }
  return quote.last;
}

/** OPEN adds the operator's new-position approval to the unchanged risk gate. */
export function assertCfdOpenQuote(quote: CfdQuote | undefined, symbol: string, maxAgeMs: number, now = Date.now()): number | string {
  const price = assertCfdFreshQuote(quote, symbol, maxAgeMs, now);
  if (quote!.executionAllowed !== true) throw new CfdQuoteUnavailable('new_positions_disabled');
  return price;
}
