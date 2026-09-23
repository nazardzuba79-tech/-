import type { Candle } from './indicators';

const intervals:Record<string,string>={'1m':'1','3m':'3','5m':'5','15m':'15','30m':'30','1h':'60','2h':'120','4h':'240','6h':'360','12h':'720','1d':'D','1w':'W'};

export function parseSpotCandles(payload:any,symbol:string):{candles:Candle[]}{
  if(payload?.retCode!==0||payload.result?.category!=='spot'||payload.result?.symbol!==symbol||!Array.isArray(payload.result.list))throw new Error('Invalid spot candle response');
  const candles:Candle[]=payload.result.list.map((row:any)=>{
    if(!Array.isArray(row)||row.length<6)throw new Error('Invalid spot candle');
    const [ms,open,high,low,close,volume]=row.slice(0,6).map(Number);
    if(![ms,open,high,low,close,volume].every(Number.isFinite)||ms<=0||Math.min(open,high,low,close)<=0)return null;
    return{time:ms/1000,open,high,low,close,volume};
  }).filter(Boolean).sort((a:Candle,b:Candle)=>a.time-b.time);
  if(!candles.length)throw new Error('Empty spot candles');
  return{candles};
}
async function getJson(url:string,signal?:AbortSignal){const r=await fetch(url,{signal,credentials:'omit',headers:{Accept:'application/json'}});if(!r.ok)throw new Error('spot_candle_http');return r.json();}
function production(){if(typeof window==='undefined')return false;const h=window.location.hostname;return h==='voltextech.net'||h.endsWith('.voltextech.net');}
export async function getSpotCandles(pair:string,interval:string,limit:number,signal?:AbortSignal):Promise<{candles:Candle[]}>{
  if(!/^[A-Z0-9]{1,32}\/USDT$/.test(pair)||!intervals[interval])throw new Error('Unsupported spot candle instrument');
  if(!production()){
    const base=import.meta.env.VITE_API_URL||'/api/v1';
    const r=await fetch(`${base}/market/external/candles/${pair.replace('/','-')}?interval=${interval}&limit=${Math.min(1000,Math.max(1,limit))}`,{signal,credentials:'omit'});
    if(!r.ok)throw new Error('Candles unavailable');const body=await r.json();return{candles:body.candles};
  }
  const symbol=pair.replace('/',''),provider=intervals[interval],q=new URLSearchParams({category:'spot',symbol,interval:provider,limit:String(Math.min(1000,Math.max(1,limit)))});
  for(const host of ['https://api.bybit.com','https://api.bytick.com']){try{return parseSpotCandles(await getJson(`${host}/v5/market/kline?${q}`,signal),symbol);}catch(e){if(signal?.aborted)throw e;}}
  const body=await getJson(`https://market.voltextech.net/market/display/spot-candles/${pair.replace('/','-')}?interval=${interval}&limit=${Math.min(1000,Math.max(1,limit))}`,signal);
  return{candles:body.candles};
}
