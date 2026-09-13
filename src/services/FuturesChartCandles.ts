/** Read-only, bounded public contract-candle cache. No account/execution dependencies. */
export class FuturesChartCandles {
  private cache = new Map<string,{at:number;data:unknown}>();
  private pending = new Map<string,Promise<unknown>>();
  constructor(private request:typeof fetch=fetch,private now:()=>number=Date.now,
    private collector?: {url:string;token:string}) {}
  async get(pair:string,interval:string,limit:number):Promise<unknown> {
    const intervals:Record<string,string>={'5m':'5','15m':'15','1h':'60','4h':'240','1d':'D','1w':'W'};
    if(!/^[A-Z0-9]{1,32}-USDT$/.test(pair)||!intervals[interval]||!Number.isInteger(limit)||limit<1||limit>1000) throw new RangeError('Invalid candle request');
    const symbol=pair.replace('-','');const key=`${symbol}:${interval}:${limit}`;
    const cached=this.cache.get(key);if(cached&&this.now()-cached.at<4000)return cached.data;
    const pending=this.pending.get(key);if(pending)return pending;
    if(this.pending.size>=16)throw new Error('Candle service busy');
    const load=(async()=>{
      const query=new URLSearchParams({category:'linear',symbol,interval:intervals[interval],limit:String(limit)});
      let url=`https://api.bybit.com/v5/market/kline?${query}`;
      const options:RequestInit={signal:AbortSignal.timeout(10000),redirect:'error'};
      if(this.collector) {
        // The API region must never fall back to direct venue requests.
        const base=new URL(this.collector.url);
        if(!this.collector.token.trim()||base.username||base.password||base.search||base.hash||base.pathname!=='/'||
          (base.protocol!=='https:'&&!(base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname)))) throw new Error('Invalid candle collector');
        url=`${base.origin}/internal/v1/futures/candles/${pair}?${new URLSearchParams({interval,limit:String(limit)})}`;
        options.headers={Authorization:`Bearer ${this.collector.token}`};
      }
      const response=await this.request(url,options);
      if(!response.ok)throw new Error('Candle provider unavailable');
      const data:any=await response.json();
      if(data?.retCode!==0||data.result?.category!=='linear'||data.result?.symbol!==symbol||!Array.isArray(data.result.list)||data.result.list.length>limit)throw new Error('Invalid candle response');
      if(this.cache.size>=128)this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key,{at:this.now(),data});return data;
    })();
    this.pending.set(key,load);
    try{return await load;}finally{this.pending.delete(key);}
  }
}
