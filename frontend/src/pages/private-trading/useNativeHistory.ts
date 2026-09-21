import { useCallback,useEffect,useState,useMemo } from 'react';
import { nativeDemoApi,type NativeState,type NativeHistoryItems } from '../../lib/nativeDemoApi';

export interface NativeHistoryDemand { positions:boolean;orders:boolean;chart:boolean }
const EMPTY:NativeHistoryDemand={positions:false,orders:false,chart:false};
type Kind=keyof NativeHistoryItems;
type Pages={revision:number;symbol:string;session:string;positions:NativeHistoryItems['positions'][];orders:NativeHistoryItems['orders'][];
  events:NativeHistoryItems['events'][];entries:NativeHistoryItems['entries'][];
  loaded:boolean;failed:boolean;cursors:Partial<Record<Kind,string|null>>};
const blank=(revision:number,symbol:string,session:string):Pages=>({revision,symbol,session,positions:[],orders:[],events:[],entries:[],loaded:false,failed:false,cursors:{}});

/** Only mounted consumers request history. Chart overlays fetch their selected
 * symbol completely; history tabs fetch one page and expose explicit Load more. */
export function useNativeHistory(state:NativeState|null,enabled:boolean,symbol:string,session:string){
  const empty=(revision:number,symbol:string)=>blank(revision,symbol,session);
  const[demand,setDemand]=useState(EMPTY),[pages,setPages]=useState(()=>empty(0,''));
  const[chart,setChart]=useState(()=>empty(0,'')),[more,setMore]=useState(0);
  const revision=state?.revision??0;
  const kind=demand.positions?'positions':demand.orders?'orders':null;
  useEffect(()=>{
    if(!enabled||!revision||!kind)return;
    const controller=new AbortController();
    setPages(empty(revision,''));setMore(0);
    nativeDemoApi.history(kind,revision,{signal:controller.signal}).then(page=>{
      if(controller.signal.aborted)return;
      setPages({...empty(revision,''),[kind]:page.items,loaded:true,cursors:{[kind]:page.nextCursor}});
    }).catch(()=>{if(!controller.signal.aborted)setPages({...empty(revision,''),failed:true});});
    return()=>controller.abort();
  },[enabled,revision,kind,session]);
  useEffect(()=>{
    if(!more||!enabled||!kind||pages.session!==session)return;
    const cursor=pages.cursors[kind];if(!cursor||pages.revision!==revision)return;
    const controller=new AbortController();
    nativeDemoApi.history(kind,revision,{cursor,signal:controller.signal}).then(page=>{
      if(controller.signal.aborted)return;
      setPages(p=>({...p,[kind]:[...p[kind],...page.items],cursors:{...p.cursors,[kind]:page.nextCursor}}));
    }).catch(()=>{if(!controller.signal.aborted)setPages(p=>({...p,failed:true}));});
    return()=>controller.abort();
    // Cursor is captured once per explicit request; a result must not auto-fetch the next page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[more,session,enabled,revision,kind]);
  useEffect(()=>{
    if(!enabled||!revision||!demand.chart)return;
    const controller=new AbortController();setChart(empty(revision,symbol));
    async function load(){
      const result=empty(revision,symbol);
      for(const k of ['positions','events','entries'] as const){
        let cursor:string|undefined;
        do{
          const page=await nativeDemoApi.history(k,revision,{symbol,cursor,signal:controller.signal});
          // Each array is kept in its own typed bucket.
          if(k==='positions')result.positions.push(...page.items as NativeHistoryItems['positions'][]);
          if(k==='events')result.events.push(...page.items as NativeHistoryItems['events'][]);
          if(k==='entries')result.entries.push(...page.items as NativeHistoryItems['entries'][]);
          cursor=page.nextCursor??undefined;
        }while(cursor&&!controller.signal.aborted);
      }
      if(!controller.signal.aborted)setChart({...result,loaded:true});
    }
    void load().catch(()=>{if(!controller.signal.aborted)setChart({...empty(revision,symbol),failed:true});});
    return()=>controller.abort();
  },[enabled,revision,demand.chart,symbol,session]);
  const current=enabled&&pages.session===session&&pages.revision===revision?pages:empty(revision,'');
  // The empty lazy overlay is data too: allocating it on every book tick would
  // invalidate chart consumers even while no history has been requested.
  const overlay=useMemo(()=>enabled&&chart.session===session&&chart.revision===revision&&chart.symbol===symbol?chart:blank(revision,symbol,session),
    [enabled,chart,session,revision,symbol]);
  const setHistoryDemand=useCallback((next:NativeHistoryDemand)=>setDemand(previous=>
    previous.positions===next.positions&&previous.orders===next.orders&&previous.chart===next.chart?previous:next),[]);
  return{setHistoryDemand,overlay,
    state:state?{...state,history:current.positions,orders:[...state.orders,...current.orders],
      positionHistoryLoaded:kind==='positions'&&current.loaded,orderHistoryLoaded:kind==='orders'&&current.loaded,historyFailed:current.failed}:null,
    historyHasMore:!!(kind&&current.cursors[kind]),loadMoreHistory:()=>setMore(n=>n+1)};
}
