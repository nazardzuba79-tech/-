/** Display precision only. Never round the reference price used for sizing or API payloads. */
const CFD_DECIMALS: Record<string, number> = { XAUUSD: 2, EURUSD: 5, GBPUSD: 5, USDJPY: 3, AUDUSD: 5, USDCAD: 5 };

export function formatCfdPrice(value: string | number | null, symbol: string): string {
  const price = Number(value);
  return Number.isFinite(price) && price > 0
    ? price.toLocaleString('en-US', { minimumFractionDigits: CFD_DECIMALS[symbol] ?? 5, maximumFractionDigits: CFD_DECIMALS[symbol] ?? 5 })
    : '—';
}

/** UI is advisory; the server repeats this gate inside each money transaction. */
export function canExecuteCfdQuote(q: {price: string | null; status?: string; stale?: boolean; executionAllowed?: boolean;
  providerTimestamp?: number | null; fetchedAt?: number | null; maxQuoteAgeMs?: number} | undefined, now = Date.now()): boolean {
  if (!q || q.executionAllowed !== true || q.status !== 'live' || q.stale !== false || q.price === null || !Number.isFinite(Number(q.price)) || Number(q.price) <= 0) return false;
  const age = q.maxQuoteAgeMs;
  return typeof age === 'number' && age >= 250 && age <= 10000 && [q.providerTimestamp,q.fetchedAt].every(t =>
    typeof t === 'number' && Number.isFinite(t) && t > 0 && t <= now + 1000 && now-t <= age);
}

/** Prefer the requested real listed instrument; never create a synthetic ticker.
 * Before the feed loads, use only known chart mappings. Once loaded the feed
 * is authoritative, including providers that return only part of the list.
 */
export function resolveCfdSymbol(requested: string, tickers: { symbol: string }[]): string {
  if (tickers.length) return tickers.some(t => t.symbol === requested) ? requested
    : tickers.find(t => t.symbol === 'XAUUSD')?.symbol ?? tickers[0].symbol;
  return Object.prototype.hasOwnProperty.call(CFD_DECIMALS, requested) ? requested : 'XAUUSD';
}
