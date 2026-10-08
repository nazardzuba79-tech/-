import { useCallback, useEffect, useRef, useState } from 'react';
declare const __VOLTEX_STOCKS_ENABLED__: boolean;
declare const __VOLTEX_STOCKS_ORIGIN__: string;
export const stocksEnabled = typeof __VOLTEX_STOCKS_ENABLED__ !== 'undefined' && __VOLTEX_STOCKS_ENABLED__;
const stocksOrigin = typeof __VOLTEX_STOCKS_ORIGIN__ !== 'undefined' ? __VOLTEX_STOCKS_ORIGIN__ : '';
export type StockCandle={openTimeUtc:number;closeTimeUtc:number;open:string;high:string;low:string;close:string;volume:string|null;fetchedAt:number};
export type StockInstrument={instrumentId:string;symbol:string;name:string;type:'stock'|'index';region:'USA'|'Russia'|'Asia';country:string;exchange:string;currency:string;exchangeTimeZone:string;logoPath:string|null;latest:StockCandle|null;sessionChange:number|null};
export type StockCatalogue={instruments:StockInstrument[]};
export type StockHistory={instrumentId?:string;currency?:string;adjustmentMode?:string;candles:StockCandle[];next:number|null};
/** Why the last read failed: no usable answer, or an answer that does not pass the contract check. */
export type StockFailure='unavailable'|'invalid';
/**
 * `data` is the last answer that passed the check for this path (it survives a
 * failed refresh); `error`/`failure` describe the latest attempt and stay set
 * until a read succeeds; `loading` is an attempt in flight, never an error.
 */
export type StockRead<T>={data?:T;error:boolean;failure?:StockFailure;loading:boolean;retry:()=>void};
type Entry={data:unknown;updated:number;failure?:StockFailure;promise?:Promise<unknown>;controller?:AbortController;users:number};
const cache=new Map<string,Entry>();
const freshness=15*60*1000;
// The stock reader's own deadline is 10 s; a request still open after that is an error, not a spinner.
const timeoutMs=12_000;
export const catalogueHistoryPath=(instrumentId:string)=>'/stocks/history/'+encodeURIComponent(instrumentId);
const fresh=(entry:Entry|undefined)=>entry?.data!==undefined&&Date.now()-entry.updated<freshness;
class InvalidBody extends Error {}

// Contract of services/stocks/server.mjs, checked before an answer can enter the cache.
const DECIMAL=/^(?:0|[1-9]\d{0,14})(?:\.\d{1,12})?$/;
const CANONICAL=/^[A-Z0-9]{4}:[A-Za-z0-9._-]{1,24}$/;
const isRecord=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const isDecimal=(v:unknown):v is string=>typeof v==='string'&&DECIMAL.test(v);
const isText=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
function isCandle(v:unknown):v is StockCandle{
  if(!isRecord(v)||!Number.isSafeInteger(v.openTimeUtc)||!Number.isSafeInteger(v.closeTimeUtc)||(v.closeTimeUtc as number)-(v.openTimeUtc as number)!==900000||!Number.isSafeInteger(v.fetchedAt))return false;
  if(![v.open,v.high,v.low,v.close].every(isDecimal)||!(v.volume===null||isDecimal(v.volume)))return false;
  // Rounding to a double is monotonic, so a valid candle never fails this.
  const [o,h,l,c]=[v.open,v.high,v.low,v.close].map(Number);
  return l>0&&l<=Math.min(o,c)&&h>=Math.max(o,c);
}
function isInstrument(v:unknown):v is StockInstrument{
  return isRecord(v)&&typeof v.instrumentId==='string'&&CANONICAL.test(v.instrumentId)&&isText(v.symbol)&&isText(v.name)&&(v.type==='stock'||v.type==='index')
    &&(v.region==='USA'||v.region==='Russia'||v.region==='Asia')&&isText(v.country)&&isText(v.exchange)&&typeof v.currency==='string'&&/^[A-Z]{3}$/.test(v.currency)
    &&isText(v.exchangeTimeZone)&&(v.logoPath===null||typeof v.logoPath==='string')&&(v.latest===null||isCandle(v.latest))
    &&(v.sessionChange===null||(typeof v.sessionChange==='number'&&Number.isFinite(v.sessionChange)));
}
export function isStockCatalogue(body:unknown):body is StockCatalogue{
  if(!isRecord(body)||!Array.isArray(body.instruments)||body.instruments.length>250||!body.instruments.every(isInstrument))return false;
  return new Set(body.instruments.map(i=>i.instrumentId)).size===body.instruments.length;
}
/**
 * A history page belongs to this instrument or is rejected. The server's
 * empty answer for a disabled instrument (`{"candles":[],"next":null}`)
 * carries no id and is a valid "no history yet"; candles without an id, with
 * another id or another currency are not this instrument's.
 */
export function stockHistoryCheck(instrument:Pick<StockInstrument,'instrumentId'|'currency'>){
  return (body:unknown):body is StockHistory=>{
    if(!isRecord(body)||!Array.isArray(body.candles)||body.candles.length>500)return false;
    if(!(body.next===null||(Number.isSafeInteger(body.next)&&(body.next as number)>=0)))return false;
    if(body.instrumentId===undefined?body.candles.length>0:body.instrumentId!==instrument.instrumentId)return false;
    if(body.currency!==undefined&&body.currency!==instrument.currency)return false;
    if(body.adjustmentMode!==undefined&&typeof body.adjustmentMode!=='string')return false;
    let last=-Infinity;
    for(const candle of body.candles){if(!isCandle(candle)||candle.openTimeUtc<=last)return false;last=candle.openTimeUtc;}
    return true;
  };
}

/**
 * One shared read per path: deduplicated, cached for 15 minutes, paused while
 * the tab is hidden. State belongs to the path it was read for, so a late
 * answer for the previous instrument can never be shown under the next one.
 * An optional check runs before an answer is cached: a failing answer is an
 * `invalid` error and the last valid answer stays.
 */
export function useStocks<T>(path:string,accept?:(body:unknown)=>boolean):StockRead<T>{
  const snapshot=()=>{const entry=cache.get(path);return {path,data:entry?.data as T|undefined,error:!!entry?.failure,failure:entry?.failure,loading:!fresh(entry)};};
  const [state,setState]=useState<{path:string;data?:T;error:boolean;failure?:StockFailure;loading:boolean}>(snapshot);
  const [attempt,setAttempt]=useState(0);
  const acceptRef=useRef(accept);acceptRef.current=accept;
  useEffect(()=>{
    if(!stocksEnabled)return;
    let alive=true,timer:ReturnType<typeof setTimeout>|undefined;
    let entry=cache.get(path);if(!entry){entry={data:undefined,updated:0,users:0};cache.set(path,entry);}
    entry.users++;const current=entry;
    const commit=(loading:boolean)=>{if(alive)setState({path,data:current.data as T|undefined,error:!!current.failure,failure:current.failure,loading});};
    const schedule=()=>{clearTimeout(timer);if(alive&&!document.hidden)timer=setTimeout(load,Math.max(1000,current.updated+freshness-Date.now()));};
    const load=async()=>{
      if(document.hidden||!alive)return;
      if(fresh(current)&&!current.failure){commit(false);schedule();return;}
      commit(true);
      if(!current.promise||current.controller?.signal.aborted){const controller=new AbortController();current.controller=controller;
        let timedOut=false;const check=acceptRef.current;
        const deadline=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
        const work=fetch(stocksOrigin+path,{signal:controller.signal,credentials:'omit'})
          .then(r=>{if(!r.ok)throw Error('Unavailable');return r.json().catch(()=>{throw new InvalidBody();});})
          .then(data=>{if(check&&!check(data))throw new InvalidBody();current.data=data;current.updated=Date.now();current.failure=undefined;return data;})
          // Leaving the page aborts the read; that is not a failure to report.
          .catch(error=>{if(!controller.signal.aborted||timedOut)current.failure=error instanceof InvalidBody?'invalid':'unavailable';throw error;})
          .finally(()=>{clearTimeout(deadline);if(current.promise===work){current.promise=undefined;current.controller=undefined;}});
        current.promise=work;}
      try{await current.promise;commit(false);}
      catch{commit(false);if(alive)timer=setTimeout(load,freshness);return;}schedule();
    };
    const visibility=()=>{clearTimeout(timer);if(!document.hidden)void load();};
    void load();document.addEventListener('visibilitychange',visibility);
    return()=>{alive=false;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);current.users--;queueMicrotask(()=>{if(!current.users)current.controller?.abort();});
      // At most 12 closed views retained; never cache the entire history archive.
      for(const [key,value]of cache){if(cache.size<=12)break;if(!value.users){value.controller?.abort();cache.delete(key);}}};
  },[path,attempt]);
  // Only an explicit user action re-reads before the 15-minute window ends; a
  // read already in flight is joined, never duplicated.
  const retry=useCallback(()=>{const entry=cache.get(path);if(entry&&!entry.promise)entry.updated=0;setAttempt(n=>n+1);},[path]);
  const view=state.path===path?state:snapshot();
  return {data:view.data,error:view.error,failure:view.failure,loading:view.loading,retry};
}
