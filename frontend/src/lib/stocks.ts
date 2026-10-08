import { useCallback, useEffect, useState } from 'react';
declare const __VOLTEX_STOCKS_ENABLED__: boolean;
declare const __VOLTEX_STOCKS_ORIGIN__: string;
export const stocksEnabled = typeof __VOLTEX_STOCKS_ENABLED__ !== 'undefined' && __VOLTEX_STOCKS_ENABLED__;
const stocksOrigin = typeof __VOLTEX_STOCKS_ORIGIN__ !== 'undefined' ? __VOLTEX_STOCKS_ORIGIN__ : '';
export type StockCandle={openTimeUtc:number;closeTimeUtc:number;open:string;high:string;low:string;close:string;volume:string|null;fetchedAt:number};
export type StockInstrument={instrumentId:string;symbol:string;name:string;type:'stock'|'index';region:'USA'|'Russia'|'Asia';country:string;exchange:string;currency:string;exchangeTimeZone:string;logoPath:string|null;latest:StockCandle|null;sessionChange:number|null};
export type StockCatalogue={instruments:StockInstrument[]};
export type StockHistory={instrumentId?:string;currency?:string;adjustmentMode?:string;candles:StockCandle[];next:number|null};
export type StockRead<T>={data?:T;error:boolean;loading:boolean;retry:()=>void};
type Entry={data:unknown;updated:number;promise?:Promise<unknown>;controller?:AbortController;users:number};
const cache=new Map<string,Entry>();
const freshness=15*60*1000;
// The stock reader's own deadline is 10 s; a request still open after that is an error, not a spinner.
const timeoutMs=12_000;
export const catalogueHistoryPath=(instrumentId:string)=>'/stocks/history/'+encodeURIComponent(instrumentId);
const fresh=(entry:Entry|undefined)=>entry?.data!==undefined&&Date.now()-entry.updated<freshness;
/**
 * One shared read per path: deduplicated, cached for 15 minutes, paused while
 * the tab is hidden. State belongs to the path it was read for, so a late
 * answer for the previous instrument can never be shown under the next one.
 */
export function useStocks<T>(path:string):StockRead<T>{
  const [state,setState]=useState<{path:string;data?:T;error:boolean;loading:boolean}>(()=>({path,data:fresh(cache.get(path))?cache.get(path)!.data as T:undefined,error:false,loading:!fresh(cache.get(path))}));
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    if(!stocksEnabled)return;
    let alive=true,timer:ReturnType<typeof setTimeout>|undefined;
    let entry=cache.get(path);if(!entry){entry={data:undefined,updated:0,users:0};cache.set(path,entry);}
    entry.users++;const current=entry;
    const commit=(next:{data?:T;error:boolean;loading:boolean})=>{if(alive)setState({path,...next});};
    const schedule=()=>{clearTimeout(timer);if(alive&&!document.hidden)timer=setTimeout(load,Math.max(1000,current.updated+freshness-Date.now()));};
    const load=async()=>{
      if(document.hidden||!alive)return;
      if(fresh(current)){commit({data:current.data as T,error:false,loading:false});schedule();return;}
      commit({data:current.data as T|undefined,error:false,loading:true});
      if(!current.promise||current.controller?.signal.aborted){const controller=new AbortController();current.controller=controller;
        const deadline=setTimeout(()=>controller.abort(),timeoutMs);
        const work=fetch(stocksOrigin+path,{signal:controller.signal,credentials:'omit'}).then(r=>{if(!r.ok)throw Error('Unavailable');return r.json();}).then(data=>{current.data=data;current.updated=Date.now();return data;}).finally(()=>{clearTimeout(deadline);if(current.promise===work){current.promise=undefined;current.controller=undefined;}});current.promise=work;}
      try{const data=await current.promise;commit({data:data as T,error:false,loading:false});}
      catch{commit({data:current.data as T|undefined,error:true,loading:false});if(alive)timer=setTimeout(load,freshness);return;}schedule();
    };
    const visibility=()=>{clearTimeout(timer);if(!document.hidden)void load();};
    void load();document.addEventListener('visibilitychange',visibility);
    return()=>{alive=false;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);current.users--;queueMicrotask(()=>{if(!current.users)current.controller?.abort();});
      // At most 12 closed views retained; never cache the entire history archive.
      for(const [key,value]of cache){if(cache.size<=12)break;if(!value.users){value.controller?.abort();cache.delete(key);}}};
  },[path,attempt]);
  // Only an explicit user action re-reads before the 15-minute window ends.
  const retry=useCallback(()=>{const entry=cache.get(path);if(entry&&!entry.promise)entry.updated=0;setAttempt(n=>n+1);},[path]);
  if(state.path!==path){const entry=cache.get(path);return {data:fresh(entry)?entry!.data as T:undefined,error:false,loading:!fresh(entry),retry};}
  return {data:state.data,error:state.error,loading:state.loading,retry};
}
