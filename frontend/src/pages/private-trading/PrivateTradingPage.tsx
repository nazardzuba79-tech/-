import { useCallback,useEffect,useRef,useState } from 'react';
import { Link,useSearchParams } from 'react-router-dom';
import { LockKeyhole,RefreshCw } from 'lucide-react';
import { api,onSessionChange } from '../../lib/api';
import { discoverFuturesSymbols } from '../../lib/futuresDiscovery';
import { Nav } from '../../components/Nav';
import { FuturesPairList } from '../../components/FuturesPairList';
import { TerminalChart } from '../../components/TerminalChart';
import { FuturesReferenceBook } from '../../components/FuturesReferenceBook';
import { privateTradingApi,PrivateTradingError,privateErrorText,privateNumber,privateUtc,privateRefreshDraft,type PrivateMarket,type PrivatePreview,type PrivatePreviewRequest,type PrivateResultCard,type PrivateState } from '../../lib/privateTradingApi';
import { PrivateOrderTicket } from './PrivateOrderTicket';
import { PrivatePositions,PrivatePositionDialog,type PrivatePositionAction } from './PrivatePositions';
import { PrivateResultCardDialog } from './PrivateResultCardDialog';
import { PrivateLinkedCard } from './PrivateLinkedCard';
import { PrivateChartTicket } from './PrivateChartTicket';
import { usePrivateScenarioRefresh } from '../../lib/usePrivateScenarioRefresh';
import { privateChartOverlays } from '../../lib/privateChartPresentation';
import type { ChartTradeCandle,ChartCandleLoader } from '../../lib/chartTrading';
// Direct private entry must own the shared widget styles; the public route is lazy.
import '../trade-terminal/TradeTerminal.css';
import '../trade-terminal/ReferenceFuturesTerminal.css';
import '../trade-terminal/TerminalPresentationPolish.css';
import '../trade-terminal/FuturesStudio.css';
import '../trade-terminal/TerminalStudio.css';
import './privateTrading.css';

export function PrivateTradingPage(){
  const[params]=useSearchParams(),cardId=params.get('card');
  const[access,setAccess]=useState<'loading'|'allowed'|'denied'>('loading');
  useEffect(()=>{let active=true;const controller=new AbortController();
    async function check(){try{const result=await privateTradingApi.access(controller.signal);if(active)setAccess(result.allowed===true?'allowed':'denied');}catch{if(active)setAccess('denied');}}
    void check();const timer=window.setInterval(()=>void check(),10_000);
    const unsubscribe=onSessionChange(()=>{active=false;controller.abort();clearInterval(timer);setAccess('denied');});
    return()=>{active=false;controller.abort();clearInterval(timer);unsubscribe();};
  },[]);
  return <div className="trade-terminal futures-terminal futures-reference futures-studio terminal-studio private-trading-terminal" data-terminal-design="studio">
    <Nav active="/futures" hideTicker/>
    {access==='allowed'?(cardId?<PrivateLinkedCard id={cardId} onDenied={()=>setAccess('denied')}/>:<PrivateTradingWorkspace onDenied={()=>setAccess('denied')}/>):<main className="private-access-state"><LockKeyhole size={30}/><h1>{access==='loading'?'Проверка доступа…':'Приватный режим недоступен'}</h1>{access==='denied'&&<Link to="/futures">Вернуться в терминал</Link>}</main>}
  </div>;
}

function PrivateTradingWorkspace({onDenied}:{onDenied:()=>void}){
  const[params]=useSearchParams(),[symbol,setSymbol]=useState(params.get('pair')||'BTC/USDT');
  const[symbols,setSymbols]=useState(['BTC/USDT','ETH/USDT','SOL/USDT']);
  const[state,setState]=useState<PrivateState|null>(null),[market,setMarket]=useState<PrivateMarket|null>(null),[error,setError]=useState('');
  const[busy,setBusy]=useState(false),[preview,setPreview]=useState<PrivatePreview|null>(null),[card,setCard]=useState<PrivateResultCard|null>(null),[action,setAction]=useState<PrivatePositionAction|null>(null);
  const[pickedPrice,setPickedPrice]=useState<{price:string;sequence:number}|null>(null);
  const alive=useRef(true),pending=useRef(false),requestKey=useRef<{fingerprint:string;key:string}|null>(null);
  const[selecting,setSelecting]=useState<'entry'|'exit'|null>(null),[selectedCandle,setSelectedCandle]=useState<ChartTradeCandle|null>(null),[selectedTradeId,setSelectedTradeId]=useState<string|null>(null),[exitId,setExitId]=useState<string|null>(null);
  const[chartFocus,setChartFocus]=useState<{tradeId:string;time:number;sequence:number}|null>(null);
  const chartLoader=useCallback<ChartCandleLoader>(async(pair,interval,limit,signal,endTime)=>{const result=await privateTradingApi.candles(pair,interval,limit,signal,endTime);if(result.source!=='BYBIT_LINEAR'||result.symbol!==pair.replace(/[^A-Z0-9]/gi,'').toUpperCase()||result.interval!==interval)throw new Error('История не соответствует выбранному контракту');return result;},[]);
  const advanceAttempt=useRef<{id:string;asOf:string}|null>(null);
  const fail=useCallback((cause:unknown)=>{if(cause instanceof PrivateTradingError&&(cause.status===401||cause.status===403)){setState(null);setCard(null);setPreview(null);setMarket(null);onDenied();}else if(alive.current)setError(privateErrorText(cause));},[onDenied]);
  const failRef=useRef(fail);failRef.current=fail;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{let cancelled=false;api.getFuturesUniverse().then(result=>{if(!cancelled)setSymbols(discoverFuturesSymbols(['BTC/USDT','ETH/USDT','SOL/USDT'],result));}).catch(()=>{});return()=>{cancelled=true;};},[]);
  const refresh=useCallback(async()=>{try{const next=await privateTradingApi.state();if(alive.current)setState(next);}catch(e){failRef.current(e);}},[]);
  useEffect(()=>{let cancelled=false,loading=false;const controller=new AbortController();setMarket(null);
    const poll=async()=>{if(cancelled||loading||document.hidden)return;loading=true;
      const results=await Promise.allSettled([privateTradingApi.state(controller.signal),privateTradingApi.market(symbol,controller.signal)]);
      if(!cancelled){if(results[0].status==='fulfilled')setState(results[0].value);else failRef.current(results[0].reason);
        if(results[1].status==='fulfilled')setMarket(results[1].value);else{setMarket(null);if(results[1].reason instanceof PrivateTradingError&&[401,403].includes(results[1].reason.status))failRef.current(results[1].reason);}}
      loading=false;
    };void poll();const timer=window.setInterval(()=>void poll(),2500);document.addEventListener('visibilitychange',poll);
    return()=>{cancelled=true;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',poll);};
  },[symbol]);
  useEffect(()=>{if(preview?.status!=='RUNNING')return;let cancelled=false,loading=false;const controller=new AbortController();
    const timer=window.setInterval(()=>{if(loading||document.hidden)return;loading=true;privateTradingApi.getPreview(preview.id,controller.signal).then(next=>{if(!cancelled)setPreview(next);}).catch(e=>{if(!cancelled)failRef.current(e);}).finally(()=>{loading=false;});},2500);
    return()=>{cancelled=true;controller.abort();clearInterval(timer);};
  },[preview?.id,preview?.status]);
  useEffect(()=>{
    if(preview?.status!=='READY'||!preview.expiresAt)return;
    const remaining=Date.parse(preview.expiresAt)-Date.now();if(!Number.isFinite(remaining))return;
    const timer=window.setTimeout(()=>setPreview(current=>current?.id===preview.id?{...current,status:'EXPIRED'}:current),Math.max(0,remaining));
    return()=>clearTimeout(timer);
  },[preview?.id,preview?.status,preview?.expiresAt]);
  async function run(fingerprint:string,operation:(key:string)=>Promise<unknown>){
    if(pending.current)return;pending.current=true;setBusy(true);setError('');
    if(requestKey.current?.fingerprint!==fingerprint)requestKey.current={fingerprint,key:crypto.randomUUID()};
    try{await operation(requestKey.current.key);requestKey.current=null;await refresh();}catch(e){failRef.current(e);}finally{pending.current=false;if(alive.current)setBusy(false);}
  }
  usePrivateScenarioRefresh(state?.scenarios??[],busy||!!preview||!!selectedCandle||!!selecting,()=>void refresh(),cause=>{if(cause instanceof PrivateTradingError&&[401,403].includes(cause.status))failRef.current(cause);});
  function makePreview(draft:Omit<PrivatePreviewRequest,'idempotencyKey'>){void run(`preview:${JSON.stringify(draft)}`,async key=>{const next=await privateTradingApi.preview({...draft,idempotencyKey:key});if(alive.current)setPreview(next);});}
  function positionAction(body:{quantity?:string;takeProfit?:string|null;stopLoss?:string|null;marginDelta?:string}){
    if(!action)return;const selected=action;
    void run(`${selected.kind}:${selected.position.id}:${JSON.stringify(body)}`,async key=>{
      if(selected.kind==='close')await privateTradingApi.close(selected.position.id,body.quantity,key);
      else await privateTradingApi.amend(selected.position.id,{...body,idempotencyKey:key});
      if(alive.current)setAction(null);
    });
  }
  function advanceScenario(id:string){
    if(advanceAttempt.current?.id!==id)advanceAttempt.current={id,asOf:new Date().toISOString()};
    const attempt=advanceAttempt.current;
    void run(`advance:${id}:${attempt.asOf}`,async key=>{
      const next=await privateTradingApi.advance(id,attempt.asOf,key);
      advanceAttempt.current=null;
      if(alive.current)setPreview(next);
    });
  }
  const chartPositions=state?[...state.positions,...state.history,...state.scenarios.filter(row=>row.verification==='VERIFIED')]:[];
  const selectedTrade=chartPositions.find(row=>row.id===selectedTradeId&&row.symbol===symbol.replace('/',''));
  const exitPosition=chartPositions.find(row=>row.id===exitId&&row.symbol===symbol.replace('/',''));
  function cancelChartSelection(){setSelecting(null);setSelectedCandle(null);setExitId(null);}
  function chooseChartMode(next:'entry'|'exit'|null){setSelectedCandle(null);setSelecting(next);if(next==='entry')setExitId(null);}
  function showEntry(id:string){const position=chartPositions.find(row=>row.id===id);if(!position)return;cancelChartSelection();setSelectedTradeId(id);setSymbol(position.symbol.replace(/USDT$/,'/USDT'));setChartFocus(current=>({tradeId:id,time:position.candleEntry?.openTime??Date.parse(position.effectiveOpenedAt),sequence:(current?.sequence??0)+1}));}
  function selectTrade(id:string){const position=chartPositions.find(row=>row.id===id);if(!position)return;cancelChartSelection();setSelectedTradeId(id);setSymbol(position.symbol.replace(/USDT$/,'/USDT'));}
  function closeOnChart(id:string){selectTrade(id);setExitId(id);setSelectedCandle(null);setSelecting('exit');}
  return <>
    <div className="private-mode-bar"><span className="private-mode-badge"><LockKeyhole size={13}/>Симуляция</span><span>Выделено: <strong>{privateNumber(state?.wallet.allocatedCapital)} USDT</strong></span><span>Резерв: <strong>{privateNumber(state?.wallet.reserved)} USDT</strong></span><Link to="/futures">Обычный терминал</Link></div>
    {error&&<div className="private-page-notice" role="alert"><span>{error}</span><button type="button" onClick={()=>{setError('');void refresh();}}><RefreshCw size={14}/>Повторить</button></div>}
    <main className="private-terminal-grid">
      <aside className="private-market-sidebar"><h2>Рынки</h2><FuturesPairList symbols={symbols} symbol={symbol} onChange={next=>{if(pending.current)return;cancelChartSelection();setSelectedTradeId(null);setChartFocus(null);setSymbol(next);setPreview(null);setPickedPrice(null);}}/></aside>
      <div className="private-chart-stack"><div className="private-instrument"><strong>{symbol}</strong><span><small>Mark Price</small><b>{privateNumber(market?.markPrice,2)}</b></span><span><small>Обновлено</small>{market?privateUtc(market.providerTimestamp):'—'}</span></div><TerminalChart pair={symbol} market="futures" compactTools candleLoader={chartLoader} privateTrading={{enabled:true,selecting,selectedCandle,trades:privateChartOverlays(chartPositions,symbol),selectedTradeId,focus:chartFocus,onCandleSelect:candle=>{setSelectedCandle(candle);setSelecting(null);},onCancelSelection:cancelChartSelection,onTradeSelect:setSelectedTradeId,onSelectionModeChange:chooseChartMode}}/>
        {selectedTrade&&<div className="private-chart-trade-detail"><strong>{selectedTrade.symbol} · {selectedTrade.side} · {selectedTrade.leverage}×</strong><span>Прибыль {privateNumber(selectedTrade.netPnl)} USDT</span><button type="button" onClick={()=>showEntry(selectedTrade.id)}>Показать вход</button>{selectedTrade.mode==='HISTORICAL_REPLAY'&&selectedTrade.status==='OPEN'&&<button type="button" onClick={()=>closeOnChart(selectedTrade.id)}>Закрыть на графике</button>}<button type="button" aria-label="Скрыть детали позиции" onClick={()=>setSelectedTradeId(null)}>×</button></div>}</div>
      <div className="private-book repaired-futures-book"><FuturesReferenceBook key={symbol} pair={symbol} bids={market?.bids??[]} asks={market?.asks??[]} lastPrice={market?Number(market.lastPrice):null} onPickPrice={price=>setPickedPrice(current=>({price,sequence:(current?.sequence??0)+1}))}/></div>
      <PrivateOrderTicket onChartEntry={()=>chooseChartMode('entry')} key={symbol} symbol={symbol} market={market} wallet={state?.wallet??null} busy={busy} preview={preview} pickedPrice={pickedPrice} savedPreviews={state?.previews??[]}
        onModeChange={()=>{setPreview(null);setPickedPrice(null);setError('');}}
        onRefresh={preview&&privateRefreshDraft(preview)?()=>{const draft=privateRefreshDraft(preview);if(draft)void run(`refresh-preview:${preview.id}`,async key=>{const next=await privateTradingApi.preview({...draft,idempotencyKey:key});if(alive.current)setPreview(next);});}:undefined}
        onResume={id=>void run(`resume:${id}`,async()=>{const next=await privateTradingApi.getPreview(id);if(alive.current){cancelChartSelection();if(next.result?.position)setSymbol(next.result.position.symbol.replace(/USDT$/,'/USDT'));setPreview(next);}})}
        onPreview={makePreview} onAllocate={amount=>void run(`allocate:${amount}`,key=>privateTradingApi.allocate(amount,key))}
        onConfirm={()=>{if(preview)void run(`confirm:${preview.id}`,async key=>{await privateTradingApi.confirm(preview.id,key);if(alive.current)setPreview(null);});}}
        onCancel={()=>{if(preview){if(['EXPIRED','FAILED','CANCELLED','CONFIRMED'].includes(preview.status)){setPreview(null);return;}void run(`cancel-preview:${preview.id}`,async()=>{await privateTradingApi.cancelPreview(preview.id);if(alive.current)setPreview(null);});}}}/>
      {state?<PrivatePositions state={state} busy={busy} selectedId={selectedTradeId} onSelect={selectTrade} onShowEntry={showEntry} onCloseOnChart={closeOnChart} onAction={next=>{setError('');setAction(next);}}
        onCard={id=>void run(`card:${id}`,async()=>{const next=await privateTradingApi.card(id);if(alive.current)setCard(next);})}
        onCancelOrder={id=>void run(`cancel-order:${id}`,key=>privateTradingApi.cancelOrder(id,key))}
        onAdvance={advanceScenario}/>:<section className="private-bottom-panel private-empty" role="status">Загрузка приватного счёта…</section>}
    </main>
    {selectedCandle&&selectedCandle.symbol===symbol.replace(/[^A-Z0-9]/gi,'').toUpperCase()&&state&&(!exitId||exitPosition)&&<PrivateChartTicket key={symbol+':'+selectedCandle.openTime+':'+(exitId||'entry')} candle={selectedCandle} wallet={state.wallet} market={market} exitPosition={exitPosition} onDismiss={cancelChartSelection} onSaved={id=>{cancelChartSelection();setSelectedTradeId(id);void refresh();}} onDenied={cause=>{if(cause instanceof PrivateTradingError&&[401,403].includes(cause.status))fail(cause);}}/>}
    {card&&<PrivateResultCardDialog snapshot={card} onClose={()=>setCard(null)} onError={fail}/>}
    {action&&<PrivatePositionDialog action={action} busy={busy} error={error} onClose={()=>setAction(null)} onSubmit={positionAction}/>}
  </>;
}
