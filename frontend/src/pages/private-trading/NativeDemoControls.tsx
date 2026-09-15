import { useEffect,useRef,useState,type FormEvent } from 'react';
import { privateNumber,privateUtc } from '../../lib/privateTradingApi';
import { nativeDemoApi,nativeFundingPercent,type NativeDraft,type NativePosition } from '../../lib/nativeDemoApi';
import { PrivateResultCardDialog } from './PrivateResultCardDialog';
import type { NativeDemoController } from './useNativeDemo';
import './nativeDemo.css';

/** Owner-only account source switch, inside the terminal trading panel (not the global header). */
export function NativeDemoSwitch({controller:c}:{controller:NativeDemoController}){
  return c.allowed?<div className="native-mode-switch" role="group" aria-label="Торговый счёт">
    <button type="button" aria-pressed={!c.requested} onClick={()=>c.toggle(false)}>Real</button>
    <button type="button" aria-pressed={c.requested} onClick={()=>c.toggle(true)}>Demo</button>
  </div>:null;
}
const sign=(value:string|null|undefined)=>value===null||value===undefined||value===''?'':Number(value)<0?'negative':Number(value)>0?'positive':'';
function fundingText(c:NativeDemoController){
  const f=c.state?.model.funding;
  return f?`Long ${nativeFundingPercent(f.longCashflow)}, Short ${nativeFundingPercent(f.shortCashflow)} от стоимости позиции каждые 8 ч UTC (коэффициенты ${f.longCashflow} / ${f.shortCashflow}). Пользовательская демо-модель — не исторический funding Bybit.`:'—';
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
  if(!c.allowed)return <div className="native-demo-controls" role="status">{c.checked?'Приватный Demo недоступен для этого аккаунта.':'Проверка доступа…'}</div>;
  const state=c.state,a=state?.account;
  return <div className="native-demo-controls">
    <header><b>Demo · Cross</b><span>USDT Perpetual</span></header>
    {state?.source==='PREVIEW_FIXTURE'&&<p className="native-preview-label">Тестовый баланс preview. Не ваш счёт.</p>}
    {c.error&&<p role="alert">{c.error}</p>}
    {!state?<p role="status">Загрузка демо-счёта…</p>:!state.initialized?<div className="native-demo-connect">
      <p>Доступно демо-средств: <b>{privateNumber(state.demoAvailable)} USDT</b></p>
      <p>Весь переведённый демо-баланс — общее обеспечение Cross Margin. Реальные средства не используются.</p>
      <p>Funding: {fundingText(c)}</p>
      <button type="button" disabled={c.busy||!state.demoAvailable} onClick={()=>void c.initialize()}>Использовать демо-средства</button>
    </div>:<>
      <div className="native-balance"><span>Доступно</span><b>{privateNumber(a?.available)} USDT</b></div>
      <form onSubmit={submit}>
        <div className="native-side"><button type="button" className="positive" aria-pressed={side==='LONG'} onClick={()=>setSide('LONG')}>Long</button><button type="button" className="negative" aria-pressed={side==='SHORT'} onClick={()=>setSide('SHORT')}>Short</button></div>
        <div className="native-types"><button type="button" aria-pressed={type==='MARKET'} onClick={()=>setType('MARKET')}>Рыночный</button><button type="button" aria-pressed={type==='LIMIT'} onClick={()=>setType('LIMIT')}>Лимитный</button></div>
        <button type="button" className="native-history" disabled={c.busy} onClick={c.pickEntry}>Выбрать вход на графике</button>
        {selected&&<section className="native-candle" data-open-time={selected.openTime} data-interval={selected.interval}>
          <b>{c.exitId?'Выбран выход':'Исторический вход'}</b><span>{privateUtc(selected.openTime)} · {selected.interval}</span>
          {historicalLimit?<p className="native-hint">Лимит на этой свече: Buy исполняется, если Low ≤ цены; Sell — если High ≥ цены. Иначе ордер ждёт после закрытия свечи. Это симуляция по OHLC.</p>
            :<label>Цена свечи<select value={point} onChange={e=>setPoint(e.target.value as 'OPEN'|'CLOSE')}><option value="OPEN">Открытие</option><option value="CLOSE">Закрытие</option></select></label>}
          <button type="button" onClick={()=>{c.setCandle(null);c.setExitId(null);}}>Отменить выбор</button>
        </section>}
        {type==='LIMIT'&&!c.exitId&&<label>Лимитная цена<input aria-label="Лимитная цена" inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)} required/></label>}
        {!c.exitId&&<>
          <label>Маржа, USDT<input aria-label="Маржа, USDT" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} required/></label>
          <label>Плечо<input aria-label="Плечо" inputMode="decimal" value={leverage} onChange={e=>setLeverage(e.target.value)} required/></label>
          <details><summary>TP/SL</summary>
            <label>Take Profit<input aria-label="Take Profit" inputMode="decimal" value={tp} onChange={e=>setTp(e.target.value)} placeholder="Не установлен"/></label>
            <label>Stop Loss<input aria-label="Stop Loss" inputMode="decimal" value={sl} onChange={e=>setSl(e.target.value)} placeholder="Не установлен"/></label>
          </details>
        </>}
        <button type="submit" className={`native-submit ${side==='LONG'?'long':'short'}`} disabled={c.busy||(!!c.exitId&&!selected)}>{c.busy?'Сервер рассчитывает…':c.exitId?'Закрыть на выбранной свече':selected?'Открыть историческую сделку':`Открыть ${side==='LONG'?'Long':'Short'}`}</button>
      </form>
      <dl>
        <dt>Обеспечение (Cross)</dt><dd>{privateNumber(a?.equity)} USDT</dd>
        <dt>Нереализованный P&amp;L</dt><dd className={sign(a?.unrealizedPnl)}>{privateNumber(a?.unrealizedPnl)} USDT</dd>
        <dt>Использовано</dt><dd>{privateNumber(a?.usedMargin)} USDT</dd>
        <dt>Резерв ордеров</dt><dd>{privateNumber(a?.orderReserve)} USDT</dd>
        <dt>Поддерживающая маржа</dt><dd>{privateNumber(a?.maintenanceMargin)} USDT</dd>
      </dl>
      <details className="native-model"><summary>Условия Demo</summary>
        <p>Funding: {fundingText(c)}</p>
        <p>История: предполагаемый путь Open → Low → High → Close. Свечи за последние 7 дней — минутные, до 45 дней — 15-минутные, старше — часовые. Историческое исполнение — симуляция, не сделка на Bybit.</p>
        <p>Cross Margin: весь демо-капитал — общее обеспечение. Ликвидация — когда обеспечение ≤ поддерживающей маржи всех позиций по Mark Price. Цена ликвидации — оценка при неизменных ценах остальных контрактов; «—» значит недостижима при текущем обеспечении.</p>
      </details>
    </>}
  </div>;
}
function Liquidation({p}:{p:NativePosition}){
  if(p.status!=='OPEN')return <>—</>;
  return p.liquidationPrice===null?<span title="При текущем общем обеспечении ликвидация недостижима">—</span>:<>{privateNumber(p.liquidationPrice,2)}</>;
}
export function NativeDemoPanel({controller:c}:{controller:NativeDemoController}){
  const[tab,setTab]=useState<'positions'|'orders'|'history'|'fills'>('positions'),s=c.state;
  const prev=useRef(0);
  useEffect(()=>{if((s?.positions.length??0)>prev.current)setTab('positions');prev.current=s?.positions.length??0;},[s?.positions.length]);
  const rows=tab==='history'?s?.history:s?.positions;
  const tabs=[['positions','Позиции'],['orders','Ордера'],['history','История позиций'],['fills','Исполнения / Funding']] as const;
  return <div className="native-demo-panel">
    <div className="bottom-tabs" role="tablist" aria-label="Демо-счёт">
      {tabs.map(([id,label])=><button key={id} type="button" className={`bottom-tab ${id===tab?'active':''}`} role="tab" aria-selected={id===tab} onClick={()=>setTab(id)}>{label}</button>)}
      <button type="button" className="bottom-tab" disabled={c.busy||!s?.initialized} onClick={()=>void c.run({kind:'REFRESH'})}>Обновить</button>
    </div>
    {!s||!s.initialized?<p className="native-empty">{!s?'Данные счёта ещё не получены.':'Подключите существующие демо-средства в торговой панели.'}</p>:<div className="native-table-scroll">
      {(tab==='positions'||tab==='history')&&<table><thead><tr>
        <th>Контракт</th><th>Количество</th><th>Цена Входа</th><th>{tab==='history'?'Цена выхода':'Рыночная цена'}</th><th>Цена ликв.</th><th>Маржа</th><th>P&amp;L / ROI</th><th>Funding</th><th>TP/SL</th><th>Закрыть</th>
      </tr></thead><tbody>{rows?.map(p=>{
        const pnl=p.status==='OPEN'?p.unrealizedPnl:p.netPnl;
        const exit=p.status==='OPEN'?p.markPrice:[...s.events].reverse().find(e=>e.positionId===p.id&&['CLOSE','TAKE_PROFIT','STOP_LOSS','LIQUIDATION'].includes(e.kind))?.price??null;
        return <tr key={p.id} aria-selected={c.selectedId===p.id}>
          <td><button type="button" onClick={()=>c.selectEntry(p)}><b>{p.symbol}</b></button><small className={p.side==='LONG'?'positive':'negative'}>{p.side} · Cross {p.leverage}×</small>{p.historical&&<small>Historical Test · {privateUtc(p.openedAt)}</small>}</td>
          <td>{privateNumber(p.quantity,3)}</td><td>{privateNumber(p.entryPrice,2)}</td><td>{privateNumber(exit,2)}</td><td><Liquidation p={p}/></td>
          <td>{privateNumber(p.status==='OPEN'?p.roiBasis:p.closedRoiBasis)}</td>
          <td><span className={sign(pnl)}>{privateNumber(pnl)} USDT<br/>{privateNumber(p.roiPercent)}%</span><button type="button" aria-label={`Карточка ${p.symbol}`} onClick={()=>void c.showCard(p.id)}>↗</button></td>
          <td className={sign(p.fundingNet)}>{privateNumber(p.fundingNet)}</td>
          <td>{p.status==='OPEN'&&(p.protection.takeProfit||p.protection.stopLoss)?<small>TP {privateNumber(p.protection.takeProfit,2)} / SL {privateNumber(p.protection.stopLoss,2)}</small>:null}
            <button type="button" disabled={c.busy||p.status!=='OPEN'} onClick={()=>c.setDialog({kind:'protection',position:p})}>TP/SL</button><button type="button" disabled={c.busy||p.status!=='OPEN'} onClick={()=>c.setDialog({kind:'leverage',position:p})}>Плечо</button></td>
          <td>{p.status==='OPEN'?<><button type="button" disabled={c.busy} onClick={()=>c.setDialog({kind:'close',position:p})}>Рыночный</button><button type="button" disabled={c.busy} onClick={()=>c.exitOnChart(p)}>На графике</button></>:p.status==='LIQUIDATED'?'Ликвидирована':'Закрыта'}</td>
        </tr>;})}
        {!rows?.length&&<tr><td colSpan={10}>Подтверждённых позиций нет</td></tr>}</tbody></table>}
      {tab==='orders'&&<table><thead><tr><th>Время UTC</th><th>Контракт</th><th>Направление</th><th>Тип</th><th>Цена</th><th>Количество</th><th>Исполнено</th><th>Ср. цена</th><th>Статус</th><th/></tr></thead><tbody>
        {[...s.orders].reverse().map(o=><tr key={o.id}><td>{privateUtc(o.createdAt)}</td><td>{o.symbol}</td><td className={o.side==='LONG'?'positive':'negative'}>{o.side}</td><td>{o.type}</td><td>{privateNumber(o.price)}</td><td>{privateNumber(o.quantity,3)}</td><td>{privateNumber(o.filled,3)}</td><td>{privateNumber(o.averagePrice)}</td><td>{o.status}</td>
          <td>{['OPEN','PARTIALLY_FILLED'].includes(o.status)&&<button type="button" disabled={c.busy} onClick={()=>void c.run({kind:'CANCEL',orderId:o.id})}>Отменить</button>}</td></tr>)}
        {!s.orders.length&&<tr><td colSpan={10}>Ордеров нет</td></tr>}</tbody></table>}
      {tab==='fills'&&<table><thead><tr><th>Время UTC</th><th>Контракт</th><th>Операция</th><th>Цена</th><th>Количество</th><th>Комиссия</th><th>Изменение баланса</th><th>Модель цены</th></tr></thead><tbody>
        {[...s.events].reverse().filter(e=>e.kind!=='PROTECTION'&&e.kind!=='LEVERAGE').map(e=><tr key={e.id}><td>{privateUtc(e.time)}</td><td>{e.symbol}</td><td>{e.kind}</td><td>{privateNumber(e.price)}</td><td>{privateNumber(e.quantity,3)}</td><td>{privateNumber(e.fee,6)}</td><td className={sign(e.cashflow)}>{privateNumber(e.cashflow,6)}</td><td><small>{e.pricing}</small></td></tr>)}
      </tbody></table>}
    </div>}
    {s?.asOf&&<div className="native-asof">Серверный расчёт: {privateUtc(s.asOf)} · Ревизия {s.revision}</div>}
  </div>;
}
export function NativeDemoDialogs({controller:c}:{controller:NativeDemoController}){
  return <>{c.dialog&&<NativeAction key={c.dialog.kind+c.dialog.position.id} controller={c}/>} {c.card&&<PrivateResultCardDialog snapshot={c.card} loadSnapshot={nativeDemoApi.getCard} openHref={`/futures?demo=1&nativeCard=${encodeURIComponent(c.card.id)}`} onClose={()=>c.setCard(null)} onError={c.fail}/>}</>;
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
