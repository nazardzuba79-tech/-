import type { PrivateTradingMarketData } from '../marketData';
import { commandRead } from './commandScope';
import { DemoEngineError } from './engine';
import { BarRequest, ReplayBar, checkCoverage } from './replay';

const MINUTE=60_000;
export const NATIVE_HISTORY_CACHE_BARS=4096;
export const NATIVE_HISTORY_CACHE_TTL=15*MINUTE;
/** Shared across native account services using the same market adapter. Closed
 * bars only; bounded by count and age. Failed/incomplete responses never cache.
 * The queue also respects the adapter's single-history-request admission. */
export class NativeHistoryCache {
  private entries=new Map<string,{bar:ReplayBar;expires:number}>();
  private tail:Promise<unknown>=Promise.resolve();
  constructor(private market:PrivateTradingMarketData,private now:()=>number){}
  get size(){return this.entries.size;}
  load(request:BarRequest,signal?:AbortSignal):Promise<ReplayBar[]>{
    const run=this.tail.then(()=>this.read(request,signal));
    this.tail=run.catch(()=>undefined);
    return run;
  }
  private async read(r:BarRequest,signal?:AbortSignal){
    signal?.throwIfAborted();
    const key=(time:number)=>`${r.symbol}:${r.intervalMs}:${time}`;
    const now=this.now();
    for(const [k,v] of this.entries)if(v.expires<=now)this.entries.delete(k);
    if(r.end>Math.floor(now/r.intervalMs)*r.intervalMs)throw new DemoEngineError('HISTORY_GAP');
    const result:ReplayBar[]=[];
    for(let time=r.start;time<r.end;){
      signal?.throwIfAborted();
      const hit=this.entries.get(key(time));
      if(hit){result.push(hit.bar);time+=r.intervalMs;continue;}
      const start=time;
      while(time<r.end&&!this.entries.has(key(time)))time+=r.intervalMs;
      const history=await commandRead('market.history.fetch',()=>this.market.history({symbol:r.symbol,startTime:start,endTime:time,intervalMinutes:(r.intervalMs/MINUTE) as 1|15|60,omitProviderFunding:true,signal}));
      signal?.throwIfAborted();
      if(!history.complete||history.symbol!==r.symbol||history.intervalMs!==r.intervalMs)throw new DemoEngineError('HISTORY_GAP');
      const marks=new Map(history.markCandles.map(c=>[c.timestamp,c]));
      if(marks.size!==history.markCandles.length)throw new DemoEngineError('MARK_HISTORY_GAP');
      const bars=history.tradeCandles.map(c=>{
        const mark=marks.get(c.timestamp);if(!mark)throw new DemoEngineError('MARK_HISTORY_GAP');
        return{time:c.timestamp,intervalMs:r.intervalMs,trade:c,mark};
      });
      const valid=checkCoverage(bars,{...r,start,end:time});
      if(marks.size!==valid.length)throw new DemoEngineError('MARK_HISTORY_GAP');
      for(const bar of valid){
        result.push(bar);
        this.entries.set(key(bar.time),{bar:structuredClone(bar),expires:this.now()+NATIVE_HISTORY_CACHE_TTL});
        while(this.entries.size>NATIVE_HISTORY_CACHE_BARS)this.entries.delete(this.entries.keys().next().value!);
      }
    }
    return structuredClone(result);
  }
}
const shared=new WeakMap<PrivateTradingMarketData,NativeHistoryCache>();
export function nativeHistoryCache(market:PrivateTradingMarketData,now:()=>number){
  let cache=shared.get(market);if(!cache){cache=new NativeHistoryCache(market,now);shared.set(market,cache);}return cache;
}
