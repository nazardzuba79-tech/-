import type { Candle } from './indicators';
import { subscribeFuturesKline, type FuturesKlineUpdate } from './futuresDepth';

const intervals: Record<string, string> = { '5m':'5', '15m':'15', '1h':'60', '4h':'240', '1d':'D', '1w':'W' };
const REST_CACHE_MS=60_000, STREAM_STALE_MS=90_000, STREAM_IDLE_MS=30_000;
type Cached={candles:Candle[];fetchedAt:number};
type Stream={latest:Candle|null;lastUpdate:number;stop:()=>void;idle:ReturnType<typeof setTimeout>|null};
const historyCache=new Map<string,Cached>(),streams=new Map<string,Stream>();

function productionSite():boolean{
  if(typeof window==='undefined')return false;
  const host=window.location.hostname;
  return host==='voltextech.net'||host.endsWith('.voltextech.net');
}
function cacheKey(pair:string,interval:string){return `${pair}:${interval}`;}
function mergeCandle(rows:Candle[],candle:Candle,limit=1000):Candle[]{
  const map=new Map(rows.map(row=>[row.time,row]));
  map.set(candle.time,candle);
  return [...map.values()].sort((a,b)=>a.time-b.time).slice(-limit);
}
function liveCandle(update:FuturesKlineUpdate):Candle{
  return {time:update.time,open:update.open,high:update.high,low:update.low,close:update.close,volume:update.volume};
}
function touchStream(pair:string,interval:string):Stream|null{
  if(!productionSite())return null;
  const key=cacheKey(pair,interval);
  let stream=streams.get(key);
  if(!stream){
    const holder:Stream={latest:null,lastUpdate:0,stop:()=>{},idle:null};
    holder.stop=subscribeFuturesKline(pair,interval,update=>{
      const candle=liveCandle(update);holder.latest=candle;holder.lastUpdate=Date.now();
      const cached=historyCache.get(key);
      if(cached)historyCache.set(key,{candles:mergeCandle(cached.candles,candle),fetchedAt:cached.fetchedAt});
    });
    stream=holder;streams.set(key,holder);
  }
  if(stream.idle)clearTimeout(stream.idle);
  stream.idle=setTimeout(()=>{const current=streams.get(key);if(current!==stream)return;current.stop();streams.delete(key);},STREAM_IDLE_MS);
  return stream;
}

/** Public reference candles. Exact perpetual identity; never fall back to Spot. */
export function parseFuturesCandles(payload: any, symbol: string): { candles: Candle[] } {
  if (payload?.retCode !== 0 || payload.result?.category !== 'linear' || payload.result?.symbol !== symbol ||
      !Array.isArray(payload.result.list) || payload.result.list.length > 1000) throw new Error('Invalid candle response');
  const candles: Candle[] = payload.result.list.map((row: unknown) => {
    if (!Array.isArray(row) || row.length < 6 || row.slice(0,6).some(v => typeof v !== 'string' || !/^\d+(?:\.\d+)?$/.test(v))) throw new Error('Invalid candle');
    const [ms,open,high,low,close,volume] = row.slice(0,6).map(Number);
    if (![ms,open,high,low,close,volume].every(Number.isFinite) || !Number.isSafeInteger(ms) || ms <= 0 ||
        Math.min(open,high,low,close) <= 0 || low > Math.min(open,close) || high < Math.max(open,close) || volume < 0) throw new Error('Invalid OHLC');
    return { time:ms/1000, open,high,low,close,volume };
  }).sort((a:Candle,b:Candle) => a.time-b.time);
  if (candles.some((c,i) => i > 0 && c.time === candles[i-1].time)) throw new Error('Duplicate candle');
  return { candles };
}

async function fetchPublicJson(url:string, signal?:AbortSignal):Promise<any> {
  const response=await fetch(url,{signal,credentials:'omit',headers:{Accept:'application/json'}});
  if(!response.ok)throw new Error(`candle_http_${response.status}`);
  return response.json();
}

export async function getFuturesCandles(pair:string, interval:string, limit:number, signal?:AbortSignal, endTime?:number):Promise<{candles:Candle[]}> {
  if (!/^[A-Z0-9]{1,32}\/USDT$/.test(pair) || !intervals[interval] ||
      (endTime !== undefined && (!Number.isSafeInteger(endTime) || endTime <= 0))) throw new Error('Unsupported candle instrument');
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  const symbol=pair.replace('/','');

  // CI/local/preview keeps the existing deterministic app endpoint.
  if (!productionSite()) {
    const query=new URLSearchParams({interval,limit:String(Math.min(1000,Math.max(1,limit))),
      ...(endTime===undefined?{}:{endTime:String(endTime)})});
    const base=import.meta.env.VITE_API_URL || '/api/v1';
    const response=await fetch(`${base}/market/futures/candles/${pair.replace('/','-')}?${query}`,{signal,credentials:'omit'});
    if(!response.ok)throw new Error('Candles unavailable');
    return parseFuturesCandles(await response.json(),symbol);
  }

  const key=cacheKey(pair,interval),stream=endTime===undefined?touchStream(pair,interval):null;
  const cached=endTime===undefined?historyCache.get(key):undefined;
  if(cached&&(Date.now()-cached.fetchedAt<REST_CACHE_MS||(stream?.lastUpdate&&Date.now()-stream.lastUpdate<STREAM_STALE_MS))){
    const candles=stream?.latest?mergeCandle(cached.candles,stream.latest,Math.min(1000,Math.max(1,limit))):cached.candles;
    return {candles:candles.slice(-Math.min(1000,Math.max(1,limit)))};
  }

  const providerInterval=intervals[interval];
  const providerQuery=new URLSearchParams({category:'linear',symbol,interval:providerInterval,limit:String(Math.min(1000,Math.max(1,limit))),
    ...(endTime===undefined?{}:{end:String(endTime)})});
  const edgeQuery=new URLSearchParams({interval:providerInterval,limit:String(Math.min(1000,Math.max(1,limit))),
    ...(endTime===undefined?{}:{end:String(endTime)})});

  let result:{candles:Candle[]}|null=null;
  for(const host of ['https://api.bybit.com','https://api.bytick.com']){
    try{result=parseFuturesCandles(await fetchPublicJson(`${host}/v5/market/kline?${providerQuery}`,signal),symbol);break;}
    catch(error){if(signal?.aborted)throw error;}
  }
  if(!result){
    const body=await fetchPublicJson(`https://market.voltextech.net/market/display/futures-candles/${symbol}?${edgeQuery}`,signal);
    result=parseFuturesCandles(body,symbol);
  }

  if(endTime===undefined){
    let candles=result.candles;
    if(stream?.latest)candles=mergeCandle(candles,stream.latest);
    historyCache.set(key,{candles,fetchedAt:Date.now()});
    return {candles:candles.slice(-Math.min(1000,Math.max(1,limit)))};
  }
  return result;
}
