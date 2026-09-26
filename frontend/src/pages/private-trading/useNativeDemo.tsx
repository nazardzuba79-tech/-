import { useCallback,useEffect,useRef,useState,useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getToken,onSessionChange } from '../../lib/api';
import { nativeDemoApi,type NativeState,type NativeDraft,type NativePosition,type NativeEvent } from '../../lib/nativeDemoApi';
import { PrivateTradingError,privateTradingApi,privateErrorText,type PrivateResultCard } from '../../lib/privateTradingApi';
import { NativeCommandLane,acceptsRevision } from '../../lib/nativeCommandLane';
import { withNativeTransportRetry } from '../../lib/nativeTransportRetry';
import { chartExits } from '../../lib/nativeChartExits';
import type { ChartTradeCandle,ChartTradeOverlay,ChartTradingInteraction,ChartCandleLoader } from '../../lib/chartTrading';
import { compactNativeUiState,shouldPollNativeLive,NATIVE_LIVE_POLL_MS } from '../../lib/nativeLivePolicy';
import { useNativeHistory } from './useNativeHistory';
import { createVisibleRead } from '../../lib/visibleRead';

const NATIVE_WARM_PREFIX='voltex:native-state:v2:';
const NATIVE_WARM_MAX_AGE_MS=2*60_000;
const NATIVE_WARM_MAX_BYTES=50_000;
const NATIVE_ACCESS_POLL_MS=60_000;

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

export function useNativeDemo(symbol:string,onSymbol?:(symbol:string)=>void){
  /** THE SERVER DECIDES, NOT THE URL.
   *  This account has no Real/Demo switch and needs no `?demo=1`: the access
   *  endpoint states that it trades the native engine, and the real futures
   *  routes refuse it on the same pinned configuration. `requested` is kept
   *  as the single name the rest of the terminal reads, so nothing below had
   *  to learn that the mode is gone. */
  const[params]=useSearchParams();
  const initialWarm=useRef<NativeState|null>(readWarmState(getToken()));
  const[allowed,setAllowed]=useState(false),[checked,setChecked]=useState(false),[liveState,setState]=useState<NativeState|null>(()=>initialWarm.current);
  const history=useNativeHistory(liveState,allowed,symbol.replace(/[^A-Z0-9]/gi,'').toUpperCase(),sessionScope(getToken())??'');
  const state=history.state;
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
  const[entryIntent,setEntryIntent]=useState(false);
  const[selectedId,setSelectedId]=useState<string|null>(null),[focus,setFocus]=useState<{tradeId:string;time:number;sequence:number}|null>(null);
  const pendingExit=useRef<string|null>(null);
  const alive=useRef(true);
  /** One ordered lane: commands wait their turn, a REFRESH never refuses a CLOSE. See lib/nativeCommandLane. */
  const lane=useRef(new NativeCommandLane());
  /** Idempotency key per draft, kept until that draft succeeds so a retry replays rather than trades twice. */
  const attempts=useRef(new Map<string,string>());
  /** Bumped at every session boundary: a command queued or answered under an older epoch is discarded. */
  const epoch=useRef(0);
  const[dialog,setDialog]=useState<{kind:'close'|'protection'|'leverage';position:NativePosition}|null>(null);
  const commitState=useCallback((next:NativeState)=>{
    // A retried receipt or a slow refresh must not paint an older account
    // over a newer one. Same revision (a refresh that changed nothing) is
    // still applied, because its marks are fresher.
    if(!acceptsRevision(stateRef.current,next))return;
    next=compactNativeUiState(next);
    stateRef.current=next;writeWarmState(getToken(),next);setStateLoaded(true);if(alive.current)setState(next);
  },[]);
  /** A temporary access/control-plane outage makes the cached account
   * read-only; it does not erase true numbers and replace them with dashes. */
  // Preserve the unsent candle through transient access polling failures.
  // Clearing it here previously re-enabled a LIVE order after access recovered.
  // Only a real session boundary or an explicit chart cancellation clears it.
  const suspend=useCallback(()=>{setAllowed(false);setCard(null);setDialog(null);},[]);
  /** A real session boundary MUST clear the transcript so another user can
   * never inherit it — and must orphan every command still in the lane, so
   * a late answer for the previous user is never applied to the next. */
  const resetSession=useCallback(()=>{suspend();setCandle(null);setSelecting(null);setEntryIntent(false);stateRef.current=null;setState(null);setStateLoaded(false);clearWarmState();epoch.current+=1;lane.current.reset();attempts.current.clear();},[suspend]);
  const fail=useCallback((e:unknown)=>{
    if(!alive.current)return;
    if(e instanceof PrivateTradingError&&[401,403].includes(e.status))resetSession();
    const message=privateErrorText(e);errorRef.current=message;setError(message);
  },[resetSession]);
  useEffect(()=>{alive.current=true;const controller=new AbortController();let cancelled=false;
    async function check(){
      if(document.hidden)return;
      try{
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
      }finally{if(!cancelled)setChecked(true);}
    }
    const reader=createVisibleRead(check,NATIVE_ACCESS_POLL_MS,true);
    const off=onSessionChange(()=>{resetSession();setBinding('unknown');setChecked(false);void reader.refresh();});
    return()=>{cancelled=true;alive.current=false;controller.abort();reader.stop();off();};
  },[resetSession,suspend]);
  useEffect(()=>{if(!requested||!allowed)return;let cancelled=false;const controller=new AbortController();
    nativeDemoApi.activate(controller.signal).then(()=>nativeDemoApi.live(controller.signal)).then(s=>{if(!cancelled)commitState(s);}).catch(e=>{if(!cancelled)fail(e);});
    return()=>{cancelled=true;controller.abort();};
  },[requested,allowed,fail,commitState]);
  useEffect(()=>{setCandle(null);setEntryIntent(false);setSelecting(pendingExit.current?'exit':null);setExitId(pendingExit.current);pendingExit.current=null;},[symbol,requested]);
  /**
   * SEND ONE COMMAND, IN TURN, AND ANSWER WITH THE SERVER'S RESULT OR ITS REFUSAL.
   *
   * The structured error (code, status, contract limit) travels to the
   * caller unchanged: the terminal localizes it from the code, and a
   * refusal is never flattened into a generic "not confirmed". `run` below
   * is the boolean convenience the older callers use.
   */
  const execute=useCallback(async(draft:NativeDraft):Promise<NativeState>=>{
    if(!allowed)throw new PrivateTradingError('Торговый счёт недоступен',409,'native_unavailable');
    const started=epoch.current,fingerprint=JSON.stringify(draft),refresh=draft.kind==='REFRESH';
    const orphaned=()=>epoch.current!==started;
    const task=async()=>{
      if(orphaned())throw new PrivateTradingError('Сессия завершена',401,'session_ended');
      if(!refresh){errorRef.current='';setError('');}
      let key=attempts.current.get(fingerprint);if(!key){key=crypto.randomUUID();attempts.current.set(fingerprint,key);}
      // A restarting server is retried under the same key; a refusal is not (see nativeTransportRetry).
      const next=refresh?await nativeDemoApi.live():await withNativeTransportRetry(()=>{
        if(orphaned())throw new PrivateTradingError('Сессия завершена',401,'session_ended');
        return nativeDemoApi.command(draft,key!);
      });
      if(orphaned())throw new PrivateTradingError('Сессия завершена',401,'session_ended');
      attempts.current.delete(fingerprint);commitState(next);return next;
    };
    setBusy(true);
    try{return await lane.current.enqueue(refresh,task);}
    catch(e){if(!(e instanceof PrivateTradingError&&e.code==='session_ended'))fail(e);throw e;}
    finally{if(lane.current.pending===0&&alive.current)setBusy(false);}
  },[allowed,fail,commitState]);
  const run=useCallback(async(draft:NativeDraft)=>{try{await execute(draft);return true;}catch{return false;}},[execute]);
  useEffect(()=>{if(!requested||!allowed)return;
    // A command in flight answers with fresh state anyway; the timer only fills quiet time.
    let timer:ReturnType<typeof setInterval>|null=null;
    const stop=()=>{if(timer!==null)clearInterval(timer);timer=null;};
    const schedule=()=>{stop();if(!document.hidden)timer=setInterval(()=>{if(shouldPollNativeLive(stateRef.current,document.hidden,lane.current.pending))void run({kind:'REFRESH'});},NATIVE_LIVE_POLL_MS);};
    const visible=()=>{schedule();if(!document.hidden)void nativeDemoApi.activate().then(()=>run({kind:'REFRESH'})).catch(fail);};
    schedule();
    document.addEventListener('visibilitychange',visible);
    return()=>{stop();document.removeEventListener('visibilitychange',visible);};
  },[requested,allowed,run,fail]);
  useEffect(()=>{const id=params.get('nativeCard');if(requested&&allowed&&id)nativeDemoApi.getCard(id).then(setCard).catch(fail);},[params,requested,allowed,fail]);
  const initialize=useCallback(async()=>{
    if(!state||!allowed)return;
    const version=state.model.version,started=epoch.current;
    setBusy(true);
    try{await lane.current.enqueue(false,async()=>{if(epoch.current!==started)return;const result=await nativeDemoApi.initialize(version,'initialize-native-account');if(epoch.current===started)commitState(result);});}
    catch(e){fail(e);}
    finally{if(lane.current.pending===0&&alive.current)setBusy(false);}
  },[state,allowed,fail,commitState]);
  async function showCard(id:string){try{const result=await nativeDemoApi.card(id);if(alive.current)setCard(result);}catch(e){fail(e);}}
  const normalized=symbol.replace(/[^A-Z0-9]/gi,'').toUpperCase();
  // Book/ticker renders do not change account overlays. Keep their identity
  // until the actual account, selected contract or lazy history changes.
  const positions=useMemo(()=>[...(state?.positions??[]),...history.overlay.positions],[state?.positions,history.overlay.positions]);
  const trades:ChartTradeOverlay[]=useMemo<ChartTradeOverlay[]>(()=>positions.filter(p=>p.symbol===normalized).map(p=>{
    const entry=(state?.entries??[]).find(e=>e.positionId===p.id)?.candle??history.overlay.entries.find(e=>e.positionId===p.id)?.candle;
    return{id:p.id,symbol:p.symbol,side:p.side,leverage:Number(p.leverage),entryPrice:Number(p.entryPrice),quantity:Number(p.quantity),pnl:Number(p.status==='OPEN'?p.unrealizedPnl:p.netPnl),status:p.status,
      entryTime:p.openedAt,entryCandleOpenTime:entry?.openTime,entryInterval:entry?.interval,entryModel:entry?.pricePoint,
      takeProfit:p.protection.takeProfit===null?null:Number(p.protection.takeProfit),stopLoss:p.protection.stopLoss===null?null:Number(p.protection.stopLoss),liquidationPrice:p.status==='OPEN'&&p.liquidationPrice!==null?Number(p.liquidationPrice):null,
      exits:chartExits(history.overlay.events,p.id)};
  }),[positions,normalized,state?.entries,history.overlay.entries,history.overlay.events]);
  const loader=useCallback<ChartCandleLoader>((pair,interval,limit,signal,endTime)=>privateTradingApi.candles(pair,interval,limit,signal,endTime),[]);
  const interaction=useMemo<ChartTradingInteraction>(()=>({enabled:requested&&allowed&&stateLoaded,selecting,selectedCandle:candle,trades,selectedTradeId:selectedId,focus,
    onCandleSelect:c=>{setCandle(c);setSelecting(null);},onCancelSelection:()=>{setCandle(null);setSelecting(null);setExitId(null);setEntryIntent(false);},onTradeSelect:setSelectedId,
    onTradeClose:id=>{const p=positions.find(p=>p.id===id&&p.status==='OPEN');if(p)setDialog({kind:'close',position:p});},
    onSelectionModeChange:mode=>{setSelecting(mode);setCandle(null);setEntryIntent(mode==='entry');if(mode==='entry')setExitId(null);}}),
    [requested,allowed,stateLoaded,selecting,candle,trades,selectedId,focus,positions]);

  function selectEntry(p:NativePosition){onSymbol?.(p.symbol.replace(/USDT$/,'/USDT'));setSelectedId(p.id);setFocus(f=>({tradeId:p.id,time:p.openedAt,sequence:(f?.sequence??0)+1}));}
  function exitOnChart(p:NativePosition){if(p.symbol!==normalized){pendingExit.current=p.id;onSymbol?.(p.symbol.replace(/USDT$/,'/USDT'));}setSelectedId(p.id);setExitId(p.id);setCandle(null);setSelecting('exit');}
  const getState=useCallback(()=>stateRef.current,[]),getError=useCallback(()=>errorRef.current,[]);
  return{requested,allowed,checked,binding,state,stateLoaded,getState,getError,error,busy,card,setCard,dialog,setDialog,candle,setCandle,entryIntent,exitId,setExitId,selectedId,run,execute,initialize,showCard,interaction,loader,selectEntry,exitOnChart,fail,
    setHistoryDemand:history.setHistoryDemand,historyHasMore:history.historyHasMore,loadMoreHistory:history.loadMoreHistory,
    pickEntry:()=>{setEntryIntent(true);setCandle(null);setExitId(null);setSelecting('entry');}};
}
export type NativeDemoController=ReturnType<typeof useNativeDemo>;
