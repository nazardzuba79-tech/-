import type { Candle } from './indicators';

const intervals: Record<string, string> = { '5m':'5', '15m':'15', '1h':'60', '4h':'240', '1d':'D', '1w':'W' };

/** Public reference candles. Exact perpetual identity; never fall back to Spot.
 * https://bybit-exchange.github.io/docs/v5/market/kline */
export function parseFuturesCandles(payload: any, symbol: string): { candles: Candle[] } {
  if (payload?.retCode !== 0 || payload.result?.category !== 'linear' || payload.result?.symbol !== symbol ||
      !Array.isArray(payload.result.list) || payload.result.list.length > 1000) throw new Error('Invalid candle response');
  const candles: Candle[] = payload.result.list.map((row: unknown) => {
    if (!Array.isArray(row) || row.length < 6 || row.slice(0,6).some(v => typeof v !== 'string' || !/^\d+(?:\.\d+)?$/.test(v))) throw new Error('Invalid candle');
    const [ms,open,high,low,close,volume] = row.slice(0,6).map(Number);
    if (![ms,open,high,low,close,volume].every(Number.isFinite) || !Number.isSafeInteger(ms) || ms <= 0 ||
        Math.min(open,high,low,close) <= 0 || low > Math.min(open,close) || high < Math.max(open,close)) throw new Error('Invalid OHLC');
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
  const symbol=pair.replace('/','');
  const providerInterval=intervals[interval];
  const providerQuery=new URLSearchParams({category:'linear',symbol,interval:providerInterval,limit:String(Math.min(1000,Math.max(1,limit))),
    ...(endTime===undefined?{}:{end:String(endTime)})});
  const edgeQuery=new URLSearchParams({interval:providerInterval,limit:String(Math.min(1000,Math.max(1,limit))),
    ...(endTime===undefined?{}:{end:String(endTime)})});

  // Primary path: the visitor's browser talks to Bybit directly. This costs
  // Render, Neon and Cloudflare zero requests when the venue is reachable.
  for(const host of ['https://api.bybit.com','https://api.bytick.com']){
    try{
      return parseFuturesCandles(await fetchPublicJson(`${host}/v5/market/kline?${providerQuery}`,signal),symbol);
    }catch(error){
      if(signal?.aborted)throw error;
    }
  }

  // Regional/CORS fallback only: Cloudflare edge, never Render/Neon.
  const body=await fetchPublicJson(`https://market.voltextech.net/market/display/futures-candles/${symbol}?${edgeQuery}`,signal);
  return parseFuturesCandles(body,symbol);
}
