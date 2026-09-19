import { useCallback,useEffect,useRef,useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getToken,onSessionChange } from '../../lib/api';
import { nativeDemoApi,type NativeState,type NativeDraft,type NativePosition,type NativeEvent } from '../../lib/nativeDemoApi';
import { PrivateTradingError,privateTradingApi,privateErrorText,type PrivateResultCard } from '../../lib/privateTradingApi';
import type { ChartTradeCandle,ChartTradeOverlay,ChartTradingInteraction,ChartCandleLoader } from '../../lib/chartTrading';

const NATIVE_WARM_PREFIX='voltex:native-state:v1:';
const NATIVE_WARM_MAX_AGE_MS=2*60_000;
const NATIVE_WARM_MAX_BYTES=900_000;

/** Scope browser warm state to the exact authenticated session. The token is
 * already stored by the app, but it is never copied into a cache key/value. */
function sessionScope(token:string|null):string|null{
  if(!token||typeof atob!=='function')return null;
  try{
    const part=token.split('.')[1];if(!part)return null;
    const raw=part.replace(/-/g,'+').replace(/_/g,'/');
    const claims=JSON.parse(atob(raw+'='.repeat((4-raw.length%4)%4)));
    return typeof claims?.sub==='string'&&typeof claims?.sid==='string'?`${claims.sub}:${claims.sid}`:null;
  }catch{return null;}
}
function warmStorage():Storage|null{
  try{return typeof window!=='undefined'?window.sessionStorage:null;}catch{return null;}
}
function warmKey(token:string|null){const scope=sessionScope(token);return scope?NATIVE_WARM_PREFIX+scope:null;}
function readWarmState(token:string|null):NativeState|null{
  const storage=warmStorage(),key=warmKey(token);if(!storage||!key)return null;
  try{
    const parsed=JSON.parse(storage.getItem(key)??'null');
    if(!parsed||!Number.isFinite(parsed.at)||Date.now()-parsed.at>NATIVE_WARM_MAX_AGE_MS){storage.removeItem(key);return null;}
    const state=parsed.state;
    if(!state||typeof state.initialized!=='boolean'||!Array.isArray(state.positions)||!Array.isArray(state.history)||!Array.isArray(state.events))return null;
    return state as NativeState;
  }catch{return null;}
}
function writeWarmState(token:string|null,state:NativeState){
  const storage=warmStorage(),key=warmKey(token);if(!storage||!key)return;
  try{const value=JSON.stringify({at:Date.now(),state});if(value.length<=NATIVE_WARM_MAX_BYTES)storage.setItem(key,value);}catch{}
}
function clearWarmState(){
  const storage=warmStorage();if(!storage)return;
  try{for(let i=storage.length-1;i>=0;i--){const key=storage.key(i);if(key?.startsWith(NATIVE_WARM_PREFIX))storage.removeItem(key);}}catch{}
}

/** A market close can consume many depth levels. The engine correctly emits
 * one fill event per level, but the chart is a trade view, not a fill tape:
 * one close action should be one small exit marker. Exact accounting stays
 * in the ledger/events; this aggregation is presentation-only. */
function chartExits(events:NativeEvent[],positionId:string){
  type Exit={time:number;price:number;kind:string;quantity:number;lastTime:number};
  const result:Exit[]=[];
  const source=events.filter(e=>e.positionId===positionId&&['CLOSE','TAKE_PROFIT','STOP_LOSS','LIQUIDATION'].includes(e.kind))
    .filter(e=>e.price!==null&&Number.isFinite(Number(e.price))&&Number.isFinite(Number(e.quantity))&&Number(e.quantity)>0)
    .sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));
  for(const event of source){
    const price=Number(event.price),quantity=Number(event.quantity),previous=result.length?result[result.length-1]:undefined;
    // One observed-book close may be split both by depth and, for a large
    // position, into several contract-valid market orders. Commands from the
    // same click arrive seconds apart, so fold only a short CLOSE burst.
    if(event.kind==='CLOSE'&&previous?.kind==='CLOSE'&&event.time-previous.lastTime<=15_000){
      const total=previous.quantity+quantity;
      previous.price=(previous.price*previous.quantity+price*quantity)/total;
      previous.quantity=total;previous.time=event.time;previous.lastTime=event.time;
    }else result.push({time:event.time,price,kind:event.kind,quantity,lastTime:event.time});
  }
  return result.map(({lastTime:_,...exit})=>exit);
}

export function useNativeDemo(symbol:string,onSymbol?:(symbol:string)=>void){
  /** THE SERVER DECIDES, NOT THE URL.
   *  This account has no Real/Demo switch and needs no `?demo=1`: the access
   *  endpoint states that it trades the native engine, and the real futures
   *  routes refuse it on the same pinned configuration. `requested` is kept
   *  as the single name the rest of the terminal reads, so nothing below had
   *  to learn that the mode is gone. */
  const[params]=useSearchParams();
  const initialWarm=useRef<NativeState|null>(readWarmState(getToken()));
  const[allowed,setAllowed]=useState(false),[checked,setChecked]=useState(false),[state,setState]=useState<NativeState|null>(()=>initialWarm.current);
  // A cached transcript may paint immediately, but can NEVER authorize a
  // write. `stateLoaded` becomes true only after this session hears back from
  // the server (state/command/initialize).
  const[stateLoaded,setStateLoaded]=useState(false);
  const stateRef=useRef<NativeState|null>(initialWarm.current);
  /**
   * WHICH ENGINE THIS ACCOUNT BELONGS TO — a THREE-state answer, and the
   * reason the owner cannot fall through to real trading.
   */
  const[binding,setBinding]=useState<'unknown'|'owner'|'ordinary'>('unknown');
  const requested=binding==='owner'||binding==='unknown';
  const[error,setError]=useState(''),[busy,setBusy]=useState(false),[card,setCard]=useState<PrivateResultCard|null>(null);
  const errorRef=useRef('');
  const[selecting,setSelecting]=useState<'entry'|'exit'|null>(null),[candle,setCandle]=useState<ChartTradeCandle|null>(null),[exitId,setExitId]=useState<string|null>(null);
  const[selectedId,setSelectedId]=useState<string|null>(null),[focus,setFocus]=useState<{tradeId:string;time:number;sequence:number}|null>(null);
  const pendingExit=useRef<string|null>(null);
  const pending=useRef(false),alive=useRef(true),attempt=useRef<{fingerprint:string;key:string}|null>(null);
  const[dialog,setDialog]=useState<{kind:'close'|'protection'|'leverage';position:NativePosition}|null>(null);
  const commitState=useCallback((next:NativeState)=>{
    stateRef.current=next;writeWarmState(getToken(),next);setStateLoaded(true);if(alive.current)setState(next);
  },[]);
  /** A temporary access/control-plane outage makes the cached account
   * read-only; it does not erase true numbers and replace them with dashes. */
  const suspend=useCallback(()=>{setAllowed(false);setCard(null);setDialog(null);setCandle(null);setSelecting(null);},[]);
  /** A real session boundary MUST clear the transcript so another user can
   * never inherit it. */
  const resetSession=useCallback(()=>{suspend();stateRef.current=null;setState(null);setStateLoaded(false);clearWarmState();},[suspend]);
  const fail=useCallback((e:unknown)=>{
    if(!alive.current)return;
    if(e instanceof PrivateTradingError&&[401,403].includes(e.status))resetSession();
    const message=privateErrorText(e);errorRef.current=message;setError(message);
  },[resetSession]);
  useEffect(()=>{alive.current=true;const controller=new AbortController();let cancelled=false;
    async function check(){try{
      if(!getToken()){resetSession();setBinding('ordinary');return;}
      const a=await nativeDemoApi.access(controller.signal);
      if(cancelled)return;
      const owner=a.allowed===true&&a.nativeAvailable===true&&a.simulationOnly===true;
      setAllowed(owner);
      setBinding(current=>owner?'owner':current==='owner'?'owner':'ordinary');
    }catch{
      // Outage, not a verdict. Keep the last server transcript on screen but
      // disable every write until access is confirmed again.
      if(!cancelled)suspend();
    }finally{if(!cancelled)setChecked(true);}}
    void check();const timer=window.setInterval(check,15000),off=onSessionChange(()=>{resetSession();setBinding('unknown');setChecked(false);void check();});
    return()=>{cancelled=true;alive.current=false;controller.abort();clearInterval(timer);off();};
  },[resetSession,suspend]);
  const refreshOnLoad=useRef(false);
  useEffect(()=>{if(!requested||!allowed)return;let cancelled=false;const controller=new AbortController();
    nativeDemoApi.state(controller.signal).then(s=>{if(cancelled)return;commitState(s);refreshOnLoad.current=s.initialized;}).catch(e=>{if(!cancelled)fail(e);});
    return()=>{cancelled=true;controller.abort();};
  },[requested,allowed,fail,commitState]);
  useEffect(()=>{setCandle(null);setSelecting(pendingExit.current?'exit':null);setExitId(pendingExit.current);pendingExit.current=null;},[symbol,requested]);
  const run=useCallback(async(draft:NativeDraft)=>{
    if(pending.current||!allowed)return false;pending.current=true;setBusy(true);errorRef.current='';setError('');
    const fingerprint=JSON.stringify(draft);if(attempt.current?.fingerprint!==fingerprint)attempt.current={fingerprint,key:crypto.randomUUID()};
    try{const next=await nativeDemoApi.command(draft,attempt.current.key);attempt.current=null;commitState(next);return true;}
    catch(e){fail(e);return false;}finally{pending.current=false;if(alive.current)setBusy(false);}
  },[allowed,fail,commitState]);
  // Paint the last verified server state first; then silently revalue it.
  useEffect(()=>{if(refreshOnLoad.current&&state?.initialized&&requested&&allowed){refreshOnLoad.current=false;void run({kind:'REFRESH'});}},[state,requested,allowed,run]);
  useEffect(()=>{if(!requested||!allowed||!state?.initialized)return;
    const timer=window.setInterval(()=>{if(!document.hidden&&!pending.current&&!dialog&&!candle)void run({kind:'REFRESH'});},30000);
    return()=>clearInterval(timer);
  },[requested,allowed,state?.initialized,run,dialog,candle]);
  useEffect(()=>{const id=params.get('nativeCard');if(requested&&allowed&&id)nativeDemoApi.getCard(id).then(setCard).catch(fail);},[params,requested,allowed,fail]);
  const initialize=useCallback(async()=>{
    if(pending.current||!state||!allowed)return;
    pending.current=true;setBusy(true);
    try{const result=await nativeDemoApi.initialize(state.model.version,'initialize-native-account');commitState(result);}
    catch(e){fail(e);}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  },[state,allowed,fail,commitState]);
  async function showCard(id:string){try{const result=await nativeDemoApi.card(id);if(alive.current)setCard(result);}catch(e){fail(e);}}
  const normalized=symbol.replace(/[^A-Z0-9]/gi,'').toUpperCase();
  const positions=[...(state?.positions??[]),...(state?.history??[])];
  const trades:ChartTradeOverlay[]=positions.filter(p=>p.symbol===normalized).map(p=>{
    const entry=state?.entries?.find(e=>e.positionId===p.id)?.candle;
    return{id:p.id,symbol:p.symbol,side:p.side,leverage:Number(p.leverage),entryPrice:Number(p.entryPrice),quantity:Number(p.quantity),pnl:Number(p.status==='OPEN'?p.unrealizedPnl:p.netPnl),status:p.status,
      entryTime:p.openedAt,entryCandleOpenTime:entry?.openTime,entryInterval:entry?.interval,entryModel:entry?.pricePoint,
      takeProfit:p.protection.takeProfit===null?null:Number(p.protection.takeProfit),stopLoss:p.protection.stopLoss===null?null:Number(p.protection.stopLoss),liquidationPrice:p.status==='OPEN'&&p.liquidationPrice!==null?Number(p.liquidationPrice):null,
      exits:chartExits(state?.events??[],p.id)};
  });
  const loader=useCallback<ChartCandleLoader>((pair,interval,limit,signal,endTime)=>privateTradingApi.candles(pair,interval,limit,signal,endTime),[]);
  const interaction:ChartTradingInteraction={enabled:requested&&allowed&&stateLoaded,selecting,selectedCandle:candle,trades,selectedTradeId:selectedId,focus,
    onCandleSelect:c=>{setCandle(c);setSelecting(null);},onCancelSelection:()=>{setCandle(null);setSelecting(null);setExitId(null);},onTradeSelect:setSelectedId,
    onTradeClose:id=>{const p=positions.find(p=>p.id===id&&p.status==='OPEN');if(p)setDialog({kind:'close',position:p});},
    onSelectionModeChange:mode=>{setSelecting(mode);setCandle(null);if(mode==='entry')setExitId(null);}};

  function selectEntry(p:NativePosition){onSymbol?.(p.symbol.replace(/USDT$/,'/USDT'));setSelectedId(p.id);setFocus(f=>({tradeId:p.id,time:p.openedAt,sequence:(f?.sequence??0)+1}));}
  function exitOnChart(p:NativePosition){if(p.symbol!==normalized){pendingExit.current=p.id;onSymbol?.(p.symbol.replace(/USDT$/,'/USDT'));}setSelectedId(p.id);setExitId(p.id);setCandle(null);setSelecting('exit');}
  const getState=useCallback(()=>stateRef.current,[]),getError=useCallback(()=>errorRef.current,[]);
  return{requested,allowed,checked,binding,state,stateLoaded,getState,getError,error,busy,card,setCard,dialog,setDialog,candle,setCandle,exitId,setExitId,selectedId,run,initialize,showCard,interaction,loader,selectEntry,exitOnChart,fail,
    pickEntry:()=>{setCandle(null);setExitId(null);setSelecting('entry');}};
}
export type NativeDemoController=ReturnType<typeof useNativeDemo>;
