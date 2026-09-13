import { BIQUOTE_CFD_SYMBOLS } from './BiquoteCfdQuoteSource';
import { CFD_REFERENCE_CATALOG } from './catalog';

export const CFD_OHLC_INTERVALS=['1m','5m','15m','30m','1h','4h','1d'] as const;
export type CfdOhlcInterval=typeof CFD_OHLC_INTERVALS[number];
export interface CfdOhlcBar{openTime:number;open:number;high:number;low:number;close:number;volume:number|null;tickVolume:number|null;isOpen:boolean;}
export interface CfdOhlcSnapshot{symbol:string;providerSymbol:string;interval:CfdOhlcInterval;fetchedAt:number;bars:CfdOhlcBar[];source:'biquote';}

const canonical=new Set(CFD_REFERENCE_CATALOG.map(row=>row.symbol));
const positive=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)&&n>0?n:null;};
const nonNegative=(value:unknown)=>{const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;};

/** Public/no-key OHLC data used only for the visible CFD chart. */
export class BiquoteCfdOhlcSource{
  private readonly baseUrl:string;
  private readonly cache=new Map<string,{at:number;value:CfdOhlcSnapshot}>();
  private readonly inflight=new Map<string,Promise<CfdOhlcSnapshot>>();
  constructor(baseUrl='https://biquote.io',private readonly fetchFn:typeof fetch=fetch,private readonly timeoutMs=5_000,private readonly cacheMs=15_000){this.baseUrl=baseUrl.replace(/\/$/,'');}

  async getOhlc(symbol:string,interval:CfdOhlcInterval='15m',limit=240):Promise<CfdOhlcSnapshot>{
    if(!canonical.has(symbol)||!CFD_OHLC_INTERVALS.includes(interval))throw new Error('invalid_cfd_ohlc_request');
    const boundedLimit=Math.max(20,Math.min(500,Math.trunc(limit)||240)),key=`${symbol}:${interval}:${boundedLimit}`,now=Date.now();
    const cached=this.cache.get(key);if(cached&&now-cached.at<=this.cacheMs)return{...cached.value,bars:cached.value.bars.map(bar=>({...bar}))};
    const pending=this.inflight.get(key);if(pending)return pending.then(value=>({...value,bars:value.bars.map(bar=>({...bar}))}));
    const work=(async()=>{
      const providerSymbol=BIQUOTE_CFD_SYMBOLS[symbol];
      const url=new URL(`${this.baseUrl}/api/${encodeURIComponent(providerSymbol)}/ohlc`);url.searchParams.set('interval',interval);url.searchParams.set('limit',String(boundedLimit));
      const response=await this.fetchFn(url.toString(),{headers:{Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(Math.max(1_000,Math.min(10_000,this.timeoutMs)))});
      if(!response.ok)throw new Error('cfd_ohlc_unavailable');
      const text=await response.text();if(text.length>1_500_000)throw new Error('cfd_ohlc_body_limit');
      const raw=JSON.parse(text);if(!raw||raw.symbol!==providerSymbol||raw.interval!==interval||!Array.isArray(raw.bars))throw new Error('cfd_ohlc_shape');
      const bars:CfdOhlcBar[]=[];const seen=new Set<number>();
      for(const item of raw.bars.slice(0,1000)){
        if(!item||typeof item!=='object')continue;const openTime=typeof item.openTime==='string'?Date.parse(item.openTime):NaN;
        const open=positive(item.open),high=positive(item.high),low=positive(item.low),close=positive(item.close);
        if(!Number.isFinite(openTime)||openTime<=0||open===null||high===null||low===null||close===null||high<Math.max(open,close,low)||low>Math.min(open,close,high)||seen.has(openTime))continue;
        seen.add(openTime);bars.push({openTime,open,high,low,close,volume:nonNegative(item.volume),tickVolume:nonNegative(item.tickVolume),isOpen:item.isOpen===true});
      }
      bars.sort((a,b)=>a.openTime-b.openTime);if(bars.length<2)throw new Error('cfd_ohlc_insufficient');
      const value:CfdOhlcSnapshot={symbol,providerSymbol,interval,fetchedAt:Date.now(),bars,source:'biquote'};this.cache.set(key,{at:Date.now(),value});return value;
    })().finally(()=>this.inflight.delete(key));
    this.inflight.set(key,work);return work.then(value=>({...value,bars:value.bars.map(bar=>({...bar}))}));
  }
}
