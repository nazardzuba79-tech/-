import { useStocksText } from './useStocksText';
import { stockOrderLabel, stockNoticeText, stockFxPolicyText, type StockNotice } from './stockText';
import { StockChartDemand } from './chartDemand';
import { useCallback,useEffect,useRef,useState } from 'react';
import { useNavigate,useParams } from 'react-router-dom';
import BigNumber from 'bignumber.js';
import OriginalStocksHeader from './OriginalStocksHeader';
import { originalStocksText } from './stockOriginalText';
import { isWaitingForCurrentQuote } from './quoteReadiness';
import GlobalChart from './GlobalChart';
import { DEFAULT_STOCKS_INSTRUMENT } from '../../../lib/stocksIdentity';
import { StockRequestError, globalStockErrorText as errorText } from '../stockRequestError';
import { quoteAge } from './tradeMarkers';
import type { Asset,Candle,Currency,Position,State } from './types';
import './globalStocks.css';
import { api, clearToken, getToken, onSessionChange } from '../../../lib/api';
import { StockSessionFence, rememberStockOrder } from './accountSession';
import { VisibleStockReads, startVisibleStockPolling, mergeStockCandles, admitStockHistory, mergeAdmittedStockHistory, mergeStockSourceGaps } from './readWork';
import type { StockSourceGap } from './readWork';
import { StockOverloadCircuit, stockOverloadCode, stockOverloadText } from './overload';
import type { StockOverloadState, StockReadResult } from './overload';
import { DesktopMarketStats, DesktopQuotes, DesktopFooter, DesktopAllocation } from './DesktopShell';
import { catalogueQuery, settleCatalogue, type CatalogueCache } from './catalogueVersion';
import './desktopProfessional.css';
import './stocksOriginal.css';
const API='/__stocks_global/';
declare const __VOLTEX_STOCKS_CATALOGUE_VISIBLE__: boolean;
const hostedStocks = typeof __VOLTEX_STOCKS_CATALOGUE_VISIBLE__ !== 'undefined' && __VOLTEX_STOCKS_CATALOGUE_VISIBLE__;
const STOCKS_USDT_ONLY = hostedStocks || import.meta.env.VITE_STOCKS_OWNER_USDT_ONLY === 'true';
// Owner policy #558: permission metadata never activates execution. A future
// reviewed demo pilot requires this explicit build gate AND the server gate (#611).
const STOCKS_ORDER_EXECUTION_ENABLED = import.meta.env.VITE_STOCKS_ORDER_EXECUTION_ENABLED === 'true';
const fmt=(v:string|number|null|undefined,d=6)=>v==null?'—':new BigNumber(v).toFixed(d).replace(/\.?0+$/,'')||'0';
const valid=(s:string)=>/^\d+(\.\d{1,8})?$/.test(s)&&new BigNumber(s).gt(0);

function Logo({asset}:{asset:Asset}){const {s}=useStocksText();const [failed,setFailed]=useState(false);return <span className="vxg-logo">{asset.domain&&!failed?<img src={`https://${asset.domain}/favicon.ico`} alt={s("Логотип {value0}", {value0: asset.name})} onError={()=>setFailed(true)}/>:<span title={s("Логотип недоступен")}>{asset.ticker.slice(0,2)}</span>}</span>;}
export default function GlobalStocks(){
  const {s,lang,locale}=useStocksText();
  const [now,setNow]=useState(Date.now),[keyboard,setKeyboard]=useState(false);
  useEffect(()=>startVisibleStockPolling(()=>setNow(Date.now()),1000),[]);
  useEffect(()=>{
    const viewport=window.visualViewport;
    const reveal=()=>{
      const field=document.activeElement;
      const editing=field instanceof HTMLInputElement&&!!field.closest('.vxg-ticket');
      setKeyboard(!!editing&&!!viewport&&window.innerHeight-viewport.height>160);
      if(editing&&window.innerWidth<=800) field.scrollIntoView({block:'nearest',behavior:'smooth'});
    };
    viewport?.addEventListener('resize',reveal);document.addEventListener('focusin',reveal);document.addEventListener('focusout',reveal);
    return()=>{viewport?.removeEventListener('resize',reveal);document.removeEventListener('focusin',reveal);document.removeEventListener('focusout',reveal);};
  },[]);
  const {instrumentId}=useParams(),navigate=useNavigate();const id=instrumentId?.includes(':')&&!instrumentId.startsWith('XNGS:')?instrumentId:DEFAULT_STOCKS_INSTRUMENT;
  const [state,setState]=useState<State|null>(null),[connected,setConnected]=useState(false),[currency,setCurrency]=useState<Currency>('USDT'),[region,setRegion]=useState(id.startsWith('MOEX:')?'RU':'US'),[search,setSearch]=useState(''),[favorites,setFavorites]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem('voltex.stocks.global.favorites')||'[]');}catch{return [];}});
  const [menu,setMenu]=useState(false),[view,setView]=useState('chart'),[accountTab,setAccountTab]=useState('positions'),[side,setSide]=useState<'BUY'|'SELL'>('BUY'),[type,setType]=useState<'MARKET'|'LIMIT'>('MARKET'),[quantity,setQuantity]=useState(''),[limit,setLimit]=useState(''),[interval,setIntervalValue]=useState(id.startsWith('MOEX:')?'1m':'15m'),[candles,setCandles]=useState<Candle[]>([]),[chartError,setChartError]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState<StockNotice|null>(null),[error,setError]=useState(''),[balances,setBalances]=useState({USDT:'',USDC:''});
  const session=useRef(new StockSessionFence(getToken));
  const [sourceGaps,setSourceGaps]=useState<StockSourceGap[]>([]),[ownSource,setOwnSource]=useState(false);
  const [authRequired,setAuthRequired]=useState(false);
  const [overload,setOverload]=useState<StockOverloadState|null>(null);
  const circuit=useRef(new StockOverloadCircuit(setOverload,()=>document.hidden));
  const reads=useRef(new VisibleStockReads(()=>document.hidden));
  const demand=useRef(new StockChartDemand()),catalogueCache=useRef<CatalogueCache<Asset>>(null);
  const token=useRef(''),gate=useRef(false),selected=useRef(id),historyGeneration=useRef(0),historyClass=useRef({generation:-1,ownSource:false});selected.current=id;
  // Accepted permission belongs to the response's session. A stale render must
  // never turn the next credential into an order, even before React rerenders.
  const acceptedAccount=useRef<{id?:string;revision:number;canTrade:boolean;existingOnly:boolean;current:()=>boolean}|null>(null);
  const renderedAccount=acceptedAccount.current;
  const mayReadAccount=()=>!!getToken()&&renderedAccount!==null&&renderedAccount===acceptedAccount.current&&renderedAccount.canTrade&&renderedAccount.current();
  const mayTrade=()=>STOCKS_ORDER_EXECUTION_ENABLED&&mayReadAccount();
  const accept=useCallback((s:State,current:()=>boolean)=>{
    if(!current())return;
    const old=acceptedAccount.current;
    const canTrade=!!s.account?.id&&s.account.canTrade===true&&s.account.mode==='isolated-paper';
    const existingOnly=s.account?.fundingMode==='existing-only';
    // Permission revocation is not a ledger revision and must never be ignored
    // merely because the read-only projection has a lower/empty revision.
    if(old?.current()&&old.id===s.account?.id&&s.revision<old.revision&&canTrade===old.canTrade&&existingOnly===old.existingOnly)return;
    acceptedAccount.current={id:s.account?.id,revision:s.revision,canTrade,existingOnly,current};
    if(s.token)token.current=s.token;setState(s);
  },[]);
  const pause=useCallback((code:unknown,hint?:unknown)=>{const blocked=circuit.current.trip(code,hint);if(blocked)setConnected(false);return blocked;},[]);
  const poll=useCallback((recovery=false):Promise<StockReadResult>=>{
    if(circuit.current.paused&&!recovery)return Promise.resolve({kind:'failed'});
    return reads.current.run('state:'+id,async():Promise<StockReadResult>=>{
      const request=session.current.capture(()=>selected.current===id);
      const visit=demand.current.open(id,request.headers);
      try{
        const r=await fetch(API+'state?id='+encodeURIComponent(id)+catalogueQuery(catalogueCache.current),{headers:visit.headers,credentials:'omit',cache:'no-store',signal:AbortSignal.any([visit.signal,AbortSignal.timeout(8000)])});
        if(!request.current())return{kind:'failed'};
        if(r.status===401){request.reject(clearToken);token.current='';setState(null);setAuthRequired(true);setConnected(false);return{kind:'failed'};}
        const s=await r.json();if(!request.current())return{kind:'failed'};
        const code=stockOverloadCode(r.ok?s.errors?.[id]:s.error);
        if(!r.ok){if(code){if(!recovery)pause(code,s.retryAfterMs);return{kind:'overload',code,retryAfterMs:s.retryAfterMs};}catalogueCache.current=null;throw Error();}
        const settled=settleCatalogue<Asset>(catalogueCache.current,s);if(!settled){catalogueCache.current=null;throw Error();}catalogueCache.current=settled.cache;s.catalogue=settled.list;
        if(s.schema!==2)throw Error();if(s.token)visit.accept(s.token);accept(s,request.current);setAuthRequired(false);setConnected(!code);
        if(code){if(!recovery)pause(code);return{kind:'prior-overload',code};}
        return{kind:'ready'};
      }catch{if(request.current())setConnected(false);return{kind:'failed'};}
    })??Promise.resolve({kind:'failed'});
  },[id,accept,pause]);
  useEffect(()=>onSessionChange(()=>{acceptedAccount.current=null;demand.current.close();session.current.invalidate();reads.current.reset();circuit.current.reset();token.current='';setState(null);setConnected(false);setQuantity('');setLimit('');setMessage(null);setError('');setChartError('');setBalances({USDT:'',USDC:''});void poll();}),[poll]);
  useEffect(()=>{const stop=startVisibleStockPolling(()=>void poll(),3000);return()=>{acceptedAccount.current=null;demand.current.close();session.current.invalidate();reads.current.reset();stop();};},[poll]);
  useEffect(()=>{const hidden=()=>{if(document.hidden){demand.current.close();circuit.current.cancelRecovery();}};document.addEventListener('visibilitychange',hidden);return()=>{document.removeEventListener('visibilitychange',hidden);circuit.current.reset(false);};},[]);
  const act=async(path:string,body:unknown)=>{if(!mayTrade()||(path==='balances'&&acceptedAccount.current?.existingOnly))return null;if(gate.current||circuit.current.paused)return null;const request=session.current.capture();gate.current=true;setBusy(true);setError('');setMessage(null);try{const r=await fetch(API+path,{method:'POST',credentials:'omit',headers:{...request.headers,...demand.current.headers(),'Content-Type':'application/json','X-Stocks-Token':token.current},body:JSON.stringify(body),signal:path==='refresh'&&demand.current.signal()?AbortSignal.any([demand.current.signal()!,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});const s=await r.json();if(!request.current())return null;if(r.status===401){request.reject(clearToken);token.current='';setState(null);setConnected(false);setAuthRequired(true);}if(!r.ok){if(pause(s.error,s.retryAfterMs))return null;throw new StockRequestError(s.error);}accept(s,request.current);pause(s.errors?.[selected.current]);return s;}catch(e){if(request.current())setError(e instanceof StockRequestError?e.code:'LOCAL_SERVICE_ERROR');return null;}finally{gate.current=false;setBusy(false);}};
  const visibleAccount=mayReadAccount()?state:null;
  const asset=state?.catalogue.find(a=>a.id===id),q=state?.quotes[id],price=type==='LIMIT'?limit:q?.prices[currency]?.[side==='BUY'?'buy':'sell']||'',ready=connected&&q?.status[currency]==='READY'&&now-q.receivedAt<30000&&now-q.timestamp<((asset?.delaySeconds||0)+60)*1000;
  // Native USD market visibility is independent of USDT execution/FX admission.
  // This presentation flag is never used by canOrder, submit or financial logic.
  const marketDisplayReady=q?.transport==='websocket'
    ? connected&&!state?.errors[id]&&now-q.timestamp<=5000&&now-q.receivedAt<=5000
    : ready;
  const positions=Object.values(visibleAccount?.positions||{}).filter(p=>Number(p.quantity)>0&&(!STOCKS_USDT_ONLY||p.currency==='USDT')),open=visibleAccount?.orders.filter(o=>['OPEN','PARTIAL'].includes(o.status)&&(!STOCKS_USDT_ONLY||o.currency==='USDT'))||[],position=visibleAccount?.positions[id+'|'+currency],available=side==='BUY'?visibleAccount?.wallets[currency].available:visibleAccount?position?.available||'0':undefined;
  const total=valid(price)&&valid(quantity)?new BigNumber(price).times(quantity).toFixed(8,side==='BUY'?BigNumber.ROUND_CEIL:BigNumber.ROUND_FLOOR):null;
  const admission=state?.errors[id]||(q?.status[currency]&&q.status[currency]!=='READY'?q.status[currency]:'');
  // Viewers (including unresolved sessions) keep interactive controls. Their
  // submit is a silent no-op before validation or any trading side effect.
  // Hosted too (owner policy 2026-10-23, PR #593): a viewer's Buy/Sell stays clickable and does nothing.
  const readOnlyOrderPreview=!mayTrade();
  const canOrder=readOnlyOrderPreview || (!STOCKS_USDT_ONLY || currency === 'USDT')&&connected&&!busy&&!overload&&asset?.provider!=='moex'&&valid(quantity)&&valid(price)&&(type==='LIMIT'||ready)&&!!state&&(side==='BUY'?new BigNumber(total||0).lte(available||0):new BigNumber(quantity).lte(available||0));
  const history=useCallback((before?:number,recovery=false):Promise<StockReadResult>=>{
    if(circuit.current.paused&&!recovery)return Promise.resolve({kind:'failed'});
    return reads.current.run(`history:${historyGeneration.current}:${id}:${interval}:${before||''}`,async():Promise<StockReadResult>=>{
      const generation=historyGeneration.current,request=session.current.capture();setLoading(true);
      const current=()=>request.current()&&selected.current===id&&generation===historyGeneration.current;
      try{
        const r=await fetch(API+`history?id=${encodeURIComponent(id)}&interval=${interval}${before?'&before='+before:''}`,{headers:request.headers,credentials:'omit',signal:AbortSignal.timeout(15000)});
        const j=await r.json();if(!current())return{kind:'failed'};
        if(!r.ok){const code=stockOverloadCode(j.error);if(code){if(!recovery)pause(code,j.retryAfterMs);return{kind:'overload',code,retryAfterMs:j.retryAfterMs};}throw new StockRequestError(j.error);}
        // Own-source classification latches for the generation: a later provenance-less page is a
        // rejected downgrade (cleared, unavailable), never plain numbers or a reopened native-bar path.
        const page=admitStockHistory(j,id,interval),latched=historyClass.current.generation===generation&&historyClass.current.ownSource;
        const admitted=latched&&!page.ownSource?{candles:[],gaps:[],ownSource:true,error:'SOURCE_UNAVAILABLE'}:page;historyClass.current={generation,ownSource:admitted.ownSource};
        setCandles(old=>mergeAdmittedStockHistory(old,admitted));setOwnSource(admitted.ownSource);
        setSourceGaps(old=>mergeStockSourceGaps(old,admitted));
        setChartError(admitted.error||'');return{kind:admitted.error?'failed':'ready'};
      }catch(e){if(current())setChartError(e instanceof StockRequestError?e.code:'SOURCE_UNAVAILABLE');return{kind:'failed'};}
      finally{if(current())setLoading(false);}
    })??Promise.resolve({kind:'failed'});
  },[id,interval,pause]);
  useEffect(()=>{historyGeneration.current++;setCandles([]);setSourceGaps([]);setOwnSource(false);setChartError('');const stop=startVisibleStockPolling(()=>void history(),15000);return()=>{historyGeneration.current++;circuit.current.cancelRecovery();stop();};},[history]);
  // Native bars ride the existing quote response (CEX feeds). Do not turn a last
  // price into OHLC, increase REST polling, or repaint an unchanged native
  // observation. Own-source (#615) prices reach the chart only through
  // admitStockHistory: never for a SOLANA: identity, never once this history
  // generation was classified as own-source, never into a newer generation.
  useEffect(()=>{const live=state?.quotes[id]?.nativeCandles?.[interval];if(!live||id.startsWith('SOLANA:'))return;
    const generation=historyGeneration.current,own=()=>generation!==historyGeneration.current||(historyClass.current.generation===generation&&historyClass.current.ownSource);
    if(own())return;
    setCandles(old=>{if(own())return old;const last=old[old.length-1];if(last&&(live.time<last.time||(['time','open','high','low','close','volume'] as const).every(k=>last[k]===live[k])))return old;return mergeStockCandles(old,[live]);});
  },[state,id,interval]);
  const recover=()=>void circuit.current.recover(()=>poll(true),()=>history(undefined,true));
  const retrySeconds=overload?Math.max(0,Math.ceil((overload.retryAt-now)/1000)):0;
  const choose=(a:Asset)=>{setMenu(false);setQuantity('');setLimit('');setMessage(null);setError('');setIntervalValue(a.timeframes.includes(interval)?interval:a.timeframes[0]);navigate('/stocks/'+encodeURIComponent(a.id));};
  const submitOrder=async()=>{if(!mayTrade())return;if(!canOrder)return;const body={instrumentId:id,currency,side,type,quantity:new BigNumber(quantity).toFixed(8),...(type==='LIMIT'?{limitPrice:new BigNumber(limit).toFixed(8)}:{})};const pending=rememberStockOrder(sessionStorage,state?.account?.id,JSON.stringify(body),()=>crypto.randomUUID());const result=await act('orders',{...body,id:pending.id});if(result){sessionStorage.removeItem(pending.key);setMessage({kind:'order',status:result.result.status,filled:fmt(result.result.filled),asset:asset?.asset||''});setQuantity('');setAccountTab(result.result.filled!=='0.00000000'?'positions':'orders');}};
  const prepareSell=(p:Position,half:boolean)=>{if(!mayTrade())return;if (STOCKS_USDT_ONLY && p.currency !== 'USDT') return;const a=state?.catalogue.find(a=>a.id===p.instrumentId);if(a)choose(a);setCurrency(p.currency);setSide('SELL');setType('MARKET');setQuantity(new BigNumber(p.available).div(half?2:1).toFixed(8,BigNumber.ROUND_DOWN));setView('trade');};
  const toggleFavorite=(assetId:string)=>setFavorites(old=>{const n=old.includes(assetId)?old.filter(x=>x!==assetId):[...old,assetId];localStorage.setItem('voltex.stocks.global.favorites',JSON.stringify(n));return n;});
  const filtered=state?.catalogue.filter(a=>(region==='FAV'?favorites.includes(a.id):a.region===region)&&`${a.ticker} ${a.asset} ${a.name} ${a.provider}`.toLowerCase().includes(search.toLowerCase()))||[];
  return <div className={`vxg-page vxg-original-terminal ${keyboard?'vxg-keyboard-open':''}`}><OriginalStocksHeader terminal onSettings={()=>{setView('trade');requestAnimationFrame(()=>{const details=document.querySelector<HTMLDetailsElement>(".vxg-settings");if(details){details.open=true;details.scrollIntoView({block:"nearest"});}});}}/><main className={`vxg-terminal vxg-view-${view}`}>
    <aside className={`vxg-roster ${menu?'vxg-open':''}`}><div className="vxg-roster-head"><strong>{s("Акции")}</strong><button className="vxg-mobile" onClick={()=>setMenu(false)}>{s("Закрыть")}</button></div><div className="vxg-categories">{[['US',s("США")],['RU',s("Россия")],['FAV',s("Избранное")]].map(([v,label])=><button key={v} className={region===v?'selected':''} onClick={()=>setRegion(v)}>{label}</button>)}</div><input aria-label={s("Поиск компании или токена")} placeholder={s("Компания, тикер, источник")} value={search} onChange={e=>setSearch(e.target.value)}/><div className="vxg-assets">{/* The roster is display:none until opened (both layouts); its rows re-render with the 1 s clock, so only while open. */menu&&filtered.map(a=><div key={a.id} className={a.id===id?'selected':''}><button aria-label={s("Избранное {value0} {value1}", {value0: a.asset, value1: a.provider})} onClick={()=>toggleFavorite(a.id)}>{favorites.includes(a.id)?'★':'☆'}</button><button className="vxg-asset" onClick={()=>choose(a)}><Logo asset={a}/><span><strong>{a.asset}</strong><small>{a.name}</small><em>{a.provider.toUpperCase()} · {a.kind==='token'?s("Токен"):s("Акция MOEX")}</em></span><span>{fmt((state?.quotes[a.id]?.timestamp??0)>(a.display?.timestamp??0)?state?.quotes[a.id]?.last:a.display?.price,2)}<small>{a.currency}</small><small className="vxg-quote-age">{quoteAge(Math.max(state?.quotes[a.id]?.timestamp||0,a.display?.timestamp||0),now,lang)}</small></span></button></div>)}</div><footer>{s("Котировки из API источников")}<br/>{s("Ордера остаются в VOLTEX")}</footer></aside>
    <section className="vxg-center"><header className="vxg-market-head"><button className="vxg-active-asset" onClick={()=>setMenu(!menu)}>{asset&&<Logo key={id} asset={asset}/>}<span><strong>{asset?.asset||'STOCKS'} <small>⌄</small></strong><small>{asset?.name||s("Загрузка каталога")}</small></span></button><div className="vxg-last"><strong>{fmt(q?.last,2)}</strong><small>{asset?.currency} · {asset?.provider.toUpperCase()}</small><small className={marketDisplayReady?'vxg-quote-age':'vxg-quote-age stale'}>{quoteAge(q?.timestamp,now,lang)}{asset?.delaySeconds?s(" · задержка {value0} мин", {value0: asset.delaySeconds/60}):!marketDisplayReady&&q?s(" · нет свежей цены"):''}</small></div><div className={Number(q?.change24h)>=0?'up':'down'}>{q?.change24h==null?'—':`${q.change24h.toFixed(2)}%`}<small>{s("За 24 часа")}</small></div><div className="vxg-volume">{fmt(q?.volume,2)}<small>{s("Объём ·")} {asset?.asset}</small></div><DesktopMarketStats asset={asset} quote={q} candles={candles} ready={marketDisplayReady} now={now}/></header>
      <div className="vxg-mobile-tabs"><button className={view==='chart'?'selected':''} onClick={()=>setView('chart')}>{s("График")}</button><button className={view==='trade'?'selected':''} onClick={()=>setView('trade')}>{s("Торговля")}</button><button className={view==='account'?'selected':''} onClick={()=>setView('account')}>{s("Позиции / заявки")}</button></div>
      {overload&&<p role="alert" className="vxg-error">{stockOverloadText(overload.code,lang)} {retrySeconds>0?s("Повторить можно через {value0} с.", {value0: retrySeconds}):s("Повторите загрузку, когда будете готовы.")} <button disabled={retrySeconds>0||overload.recovering} onClick={recover}>{overload.recovering?s("Проверяем доступность…"):s("Повторить загрузку")}</button></p>}
      <div className="vxg-chart-section"><div className="vxg-desktop-only vxg-pro-chart-heading"><strong>{s("График")}</strong><span>{asset?.asset} / {asset?.currency} · {asset?.provider.toUpperCase()}{ownSource?' · '+s("Цена токена"):null}</span><button aria-label={s("Развернуть график")} title={s("Развернуть график")} onClick={e=>{const panel=e.currentTarget.closest<HTMLElement>(".vxg-chart-section");if(document.fullscreenElement)void document.exitFullscreen();else void panel?.requestFullscreen?.().catch(()=>{});}}>⛶</button></div><div className="vxg-timeframes">{(asset?.timeframes||['1m','5m','15m','30m','1h','4h','1D']).map(t=><button key={t} className={t===interval?'selected':''} onClick={()=>setIntervalValue(t)}>{t}</button>)}<span>{asset?.delaySeconds?s("Задержка {value0} мин", {value0: asset.delaySeconds/60}):s("Данные биржи")}</span></div><GlobalChart sourceGaps={sourceGaps} priceKind={ownSource?'raw-token':undefined} appearance="light" id={id} candles={candles} currency={asset?.currency||'USDT'} interval={interval} entry={position?.averageNative||null} fills={visibleAccount?.fills||[]} error={chartError?errorText(chartError,lang):''} loading={loading} older={()=>void history(candles[0]?candles[0].time*1000-1:undefined)}/></div>
      <section className="vxg-account"><div className="vxg-wallets">{(STOCKS_USDT_ONLY ? ['USDT'] as const : ['USDT','USDC'] as const).map(c=><div key={c}><strong>{fmt(visibleAccount?.wallets[c].cash)} <small>{c}</small></strong><small>{s("В резерве")} {fmt(visibleAccount?.wallets[c].reserved)} · PnL <b className={Number(visibleAccount?.realized[c])>=0?'up':'down'}>{fmt(visibleAccount?.realized[c])}</b></small></div>)}</div><div className="vxg-account-tabs">{[['positions',s("Позиции ({value0})", {value0: positions.length})],['orders',s("Заявки ({value0})", {value0: open.length})],['history',s("История")],['fills',s("Сделки")]].map(([v,label])=><button key={v} className={accountTab===v?'selected':''} onClick={()=>setAccountTab(v)}>{label}</button>)}</div><div className="vxg-account-rows">
        {accountTab==='positions'&&(positions.length?positions.map(p=><article key={p.instrumentId+p.currency}><div><strong>{state?.catalogue.find(a=>a.id===p.instrumentId)?.asset} / {p.currency}</strong><small>{p.instrumentId} · {fmt(p.quantity)} {s("ед.")}</small><small>{s("Вход")} {fmt(p.average)} {s("· Оценка")} {fmt(p.mark)}</small></div><div><b className={Number(p.unrealized)>=0?'up':'down'}>{fmt(p.unrealized)} {p.currency}</b><small>{s("Нереализованный PnL")}</small><button disabled={!mayTrade()||busy||Number(p.available)<=0} onClick={()=>prepareSell(p,true)}>{s("Продать 50%")}</button><button disabled={!mayTrade()||busy||Number(p.available)<=0} onClick={()=>prepareSell(p,false)}>{s("Закрыть")}</button></div></article>):<p className="vxg-empty">{s("Открытых позиций нет")}</p>)}
        {(accountTab==='orders'||accountTab==='history')&&((accountTab==='orders'?open:[...(visibleAccount?.orders||[])].filter(o=>!STOCKS_USDT_ONLY||o.currency==='USDT').reverse()).map(o=><article key={o.id}><div><strong>{state?.catalogue.find(a=>a.id===o.instrumentId)?.asset} / {o.currency}</strong><small>{o.instrumentId} · {o.side==='BUY'?s('Купить'):s('Продать')} {o.type==='MARKET'?s('Market'):s('Limit')}</small><small>{fmt(o.filled)} / {fmt(o.quantity)} · {o.limitPrice?fmt(o.limitPrice):s('Market')}</small></div><div><b>{stockOrderLabel(o.status,s)}</b><small>{new Date(o.createdAt).toLocaleTimeString(locale)}</small>{['OPEN','PARTIAL'].includes(o.status)&&<button disabled={!mayTrade()||busy||!!overload} onClick={async()=>{if(await act('cancel',{id:o.id}))setMessage({kind:'text',message:'Остаток заявки отменён'});}}>{s("Отменить")}</button>}</div></article>))}
        {accountTab==='orders'&&!open.length&&<p className="vxg-empty">{s("Активных заявок нет")}</p>}
        {accountTab==='fills'&&[...(visibleAccount?.fills||[])].filter(f=>!STOCKS_USDT_ONLY||f.currency==='USDT').reverse().map(f=><article key={f.id}><div><strong>{state?.catalogue.find(a=>a.id===f.instrumentId)?.asset} / {f.currency}</strong><small>{f.provider} · {fmt(f.quantity)} × {fmt(f.price)}</small><small>PnL {fmt(f.realized)} {f.currency} {s("· Комиссия 0")}</small></div><div><b className={f.side==='BUY'?'up':'down'}>{f.side==='BUY'?s('Купить'):s('Продать')}</b><small>{new Date(f.timestamp).toLocaleTimeString(locale)}</small></div></article>)}
      </div></section>
    </section>
    <DesktopQuotes asset={asset} quote={q} fills={visibleAccount?.fills||[]} now={now} ready={marketDisplayReady}/><aside className="vxg-ticket"><header><strong>{s("Торговля")}</strong><span>{asset?.asset}/{currency}</span></header>{!readOnlyOrderPreview&&state?.account&&<div className="vxg-available"><small>{s("Счёт")} {state.account.id.slice(0,8)}</small><button onClick={()=>{const logout=api.logout();clearToken();navigate('/login?next='+encodeURIComponent('/stocks/'+encodeURIComponent(id)));void logout.catch(()=>{});}}>{s("Сменить аккаунт")}</button></div>}<div className="vxg-currency">{(STOCKS_USDT_ONLY ? ['USDT'] as const : ['USDT','USDC'] as const).map(c=><button className={currency===c?'selected':''} key={c} onClick={()=>setCurrency(c)}>{c}</button>)}</div><div className="vxg-sides"><button className={side==='BUY'?'buy selected':''} onClick={()=>setSide('BUY')}>{s("Купить")}</button><button className={side==='SELL'?'sell selected':''} onClick={()=>setSide('SELL')}>{s("Продать")}</button></div><div className="vxg-order-types">{(['MARKET','LIMIT'] as const).map(t=><button key={t} className={type===t?'selected':''} onClick={()=>{setType(t);if(t==='LIMIT'&&!limit)setLimit(q?.prices[currency]?.buy||'');}}>{t==='MARKET'?s('Market'):s('Limit')}</button>)}</div>
      <div className="vxg-available">{s("Доступно")} <b>{fmt(available)} {side==='BUY'?currency:asset?.asset}</b></div><form onSubmit={e=>{e.preventDefault();if(!mayTrade())return;void submitOrder();}}><label>{s("Цена")} <span>{currency}</span><input aria-label={s("Цена")} inputMode="decimal" value={price} disabled={type==='MARKET'} onChange={e=>setLimit(e.target.value.replace(',','.'))} placeholder="—"/></label><label>{s("Количество")} <span>{asset?.kind==='token'?s("токенов"):s("акций")}</span><input aria-label={s("Количество")} inputMode="decimal" value={quantity} onChange={e=>setQuantity(e.target.value.replace(',','.'))} placeholder="0.00"/></label><DesktopAllocation available={available||"0"} price={price} side={side} quantity={quantity} onChange={setQuantity}/><label>{s("Итого")} <span>{currency}</span><input aria-label={s("Итого")} disabled value={fmt(total)} /></label><div className="vxg-available">{s("Комиссия")} <b>0%</b></div><button className={`vxg-submit ${side==='BUY'?'buy':'sell'}`} disabled={!canOrder}>{side==='BUY'?s("Купить"):s("Продать")} {asset?.asset}</button></form>
      {authRequired?<p role="alert" className="vxg-error">{errorText('AUTH_REQUIRED',lang)} <button onClick={()=>navigate('/login?next='+encodeURIComponent('/stocks/'+encodeURIComponent(id)))}>{s("Войти")}</button></p>:!connected&&!overload&&<p role="alert" className="vxg-error">{s("Нет связи с локальным сервисом")}</p>}{error&&<p role="alert" className="vxg-error">{errorText(error,lang)}</p>}{message&&<p role="status" className="vxg-success">{stockNoticeText(message,s)}</p>}{admission&&<p className={isWaitingForCurrentQuote(state?.readiness?.[id],admission,now,asset?.delaySeconds)?'vxg-quote-waiting':'vxg-error'} role="status">{isWaitingForCurrentQuote(state?.readiness?.[id],admission,now,asset?.delaySeconds)?<>{originalStocksText(lang).waitingQuote} <small>QUOTE_STALE</small></>:errorText(admission,lang)}</p>}
      <div className="vxg-source"><strong>{asset?.kind==='token'?s("Токенизированный инструмент"):asset?.provider==='moex'?s("Акция MOEX · расчётная пара"):s("Источник не выбран")}</strong><p>{id}</p>{q&&<p>{s("Котировка")} {new Date(q.timestamp).toLocaleTimeString(locale)} {s("· возраст")} {Math.max(0,Math.floor((Date.now()-q.timestamp)/1000))} {s("с")}</p>}{asset?.delaySeconds? <p>{s("Данные MOEX с задержкой не менее 15 минут")}</p>:null}{q?.fx[currency]?<p>{q.fx[currency]?.source}<br/>{stockFxPolicyText(q.fx[currency]?.policy,s)}<br/>{s("Курс:")} {fmt(q.fx[currency]?.rate,8)}</p>:currency==='USDT'&&asset?.currency==='USDT'?<p>{s("Цена токена уже в USDT. Пересчёт через USD не применяется.")}</p>:<p>{s("Исполнение требует проверенного курса.")}</p>}{asset?.kind==='token'&&<p>{q?.multiplier?<>{s("Множитель")} {q.multiplier}{valid(quantity)&&<> {s("· Эквивалент")} {fmt(new BigNumber(quantity).times(q.multiplier).toFixed(8))} {s("акций")}</>}</>:s("Множитель акций не подтверждён. Учёт ведётся в единицах токена.")}</p>}<button disabled={!mayTrade()||busy||!!overload} onClick={()=>void act('refresh',{id})}>{s("Обновить котировку")}</button></div>
      <details className="vxg-settings" onToggle={e=>{if(e.currentTarget.open&&visibleAccount)setBalances({USDT:visibleAccount.wallets.USDT.cash,USDC:visibleAccount.wallets.USDC.cash});}}><summary>{s("Параметры счёта")}</summary><p className="vxg-notice">{s("Баланс и позиции — тестовые. Заявки не выходят на реальный рынок.")}</p>{(STOCKS_USDT_ONLY ? ['USDT'] as const : ['USDT','USDC'] as const).map(c=><label key={c}>{s("Баланс")} {c}<input disabled={readOnlyOrderPreview||state?.account?.fundingMode==='existing-only'} aria-label={`${s("Баланс")} ${c}`} inputMode="decimal" placeholder="—" value={readOnlyOrderPreview?'':balances[c]} onChange={e=>setBalances(b=>({...b,[c]:e.target.value.replace(',','.')}))}/></label>)}<button disabled={!mayTrade()||busy||!!overload||state?.account?.fundingMode==='existing-only'} onClick={async()=>{if(await act('balances',{id:crypto.randomUUID(),balances}))setMessage({kind:'text',message:'Баланс обновлён; история сохранена'});}}>{s("Установить баланс")}</button><p>{s("Модель: до 1 единицы на новое наблюдение цены, общий лимит для заявок. Market — IOC: неисполненный остаток отменяется. Limit — GTC: только новые наблюдения после подачи, без исторических high/low.")}</p><p>{s("Котировки обновляются только пока открыта видимая вкладка. При скрытии исполнение приостанавливается.")}</p></details>
    </aside>
  </main><DesktopFooter asset={asset} ready={marketDisplayReady} connected={connected}/></div>;
}
