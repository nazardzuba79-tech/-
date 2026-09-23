import { CFD_REFERENCE_CATALOG } from './catalog';
import { assertCfdFreshQuote, DEFAULT_MAX_QUOTE_AGE_MS, quoteAgeLimit, type CfdQuote, type CfdQuoteSource } from './CfdQuote';

export const BIQUOTE_CFD_SYMBOLS: Record<string,string> = {
  XAUUSD:'XAUUSD', XAGUSD:'XAGUSD', XPTUSD:'XPTUSD', XPDUSD:'XPDUSD',
  WTIUSD:'USOIL', XBRUSD:'UKOIL',
  EURUSD:'EURUSD', GBPUSD:'GBPUSD', USDJPY:'USDJPY', AUDUSD:'AUDUSD', USDCAD:'USDCAD', USDCHF:'USDCHF', NZDUSD:'NZDUSD',
};
const ALL = CFD_REFERENCE_CATALOG.map(i=>i.symbol);

function positive(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
function timestampMs(value: unknown): number | null {
  // BiQuote has returned both ISO timestamps with an explicit offset and
  // epoch timestamps over time. Identity, bid/ask sanity and future-time
  // rejection are checked separately below, so accepting those equivalent
  // timestamp encodings does not relax quote validity.
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e12 ? value * 1000 : value;
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const n=Number(value); if(!Number.isFinite(n)||n<=0)return null; return n < 1e12 ? n * 1000 : n;
  }
  const at=Date.parse(value); return Number.isFinite(at) ? at : null;
}

export interface BiquoteOptions {
  now?:()=>number; maxQuoteAgeMs?:number; baseUrl?:string; fetchFn?:typeof fetch;
  entitledSymbols?:string[]; executionSymbols?:string[];
  financialUseEvidence?:string;
  contractEvidence?:Partial<Record<string,string>>;
  timeoutMs?:number;
  cacheMs?:number;
}

/** Public/no-key technical feed. Financial use remains separately admitted. */
export class BiquoteCfdQuoteSource implements CfdQuoteSource {
  readonly maxQuoteAgeMs:number;
  private readonly now:()=>number; private readonly baseUrl:string; private readonly fetchFn:typeof fetch;
  private readonly entitled:Set<string>; private readonly executable:Set<string>; private readonly rights:string;
  private readonly contractEvidence:Partial<Record<string,string>>; private readonly timeoutMs:number; private readonly cacheMs:number;
  private failures=new Map<string,{count:number,lastAt:number|null,lastReason:string|null}>();
  private cache:CfdQuote[]=[]; private cacheAt=-Infinity; private inFlight:Promise<CfdQuote[]>|null=null; private requests=0;
  constructor(options:BiquoteOptions={}){
    this.now=options.now??(()=>Date.now()); this.maxQuoteAgeMs=quoteAgeLimit(options.maxQuoteAgeMs??DEFAULT_MAX_QUOTE_AGE_MS);
    this.baseUrl=(options.baseUrl??'https://biquote.io').replace(/\/$/,''); this.fetchFn=options.fetchFn??fetch;
    this.entitled=new Set(options.entitledSymbols??[]); this.executable=new Set(options.executionSymbols??[]);
    for(const s of [...this.entitled,...this.executable]) if(!ALL.includes(s)) throw new Error('Unverified biquote CFD symbol');
    this.rights=options.financialUseEvidence?.trim()??''; this.contractEvidence=options.contractEvidence??{};
    this.timeoutMs=Math.max(250,Math.min(5000,options.timeoutMs??1200)); this.cacheMs=Math.max(250,Math.min(5000,options.cacheMs??1000));
  }
  isConfigured():boolean{return Boolean(this.rights)&&this.entitled.size>0;}
  private admitted(symbol:string):boolean{return Boolean(this.rights)&&this.entitled.has(symbol)&&Boolean(this.contractEvidence[symbol]?.trim());}
  private parse(symbol:string,raw:any,receivedAt:number):CfdQuote{
    const providerSymbol=BIQUOTE_CFD_SYMBOLS[symbol];
    if(!raw||raw.symbol!==providerSymbol){this.fail(symbol,'identity');return this.missing(symbol,providerSymbol);}
    const bid=positive(raw.bid),ask=positive(raw.ask),mid=positive(raw.mid),at=timestampMs(raw.timestamp);
    const marketState=raw.marketState; const providerStale=raw.stale===true;
    const sane=bid!==null&&ask!==null&&mid!==null&&bid<=mid&&mid<=ask&&at!==null&&at<=receivedAt+1000;
    if(!sane){this.fail(symbol,'payload');return this.missing(symbol,providerSymbol);}
    const stale=providerStale||receivedAt-at!>this.maxQuoteAgeMs; const admitted=this.admitted(symbol); const closed=marketState==='closed';
    return {provider:'biquote',symbol,providerSymbol,bid,ask,mid,last:mid,providerTimestamp:at,fetchedAt:receivedAt,
      stale,status:admitted?(closed?'market_closed':stale?'stale':'live'):'entitlement_required',referenceStatus:closed?'market_closed':stale?'stale':'available',
      entitlementVerified:admitted,executionAllowed:admitted&&!closed&&!stale&&this.executable.has(symbol),changePercent24h:typeof raw.dayDiffPercent==='number'&&Number.isFinite(raw.dayDiffPercent)?String(raw.dayDiffPercent):undefined};
  }
  private async refresh():Promise<CfdQuote[]>{
    const now=this.now(); if(this.cache.length&&now-this.cacheAt<=this.cacheMs)return this.cache.map(q=>({...q}));
    if(this.inFlight)return this.inFlight.then(rows=>rows.map(q=>({...q})));
    const run=(async()=>{
      const receivedAt=this.now(); const url=new URL(`${this.baseUrl}/api/latest`);
      for(const symbol of ALL)url.searchParams.append('symbols',BIQUOTE_CFD_SYMBOLS[symbol]);
      let response:Response; this.requests++;
      try{
        response=await this.fetchFn(url.toString(),{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(this.timeoutMs)});
      }catch{
        for(const s of ALL)this.fail(s,'network'); return this.cache.length?this.cache.map(q=>({...q})):ALL.map(s=>this.missing(s,BIQUOTE_CFD_SYMBOLS[s]));
      }
      if(!response.ok){for(const s of ALL)this.fail(s,`http_${response.status}`);await response.body?.cancel();return this.cache.length?this.cache.map(q=>({...q})):ALL.map(s=>this.missing(s,BIQUOTE_CFD_SYMBOLS[s]));}
      let text:string;try{text=await response.text();}catch{for(const s of ALL)this.fail(s,'body');return this.cache.length?this.cache.map(q=>({...q})):ALL.map(s=>this.missing(s,BIQUOTE_CFD_SYMBOLS[s]));}
      if(text.length>512_000){for(const s of ALL)this.fail(s,'body_limit');return this.cache.length?this.cache.map(q=>({...q})):ALL.map(s=>this.missing(s,BIQUOTE_CFD_SYMBOLS[s]));}
      let raw:any;try{raw=JSON.parse(text);}catch{for(const s of ALL)this.fail(s,'invalid_json');return this.cache.length?this.cache.map(q=>({...q})):ALL.map(s=>this.missing(s,BIQUOTE_CFD_SYMBOLS[s]));}
      if(!raw||typeof raw!=='object'||Array.isArray(raw)){for(const s of ALL)this.fail(s,'batch_shape');return this.cache.length?this.cache.map(q=>({...q})):ALL.map(s=>this.missing(s,BIQUOTE_CFD_SYMBOLS[s]));}
      const rows=ALL.map(symbol=>this.parse(symbol,raw[BIQUOTE_CFD_SYMBOLS[symbol]],receivedAt));
      this.cache=rows.map(q=>({...q}));this.cacheAt=receivedAt;return rows;
    })();
    this.inFlight=run.finally(()=>{this.inFlight=null;});
    return this.inFlight.then(rows=>rows.map(q=>({...q})));
  }
  private missing(symbol:string,providerSymbol:string):CfdQuote{return{provider:'biquote',symbol,providerSymbol,bid:null,ask:null,mid:null,last:null,providerTimestamp:null,fetchedAt:null,stale:false,status:'unavailable',referenceStatus:'unavailable',entitlementVerified:false,executionAllowed:false};}
  private fail(symbol:string,reason:string){const p=this.failures.get(symbol)??{count:0,lastAt:null,lastReason:null};this.failures.set(symbol,{count:p.count+1,lastAt:this.now(),lastReason:reason});}
  async getQuotes():Promise<CfdQuote[]>{return this.refresh();}
  async getFreshQuote(symbol:string):Promise<CfdQuote>{const q=(await this.refresh()).find(q=>q.symbol===symbol);assertCfdFreshQuote(q,symbol,this.maxQuoteAgeMs,this.now());return q!;}
  catalog(){return CFD_REFERENCE_CATALOG.map(i=>({...i,provider:'biquote',providerSymbol:BIQUOTE_CFD_SYMBOLS[i.symbol],entitlement:this.admitted(i.symbol)?'verified':'entitlement_required',executionAllowed:this.admitted(i.symbol)&&this.executable.has(i.symbol)}));}
  diagnostics(){return{provider:'biquote',publicNoAuth:true,financialUseEvidenceConfigured:Boolean(this.rights),configured:this.isConfigured(),cacheMs:this.cacheMs,requests:this.requests,cacheAt:Number.isFinite(this.cacheAt)?this.cacheAt:null,contractEvidenceSymbols:Object.keys(this.contractEvidence).filter(s=>Boolean(this.contractEvidence[s]?.trim())).sort(),failures:Object.fromEntries(this.failures)};}
}
