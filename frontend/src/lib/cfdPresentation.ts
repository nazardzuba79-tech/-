/** Display precision only. Never round the reference price used for sizing or API payloads. */
export const CFD_DISPLAY_CATALOG = [
  {symbol:'XAUUSD', name:'Gold Spot', decimals:2, icon:'🥇'},
  {symbol:'XAGUSD', name:'Silver Spot', decimals:3, icon:'🥈'},
  {symbol:'XPTUSD', name:'Platinum Spot', decimals:2, icon:'⚪'},
  {symbol:'XPDUSD', name:'Palladium Spot', decimals:2, icon:'🔘'},
  {symbol:'WTIUSD', name:'Crude Oil WTI Spot', decimals:2, icon:'🛢️'},
  {symbol:'XBRUSD', name:'Brent Spot', decimals:2, icon:'🛢️'},
  {symbol:'EURUSD', name:'Euro vs US Dollar', decimals:5, icon:'💶'},
  {symbol:'GBPUSD', name:'British Pound vs US Dollar', decimals:5, icon:'💷'},
  {symbol:'USDJPY', name:'US Dollar vs Japanese Yen', decimals:3, icon:'💴'},
  {symbol:'AUDUSD', name:'Australian Dollar vs US Dollar', decimals:5, icon:'🇦🇺'},
  {symbol:'USDCAD', name:'US Dollar vs Canadian Dollar', decimals:5, icon:'🇨🇦'},
  {symbol:'USDCHF', name:'US Dollar vs Swiss Franc', decimals:5, icon:'🇨🇭'},
  {symbol:'NZDUSD', name:'New Zealand Dollar vs US Dollar', decimals:5, icon:'🇳🇿'},
];
const CFD_DECIMALS: Record<string, number> = Object.fromEntries(CFD_DISPLAY_CATALOG.map(i => [i.symbol,i.decimals]));

/** Static identities only: no price or execution permission is manufactured. */
export function completeCfdRows<T extends {symbol:string; name:string; price:string|null}>(rows:T[]) {
  return CFD_DISPLAY_CATALOG.map(i => rows.find(r => r.symbol === i.symbol) ?? {
    symbol:i.symbol, name:i.name, price:null, status:'unavailable', referenceStatus:'unavailable', stale:true, executionAllowed:false,
  });
}

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
