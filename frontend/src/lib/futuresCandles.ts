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

export async function getFuturesCandles(pair:string, interval:string, limit:number, signal?:AbortSignal, endTime?:number):Promise<{candles:Candle[]}> {
  if (!/^[A-Z0-9]{1,32}\/USDT$/.test(pair) || !intervals[interval] ||
      (endTime !== undefined && (!Number.isSafeInteger(endTime) || endTime <= 0))) throw new Error('Unsupported candle instrument');
  const symbol=pair.replace('/','');
  const query=new URLSearchParams({interval,limit:String(Math.min(1000,Math.max(1,limit))),
    ...(endTime===undefined?{}:{endTime:String(endTime)})});
  const base=import.meta.env.VITE_API_URL || '/api/v1';
  const response=await fetch(`${base}/market/futures/candles/${pair.replace('/','-')}?${query}`,{signal,credentials:'omit'});
  if (!response.ok) throw new Error('Candles unavailable');
  return parseFuturesCandles(await response.json(),symbol);
}
