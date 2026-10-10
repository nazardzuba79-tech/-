import { CATALOG, instrument, TIMEFRAMES } from './catalog.mjs';
import { check, units, decimal, SimError } from './engine.mjs';
import { performance } from 'node:perf_hooks';
const S=100000000n;
const HISTORY_CACHE_BYTES=8*1048576, HISTORY_CACHE_PAGES=128;
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
  constructor({fetchImpl=fetch,now=Date.now}={}){this.fetch=fetchImpl;this.now=now;this.cache=new Map();this.inflight=new Map();this.starts=new Map();this.errors={};this.metrics={requests:0,bytes:0,cacheHits:0,historyParses:0,historyParseMs:0,historyCacheHits:0,historyCoalesced:0,historyCacheBytes:0,historyCacheExpired:0,historyCacheEvictions:0};this.verified=new Map();this.displays=new Map();this.historyCache=new Map();this.historyFlights=new Map();this.historyActive=0;this.historyQueue=[];}
  async request(url,ttl=0,text=false){
    const u=new URL(url);check(['api.binance.com','api.bybit.com','iss.moex.com','www.cbr.ru','api.kraken.com'].includes(u.hostname)&&u.protocol==='https:','SOURCE_FORBIDDEN');
    const old=this.cache.get(url);if(old&&this.now()-old.at<ttl){this.metrics.cacheHits++;return old.value;}if(this.inflight.has(url))return this.inflight.get(url);
    const starts=(this.starts.get(u.hostname)||[]).filter(t=>this.now()-t<60000);check(starts.length<100,'RATE_LIMIT');starts.push(this.now());this.starts.set(u.hostname,starts);
    const promise=(async()=>{this.metrics.requests++;const response=await this.fetch(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(6000)});check(response.ok,response.status===429?'RATE_LIMIT':`SOURCE_HTTP_${response.status}`);const reader=response.body.getReader();const chunks=[];let bytes=0;try{while(true){const r=await reader.read();if(r.done)break;bytes+=r.value.length;check(bytes<=8*1024*1024,'RESPONSE_TOO_LARGE');chunks.push(r.value);}}finally{await reader.cancel().catch(()=>{});}this.metrics.bytes+=bytes;const body=Buffer.concat(chunks).toString('utf8');const value=text?body:JSON.parse(body);if(ttl){this.cache.set(url,{at:this.now(),value});while(this.cache.size>80)this.cache.delete(this.cache.keys().next().value);}return value;})().catch(e=>{throw e instanceof SimError?e:new SimError(e.cause?.code==='ENOTFOUND'||e.cause?.code==='EAI_AGAIN'?'SOURCE_DNS_UNAVAILABLE':'SOURCE_UNAVAILABLE');}).finally(()=>this.inflight.delete(url));this.inflight.set(url,promise);return promise;
  }
  async catalogue(){
    await Promise.allSettled(['binance','bybit','moex'].map(async provider=>{try{let rows;if(provider==='binance'){const j=await this.request('https://api.binance.com/api/v3/exchangeInfo?symbols='+encodeURIComponent(JSON.stringify(CATALOG.filter(i=>i.provider==='binance').map(i=>i.sourceSymbol))),600000);rows=j.symbols;check(Array.isArray(rows),'INVALID_DATA');for(const i of CATALOG.filter(i=>i.provider===provider)){const r=rows.find(r=>r.symbol===i.sourceSymbol);this.verified.set(i.id,{exists:!!r,online:r?.status==='TRADING',multiplier:null,checkedAt:this.now()});}}
      else if(provider==='bybit'){const j=await this.request('https://api.bybit.com/v5/market/instruments-info?category=spot',600000);check(j.retCode===0&&Array.isArray(j.result?.list),'INVALID_DATA');for(const i of CATALOG.filter(i=>i.provider===provider)){const r=j.result.list.find(r=>r.symbol===i.sourceSymbol);this.verified.set(i.id,{exists:!!r,online:r?.status==='Trading',multiplier:r?.xstockMultiplier||null,checkedAt:this.now()});}}
      else {const j=await this.request('https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=securities',600000);rows=tables(j,'securities');for(const i of CATALOG.filter(i=>i.provider===provider)){const r=rows.find(r=>r.SECID===i.sourceSymbol);this.verified.set(i.id,{exists:!!r,online:r?.STATUS==='A',multiplier:null,checkedAt:this.now()});}}delete this.errors[provider];}catch(e){this.errors[provider]=e.message;}}));
    await Promise.allSettled(['bybit','binance'].map(async provider=>{try{const ids=CATALOG.filter(i=>i.provider===provider),url=provider==='bybit'?'https://api.bybit.com/v5/market/tickers?category=spot':'https://api.binance.com/api/v3/ticker/24hr?symbols='+encodeURIComponent(JSON.stringify(ids.map(i=>i.sourceSymbol)));const j=await this.request(url,60000);const rows=provider==='bybit'?j.result?.list:j;check(Array.isArray(rows),'INVALID_DATA');for(const i of ids){const r=rows.find(t=>t.symbol===i.sourceSymbol);if(r)this.displays.set(i.id,{price:positive(r.lastPrice),change24h:provider==='bybit'?Number(r.price24hPcnt)*100:Number(r.priceChangePercent),timestamp:provider==='bybit'?Number(j.time):Number(r.closeTime),source:'ticker snapshot'});}}catch{}}));
    return CATALOG.map(i=>({...i,...this.verified.get(i.id),display:this.displays.get(i.id)||null,sourceError:this.errors[i.provider]||null}));
  }
  async usdcRate(){const j=await this.request('https://api.binance.com/api/v3/trades?symbol=USDCUSDT&limit=1',15000);check(Array.isArray(j)&&j.length===1,'FX_UNAVAILABLE');const t=j[0];check(Number.isSafeInteger(t.time)&&this.now()-t.time<180000&&t.time<=this.now()+2000,'FX_STALE');return {rate:positive(t.price),timestamp:t.time,maxAgeMs:180000,source:'Binance USDC/USDT',policy:'observed USDT per USDC'};}
  async rubRate(){
    const xml=await this.request('https://www.cbr.ru/scripts/XML_daily.asp',1800000,true),date=xml.match(/Date="(\d{2})\.(\d{2})\.(\d{4})"/),usd=xml.match(/<Valute\b[^>]*>[\s\S]*?<CharCode>USD<\/CharCode>[\s\S]*?<Value>([\d,]+)<\/Value>[\s\S]*?<\/Valute>/);
    check(date&&usd,'FX_UNAVAILABLE');const at=Date.parse(`${date[3]}-${date[2]}-${date[1]}T00:00:00+03:00`);check(at<=this.now()&&this.now()-at<=36*3600000,'FX_STALE');
    const j=await this.request('https://api.kraken.com/0/public/Trades?pair=USDTUSD&count=1',15000);check(j.error?.length===0,'FX_UNAVAILABLE');const rows=Object.entries(j.result).find(([k])=>k!=='last')?.[1];const r=rows?.[0];check(r&&Number.isFinite(r[2])&&this.now()-r[2]*1000<180000&&r[2]*1000<=this.now()+2000,'FX_STALE');
    return {rate:decimal(units(positive(usd[1].replace(',','.')))*units(positive(r[0]))/S),timestamp:at,maxAgeMs:36*3600000,source:'CBR daily USD/RUB × Kraken USDT/USD',policy:'daily official reference, not live RUB FX',stableTimestamp:Math.floor(r[2]*1000)};
  }
  async quote(id){
    const i=instrument(id);check(i,'INVALID_PAIR');if(!this.verified.has(id)||this.now()-this.verified.get(id).checkedAt>600000)await this.catalogue();const meta=this.verified.get(id);check(meta?.exists,this.errors[i.provider]||'INSTRUMENT_UNVERIFIED');check(meta.online,'MARKET_CLOSED');let q;
    if(i.provider==='bybit'){const [book,ticker]=await Promise.all([this.request(`https://api.bybit.com/v5/market/orderbook?category=spot&symbol=${i.sourceSymbol}&limit=1`),this.request(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${i.sourceSymbol}`,15000)]);check(book.retCode===0&&book.result?.s===i.sourceSymbol&&ticker.retCode===0,'INVALID_DATA');const b=book.result,t=ticker.result.list.find(t=>t.symbol===i.sourceSymbol);check(t&&Number.isSafeInteger(b.ts),'INVALID_DATA');q={bid:positive(b.b?.[0]?.[0]),ask:positive(b.a?.[0]?.[0]),last:positive(t.lastPrice),timestamp:b.cts||b.ts,eventId:String(b.u),change24h:100*Number(t.price24hPcnt),volume:fixed(t.volume24h),marketOpen:true};}
    else if(i.provider==='binance'){const [trades,ticker]=await Promise.all([this.request(`https://api.binance.com/api/v3/trades?symbol=${i.sourceSymbol}&limit=1`),this.request(`https://api.binance.com/api/v3/ticker/24hr?symbol=${i.sourceSymbol}`,15000)]);check(Array.isArray(trades)&&trades.length===1&&ticker.symbol===i.sourceSymbol,'INVALID_DATA');const t=trades[0];q={bid:positive(t.price),ask:positive(t.price),last:positive(t.price),timestamp:t.time,eventId:String(t.id),change24h:Number(ticker.priceChangePercent),volume:fixed(ticker.volume),marketOpen:true};}
    else {const j=await this.request(`https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/${i.sourceSymbol}.json?iss.meta=off`);const t=tables(j,'marketdata').find(t=>t.SECID===i.sourceSymbol&&t.BOARDID==='TQBR');check(t&&t.LAST!=null&&t.SYSTIME,'QUOTE_UNAVAILABLE');q={bid:positive(t.LAST),ask:positive(t.LAST),last:positive(t.LAST),timestamp:Date.parse(t.SYSTIME.slice(0,10)+'T'+t.UPDATETIME+'+03:00'),eventId:String(t.SEQNUM??t.SYSTIME),change24h:t.LASTTOPREVPRICE==null?null:Number(t.LASTTOPREVPRICE),volume:t.VOLTODAY==null?null:fixed(t.VOLTODAY),marketOpen:t.TRADINGSTATUS==='T'};}
    check(Number.isSafeInteger(q.timestamp)&&units(q.ask)>=units(q.bid),'INVALID_DATA');q={...q,instrumentId:id,provider:i.provider,nativeCurrency:i.currency,receivedAt:this.now(),verified:true,capacity:'1.00000000',multiplier:meta.multiplier,delaySeconds:i.delaySeconds,prices:{},fx:{}};
    if(i.currency==='USDT')q.prices.USDT={buy:q.ask,sell:q.bid};
    else {try{const fx=await this.rubRate();q.fx.USDT=fx;q.prices.USDT=convertPrices(q.bid,q.ask,fx.rate);}catch(e){q.fxError=e.message;}}
    try{const fx=await this.usdcRate();if(q.prices.USDT){q.prices.USDC=convertPrices(q.prices.USDT.sell,q.prices.USDT.buy,fx.rate);q.fx.USDC=i.currency==='RUB'?composeRubUsdcFx(q.fx.USDT,fx):fx;}}catch(e){q.fxError=e.message;}
    return q;
  }
  async historySlot(fn){
    if(this.historyActive>=2){
      check(this.historyQueue.length<8,'SOURCE_BUSY');
      await new Promise((resolve,reject)=>{const entry={resolve};entry.timer=setTimeout(()=>{this.historyQueue=this.historyQueue.filter(x=>x!==entry);reject(new SimError('SOURCE_BUSY'));},2000);this.historyQueue.push(entry);});
    }else this.historyActive++;
    try{return await fn();}finally{const next=this.historyQueue.shift();if(next){clearTimeout(next.timer);next.resolve();}else this.historyActive--;}
  }
  async history(id,interval='15m',before=null){
    const i=instrument(id);check(i&&i.timeframes.includes(interval),'UNSUPPORTED_TIMEFRAME');const end=before?Number(before):null;check(end===null||Number.isSafeInteger(end)&&end>0&&end<=this.now(),'INVALID_RANGE');
    const key=JSON.stringify([id,interval,end]),cached=this.historyCache.get(key);
    if(cached&&cached.until>this.now()){this.metrics.historyCacheHits++;this.historyCache.delete(key);this.historyCache.set(key,cached);return cached.value;}
    if(this.historyFlights.has(key)){this.metrics.historyCoalesced++;return this.historyFlights.get(key);}
    const pending=this.historySlot(async()=>{
      let rows;
      // Cache only the validated, normalized page. The raw provider payload is
      // not retained a second time, and all users share one normalization.
      if(i.provider==='bybit'){const period={ '1m':'1','5m':'5','15m':'15','30m':'30','1h':'60','4h':'240','1D':'D' }[interval];const j=await this.request(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${i.sourceSymbol}&interval=${period}&limit=300${end?'&end='+end:''}`);check(j.retCode===0&&j.result?.symbol===i.sourceSymbol,'INVALID_CANDLES');rows=j.result.list;}
      else if(i.provider==='binance'){rows=await this.request(`https://api.binance.com/api/v3/klines?symbol=${i.sourceSymbol}&interval=${interval==='1D'?'1d':interval}&limit=300${end?'&endTime='+end:''}`);}
      else {const period={'1m':1,'1h':60,'1D':24}[interval];const till=new Date(end||this.now()).toISOString().slice(0,10);const from=new Date((end||this.now())-(interval==='1D'?360:interval==='1h'?14:2)*86400000).toISOString().slice(0,10);const j=await this.request(`https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/${i.sourceSymbol}/candles.json?iss.meta=off&interval=${period}&from=${from}&till=${till}`);rows=tables(j,'candles');}
      const started=performance.now();let candles=parseCandles(rows,i.provider,this.now());if(end)candles=candles.filter(c=>c.time*1000<end);
      for(const candle of candles)Object.freeze(candle);Object.freeze(candles);
      const value=Object.freeze({instrumentId:id,interval,currency:i.currency,provider:i.provider,delaySeconds:i.delaySeconds,candles,receivedAt:this.now()});
      this.metrics.historyParses++;this.metrics.historyParseMs+=performance.now()-started;
      const size=candles.length*256+1024; // Conservative object/array allowance, not only JSON bytes.
      // Expired current pages must not evict still-valid history. Prune on demand,
      // with no timer, prefetch, TTL extension or change to exact cursor identity.
      const cacheNow=this.now();
      for(const [oldKey,old] of this.historyCache){if(old.until<=cacheNow){this.metrics.historyCacheBytes-=old.size;this.historyCache.delete(oldKey);this.metrics.historyCacheExpired++;}}
      const previous=this.historyCache.get(key);if(previous){this.metrics.historyCacheBytes-=previous.size;this.historyCache.delete(key);}
      while(this.historyCache.size&&(this.metrics.historyCacheBytes+size>HISTORY_CACHE_BYTES||this.historyCache.size>=HISTORY_CACHE_PAGES)){const [oldKey,old]=this.historyCache.entries().next().value;this.metrics.historyCacheBytes-=old.size;this.historyCache.delete(oldKey);this.metrics.historyCacheEvictions++;}
      if(size<=HISTORY_CACHE_BYTES){this.historyCache.set(key,{value,size,until:this.now()+(i.provider==='moex'?10000:end?300000:10000)});this.metrics.historyCacheBytes+=size;}
      return value;
    }).finally(()=>this.historyFlights.delete(key));
    this.historyFlights.set(key,pending);return pending;
  }
}
