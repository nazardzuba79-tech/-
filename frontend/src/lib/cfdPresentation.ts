import { cfdMarketCopy } from './cfdDisplayCopy';
export { ageCfdTickerRows } from './cfdTickerFreshness';
export { cfdMarketCopy } from './cfdDisplayCopy';

const CFD_DECIMALS: Record<string, number> = {
  XAUUSD:2,XAGUSD:3,XPTUSD:2,XPDUSD:2,WTIUSD:3,XBRUSD:3,
  EURUSD:5,GBPUSD:5,USDJPY:3,AUDUSD:5,USDCAD:5,USDCHF:5,NZDUSD:5,
};

/** Price currency, distinct from the account's collateral currency. */
export function cfdQuoteCurrency(symbol: string): string {
  return Object.prototype.hasOwnProperty.call(CFD_DECIMALS, symbol) ? symbol.slice(-3) : '—';
}

export function formatCfdPrice(value:string|number|null,symbol:string):string{
  if(value===null||value===''||!Number.isFinite(Number(value)))return '—';
  const price=Number(value);if(price<=0)return '—';
  const digits=CFD_DECIMALS[symbol]??5;
  return price.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits});
}

export function formatCfdAsOf(value:number|null|undefined):string{
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0)return '';
  const d=new Date(value);if(Number.isNaN(d.getTime()))return '';
  return d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC';
}

export function cfdDisplayState(q:{price:string|null;status?:string;stale?:boolean;asOf?:number|null}|undefined,lang='en'):{label:string;tone:'live'|'closed'|'stale'|'off'}{
  const copy=cfdMarketCopy(lang);
  if(!q||q.price===null)return{label:copy.priceUnavailable,tone:'off'};
  const time=formatCfdAsOf(q.asOf);
  if(q.status==='market_closed')return{label:`${copy.marketClosed}${time?` · ${time}`:''}`,tone:'closed'};
  if(q.stale===true||q.status==='stale')return{label:`${copy.lastQuote}${time?` · ${time}`:''}`,tone:'stale'};
  return{label:`${copy.live}${time?` · ${time}`:''}`,tone:'live'};
}

/** Kept for old financial components, even though the visible CFD surface is read-only. */
export function canExecuteCfdQuote(q:{price:string|null;status?:string;stale?:boolean;executionAllowed?:boolean;displayOnly?:boolean;providerTimestamp?:number|null;fetchedAt?:number|null;maxQuoteAgeMs?:number}|undefined,now=Date.now()):boolean{
  if(!q||q.displayOnly===true||q.executionAllowed!==true||q.status!=='live'||q.stale!==false||q.price===null||!Number.isFinite(Number(q.price))||Number(q.price)<=0)return false;
  const age=q.maxQuoteAgeMs;
  return typeof age==='number'&&age>=250&&age<=10000&&[q.providerTimestamp,q.fetchedAt].every(t=>typeof t==='number'&&Number.isFinite(t)&&t>0&&t<=now+1000&&now-t<=age);
}

export function resolveCfdSymbol(requested:string,tickers:{symbol:string}[]):string{
  if(tickers.length)return tickers.some(t=>t.symbol===requested)?requested:tickers.find(t=>t.symbol==='XAUUSD')?.symbol??tickers[0].symbol;
  return Object.prototype.hasOwnProperty.call(CFD_DECIMALS,requested)?requested:'XAUUSD';
}
