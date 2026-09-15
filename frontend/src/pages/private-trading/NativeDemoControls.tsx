import { useEffect,useRef,useState,type FormEvent } from 'react';
import { privateNumber,privateUtc } from '../../lib/privateTradingApi';
import { nativeDemoApi,nativeFundingPercent,type NativeDraft,type NativePosition,type NativeState } from '../../lib/nativeDemoApi';
import { PrivateResultCardDialog } from './PrivateResultCardDialog';
import type { NativeDemoController } from './useNativeDemo';
import './nativeDemo.css';

const sign=(value:string|null|undefined)=>value===null||value===undefined||value===''?'':Number(value)<0?'negative':Number(value)>0?'positive':'';
/** The funding rates this account settles at, stated the way a rate is
 *  stated anywhere else on the terminal — a number, not an explanation. */
function fundingRates(c:NativeDemoController){
  const f=c.state?.model.funding;
  return f?`Long ${nativeFundingPercent(f.longCashflow)} / Short ${nativeFundingPercent(f.shortCashflow)} · 8ч`:'—';
}
export function NativeDemoTicket({controller:c,symbol,pickedPrice,pickedSequence}:{controller:NativeDemoController;symbol:string;pickedPrice?:string;pickedSequence?:number}){
  const[side,setSide]=useState<'LONG'|'SHORT'>('LONG'),[type,setType]=useState<'MARKET'|'LIMIT'>('MARKET'),[amount,setAmount]=useState('5000'),[leverage,setLeverage]=useState('10'),[price,setPrice]=useState('');
  const[tp,setTp]=useState(''),[sl,setSl]=useState(''),[point,setPoint]=useState<'OPEN'|'CLOSE'>('CLOSE');
  useEffect(()=>{if(pickedPrice){setPrice(pickedPrice);setType('LIMIT');}},[pickedPrice,pickedSequence]);
  const selected=c.candle&&c.candle.symbol===symbol.replace(/[^A-Z0-9]/gi,'').toUpperCase()?c.candle:null;
  const historicalLimit=!!selected&&!c.exitId&&type==='LIMIT';
  async function submit(e:FormEvent){
    e.preventDefault();
    const candle=selected?{source:'BYBIT_LINEAR' as const,interval:selected.interval,openTime:selected.openTime,pricePoint:historicalLimit?'OPEN' as const:point}:undefined;
    const draft:NativeDraft=c.exitId?{kind:'CLOSE',positionId:c.exitId,...(candle?{candle}:{})}
      :{kind:'OPEN',symbol,side,type,margin:amount,leverage,...(type==='LIMIT'?{price}:{}),...(candle?{candle}:{}),protection:{takeProfit:tp||null,stopLoss:sl||null}};
    if(await c.run(draft)){c.setCandle(null);c.setExitId(null);}
  }
  if(!c.allowed)return <div className="native-demo-controls" role="status">{c.checked?'Торговля недоступна для этого аккаунта.':'Загрузка…'}</div>;
  const state=c.state,a=state?.account;
  return <div className="native-demo-controls">
    {c.error&&<p role="alert">{c.error}</p>}
    {!state?<p role="status">Загрузка…</p>:!state.initialized?<div className="native-demo-connect">
      <p>Доступно: <b>{privateNumber(state.demoAvailable)} USDT</b></p>
      <button type="button" disabled={c.busy||!state.demoAvailable} onClick={()=>void c.initialize()}>Начать торговлю</button>
    </div>:<>
      {/* Margin mode and leverage read as the terminal's own controls, not as
          a description of a mode: Cross is what this account trades. */}
      <div className="native-mode-row">
        <span className="native-mode-chip">Cross</span>
        <label className="native-lev-chip">Плечо<input aria-label="Плечо" inputMode="decimal" value={leverage} onChange={e=>setLeverage(e.target.value)} required/><span>×</span></label>
      </div>
      <div className="native-types" role="tablist" aria-label="Тип ордера">
        <button type="button" role="tab" aria-selected={type==='MARKET'} aria-pressed={type==='MARKET'} onClick={()=>setType('MARKET')}>Рыночный</button>
        <button type="button" role="tab" aria-selected={type==='LIMIT'} aria-pressed={type==='LIMIT'} onClick={()=>setType('LIMIT')}>Лимитный</button>
      </div>
      <form onSubmit={submit}>
        {type==='LIMIT'&&!c.exitId&&<label>Цена<input aria-label="Лимитная цена" inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)} required/><span className="native-unit">USDT</span></label>}
        {!c.exitId&&<label>Маржа<input aria-label="Маржа, USDT" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} required/><span className="native-unit">USDT</span></label>}
        <div className="native-avail"><span>Доступно</span><b>{privateNumber(a?.available)} USDT</b></div>
        <button type="button" className="native-history" disabled={c.busy} onClick={c.pickEntry}>Выбрать вход на графике</button>
        {selected&&<section className="native-candle" data-open-time={selected.openTime} data-interval={selected.interval}>
          <b>{c.exitId?'Выход':'Вход'}</b><span>{privateUtc(selected.openTime)} · {selected.interval}</span>
          {historicalLimit?<p className="native-hint">Buy исполняется, если Low ≤ цены; Sell — если High ≥ цены. Иначе ордер ждёт после закрытия свечи.</p>
            :<label>Цена свечи<select value={point} onChange={e=>setPoint(e.target.value as 'OPEN'|'CLOSE')}><option value="OPEN">Открытие</option><option value="CLOSE">Закрытие</option></select></label>}
          <button type="button" onClick={()=>{c.setCandle(null);c.setExitId(null);}}>Отменить выбор</button>
        </section>}
        {!c.exitId&&<details className="native-tpsl"><summary>TP/SL</summary>
          <label>Take Profit<input aria-label="Take Profit" inputMode="decimal" value={tp} onChange={e=>setTp(e.target.value)} placeholder="—"/></label>
          <label>Stop Loss<input aria-label="Stop Loss" inputMode="decimal" value={sl} onChange={e=>setSl(e.target.value)} placeholder="—"/></label>
        </details>}
        {/* Direction is the button, as on every derivatives terminal. A close
            on a chosen candle has only one direction, so it stays one button. */}
        {c.exitId?<button type="submit" className="native-submit long" disabled={c.busy||!selected}>Закрыть на выбранной свече</button>
          :<div className="native-submit-pair">
            <button type="submit" className="native-submit long" disabled={c.busy} onClick={()=>setSide('LONG')}>Long</button>
            <button type="submit" className="native-submit short" disabled={c.busy} onClick={()=>setSide('SHORT')}>Short</button>
          </div>}
      </form>
      <dl>
        <dt>Обеспечение</dt><dd>{privateNumber(a?.equity)} USDT</dd>
        <dt>Нереализованный P&amp;L</dt><dd className={sign(a?.unrealizedPnl)}>{privateNumber(a?.unrealizedPnl)} USDT</dd>
        <dt>Использовано</dt><dd>{privateNumber(a?.usedMargin)} USDT</dd>
        <dt>Резерв ордеров</dt><dd>{privateNumber(a?.orderReserve)} USDT</dd>
        <dt>Поддерживающая маржа</dt><dd>{privateNumber(a?.maintenanceMargin)} USDT</dd>
        <dt>Funding</dt><dd>{fundingRates(c)}</dd>
      </dl>
    </>}
  </div>;
}
function Liquidation({p}:{p:NativePosition}){
  if(p.status!=='OPEN')return <>—</>;
  return p.liquidationPrice===null?<span title="При текущем общем обеспечении ликвидация недостижима">—</span>:<>{privateNumber(p.liquidationPrice,2)}</>;
}
export function NativeDemoPanel({controller:c}:{controller:NativeDemoController}){
  const[tab,setTab]=useState<'open'|'positions'|'history'|'fills'|'assets'|'pnl'>('positions'),s=c.state;
  const prev=useRef(0);
  useEffect(()=>{if((s?.positions.length??0)>prev.current)setTab('positions');prev.current=s?.positions.length??0;},[s?.positions.length]);
  const rows=tab==='history'?s?.history:s?.positions;
  const working=(s?.orders??[]).filter(o=>['OPEN','PARTIALLY_FILLED'].includes(o.status));
  // Every tab is a different view of the SAME authoritative server state —
  // no tab invents rows, and none is present without something to show.
  const tabs=[['open',`Открытые ордера (${working.length})`],['positions',`Позиции (${s?.positions.length??0})`],
    ['history','История ордеров'],['fills','История торговли'],['assets','Активы'],['pnl','P&L']] as const;
  const positionRows=(list:NativePosition[]|undefined,closed:boolean)=><table><thead><tr>
    <th>Контракт</th><th>Кол-во</th><th>Цена входа</th><th>{closed?'Цена выхода':'Рыночная цена'}</th><th>Цена ликв.</th><th>Маржа</th><th>P&amp;L / ROI</th><th>Funding</th><th>TP/SL</th><th>Закрыть</th>
  </tr></thead><tbody>{list?.map(p=>{
    const pnl=p.status==='OPEN'?p.unrealizedPnl:p.netPnl;
    const exit=p.status==='OPEN'?p.markPrice:[...(s?.events??[])].reverse().find(e=>e.positionId===p.id&&['CLOSE','TAKE_PROFIT','STOP_LOSS','LIQUIDATION'].includes(e.kind))?.price??null;
    return <tr key={p.id} aria-selected={c.selectedId===p.id}>
      <td><button type="button" onClick={()=>c.selectEntry(p)}><b>{p.symbol}</b></button><small className={p.side==='LONG'?'positive':'negative'}>{p.side} · Cross {p.leverage}×</small>{p.historical&&<small>{privateUtc(p.openedAt)}</small>}</td>
      <td>{privateNumber(p.quantity,3)}</td><td>{privateNumber(p.entryPrice,2)}</td><td>{privateNumber(exit,2)}</td><td><Liquidation p={p}/></td>
      <td>{privateNumber(p.status==='OPEN'?p.roiBasis:p.closedRoiBasis)}</td>
      <td className="native-pnl-cell"><span className={sign(pnl)}>{privateNumber(pnl)} USDT<br/>{privateNumber(p.roiPercent)}%</span>
        {/* Small, but a real control: an icon button with a hover state and a
            name, rather than an arrow glyph nobody reads as clickable. */}
        <button type="button" className="native-card-btn" title="P&L Card · Поделиться результатом" aria-label={`P&L Card · ${p.symbol}`} onClick={()=>void c.showCard(p.id)}>
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M8 15l3-3.5 2.4 2.4L16.5 10"/></svg>
        </button></td>
      <td className={sign(p.fundingNet)}>{privateNumber(p.fundingNet)}</td>
      <td>{p.status==='OPEN'&&(p.protection.takeProfit||p.protection.stopLoss)?<small>TP {privateNumber(p.protection.takeProfit,2)} / SL {privateNumber(p.protection.stopLoss,2)}</small>:null}
        <button type="button" disabled={c.busy||p.status!=='OPEN'} onClick={()=>c.setDialog({kind:'protection',position:p})}>TP/SL</button><button type="button" disabled={c.busy||p.status!=='OPEN'} onClick={()=>c.setDialog({kind:'leverage',position:p})}>Плечо</button></td>
      <td>{p.status==='OPEN'?<><button type="button" disabled={c.busy} onClick={()=>c.setDialog({kind:'close',position:p})}>Рыночный</button><button type="button" disabled={c.busy} onClick={()=>c.exitOnChart(p)}>На графике</button></>:p.status==='LIQUIDATED'?'Ликвидирована':'Закрыта'}</td>
    </tr>;})}
    {!list?.length&&<tr><td colSpan={10}>{closed?'Закрытых позиций нет':'Открытых позиций нет'}</td></tr>}</tbody></table>;

  const orderRows=(list:NativeState['orders']|undefined,empty:string)=><table><thead><tr><th>Время UTC</th><th>Контракт</th><th>Направление</th><th>Тип</th><th>Цена</th><th>Кол-во</th><th>Исполнено</th><th>Ср. цена</th><th>Статус</th><th/></tr></thead><tbody>
    {[...(list??[])].reverse().map(o=><tr key={o.id}><td>{privateUtc(o.createdAt)}</td><td>{o.symbol}</td><td className={o.side==='LONG'?'positive':'negative'}>{o.side}</td><td>{o.type}</td><td>{privateNumber(o.price)}</td><td>{privateNumber(o.quantity,3)}</td><td>{privateNumber(o.filled,3)}</td><td>{privateNumber(o.averagePrice)}</td><td>{o.status}</td>
      <td>{['OPEN','PARTIALLY_FILLED'].includes(o.status)&&<button type="button" disabled={c.busy} onClick={()=>void c.run({kind:'CANCEL',orderId:o.id})}>Отменить</button>}</td></tr>)}
    {!list?.length&&<tr><td colSpan={10}>{empty}</td></tr>}</tbody></table>;

  return <div className="native-demo-panel">
    <div className="bottom-tabs" role="tablist" aria-label="Счёт">
      {tabs.map(([id,label])=><button key={id} type="button" className={`bottom-tab ${id===tab?'active':''}`} role="tab" aria-selected={id===tab} onClick={()=>setTab(id)}>{label}</button>)}
      <button type="button" className="bottom-tab native-refresh" title="Обновить" aria-label="Обновить" disabled={c.busy||!s?.initialized} onClick={()=>void c.run({kind:'REFRESH'})}>⟳</button>
    </div>
    {!s||!s.initialized?<p className="native-empty">{!s?'Загрузка…':'Начните торговлю в панели справа.'}</p>:<div className="native-table-scroll">
      {tab==='positions'&&positionRows(s.positions,false)}
      {tab==='pnl'&&positionRows(s.history,true)}
      {tab==='open'&&orderRows(working,'Открытых ордеров нет')}
      {tab==='history'&&orderRows(s.orders,'Ордеров нет')}
      {tab==='fills'&&<table><thead><tr><th>Время UTC</th><th>Контракт</th><th>Операция</th><th>Цена</th><th>Кол-во</th><th>Комиссия</th><th>Изменение баланса</th></tr></thead><tbody>
        {[...s.events].reverse().filter(e=>e.kind!=='PROTECTION'&&e.kind!=='LEVERAGE').map(e=><tr key={e.id}><td>{privateUtc(e.time)}</td><td>{e.symbol}</td><td>{e.kind}</td><td>{privateNumber(e.price)}</td><td>{privateNumber(e.quantity,3)}</td><td>{privateNumber(e.fee,6)}</td><td className={sign(e.cashflow)}>{privateNumber(e.cashflow,6)}</td></tr>)}
        {!s.events.length&&<tr><td colSpan={7}>Сделок нет</td></tr>}</tbody></table>}
      {tab==='assets'&&<table><thead><tr><th>Актив</th><th>Баланс</th><th>Доступно</th><th>Использовано</th><th>Резерв ордеров</th><th>Нереализованный P&amp;L</th></tr></thead><tbody>
        <tr><td><b>USDT</b></td><td>{privateNumber(s.account?.equity)}</td><td>{privateNumber(s.account?.available)}</td><td>{privateNumber(s.account?.usedMargin)}</td><td>{privateNumber(s.account?.orderReserve)}</td>
          <td className={sign(s.account?.unrealizedPnl)}>{privateNumber(s.account?.unrealizedPnl)}</td></tr></tbody></table>}
    </div>}
  </div>;
}
export function NativeDemoDialogs({controller:c}:{controller:NativeDemoController}){
  return <>{c.dialog&&<NativeAction key={c.dialog.kind+c.dialog.position.id} controller={c}/>} {c.card&&<PrivateResultCardDialog snapshot={c.card} loadSnapshot={nativeDemoApi.getCard} openHref={`/futures?nativeCard=${encodeURIComponent(c.card.id)}`} onClose={()=>c.setCard(null)} onError={c.fail}/>}</>;
}
function NativeAction({controller:c}:{controller:NativeDemoController}){
  const d=c.dialog!,p=d.position,ref=useRef<HTMLDialogElement>(null),[qty,setQty]=useState(''),[tp,setTp]=useState(p.protection.takeProfit??''),[sl,setSl]=useState(p.protection.stopLoss??''),[leverage,setLeverage]=useState(p.leverage),[trigger,setTrigger]=useState<'MARK'|'LAST'>(p.protection.triggerBy);
  useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close();},[]);
  async function submit(e:FormEvent){
    e.preventDefault();
    const body:NativeDraft=d.kind==='close'?{kind:'CLOSE',positionId:p.id,...(qty?{quantity:qty}:{})}:d.kind==='leverage'?{kind:'LEVERAGE',positionId:p.id,leverage}
      :{kind:'PROTECTION',positionId:p.id,protection:{takeProfit:tp||null,stopLoss:sl||null,triggerBy:trigger,quantity:qty||null}};
    if(await c.run(body))c.setDialog(null);
  }
  return <dialog ref={ref} className="native-action-dialog" onCancel={()=>c.setDialog(null)}><form onSubmit={submit}>
    <header><b>{p.symbol} · {d.kind==='protection'?'TP/SL':d.kind==='close'?'Закрытие позиции':'Плечо'}</b><button type="button" aria-label="Закрыть окно" onClick={()=>c.setDialog(null)}>×</button></header>
    {d.kind==='leverage'?<><label>Плечо<input value={leverage} onChange={e=>setLeverage(e.target.value)} inputMode="decimal" required/></label><p>Плечо меняет требуемую маржу и ROI-базу, но не количество, цену входа и P&amp;L в USDT.</p></>
      :<><label>{d.kind==='close'?'Количество · пусто = вся позиция':'Количество TP/SL · пусто = вся позиция'}<input aria-label="Количество закрытия" value={qty} onChange={e=>setQty(e.target.value)} inputMode="decimal" placeholder={p.quantity}/></label>
        {d.kind==='close'&&<p>Закрытие по текущему стакану. Для закрытия на исторической свече используйте «На графике».</p>}
        {d.kind==='protection'&&<><label>Take Profit<input aria-label="Цена TP" value={tp} onChange={e=>setTp(e.target.value)} inputMode="decimal"/></label><label>Stop Loss<input aria-label="Цена SL" value={sl} onChange={e=>setSl(e.target.value)} inputMode="decimal"/></label>
          <label>Цена срабатывания<select value={trigger} onChange={e=>setTrigger(e.target.value as 'MARK'|'LAST')}><option value="MARK">Mark Price</option><option value="LAST">Last Price</option></select></label><p>Пустое поле удаляет соответствующий TP или SL.</p></>}</>}
    {c.error&&<p role="alert">{c.error}</p>}<button type="submit" disabled={c.busy}>{c.busy?'Выполняется…':'Подтвердить'}</button>
  </form></dialog>;
}
