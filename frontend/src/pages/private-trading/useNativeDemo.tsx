import { useCallback,useEffect,useRef,useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getToken,onSessionChange } from '../../lib/api';
import { nativeDemoApi,type NativeState,type NativeDraft,type NativePosition } from '../../lib/nativeDemoApi';
import { PrivateTradingError,privateTradingApi,type PrivateResultCard } from '../../lib/privateTradingApi';
import type { ChartTradeCandle,ChartTradeOverlay,ChartTradingInteraction,ChartCandleLoader } from '../../lib/chartTrading';
export function useNativeDemo(symbol:string,onSymbol?:(symbol:string)=>void){
  /** THE SERVER DECIDES, NOT THE URL.
   *  This account has no Real/Demo switch and needs no `?demo=1`: the access
   *  endpoint states that it trades the native engine, and the real futures
   *  routes refuse it on the same pinned configuration. `requested` is kept
   *  as the single name the rest of the terminal reads, so nothing below had
   *  to learn that the mode is gone. */
  const[params]=useSearchParams();
  const[allowed,setAllowed]=useState(false),[checked,setChecked]=useState(false),[state,setState]=useState<NativeState|null>(null);
  /**
   * WHICH ENGINE THIS ACCOUNT BELONGS TO — a THREE-state answer, and the
   * reason the owner cannot fall through to real trading.
   *
   * 'unknown'  the access verdict has not arrived. Nobody trades, and the
   *            real account store is NOT polled — because at this moment we
   *            do not yet know that polling it is allowed.
   * 'owner'    the server said this account trades the simulation engine.
   *            STICKY for the session: a later failure of `/access` is an
   *            outage, not a demotion, so it can never turn into 'ordinary'
   *            and hand the owner the real engine.
   * 'ordinary' the server said this is a normal account. Only this answer
   *            releases the real path.
   *
   * `allowed` still means "the simulation engine is usable right now", and
   * it does go false on an outage — that blocks trading. `binding` is what
   * decides WHICH engine, and it never moves back.
   */
  const[binding,setBinding]=useState<'unknown'|'owner'|'ordinary'>('unknown');
  const requested=binding==='owner'||binding==='unknown';
  const[error,setError]=useState(''),[busy,setBusy]=useState(false),[card,setCard]=useState<PrivateResultCard|null>(null);
  const[selecting,setSelecting]=useState<'entry'|'exit'|null>(null),[candle,setCandle]=useState<ChartTradeCandle|null>(null),[exitId,setExitId]=useState<string|null>(null);
  const[selectedId,setSelectedId]=useState<string|null>(null),[focus,setFocus]=useState<{tradeId:string;time:number;sequence:number}|null>(null);
  const pendingExit=useRef<string|null>(null);
  const pending=useRef(false),alive=useRef(true),attempt=useRef<{fingerprint:string;key:string}|null>(null);
  const[dialog,setDialog]=useState<{kind:'close'|'protection'|'leverage';position:NativePosition}|null>(null);
  /** Drops the simulation SESSION, never the engine binding: an owner whose
   *  access call just failed is still an owner. Only a real session change
   *  (below) resets the binding to 'unknown'. */
  const revoke=useCallback(()=>{setAllowed(false);setState(null);setCard(null);setDialog(null);setCandle(null);setSelecting(null);},[]);
  const fail=useCallback((e:unknown)=>{if(!alive.current)return;if(e instanceof PrivateTradingError&&[401,403].includes(e.status))revoke();setError(e instanceof Error?e.message:'Операция не подтверждена');},[revoke]);
  useEffect(()=>{alive.current=true;const controller=new AbortController();let cancelled=false;
    async function check(){try{
      if(!getToken()){revoke();setBinding('ordinary');return;}
      const a=await nativeDemoApi.access(controller.signal);
      if(cancelled)return;
      const owner=a.allowed===true&&a.nativeAvailable===true&&a.simulationOnly===true;
      setAllowed(owner);
      // An answer moves the binding; a FAILURE below never does.
      setBinding(current=>owner?'owner':current==='owner'?'owner':'ordinary');
    }catch(e){
      // Outage, not a verdict. The session is dropped so nothing trades,
      // but an account already known to be the owner's stays the owner's.
      if(!cancelled)revoke();
    }finally{if(!cancelled)setChecked(true);}}
    void check();const timer=window.setInterval(check,15000),off=onSessionChange(()=>{revoke();setBinding('unknown');setChecked(false);void check();});
    return()=>{cancelled=true;alive.current=false;controller.abort();clearInterval(timer);off();};
  },[revoke]);
  const refreshOnLoad=useRef(false);
  useEffect(()=>{if(!requested||!allowed)return;let cancelled=false;const controller=new AbortController();
    nativeDemoApi.state(controller.signal).then(s=>{if(cancelled)return;setState(s);refreshOnLoad.current=s.initialized;}).catch(e=>{if(!cancelled)fail(e);});
    return()=>{cancelled=true;controller.abort();};
  },[requested,allowed,fail]);
  useEffect(()=>{setCandle(null);setSelecting(pendingExit.current?'exit':null);setExitId(pendingExit.current);pendingExit.current=null;},[symbol,requested]);
  const run=useCallback(async(draft:NativeDraft)=>{
    if(pending.current||!allowed)return false;pending.current=true;setBusy(true);setError('');
    const fingerprint=JSON.stringify(draft);if(attempt.current?.fingerprint!==fingerprint)attempt.current={fingerprint,key:crypto.randomUUID()};
    try{const next=await nativeDemoApi.command(draft,attempt.current.key);attempt.current=null;if(alive.current)setState(next);return true;}
    catch(e){fail(e);return false;}finally{pending.current=false;if(alive.current)setBusy(false);}
  },[allowed,fail]);
  // The stored revision may be older than the live quote: revalue once right after loading.
  useEffect(()=>{if(refreshOnLoad.current&&state?.initialized&&requested&&allowed){refreshOnLoad.current=false;void run({kind:'REFRESH'});}},[state,requested,allowed,run]);
  useEffect(()=>{if(!requested||!allowed||!state?.initialized)return;
    const timer=window.setInterval(()=>{if(!document.hidden&&!pending.current&&!dialog&&!candle)void run({kind:'REFRESH'});},30000);
    return()=>clearInterval(timer);
  },[requested,allowed,state?.initialized,run,dialog,candle]);
  useEffect(()=>{const id=params.get('nativeCard');if(requested&&allowed&&id)nativeDemoApi.getCard(id).then(setCard).catch(fail);},[params,requested,allowed,fail]);
  /**
   * Open the account, at most once.
   *
   * Three guards, and they are layered on purpose because they fail at
   * different moments. `pending.current` is set SYNCHRONOUSLY before the
   * await, so a double click cannot get two requests past it — the second
   * click runs while the first is still in flight and returns immediately.
   * The idempotency key is fixed rather than random, so a retry, a second
   * tab or a reload that races the first attempt is the same request to the
   * server and is deduplicated there. And the server checks the owner
   * binding and the accepted model on top of both.
   *
   * `useCallback` is not cosmetic: the execution seam memoizes on this
   * identity, and a fresh function every render would rebuild the whole
   * execution object on every tick.
   */
  const initialize=useCallback(async()=>{
    if(pending.current||!state||!allowed)return;
    pending.current=true;setBusy(true);
    try{const result=await nativeDemoApi.initialize(state.model.version,'initialize-native-account');if(alive.current)setState(result);}
    catch(e){fail(e);}
    finally{pending.current=false;if(alive.current)setBusy(false);}
  },[state,allowed,fail]);
  async function showCard(id:string){try{const result=await nativeDemoApi.card(id);if(alive.current)setCard(result);}catch(e){fail(e);}}
  const normalized=symbol.replace(/[^A-Z0-9]/gi,'').toUpperCase();
  const positions=[...(state?.positions??[]),...(state?.history??[])];
  const trades:ChartTradeOverlay[]=positions.filter(p=>p.symbol===normalized).map(p=>{
    const entry=state?.entries?.find(e=>e.positionId===p.id)?.candle;
    return{id:p.id,symbol:p.symbol,side:p.side,leverage:Number(p.leverage),entryPrice:Number(p.entryPrice),quantity:Number(p.quantity),pnl:Number(p.status==='OPEN'?p.unrealizedPnl:p.netPnl),status:p.status,
      entryTime:p.openedAt,entryCandleOpenTime:entry?.openTime,entryInterval:entry?.interval,entryModel:entry?.pricePoint,
      takeProfit:p.protection.takeProfit===null?null:Number(p.protection.takeProfit),stopLoss:p.protection.stopLoss===null?null:Number(p.protection.stopLoss),liquidationPrice:p.status==='OPEN'&&p.liquidationPrice!==null?Number(p.liquidationPrice):null,
      exits:(state?.events??[]).filter(e=>e.positionId===p.id&&['CLOSE','TAKE_PROFIT','STOP_LOSS','LIQUIDATION'].includes(e.kind)).map(e=>({time:e.time,price:Number(e.price),kind:e.kind,quantity:Number(e.quantity)}))};
  });
  const loader=useCallback<ChartCandleLoader>((pair,interval,limit,signal,endTime)=>privateTradingApi.candles(pair,interval,limit,signal,endTime),[]);
  const interaction:ChartTradingInteraction={enabled:requested&&allowed,selecting,selectedCandle:candle,trades,selectedTradeId:selectedId,focus,
    onCandleSelect:c=>{setCandle(c);setSelecting(null);},onCancelSelection:()=>{setCandle(null);setSelecting(null);setExitId(null);},onTradeSelect:setSelectedId,
    onTradeClose:id=>{const p=positions.find(p=>p.id===id&&p.status==='OPEN');if(p)setDialog({kind:'close',position:p});},
    onSelectionModeChange:mode=>{setSelecting(mode);setCandle(null);if(mode==='entry')setExitId(null);}};

  function selectEntry(p:NativePosition){onSymbol?.(p.symbol.replace(/USDT$/,'/USDT'));setSelectedId(p.id);setFocus(f=>({tradeId:p.id,time:p.openedAt,sequence:(f?.sequence??0)+1}));}
  function exitOnChart(p:NativePosition){if(p.symbol!==normalized){pendingExit.current=p.id;onSymbol?.(p.symbol.replace(/USDT$/,'/USDT'));}setSelectedId(p.id);setExitId(p.id);setCandle(null);setSelecting('exit');}
  return{requested,allowed,checked,binding,state,error,busy,card,setCard,dialog,setDialog,candle,setCandle,exitId,setExitId,selectedId,run,initialize,showCard,interaction,loader,selectEntry,exitOnChart,fail,
    pickEntry:()=>{setCandle(null);setExitId(null);setSelecting('entry');}};
}
export type NativeDemoController=ReturnType<typeof useNativeDemo>;
