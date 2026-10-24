import { CATALOG, VENUE_CATALOG, instrument, TIMEFRAMES } from './catalog.mjs';
import { VENUES } from './venues.mjs';
import { check, units, decimal, SimError } from './engine.mjs';
import { performance } from 'node:perf_hooks';
const S=100000000n;
const HISTORY_CACHE_BYTES=8*1048576, HISTORY_CACHE_PAGES=128;
const HISTORY_PAGE_ROWS=300, HISTORY_WINDOW_ROWS=600;
// Official Binance public-market-data hosts. The default is unchanged; data-api.binance.vision is
// the documented market-data-only endpoint (same paths and payloads, no account or order routes).
export const BINANCE_HOSTS=['api.binance.com','data-api.binance.vision'];
// A range is admitted only from a complete, strictly ordered native response.
// Timestamps need not be contiguous: missing trading periods are not invented.
const nativeOrder=(rows,provider)=>Array.isArray(rows)&&rows.every((r,n)=>Number.isSafeInteger(Number(r?.[0]))&&(!n||(provider==='bybit'?Number(rows[n-1][0])>Number(r[0]):Number(rows[n-1][0])<Number(r[0]))));
const fixed=(v)=>{const n=String(v);check(/^\d+(\.\d+)?$/.test(n),'INVALID_DATA');return decimal(units(n.split('.')[0]+'.'+(n.split('.')[1]||'').padEnd(8,'0').slice(0,8)));};
const positive=v=>{const d=fixed(v);units(d,true);return d;};
const tables=(j,name)=>{const t=j[name];check(Array.isArray(t?.columns)&&Array.isArray(t?.data),'INVALID_DATA');return t.data.map(row=>Object.fromEntries(t.columns.map((k,i)=>[k,row[i]])));};
const ceil=(a,b)=>(a+b-1n)/b;
export function convertPrices(bid,ask,rate){const r=units(rate,true);return {buy:decimal(ceil(units(ask,true)*S,r)),sell:decimal(units(bid,true)*S/r)};}
export function composeRubUsdcFx(rub,usdc){return {...usdc,rate:decimal(units(rub.rate,true)*units(usdc.rate,true)/S),source:rub.source+' + '+usdc.source,policy:'RUB per USDC: daily reference × observed stablecoin legs',referenceTimestamp:rub.timestamp,stableTimestamp:rub.stableTimestamp,legs:[{...rub},{...usdc}]};}
export function parseCandles(rows,provider,now){
  check(Array.isArray(rows)&&rows.length<=1000,'INVALID_CANDLES');const map=new Map();
  for(const r of rows){const c=provider==='moex'?{time:Date.parse(r.begin.replace(' ','T')+'+03:00')/1000,open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),volume:Number(r.volume)}:{time:Number(r[0])/1000,open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5])};
    check(Number.isSafeInteger(c.time)&&c.time<=Math.floor(now/1000)&&[c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite)&&Math.min(c.open,c.high,c.low,c.close)>0&&c.volume>=0&&c.high>=Math.max(c.open,c.close,c.low)&&c.low<=Math.min(c.open,c.close),'INVALID_CANDLES');map.set(c.time,c);}
  return [...map.values()].sort((a,b)=>a.time-b.time);
}
export class MarketHub {
  constructor({fetchImpl=fetch,now=Date.now,monotonicNow=()=>performance.now(),venues=[],binanceHost=BINANCE_HOSTS[0]}={}){check(Array.isArray(venues)&&venues.every(v=>typeof v==='string'&&Object.hasOwn(VENUES,v)),'VENUE_UNKNOWN');check(BINANCE_HOSTS.includes(binanceHost),'SOURCE_FORBIDDEN');this.venues=new Set(venues);this.binanceHost=binanceHost;this.fetch=fetchImpl;this.now=now;this.monotonicNow=monotonicNow;this.cache=new Map();this.inflight=new Map();this.starts=new Map();this.errors={};this.metrics={requests:0,bytes:0,cacheHits:0,historyParses:0,historyParseMs:0,historyCacheHits:0,historyCoalesced:0,historyCacheBytes:0,historyCacheExpired:0,historyCacheEvictions:0,historyRangeHits:0,historyRangeInvalidations:0};this.verified=new Map();this.displays=new Map();this.historyCache=new Map();this.historyRanges=new Map();this.historyRetained=new Map();this.historyCandleRefs=new Map();this.historyFlights=new Map();this.historyActive=0;this.historyQueue=[];}
  async request(url,ttl=0,text=false){
    const u=new URL(url);check(([...BINANCE_HOSTS,'api.bybit.com','iss.moex.com','www.cbr.ru','api.kraken.com'].includes(u.hostname)||[...this.venues].some(v=>VENUES[v].hosts.includes(u.hostname)))&&u.protocol==='https:','SOURCE_FORBIDDEN');
    const old=this.cache.get(url);if(old&&this.now()-old.at<ttl){this.metrics.cacheHits++;return old.value;}if(this.inflight.has(url))return this.inflight.get(url);
    const starts=(this.starts.get(u.hostname)||[]).filter(t=>this.now()-t<60000);check(starts.length<100,'RATE_LIMIT');starts.push(this.now());this.starts.set(u.hostname,starts);
    const promise=(async()=>{this.metrics.requests++;const response=await this.fetch(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(6000)});check(response.ok,response.status===429?'RATE_LIMIT':`SOURCE_HTTP_${response.status}`);const reader=response.body.getReader();const chunks=[];let bytes=0;try{while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.length;check(bytes<=8*1024*1024,'RESPONSE_TOO_LARGE');chunks.push(r.value);}}finally{await reader.cancel().catch(()=>{});}this.metrics.bytes+=bytes;const body=Buffer.concat(chunks).toString('utf8');const value=text?body:JSON.parse(body);if(ttl){this.cache.set(url,{at:this.now(),value});while(this.cache.size>80)this.cache.delete(this.cache.keys().next().value);}return value;})().catch(e=>{throw e instanceof SimError?e:new SimError(e.cause?.code==='ENOTFOUND'||e.cause?.code==='EAI_AGAIN'?'SOURCE_DNS_UNAVAILABLE':'SOURCE_UNAVAILABLE');}).finally(()=>this.inflight.delete(url));this.inflight.set(url,promise);return promise;
  }
  async catalogue(){
    await Promise.allSettled(['binance','bybit','moex'].map(async provider=>{try{let rows;if(provider==='binance'){const j=await this.request(`https://${this.binanceHost}/api/v3/exchangeInfo?symbols=`+encodeURIComponent(JSON.stringify(CATALOG.filter(i=>i.provider==='binance').map(i=>i.sourceSymbol))),600000);rows=j.symbols;check(Array.isArray(rows),'INVALID_DATA');for(const i of CATALOG.filter(i=>i.provider===provider)){const r=rows.find(r=>r.symbol===i.sourceSymbol);this.verified.set(i.id,{exists:!!r,online:r?.status==='TRADING',multiplier:null,checkedAt:this.now()});}}
      else if(provider==='bybit'){const j=await this.request('https://api.bybit.com/v5/market/instruments-info?category=spot',600000);check(j.retCode===0&&Array.isArray(j.result?.list),'INVALID_DATA');for(const i of CATALOG.filter(i=>i.provider===provider)){const r=j.result.list.find(r=>r.symbol===i.sourceSymbol);this.verified.set(i.id,{exists:!!r,online:r?.status==='Trading',multiplier:r?.xstockMultiplier||null,checkedAt:this.now()});}}
      else {const j=await this.request('https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=securities',600000);rows=tables(j,'securities');for(const i of CATALOG.filter(i=>i.provider===provider)){const r=rows.find(r=>r.SECID===i.sourceSymbol);this.verified.set(i.id,{exists:!!r,online:r?.STATUS==='A',multiplier:null,checkedAt:this.now()});}}delete this.errors[provider];}catch(e){this.errors[provider]=e.message;}}));
    await Promise.allSettled(['bybit','binance'].map(async provider=>{try{const ids=CATALOG.filter(i=>i.provider===provider),url=provider==='bybit'?'https://api.bybit.com/v5/market/tickers?category=spot':`https://${this.binanceHost}/api/v3/ticker/24hr?symbols=`+encodeURIComponent(JSON.stringify(ids.map(i=>i.sourceSymbol)));const j=await this.request(url,60000);const rows=provider==='bybit'?j.result?.list:j;check(Array.isArray(rows),'INVALID_DATA');for(const i of ids){const r=rows.find(t=>t.symbol===i.sourceSymbol);if(r)this.displays.set(i.id,{price:positive(r.lastPrice),change24h:provider==='bybit'?Number(r.price24hPcnt)*100:Number(r.priceChangePercent),timestamp:provider==='bybit'?Number(j.time):Number(r.closeTime),source:'ticker snapshot'});}}catch{}}));
    // Enabled venue adapters, same contract as above: metadata success clears the venue error, a
    // ticker failure records it. An unknown pair is exists:false; nothing is filled in.
    await Promise.allSettled([...this.venues].map(async provider=>{const v=VENUES[provider],ids=VENUE_CATALOG.filter(i=>i.provider===provider);try{for(const i of ids){let meta;try{meta=v.parseInstrument(await this.request(v.instrumentUrl(i),600000),i,this.now());}catch(e){if(!/^SOURCE_HTTP_40[04]$/.test(e.message))throw e;meta={exists:false,online:false,venueStatus:null,multiplier:null,checkedAt:this.now(),filters:null};}this.verified.set(i.id,meta);}delete this.errors[provider];
      for(const i of ids){if(!this.verified.get(i.id)?.online)continue;try{const t=v.parseTicker(await this.request(v.tickerUrl(i),60000),i);this.displays.set(i.id,{price:positive(t.last),change24h:t.change24h,timestamp:t.timestamp??this.now()});}catch(e){this.displays.delete(i.id);this.errors[provider]=e.message;}}}catch(e){this.errors[provider]=e.message;}}));
    return [...CATALOG,...VENUE_CATALOG.filter(i=>this.venues.has(i.provider))].map(i=>({...i,...this.verified.get(i.id),display:this.displays.get(i.id)||null,sourceError:this.errors[i.provider]||null}));
  }
  async usdcRate(){const j=await this.request(`https://${this.binanceHost}/api/v3/trades?symbol=USDCUSDT&limit=1`,15000);check(Array.isArray(j)&&j.length===1,'FX_UNAVAILABLE');const t=j[0];check(Number.isSafeInteger(t.time)&&this.now()-t.time<180000&&t.time<=this.now()+2000,'FX_STALE');return {rate:positive(t.price),timestamp:t.time,maxAgeMs:180000,source:'Binance USDC/USDT',policy:'observed USDT per USDC'};}
  async rubRate(){
    const xml=await this.request('https://www.cbr.ru/scripts/XML_daily.asp',1800000,true),date=xml.match(/Date="(\d{2})\.(\d{2})\.(\d{4})"/),usd=xml.match(/<Valute\b[^>]*>[\s\S]*?<CharCode>USD<\/CharCode>[\s\S]*?<Value>([\d,]+)<\/Value>[\s\S]*?<\/Valute>/);
    check(date&&usd,'FX_UNAVAILABLE');const at=Date.parse(`${date[3]}-${date[2]}-${date[1]}T00:00:00+03:00`);check(at<=this.now()&&this.now()-at<=36*3600000,'FX_STALE');
    const j=await this.request('https://api.kraken.com/0/public/Trades?pair=USDTUSD&count=1',15000);check(j.error?.length===0,'FX_UNAVAILABLE');const rows=Object.entries(j.result).find(([k])=>k!=='last')?.[1];const r=rows?.[0];check(r&&Number.isFinite(r[2])&&this.now()-r[2]*1000<180000&&r[2]*1000<=this.now()+2000,'FX_STALE');
    return {rate:decimal(units(positive(usd[1].replace(',','.')))*units(positive(r[0]))/S),timestamp:at,maxAgeMs:36*3600000,source:'CBR daily USD/RUB × Kraken USDT/USD',policy:'daily official reference, not live RUB FX',stableTimestamp:Math.floor(r[2]*1000)};
  }
  async binanceNative(symbol){return{rows:await this.request(`https://${this.binanceHost}/api/v3/trades?symbol=${symbol}&limit=1`)};}
  async quote(id,{includeUsdc=true}={}){
    check(typeof includeUsdc==='boolean','INVALID_REQUEST');
    const i=instrument(id);check(i,'INVALID_PAIR');check(!VENUES[i.provider]||this.venues.has(i.provider),'DATA_RIGHTS_UNVERIFIED');if(!this.verified.has(id)||this.now()-this.verified.get(id).checkedAt>600000)await this.catalogue();const meta=this.verified.get(id);check(meta?.exists,this.errors[i.provider]||'INSTRUMENT_UNVERIFIED');check(meta.online,'MARKET_CLOSED');let q;
    if(i.provider==='bybit'){const [book,ticker]=await Promise.all([this.request(`https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${i.sourceSymbol}&limit=1`),this.request(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${i.sourceSymbol}`,15000)]);check(book.retCode===0&&book.result?.s===i.sourceSymbol&&ticker.retCode===0,'INVALID_DATA');const b=book.result,t=ticker.result.list.find(t=>t.symbol===i.sourceSymbol);check(t&&Number.isSafeInteger(b.ts),'INVALID_DATA');q={bid:positive(b.b?.[0]?.[0]),ask:positive(b.a?.[0]?.[0]),last:positive(t.lastPrice),timestamp:b.cts||b.ts,eventId:String(b.u),change24h:100*Number(t.price24hPcnt),volume:fixed(t.volume24h),marketOpen:true};}
    else if(i.provider==='binance'){const [native,ticker]=await Promise.all([this.binanceNative(i.sourceSymbol),this.request(`https://${this.binanceHost}/api/v3/ticker/24hr?symbol=${i.sourceSymbol}`,15000)]);const trades=native.rows;check(Array.isArray(trades)&&trades.length===1&&ticker.symbol===i.sourceSymbol,'INVALID_DATA');const t=trades[0];q={bid:positive(t.price),ask:positive(t.price),last:positive(t.price),timestamp:t.time,eventId:String(t.id),...(native.receivedAt===undefined?{}:{receivedAt:native.receivedAt}),...(native.streamGeneration===undefined?{}:{streamGeneration:native.streamGeneration}),change24h:Number(ticker.priceChangePercent),volume:fixed(ticker.volume),marketOpen:true};}
    else if(VENUES[i.provider]){const v=VENUES[i.provider];const r=v.parseQuote(await Promise.all(v.quoteUrls(i).map(([url,ttl])=>this.request(url,ttl))),i);q={bid:positive(r.bid),ask:positive(r.ask),last:positive(r.last),timestamp:r.timestamp,eventId:r.eventId,change24h:r.change24h,volume:fixed(r.volume),marketOpen:true};}
    else {const j=await this.request(`https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/${i.sourceSymbol}.json?iss.meta=off`);const t=tables(j,'marketdata').find(t=>t.SECID===i.sourceSymbol&&t.BOARDID==='TQBR');check(t&&t.LAST!=null&&t.SYSTIME,'QUOTE_UNAVAILABLE');q={bid:positive(t.LAST),ask:positive(t.LAST),last:positive(t.LAST),timestamp:Date.parse(t.SYSTIME.slice(0,10)+'T'+t.UPDATETIME+'+03:00'),eventId:String(t.SEQNUM??t.SYSTIME),change24h:t.LASTTOPREVPRICE==null?null:Number(t.LASTTOPREVPRICE),volume:t.VOLTODAY==null?null:fixed(t.VOLTODAY),marketOpen:t.TRADINGSTATUS==='T'};}
    check(Number.isSafeInteger(q.timestamp)&&units(q.ask)>=units(q.bid),'INVALID_DATA');q={...q,instrumentId:id,provider:i.provider,nativeCurrency:i.currency,receivedAt:q.receivedAt??this.now(),verified:true,capacity:'1.00000000',multiplier:meta.multiplier,delaySeconds:i.delaySeconds,prices:{},fx:{}};
    if(i.currency==='USDT')q.prices.USDT={buy:q.ask,sell:q.bid};
    else {try{const fx=await this.rubRate();q.fx.USDT=fx;q.prices.USDT=convertPrices(q.bid,q.ask,fx.rate);}catch(e){q.fxError=e.message;}}
    return includeUsdc?this.withUsdcPrices(q):q;
  }
  // Enrich an already admitted native observation without fetching another one.
  // Never mutate a response-only Wallet quote shared with an in-flight reader.
  async withUsdcPrices(quote){
    const q={...quote,prices:{...quote.prices},fx:{...quote.fx}};
    try{const fx=await this.usdcRate();if(q.prices.USDT){q.prices.USDC=convertPrices(q.prices.USDT.sell,q.prices.USDT.buy,fx.rate);q.fx.USDC=q.nativeCurrency==='RUB'?composeRubUsdcFx(q.fx.USDT,fx):fx;}}catch(e){q.fxError=e.message;}
    return q;
  }
  async historySlot(fn,{signal}={}){
    check(!signal?.aborted,'SOURCE_CANCELLED');
    let deadline=null;
    if(this.historyActive>=2){
      check(this.historyQueue.length<8,'SOURCE_BUSY');
      deadline=this.monotonicNow()+2000;
      await new Promise((resolve,reject)=>{
        const entry={deadline},finish=fn=>{clearTimeout(entry.timer);signal?.removeEventListener('abort',abort);fn();};
        entry.resolve=()=>finish(resolve);entry.reject=error=>finish(()=>reject(error));
        const remove=error=>{this.historyQueue=this.historyQueue.filter(x=>x!==entry);entry.reject(error);};
        const abort=()=>remove(new SimError('SOURCE_CANCELLED'));
        entry.timer=setTimeout(()=>remove(new SimError('SOURCE_BUSY')),2000);
        this.historyQueue.push(entry);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      });
    }else this.historyActive++;
    try{check(!signal?.aborted,'SOURCE_CANCELLED');if(deadline!==null)check(this.monotonicNow()<deadline,'SOURCE_BUSY');return await fn();}
    finally{
      // Timer callbacks can be late under CPU pressure. Expired work must not
      // acquire a slot or consume a provider request when that timer is delayed.
      let next;
      while((next=this.historyQueue.shift())){
        clearTimeout(next.timer);
        if(this.monotonicNow()>=next.deadline){next.reject(new SimError('SOURCE_BUSY'));continue;}
        next.resolve();break;
      }
      if(!next)this.historyActive--;
    }
  }
  readHistoryFlight(flight,signal){
    check(!signal?.aborted,'SOURCE_CANCELLED');flight.readers++;
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(error,value)=>{
        if(settled)return;settled=true;signal?.removeEventListener('abort',abort);flight.readers--;
        // A cursor follower is a reader too. Only the last reader may cancel
        // work that has not started a provider request; active reads may cache.
        if(!flight.readers&&!flight.started&&!flight.finished){
          if(this.historyFlights.get(flight.key)===flight)this.historyFlights.delete(flight.key);
          flight.controller.abort();
        }
        if(error)reject(error);else resolve(value);
      };
      const abort=()=>finish(new SimError('SOURCE_CANCELLED'));
      signal?.addEventListener('abort',abort,{once:true});
      flight.pending.then(value=>finish(null,value),error=>finish(error));
      if(signal?.aborted)abort();
    });
  }
  dropHistory(entry){
    entry.store.delete(entry.key);this.historyRetained.delete(entry.retainedKey);this.metrics.historyCacheBytes-=entry.overhead;
    for(const candle of entry.candles){const refs=this.historyCandleRefs.get(candle)-1;if(refs)this.historyCandleRefs.set(candle,refs);else{this.historyCandleRefs.delete(candle);this.metrics.historyCacheBytes-=248;}}
  }
  touchHistory(entry){this.historyRetained.delete(entry.retainedKey);this.historyRetained.set(entry.retainedKey,entry);}
  retainHistory(store,key,entry){
    const cacheNow=this.now();
    for(const old of this.historyRetained.values())if(old.until<=cacheNow){this.dropHistory(old);this.metrics.historyCacheExpired++;}
    if(store.has(key))this.dropHistory(store.get(key));
    // Count each immutable candle object once; every owning array/reference and
    // entry still has an allowance. Raw provider JSON is never retained.
    const overhead=1024+(entry.candles.length+(entry.extraRefs||0))*8;
    const cost=()=>overhead+entry.candles.reduce((sum,c)=>sum+(this.historyCandleRefs.has(c)?0:248),0);
    while(this.historyRetained.size&&(this.metrics.historyCacheBytes+cost()>HISTORY_CACHE_BYTES||this.historyRetained.size>=HISTORY_CACHE_PAGES)){this.dropHistory(this.historyRetained.values().next().value);this.metrics.historyCacheEvictions++;}
    if(cost()>HISTORY_CACHE_BYTES)return;
    const retainedKey=(store===this.historyRanges?'range:':'page:')+key;
    Object.assign(entry,{store,key,retainedKey,overhead});store.set(key,entry);this.historyRetained.set(retainedKey,entry);this.metrics.historyCacheBytes+=overhead;
    for(const candle of entry.candles){const refs=this.historyCandleRefs.get(candle)||0;if(!refs)this.metrics.historyCacheBytes+=248;this.historyCandleRefs.set(candle,refs+1);}
  }
  historyValue(i,interval,candles,receivedAt){return Object.freeze({instrumentId:i.id,interval,currency:i.currency,provider:i.provider,delaySeconds:i.delaySeconds,candles:Object.freeze(candles),receivedAt});}
  reuseHistory(i,interval,end,key){
    if(!end)return null;
    const family=JSON.stringify([i.id,interval]),window=this.historyRanges.get(family);
    if(!window||window.until<=this.now()||end>window.upper)return null;
    // Both native endpoints select the most recent rows up to inclusive end.
    // Select native limit=300 first; the existing public strict-end filter can
    // then return 299 rows at an aligned boundary. A partial suffix is NOT a page.
    let right=window.candles.length;while(right&&window.candles[right-1].time*1000>end)right--;
    if(right<HISTORY_PAGE_ROWS)return null;
    const candles=window.candles.slice(right-HISTORY_PAGE_ROWS,right).filter(c=>c.time*1000<end);
    const value=this.historyValue(i,interval,candles,window.receivedAt);
    this.touchHistory(window);this.retainHistory(this.historyCache,key,{value,candles,until:window.receivedAt+300000,derived:family});this.metrics.historyRangeHits++;
    return value;
  }
  async history(id,interval='15m',before=null,{signal}={}){
    check(!signal?.aborted,'SOURCE_CANCELLED');
    const i=instrument(id);check(i&&i.timeframes.includes(interval),'UNSUPPORTED_TIMEFRAME');check(!VENUES[i.provider]||this.venues.has(i.provider),'DATA_RIGHTS_UNVERIFIED');const end=before?Number(before):null;check(end===null||Number.isSafeInteger(end)&&end>0&&end<=this.now(),'INVALID_RANGE');
    const key=JSON.stringify([id,interval,end]),cached=this.historyCache.get(key)||(!end&&this.historyRanges.get(JSON.stringify([id,interval])));
    if(cached&&cached.until>this.now()){this.metrics.historyCacheHits++;cached.store.delete(cached.key);cached.store.set(cached.key,cached);this.touchHistory(cached);return cached.value;}
    if(this.historyFlights.has(key)){this.metrics.historyCoalesced++;return this.readHistoryFlight(this.historyFlights.get(key),signal);}
    // Capture only an earlier flight. Looking this up after queue admission
    // could wait for a later latest request queued behind this cursor itself.
    const latest=end&&this.historyFlights.get(JSON.stringify([id,interval,null]));
    const flight={key,controller:new AbortController(),readers:0,started:false,finished:false,pending:null};
    const latestRead=latest&&this.readHistoryFlight(latest,flight.controller.signal);
    // A queued follower may not await this dependency until later. Observe its
    // rejection immediately, without hiding the fallback/error at execution.
    if(latestRead)void latestRead.catch(()=>{});
    const pending=this.historySlot(async()=>{
      // A concurrent requested latest read may already be obtaining the needed
      // range. Wait for it once, then use the ordinary bounded exact fallback.
      if(latestRead){this.metrics.historyCoalesced++;await latestRead.catch(()=>{});}
      check(!flight.controller.signal.aborted,'SOURCE_CANCELLED');
      const reused=this.reuseHistory(i,interval,end,key);if(reused)return reused;
      let rows;const upper=this.now(),limit=!end&&i.provider!=='moex'?HISTORY_WINDOW_ROWS:HISTORY_PAGE_ROWS;
      flight.started=true;
      // Cache only the validated, normalized page. The raw provider payload is
      // not retained a second time, and all users share one normalization.
      if(i.provider==='bybit'){const period={ '1m':'1','5m':'5','15m':'15','30m':'30','1h':'60','4h':'240','1D':'D' }[interval];const j=await this.request(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${i.sourceSymbol}&interval=${period}&limit=${limit}${end?'&end='+end:''}`);check(j.retCode===0&&j.result?.symbol===i.sourceSymbol,'INVALID_CANDLES');rows=j.result.list;}
      else if(i.provider==='binance'){rows=await this.request(`https://${this.binanceHost}/api/v3/klines?symbol=${i.sourceSymbol}&interval=${interval==='1D'?'1d':interval}&limit=${limit}${end?'&endTime='+end:''}`);}
      else if(VENUES[i.provider]){const v=VENUES[i.provider];rows=v.parseHistory(await this.request(v.historyUrl(i,interval,Math.min(limit,v.maxRows),end)),i,Math.min(limit,v.maxRows));}
      else {const period={'1m':1,'1h':60,'1D':24}[interval];const till=new Date(end||this.now()).toISOString().slice(0,10);const from=new Date((end||this.now())-(interval==='1D'?360:interval==='1h'?14:2)*86400000).toISOString().slice(0,10);const j=await this.request(`https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/${i.sourceSymbol}/candles.json?iss.meta=off&interval=${period}&from=${from}&till=${till}`);rows=tables(j,'candles');}
      const started=performance.now();const normalized=parseCandles(rows,i.provider,this.now());for(const candle of normalized)Object.freeze(candle);
      const bounded=i.provider!=='moex'&&rows.length<=limit,ordered=bounded&&nativeOrder(rows,i.provider);
      // An unordered/duplicate response cannot establish a reusable native range,
      // but a conforming response cardinality must never enlarge the public page.
      // Preserve legacy parser handling for over-limit responses separately.
      let candles=!end&&bounded?normalized.slice(-HISTORY_PAGE_ROWS):normalized;if(end)candles=candles.filter(c=>c.time*1000<end);
      const receivedAt=this.now(),value=this.historyValue(i,interval,candles,receivedAt);
      this.metrics.historyParses++;this.metrics.historyParseMs+=performance.now()-started;
      const family=JSON.stringify([id,interval]);
      if(!end&&bounded){
        // A new authoritative observation invalidates derived aliases, including
        // historical corrections/removals and short/unordered native responses.
        // Already returned frozen data is intact; no cached value is mutated.
        for(const old of this.historyCache.values())if(old.derived===family){this.dropHistory(old);this.metrics.historyRangeInvalidations++;}
      }
      if(!end&&ordered&&normalized.length===HISTORY_WINDOW_ROWS){
        // The window also owns its latest public view, avoiding a duplicate cache
        // entry. Account for that view's additional array references explicitly.
        this.retainHistory(this.historyRanges,family,{value,candles:Object.freeze(normalized),extraRefs:candles.length,receivedAt,upper,until:receivedAt+10000});
      }else this.retainHistory(this.historyCache,key,{value,candles,until:receivedAt+(i.provider==='moex'?10000:end?300000:10000)});
      return value;
    },{signal:flight.controller.signal}).finally(()=>{flight.finished=true;flight.controller.abort();if(this.historyFlights.get(key)===flight)this.historyFlights.delete(key);});
    flight.pending=pending;this.historyFlights.set(key,flight);return this.readHistoryFlight(flight,signal);
  }
}
