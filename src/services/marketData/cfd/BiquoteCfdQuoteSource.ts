import { CFD_REFERENCE_CATALOG } from './catalog';
import { assertCfdFreshQuote, DEFAULT_MAX_QUOTE_AGE_MS, quoteAgeLimit, type CfdQuote, type CfdQuoteSource } from './CfdQuote';

export const BIQUOTE_CFD_SYMBOLS: Record<string,string> = {
  XAUUSD:'XAUUSD', XAGUSD:'XAGUSD', XPTUSD:'XPTUSD', XPDUSD:'XPDUSD',
  WTIUSD:'USOIL', XBRUSD:'UKOIL',
  EURUSD:'EURUSD', GBPUSD:'GBPUSD', USDJPY:'USDJPY', AUDUSD:'AUDUSD', USDCAD:'USDCAD', USDCHF:'USDCHF', NZDUSD:'NZDUSD',
};
const ALL = CFD_REFERENCE_CATALOG.map(i=>i.symbol);
const PROVIDER_TO_VOL = new Map(Object.entries(BIQUOTE_CFD_SYMBOLS).map(([v,p])=>[p,v]));

function positive(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
function timestampMs(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const at=Date.parse(value); return Number.isFinite(at) ? at : null;
}

export interface BiquoteOptions {
  now?:()=>number; maxQuoteAgeMs?:number; baseUrl?:string; fetchFn?:typeof fetch;
  entitledSymbols?:string[]; executionSymbols?:string[];
  /** Written permission / provider ticket / agreement reference. Not an API secret. */
  financialUseEvidence?:string;
  /** Exact-contract evidence for WTI/Brent/metals. Symbol is not enough. */
  contractEvidence?:Partial<Record<string,string>>;
  timeoutMs?:number;
}

/**
 * No-key live market-data adapter. Technical access is public, but VOLTEX
 * treats every row as non-executable unless BOTH financial-use rights and
 * exact-contract evidence are explicitly configured. This prevents a free
 * public quote from silently becoming a CFD execution oracle.
 */
export class BiquoteCfdQuoteSource implements CfdQuoteSource {
  readonly maxQuoteAgeMs:number;
  private readonly now:()=>number; private readonly baseUrl:string; private readonly fetchFn:typeof fetch;
  private readonly entitled:Set<string>; private readonly executable:Set<string>; private readonly rights:string;
  private readonly contractEvidence:Partial<Record<string,string>>; private readonly timeoutMs:number;
  private failures=new Map<string,{count:number,lastAt:number|null,lastReason:string|null}>();
  constructor(options:BiquoteOptions={}){
    this.now=options.now??(()=>Date.now()); this.maxQuoteAgeMs=quoteAgeLimit(options.maxQuoteAgeMs??DEFAULT_MAX_QUOTE_AGE_MS);
    this.baseUrl=(options.baseUrl??'https://biquote.io').replace(/\/$/,''); this.fetchFn=options.fetchFn??fetch;
    this.entitled=new Set(options.entitledSymbols??[]); this.executable=new Set(options.executionSymbols??[]);
    for(const s of [...this.entitled,...this.executable]) if(!ALL.includes(s)) throw new Error('Unverified biquote CFD symbol');
    this.rights=options.financialUseEvidence?.trim()??''; this.contractEvidence=options.contractEvidence??{};
    this.timeoutMs=Math.max(250,Math.min(5000,options.timeoutMs??1200));
  }
  isConfigured():boolean{return Boolean(this.rights)&&this.entitled.size>0;}
  private admitted(symbol:string):boolean{return Boolean(this.rights)&&this.entitled.has(symbol)&&Boolean(this.contractEvidence[symbol]?.trim());}
  private async one(symbol:string):Promise<CfdQuote>{
    const providerSymbol=BIQUOTE_CFD_SYMBOLS[symbol]; const receivedAt=this.now();
    if(!providerSymbol) return this.missing(symbol,'');
    let response:Response;
    try{response=await this.fetchFn(`${this.baseUrl}/api/${providerSymbol}?allowStale=false`,{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(this.timeoutMs)});}catch{this.fail(symbol,'network');return this.missing(symbol,providerSymbol);}
    if(!response.ok){this.fail(symbol,`http_${response.status}`);return this.missing(symbol,providerSymbol);}
    let raw:any; try{raw=await response.json();}catch{this.fail(symbol,'invalid_json');return this.missing(symbol,providerSymbol);}
    if(!raw||raw.symbol!==providerSymbol){this.fail(symbol,'identity');return this.missing(symbol,providerSymbol);}
    const bid=positive(raw.bid),ask=positive(raw.ask),mid=positive(raw.mid),at=timestampMs(raw.timestamp);
    const marketState=raw.marketState; const providerStale=raw.stale===true;
    const sane=bid!==null&&ask!==null&&mid!==null&&bid<=mid&&mid<=ask&&at!==null&&at<=receivedAt+1000;
    if(!sane){this.fail(symbol,'payload');return this.missing(symbol,providerSymbol);}
    const stale=providerStale||receivedAt-at!>this.maxQuoteAgeMs; const admitted=this.admitted(symbol);
    const closed=marketState==='closed';
    return {provider:'biquote',symbol,providerSymbol,bid,ask,mid,last:mid,lastDecimal:String(raw.mid),providerTimestamp:at,fetchedAt:receivedAt,
      stale,status:admitted?(closed?'market_closed':stale?'stale':'live'):'entitlement_required',referenceStatus:closed?'market_closed':stale?'stale':'available',
      entitlementVerified:admitted,executionAllowed:admitted&&!closed&&!stale&&this.executable.has(symbol),changePercent24h:typeof raw.dayDiffPercent==='number'&&Number.isFinite(raw.dayDiffPercent)?String(raw.dayDiffPercent):undefined};
  }
  private missing(symbol:string,providerSymbol:string):CfdQuote{return{provider:'biquote',symbol,providerSymbol,bid:null,ask:null,mid:null,last:null,providerTimestamp:null,fetchedAt:null,stale:false,status:'unavailable',referenceStatus:'unavailable',entitlementVerified:false,executionAllowed:false};}
  private fail(symbol:string,reason:string){const p=this.failures.get(symbol)??{count:0,lastAt:null,lastReason:null};this.failures.set(symbol,{count:p.count+1,lastAt:this.now(),lastReason:reason});}
  async getQuotes():Promise<CfdQuote[]>{return Promise.all(ALL.map(s=>this.one(s)));}
  async getFreshQuote(symbol:string):Promise<CfdQuote>{const q=await this.one(symbol);assertCfdFreshQuote(q,symbol,this.maxQuoteAgeMs,this.now());return q;}
  catalog(){return CFD_REFERENCE_CATALOG.map(i=>({...i,provider:'biquote',providerSymbol:BIQUOTE_CFD_SYMBOLS[i.symbol],entitlement:this.admitted(i.symbol)?'verified':'entitlement_required',executionAllowed:this.admitted(i.symbol)&&this.executable.has(i.symbol)}));}
  diagnostics(){return{provider:'biquote',publicNoAuth:true,financialUseEvidenceConfigured:Boolean(this.rights),configured:this.isConfigured(),contractEvidenceSymbols:Object.keys(this.contractEvidence).filter(s=>Boolean(this.contractEvidence[s]?.trim())).sort(),failures:Object.fromEntries(this.failures)};}
}
