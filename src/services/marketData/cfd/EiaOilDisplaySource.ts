import type { CfdQuote } from './CfdQuote';

const DAY=86_400_000;
const SERIES={
  WTIUSD:{providerSymbol:'RWTC',title:'Cushing, OK WTI Spot Price FOB',file:'RWTCD.htm'},
  XBRUSD:{providerSymbol:'RBRTE',title:'Europe Brent Spot Price FOB',file:'RBRTED.htm'},
} as const;
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const text=(s:string)=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;|&#xA0;/gi,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const numeric=(s:string)=>/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)&&Number.isFinite(Number(s))?Number(s):null;

export interface EiaOilDisplayOptions{now?:()=>number;fetchFn?:typeof fetch;timeoutMs?:number;cacheMs?:number;}

/** Daily public oil benchmarks used only when faster display feeds are absent. */
export class EiaOilDisplaySource{
  private readonly now:()=>number; private readonly fetchFn:typeof fetch; private readonly timeoutMs:number; private readonly cacheMs:number;
  private cache:CfdQuote[]=[]; private cacheAt=-Infinity; private inFlight:Promise<CfdQuote[]>|null=null;
  constructor(options:EiaOilDisplayOptions={}){this.now=options.now??Date.now;this.fetchFn=options.fetchFn??fetch;this.timeoutMs=Math.max(500,Math.min(8000,options.timeoutMs??5000));this.cacheMs=Math.max(60_000,Math.min(DAY,options.cacheMs??6*3_600_000));}
  private missing(symbol:string,providerSymbol:string):CfdQuote{return{provider:'eia',symbol,providerSymbol,bid:null,ask:null,mid:null,last:null,providerTimestamp:null,fetchedAt:null,stale:true,status:'unavailable',referenceStatus:'unavailable',entitlementVerified:false,executionAllowed:false};}
  private parse(html:string,symbol:keyof typeof SERIES,receivedAt:number):CfdQuote{
    const meta=SERIES[symbol],plain=text(html);if(!plain.includes(meta.title)||!plain.includes('Dollars per Barrel'))return this.missing(symbol,meta.providerSymbol);
    let latest:{at:number;price:number}|null=null;
    for(const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
      const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c=>text(c[1]));if(cells.length!==6)continue;
      const m=cells[0].match(/^(\d{4})\s+([A-Z][a-z]{2})-\s*(\d{1,2})\s+to\s+([A-Z][a-z]{2})-\s*(\d{1,2})$/);if(!m)continue;
      const month=MONTHS.indexOf(m[2]);if(month<0)continue;const start=Date.UTC(Number(m[1]),month,Number(m[3]));if(new Date(start).getUTCDay()!==1)continue;
      for(let day=0;day<5;day++){const price=numeric(cells[day+1]);if(price===null)continue;const at=start+day*DAY;if(at>receivedAt+DAY)continue;if(!latest||at>latest.at)latest={at,price};}
    }
    if(!latest)return this.missing(symbol,meta.providerSymbol);
    return{provider:'eia',symbol,providerSymbol:meta.providerSymbol,bid:null,ask:null,mid:null,last:latest.price,providerTimestamp:latest.at,fetchedAt:receivedAt,stale:true,status:'market_closed',referenceStatus:'market_closed',entitlementVerified:false,executionAllowed:false};
  }
  async getQuotes():Promise<CfdQuote[]>{
    const now=this.now();if(this.cache.length&&now-this.cacheAt<this.cacheMs)return this.cache.map(q=>({...q}));if(this.inFlight)return this.inFlight.then(rows=>rows.map(q=>({...q})));
    const run=(async()=>{
      const out:CfdQuote[]=[];
      for(const symbol of ['WTIUSD','XBRUSD'] as const){
        const meta=SERIES[symbol];
        try{
          const r=await this.fetchFn(`https://www.eia.gov/dnav/pet/hist/${meta.file}`,{redirect:'error',signal:AbortSignal.timeout(this.timeoutMs),headers:{Accept:'text/html','User-Agent':'VOLTEX-market-display/1.0'}});
          if(!r.ok){await r.body?.cancel();out.push(this.missing(symbol,meta.providerSymbol));continue;}
          const html=await r.text();out.push(html.length<=2_000_000?this.parse(html,symbol,this.now()):this.missing(symbol,meta.providerSymbol));
        }catch{out.push(this.missing(symbol,meta.providerSymbol));}
      }
      this.cache=out.map(q=>({...q}));this.cacheAt=this.now();return out;
    })();
    this.inFlight=run.finally(()=>{this.inFlight=null;});
    return this.inFlight.then(rows=>rows.map(q=>({...q})));
  }
  diagnostics(){return{provider:'eia',displayOnly:true,cacheAt:Number.isFinite(this.cacheAt)?this.cacheAt:null,symbols:Object.keys(SERIES)};}
}
