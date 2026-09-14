import { FormEvent,useCallback,useEffect,useRef,useState } from 'react';
import { Link,useSearchParams } from 'react-router-dom';
import { LockKeyhole,RefreshCw,Wifi,WifiOff } from 'lucide-react';
import { api,onSessionChange } from '../../lib/api';
import { bybitTestnetApi,TestnetApiError,testnetNumber,testnetTime,type TestnetState,type TestnetStatus } from '../../lib/bybitTestnetApi';
import { privateTradingApi,PrivateTradingError,privateNumber,privateUtc,type PrivateMarket } from '../../lib/privateTradingApi';
import { discoverFuturesSymbols } from '../../lib/futuresDiscovery';
import { Nav } from '../../components/Nav';
import { FuturesPairList } from '../../components/FuturesPairList';
import { TerminalChart } from '../../components/TerminalChart';
import { FuturesReferenceBook } from '../../components/FuturesReferenceBook';
import '../trade-terminal/TradeTerminal.css';
import '../trade-terminal/ReferenceFuturesTerminal.css';
import '../trade-terminal/TerminalPresentationPolish.css';
import '../trade-terminal/FuturesStudio.css';
import '../trade-terminal/TerminalStudio.css';
import './privateTrading.css';
import './bybitTestnet.css';

type Tab='positions'|'orders'|'history'|'pnl';

export function BybitTestnetPage(){
  const[access,setAccess]=useState<'loading'|'allowed'|'denied'>('loading');
  useEffect(()=>{let active=true;const controller=new AbortController();
    const check=()=>privateTradingApi.access(controller.signal).then(result=>{if(active)setAccess(result.allowed?'allowed':'denied');}).catch(()=>{if(active)setAccess('denied');});
    void check();const timer=window.setInterval(()=>void check(),10_000);
    const stop=onSessionChange(()=>{active=false;controller.abort();clearInterval(timer);setAccess('denied');});
    return()=>{active=false;controller.abort();clearInterval(timer);stop();};
  },[]);
  return <div className="trade-terminal futures-terminal futures-reference futures-studio terminal-studio testnet-terminal" data-terminal-design="studio">
    <Nav active="/futures" hideTicker/>
    {access==='allowed'?<TestnetWorkspace onDenied={()=>setAccess('denied')}/>:<main className="private-access-state"><LockKeyhole size={30}/><h1>{access==='loading'?'Проверка доступа…':'Приватный режим недоступен'}</h1>{access==='denied'&&<Link to="/futures">Вернуться в терминал</Link>}</main>}
  </div>;
}

function TestnetWorkspace({onDenied}:{onDenied:()=>void}){
  const[params]=useSearchParams();
  const[symbol,setSymbol]=useState(params.get('pair')||'BTC/USDT');
  const[symbols,setSymbols]=useState(['BTC/USDT','ETH/USDT','SOL/USDT']);
  const[status,setStatus]=useState<TestnetStatus|null>(null),[state,setState]=useState<TestnetState|null>(null),[market,setMarket]=useState<PrivateMarket|null>(null);
  const[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[tab,setTab]=useState<Tab>('positions');
  const[side,setSide]=useState<'Buy'|'Sell'>('Buy'),[orderType,setOrderType]=useState<'Market'|'Limit'>('Market');
  const[qty,setQty]=useState(''),[price,setPrice]=useState(''),[leverage,setLeverage]=useState('10'),[takeProfit,setTakeProfit]=useState(''),[stopLoss,setStopLoss]=useState('');
  const alive=useRef(true),working=useRef(false);
  const normalized=symbol.replace(/[^A-Z0-9]/gi,'').toUpperCase();
  const fail=useCallback((cause:unknown)=>{
    if((cause instanceof TestnetApiError||cause instanceof PrivateTradingError)&&[401,403].includes(cause.status)){onDenied();return;}
    setError(cause instanceof Error?cause.message:'Операция временно недоступна');
  },[onDenied]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{let cancelled=false;api.getFuturesUniverse().then(result=>{if(!cancelled)setSymbols(discoverFuturesSymbols(['BTC/USDT','ETH/USDT','SOL/USDT'],result));}).catch(()=>{});return()=>{cancelled=true;};},[]);
  const refreshState=useCallback(async()=>{try{const next=await bybitTestnetApi.state();if(alive.current)setState(next);}catch(e){if(alive.current)fail(e);}},[fail]);
  useEffect(()=>{let cancelled=false;const controller=new AbortController();
    bybitTestnetApi.status(controller.signal).then(next=>{if(!cancelled)setStatus(next);}).catch(e=>{if(!cancelled)fail(e);});
    return()=>{cancelled=true;controller.abort();};
  },[fail]);
  useEffect(()=>{if(!status?.configured)return;let cancelled=false,loading=false;const controller=new AbortController();
    const poll=async()=>{if(cancelled||loading||document.hidden)return;loading=true;try{const next=await bybitTestnetApi.state(controller.signal);if(!cancelled)setState(next);}catch(e){if(!cancelled)fail(e);}finally{loading=false;}};
    void poll();const timer=window.setInterval(()=>void poll(),4_000);document.addEventListener('visibilitychange',poll);
    return()=>{cancelled=true;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',poll);};
  },[status?.configured,fail]);
  useEffect(()=>{let cancelled=false,loading=false;const controller=new AbortController();setMarket(null);
    const poll=async()=>{if(cancelled||loading||document.hidden)return;loading=true;try{const next=await privateTradingApi.market(symbol,controller.signal);if(!cancelled)setMarket(next);}catch(e){if(!cancelled&&e instanceof PrivateTradingError&&[401,403].includes(e.status))fail(e);}finally{loading=false;}};
    void poll();const timer=window.setInterval(()=>void poll(),2_500);document.addEventListener('visibilitychange',poll);
    return()=>{cancelled=true;controller.abort();clearInterval(timer);document.removeEventListener('visibilitychange',poll);};
  },[symbol,fail]);
  async function act(label:string,run:()=>Promise<unknown>){
    if(working.current)return;working.current=true;setBusy(true);setError('');setNotice('');
    try{await run();if(alive.current){setNotice(label);await refreshState();}}catch(e){if(alive.current)fail(e);}finally{working.current=false;if(alive.current)setBusy(false);}
  }
  function place(event:FormEvent){event.preventDefault();void act('Ордер отправлен в Bybit Testnet.',()=>bybitTestnetApi.createOrder({symbol:normalized,side,orderType,qty,leverage,...(orderType==='Limit'?{price}:{}),...(takeProfit?{takeProfit}:{}),...(stopLoss?{stopLoss}:{})}));}
  const wallet=state?.wallet;
  return <>
    <div className="testnet-mode-bar"><span className="testnet-badge"><Wifi size={13}/>BYBIT TESTNET</span><span>Equity <strong>{testnetNumber(wallet?.totalEquity)} USD</strong></span><span>Доступно <strong>{testnetNumber(wallet?.totalAvailableBalance)} USD</strong></span><span>UPL <strong className={Number(wallet?.totalPerpUPL||0)>=0?'positive':'negative'}>{testnetNumber(wallet?.totalPerpUPL)} USD</strong></span><Link to="/futures?privateTrading=history">Исторический replay</Link><Link to="/futures">Обычный терминал</Link></div>
    <div className="testnet-source-note"><strong>Исполнение: Bybit Testnet.</strong><span>График, Mark Price и стакан — Bybit Mainnet reference. Они могут отличаться от цены исполнения Testnet.</span></div>
    {error&&<div className="private-page-notice" role="alert"><span>{error}</span><button type="button" onClick={()=>{setError('');if(status?.configured)void refreshState();}}><RefreshCw size={14}/>Повторить</button></div>}
    {notice&&<div className="testnet-success" role="status">{notice}</div>}
    {!status?.configured&&status&&<section className="testnet-disconnected"><WifiOff size={28}/><div><h2>Bybit Testnet ещё не подключён</h2><p>В Render для <b>exchange-api</b> нужно добавить секреты <code>BYBIT_TESTNET_API_KEY</code> и <code>BYBIT_TESTNET_API_SECRET</code>. Они остаются только на сервере и никогда не отправляются в браузер.</p></div></section>}
    <main className="testnet-grid">
      <aside className="testnet-markets"><h2>Рынки</h2><FuturesPairList symbols={symbols} symbol={symbol} onChange={next=>{if(busy)return;setSymbol(next);setPrice('');}}/></aside>
      <div className="testnet-chart"><div className="testnet-instrument"><strong>{symbol}</strong><span><small>Mark Price · Mainnet</small><b>{privateNumber(market?.markPrice,2)}</b></span><span><small>Reference updated</small>{market?privateUtc(market.providerTimestamp):'—'}</span></div><TerminalChart pair={symbol} market="futures" chrome="terminal" drawingTools compactTools/></div>
      <div className="testnet-book repaired-futures-book"><FuturesReferenceBook key={symbol} pair={symbol} bids={market?.bids??[]} asks={market?.asks??[]} lastPrice={market?Number(market.lastPrice):null} onPickPrice={value=>{setOrderType('Limit');setPrice(value);}}/></div>
      <aside className="testnet-order"><header><div><span>Bybit Testnet</span><strong>{normalized}</strong></div><span className={status?.configured?'connected':'offline'}>{status?.configured?'Подключено':'Нет ключа'}</span></header>
        <form onSubmit={place}>
          <div className="testnet-side"><button type="button" className="long" aria-pressed={side==='Buy'} onClick={()=>setSide('Buy')}>Long</button><button type="button" className="short" aria-pressed={side==='Sell'} onClick={()=>setSide('Sell')}>Short</button></div>
          <div className="testnet-types"><button type="button" aria-pressed={orderType==='Market'} onClick={()=>setOrderType('Market')}>Market</button><button type="button" aria-pressed={orderType==='Limit'} onClick={()=>setOrderType('Limit')}>Limit</button></div>
          {orderType==='Limit'&&<label>Цена<input value={price} onChange={e=>setPrice(e.target.value)} inputMode="decimal" placeholder="0.00" required/></label>}
          <label>Количество, {symbol.replace('/USDT','')}<input value={qty} onChange={e=>setQty(e.target.value)} inputMode="decimal" placeholder="0.000000" required/></label>
          <div className="testnet-leverage"><label>Плечо<input value={leverage} onChange={e=>setLeverage(e.target.value)} inputMode="decimal"/></label><button type="button" disabled={busy||!status?.configured||!leverage} onClick={()=>void act(`Плечо ${leverage}× установлено.`,()=>bybitTestnetApi.setLeverage(normalized,leverage))}>Применить</button></div>
          <details><summary>Take Profit / Stop Loss</summary><label>TP<input value={takeProfit} onChange={e=>setTakeProfit(e.target.value)} inputMode="decimal" placeholder="—"/></label><label>SL<input value={stopLoss} onChange={e=>setStopLoss(e.target.value)} inputMode="decimal" placeholder="—"/></label></details>
          <div className="testnet-balance-line"><span>Available</span><strong>{testnetNumber(wallet?.totalAvailableBalance)} USD</strong></div>
          <button className={`testnet-place ${side==='Buy'?'long':'short'}`} disabled={busy||!status?.configured||!qty||(orderType==='Limit'&&!price)}>{busy?'Отправка…':`${side==='Buy'?'Открыть Long':'Открыть Short'} · Testnet`}</button>
        </form>
      </aside>
      <section className="testnet-account">
        <nav>{([['positions','Позиции'],['orders','Ордера'],['history','История ордеров'],['pnl','Закрытый P&L']] as [Tab,string][]).map(([id,label])=><button type="button" key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}{id==='positions'&&state?.positions.length?` ${state.positions.length}`:''}{id==='orders'&&state?.openOrders.length?` ${state.openOrders.length}`:''}</button>)}</nav>
        {tab==='positions'&&<div className="testnet-table-wrap"><table><thead><tr><th>Контракт</th><th>Сторона</th><th>Размер</th><th>Вход</th><th>Mark</th><th>Плечо</th><th>Ликвидация</th><th>Нереализ. P&L</th><th></th></tr></thead><tbody>{state?.positions.map(row=><tr key={`${row.symbol}:${row.positionIdx}`}><td><b>{row.symbol}</b></td><td className={row.side==='Buy'?'positive':'negative'}>{row.side==='Buy'?'Long':'Short'}</td><td>{testnetNumber(row.size,8)}</td><td>{testnetNumber(row.avgPrice,4)}</td><td>{testnetNumber(row.markPrice,4)}</td><td>{testnetNumber(row.leverage,2)}×</td><td>{testnetNumber(row.liqPrice,4)}</td><td className={Number(row.unrealisedPnl)>=0?'positive':'negative'}>{testnetNumber(row.unrealisedPnl)} USDT</td><td><button type="button" disabled={busy} onClick={()=>void act(`${row.symbol} отправлен на закрытие.`,()=>bybitTestnetApi.closePosition(row.symbol))}>Закрыть</button></td></tr>)}{!state?.positions.length&&<tr><td colSpan={9} className="empty">Открытых позиций нет</td></tr>}</tbody></table></div>}
        {tab==='orders'&&<div className="testnet-table-wrap"><table><thead><tr><th>Контракт</th><th>Сторона</th><th>Тип</th><th>Цена</th><th>Количество</th><th>Исполнено</th><th>Статус</th><th></th></tr></thead><tbody>{state?.openOrders.map(row=><tr key={row.orderId}><td><b>{row.symbol}</b></td><td className={row.side==='Buy'?'positive':'negative'}>{row.side}</td><td>{row.orderType}</td><td>{testnetNumber(row.price,4)}</td><td>{testnetNumber(row.qty,8)}</td><td>{testnetNumber(row.cumExecQty,8)}</td><td>{row.orderStatus}</td><td><button type="button" disabled={busy} onClick={()=>void act('Отмена отправлена в Bybit Testnet.',()=>bybitTestnetApi.cancelOrder(row.orderId,row.symbol))}>Отменить</button></td></tr>)}{!state?.openOrders.length&&<tr><td colSpan={8} className="empty">Активных ордеров нет</td></tr>}</tbody></table></div>}
        {tab==='history'&&<div className="testnet-table-wrap"><table><thead><tr><th>Время</th><th>Контракт</th><th>Сторона</th><th>Тип</th><th>Количество</th><th>Средняя цена</th><th>Статус</th></tr></thead><tbody>{state?.orderHistory.map(row=><tr key={`${row.orderId}:${row.updatedTime}`}><td>{testnetTime(row.updatedTime||row.createdTime)}</td><td><b>{row.symbol}</b></td><td>{row.side}</td><td>{row.orderType}</td><td>{testnetNumber(row.qty,8)}</td><td>{testnetNumber(row.avgPrice,4)}</td><td>{row.orderStatus}</td></tr>)}{!state?.orderHistory.length&&<tr><td colSpan={7} className="empty">Истории пока нет</td></tr>}</tbody></table></div>}
        {tab==='pnl'&&<div className="testnet-table-wrap"><table><thead><tr><th>Время</th><th>Контракт</th><th>Сторона</th><th>Количество</th><th>Вход</th><th>Выход</th><th>Closed P&L</th></tr></thead><tbody>{state?.closedPnl.map(row=><tr key={`${row.orderId}:${row.updatedTime}`}><td>{testnetTime(row.updatedTime||row.createdTime)}</td><td><b>{row.symbol}</b></td><td>{row.side}</td><td>{testnetNumber(row.qty,8)}</td><td>{testnetNumber(row.avgEntryPrice,4)}</td><td>{testnetNumber(row.avgExitPrice,4)}</td><td className={Number(row.closedPnl)>=0?'positive':'negative'}>{testnetNumber(row.closedPnl)} USDT</td></tr>)}{!state?.closedPnl.length&&<tr><td colSpan={7} className="empty">Закрытых сделок пока нет</td></tr>}</tbody></table></div>}
        <footer><span>{state?`Bybit Testnet · обновлено ${testnetTime(state.fetchedAt)}`:'Ожидание данных Bybit Testnet'}</span><button type="button" disabled={busy||!status?.configured} onClick={()=>void refreshState()}><RefreshCw size={13}/>Обновить</button></footer>
      </section>
    </main>
  </>;
}
