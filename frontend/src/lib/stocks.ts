import { useEffect, useState } from 'react';
declare const __VOLTEX_STOCKS_ENABLED__: boolean;
declare const __VOLTEX_STOCKS_ORIGIN__: string;
export const stocksEnabled = typeof __VOLTEX_STOCKS_ENABLED__ !== 'undefined' && __VOLTEX_STOCKS_ENABLED__;
export type StockCandle={openTimeUtc:number;closeTimeUtc:number;open:string;high:string;low:string;close:string;volume:string|null;fetchedAt:number};
export type StockInstrument={instrumentId:string;symbol:string;name:string;type:'stock'|'index';region:'USA'|'Russia'|'Asia';exchange:string;currency:string;exchangeTimeZone:string;logoPath:string|null;latest:StockCandle|null;sessionChange:number|null};
type Entry={data:unknown;updated:number;promise?:Promise<unknown>;controller?:AbortController;users:number};
const cache=new Map<string,Entry>();
const freshness=15*60*1000;
export function useStocks<T>(path:string){
  const [state,setState]=useState<{data?:T;error:boolean}>({error:false});
  useEffect(()=>{
    if(!stocksEnabled)return;
    let alive=true,timer:ReturnType<typeof setTimeout>|undefined;
    let entry=cache.get(path);if(!entry){entry={data:undefined,updated:0,users:0};cache.set(path,entry);}
    entry.users++;const current=entry;
    const schedule=()=>{clearTimeout(timer);if(alive&&!document.hidden)timer=setTimeout(load,Math.max(1000,current.updated+freshness-Date.now()));};
    const load=async()=>{
      if(document.hidden||!alive)return;
      if(current.data&&Date.now()-current.updated<freshness){setState({data:current.data as T,error:false});schedule();return;}
      if(!current.promise||current.controller?.signal.aborted){const controller=new AbortController();current.controller=controller;
        const work=fetch(__VOLTEX_STOCKS_ORIGIN__+path,{signal:controller.signal,credentials:'omit'}).then(r=>{if(!r.ok)throw Error('Unavailable');return r.json();}).then(data=>{current.data=data;current.updated=Date.now();return data;}).finally(()=>{if(current.promise===work){current.promise=undefined;current.controller=undefined;}});current.promise=work;}
      try{const data=await current.promise;if(alive)setState({data:data as T,error:false});}
      catch{if(alive){setState({data:current.data as T|undefined,error:true});timer=setTimeout(load,freshness);}return;}schedule();
    };
    const visibility=()=>{clearTimeout(timer);if(!document.hidden)void load();};
    void load();document.addEventListener('visibilitychange',visibility);
    return()=>{alive=false;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);current.users--;queueMicrotask(()=>{if(!current.users)current.controller?.abort();});
      // At most 12 closed views retained; never cache the entire history archive.
      for(const [key,value]of cache){if(cache.size<=12)break;if(!value.users){value.controller?.abort();cache.delete(key);}}};
  },[path]);return state;
}
