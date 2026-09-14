import { useCallback,useEffect,useRef,useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getToken,onSessionChange } from '../../lib/api';
import { nativeDemoApi,type NativeState,type NativeDraft,type NativePosition } from '../../lib/nativeDemoApi';
import { PrivateTradingError,privateTradingApi,type PrivateResultCard } from '../../lib/privateTradingApi';
import type { ChartTradeCandle,ChartTradeOverlay,ChartTradingInteraction,ChartCandleLoader } from '../../lib/chartTrading';
export function useNativeDemo(symbol:string,onSymbol?:(symbol:string)=>void){
  const[params,setParams]=useSearchParams(),requested=params.get('demo')==='1'||params.get('privateTrading')==='1';
  const[allowed,setAllowed]=useState(false),[checked,setChecked]=useState(false),[state,setState]=useState<NativeState|null>(null);
  const[error,setError]=useState(''),[busy,setBusy]=useState(false),[card,setCard]=useState<PrivateResultCard|null>(null);
  const[selecting,setSelecting]=useState<'entry'|'exit'|null>(null),[candle,setCandle]=useState<ChartTradeCandle|null>(null),[exitId,setExitId]=useState<string|null>(null);
  const[selectedId,setSelectedId]=useState<string|null>(null),[focus,setFocus]=useState<{tradeId:string;time:number;sequence:number}|null>(null);
  const pendingExit=useRef<string|null>(null);
  const pending=useRef(false),alive=useRef(true),attempt=useRef<{fingerprint:string;key:string}|null>(null);
  const[dialog,setDialog]=useState<{kind:'close'|'protection'|'leverage';position:NativePosition}|null>(null);
  const revoke=useCallback(()=>{setAllowed(false);setState(null);setCard(null);setDialog(null);setCandle(null);setSelecting(null);},[]);
  const fail=useCallback((e:unknown)=>{if(!alive.current)return;if(e instanceof PrivateTradingError&&[401,403].includes(e.status))revoke();setError(e instanceof Error?e.message:'Операция не подтверждена');},[revoke]);
  useEffect(()=>{alive.current=true;const controller=new AbortController();let cancelled=false;
    async function check(){try{if(!getToken()){revoke();return;}const a=await nativeDemoApi.access(controller.signal);if(!cancelled)setAllowed(a.allowed===true&&a.nativeAvailable===true);}catch(e){if(!cancelled)revoke();}finally{if(!cancelled)setChecked(true);}}
    void check();const timer=window.setInterval(check,15000),off=onSessionChange(()=>{revoke();void check();});
    return()=>{cancelled=true;alive.current=false;controller.abort();clearInterval(timer);off();};
  },[revoke]);
  useEffect(()=>{if(!requested||!allowed)return;let cancelled=false;const controller=new AbortController();
    nativeDemoApi.state(controller.signal).then(s=>{if(!cancelled)setState(s);}).catch(e=>{if(!cancelled)fail(e);});
    return()=>{cancelled=true;controller.abort();};
  },[requested,allowed,fail]);
  useEffect(()=>{setCandle(null);setSelecting(pendingExit.current?'exit':null);setExitId(pendingExit.current);pendingExit.current=null;},[symbol,requested]);
  const run=useCallback(async(draft:NativeDraft)=>{
    if(pending.current||!allowed)return false;pending.current=true;setBusy(true);setError('');
    const fingerprint=JSON.stringify(draft);if(attempt.current?.fingerprint!==fingerprint)attempt.current={fingerprint,key:crypto.randomUUID()};
    try{const next=await nativeDemoApi.command(draft,attempt.current.key);attempt.current=null;if(alive.current)setState(next);return true;}
    catch(e){fail(e);return false;}finally{pending.current=false;if(alive.current)setBusy(false);}
  },[allowed,fail]);
  useEffect(()=>{if(!requested||!allowed||!state?.initialized)return;
    const timer=window.setInterval(()=>{if(!document.hidden&&!pending.current&&!dialog&&!candle)void run({kind:'REFRESH'});},30000);
    return()=>clearInterval(timer);
  },[requested,allowed,state?.initialized,run,dialog,candle]);
  useEffect(()=>{const id=params.get('nativeCard');if(requested&&allowed&&id)nativeDemoApi.getCard(id).then(setCard).catch(fail);},[params,requested,allowed,fail]);
  async function initialize(){if(pending.current||!state||!allowed)return;pending.current=true;setBusy(true);try{const result=await nativeDemoApi.initialize(state.model.version,'initialize-native-account');if(alive.current)setState(result);}catch(e){fail(e);}finally{pending.current=false;if(alive.current)setBusy(false);}}
  async function showCard(id:string){try{const result=await nativeDemoApi.card(id);if(alive.current)setCard(result);}catch(e){fail(e);}}
  const normalized=symbol.replace(/[^A-Z0-9]/gi,'').toUpperCase();
  const positions=[...(state?.positions??[]),...(state?.history??[])];
  const trades:ChartTradeOverlay[]=positions.filter(p=>p.symbol===normalized).map(p=>{
    const entry=state?.entries?.find(e=>e.positionId===p.id)?.candle;
    return{id:p.id,symbol:p.symbol,side:p.side,leverage:Number(p.leverage),entryPrice:Number(p.entryPrice),quantity:Number(p.quantity),pnl:Number(p.status==='OPEN'?p.unrealizedPnl:p.netPnl),status:p.status,
      entryTime:p.openedAt,entryCandleOpenTime:entry?.openTime,entryInterval:entry?.interval,entryModel:entry?.pricePoint,
      takeProfit:p.protection.takeProfit===null?null:Number(p.protection.takeProfit),stopLoss:p.protection.stopLoss===null?null:Number(p.protection.stopLoss),liquidationPrice:null,
      exits:(state?.events??[]).filter(e=>e.positionId===p.id&&['CLOSE','TAKE_PROFIT','STOP_LOSS','LIQUIDATION'].includes(e.kind)).map(e=>({time:e.time,price:Number(e.price),kind:e.kind,quantity:Number(e.quantity)}))};
  });
  const loader=useCallback<ChartCandleLoader>((pair,interval,limit,signal,endTime)=>privateTradingApi.candles(pair,interval,limit,signal,endTime),[]);
  const interaction:ChartTradingInteraction={enabled:requested&&allowed,selecting,selectedCandle:candle,trades,selectedTradeId:selectedId,focus,
    onCandleSelect:c=>{setCandle(c);setSelecting(null);},onCancelSelection:()=>{setCandle(null);setSelecting(null);setExitId(null);},onTradeSelect:setSelectedId,
    onTradeClose:id=>{const p=positions.find(p=>p.id===id&&p.status==='OPEN');if(p)setDialog({kind:'close',position:p});},
    onSelectionModeChange:mode=>{setSelecting(mode);setCandle(null);if(mode==='entry')setExitId(null);}};
  const toggle=(demo:boolean)=>{const next=new URLSearchParams(params);next.delete('privateTrading');next.delete('nativeCard');if(demo)next.set('demo','1');else next.delete('demo');setParams(next);};
  function selectEntry(p:NativePosition){onSymbol?.(p.symbol.replace(/USDT$/,'/USDT'));setSelectedId(p.id);setFocus(f=>({tradeId:p.id,time:p.openedAt,sequence:(f?.sequence??0)+1}));}
  function exitOnChart(p:NativePosition){if(p.symbol!==normalized){pendingExit.current=p.id;onSymbol?.(p.symbol.replace(/USDT$/,'/USDT'));}setSelectedId(p.id);setExitId(p.id);setCandle(null);setSelecting('exit');}
  return{requested,allowed,checked,state,error,busy,card,setCard,dialog,setDialog,candle,setCandle,exitId,setExitId,selectedId,toggle,run,initialize,showCard,interaction,loader,selectEntry,exitOnChart,fail,
    pickEntry:()=>{setCandle(null);setExitId(null);setSelecting('entry');}};
}
export type NativeDemoController=ReturnType<typeof useNativeDemo>;
