import { useEffect,useRef,useState } from 'react';
import { privateInputUtc,privateNumber,privateUtc,privateExplanation,type PrivateMarket,type PrivateMode,type PrivatePreview,type PrivatePreviewRequest,type PrivateSide,type PrivateState } from '../../lib/privateTradingApi';

type Draft=Omit<PrivatePreviewRequest,'idempotencyKey'>;
export function PrivateOrderTicket({symbol,market,wallet,busy,preview,pickedPrice,savedPreviews=[],onResume,onRefresh,onModeChange,onPreview,onConfirm,onCancel,onAllocate,onChartEntry}:{
  symbol:string;market:PrivateMarket|null;wallet:PrivateState['wallet']|null;busy:boolean;preview:PrivatePreview|null;
  onPreview:(draft:Draft)=>void;onConfirm:()=>void;onCancel:()=>void;onAllocate:(amount:string)=>void;
  pickedPrice?:{price:string;sequence:number}|null;
  savedPreviews?:PrivatePreview[];onResume?:(id:string)=>void;
  onRefresh?:()=>void;
  onModeChange?:(mode:PrivateMode)=>void;onChartEntry?:()=>void;
}){
  const[mode,setMode]=useState<PrivateMode>('DEMO_LIVE'),[side,setSide]=useState<PrivateSide>('LONG'),[type,setType]=useState<'MARKET'|'LIMIT'>('MARKET');
  const[sizeType,setSizeType]=useState<'quantity'|'margin'>('margin'),[size,setSize]=useState(''),[leverage,setLeverage]=useState('10');
  const[limit,setLimit]=useState(''),[tp,setTp]=useState(''),[sl,setSl]=useState(''),[allocation,setAllocation]=useState('');
  const[opened,setOpened]=useState(''),[closed,setClosed]=useState(''),[toNow,setToNow]=useState(true),[capital,setCapital]=useState(''),[manual,setManual]=useState(''),[manualOn,setManualOn]=useState(false),[error,setError]=useState('');
  const[events,setEvents]=useState<{id:string;effectiveAt:string;kind:'MARGIN'|'CLOSE'|'TPSL';amount:string;quantity:string;takeProfit:string;stopLoss:string}[]>([]);
  useEffect(()=>{if(pickedPrice&&mode==='DEMO_LIVE'){setType('LIMIT');setLimit(pickedPrice.price);}},[pickedPrice?.sequence]);
  const asOfAttempt=useRef<{fingerprint:string;asOf:string}|null>(null);
  useEffect(()=>{if(preview){asOfAttempt.current=null;const previewMode=preview.mode??preview.result?.position?.mode;if(previewMode)setMode(previewMode);}},[preview?.id]);
  const rules=market?.instrument;
  const historical=mode==='HISTORICAL_REPLAY';
  const livePreview=preview?.mode==='DEMO_LIVE'||preview?.result?.position?.mode==='DEMO_LIVE';
  const consent=preview?.result?.consent;
  function selectMode(next:PrivateMode){if(busy||next===mode)return;setMode(next);onModeChange?.(next);}
  function submit(event:React.FormEvent){
    event.preventDefault();setError('');
    try{
      const draft:Draft={mode,symbol,side,type:historical?'MARKET':type,leverage,[sizeType]:size,
        ...(tp?{takeProfit:tp}:{}),...(sl?{stopLoss:sl}:{}),...(!historical&&type==='LIMIT'?{limitPrice:limit}:{})};
      if(historical){draft.effectiveOpenedAt=privateInputUtc(opened);draft.capital=capital;
        if(toNow){const fingerprint=JSON.stringify({draft,opened,capital,manualOn,manual,events});if(asOfAttempt.current?.fingerprint!==fingerprint)asOfAttempt.current={fingerprint,asOf:new Date().toISOString()};draft.asOf=asOfAttempt.current.asOf;}else{draft.effectiveClosedAt=privateInputUtc(closed);draft.asOf=draft.effectiveClosedAt;}
        if(manualOn)draft.manualEntryPrice=manual;
        draft.events=events.map(event=>({id:event.id,effectiveAt:privateInputUtc(event.effectiveAt),...(event.kind==='MARGIN'?{kind:'MARGIN' as const,amount:event.amount}:event.kind==='CLOSE'?{kind:'CLOSE' as const,quantity:event.quantity}:{kind:'TPSL' as const,takeProfit:event.takeProfit||null,stopLoss:event.stopLoss||null})}));
      }
      onPreview(draft);
    }catch(e){setError(e instanceof Error?e.message:'Проверьте параметры');}
  }
  const form=(<form onSubmit={submit}>
      <div className="private-segments sides" role="group" aria-label="Направление"><button type="button" className="long" aria-pressed={side==='LONG'} onClick={()=>setSide('LONG')}>Long</button><button type="button" className="short" aria-pressed={side==='SHORT'} onClick={()=>setSide('SHORT')}>Short</button></div>
      <div className="private-ticket-row"><span>Изолированная маржа</span><label>Плечо<input aria-label="Плечо" type="number" min={rules?.minLeverage||'1'} max={rules?.maxLeverage} step={rules?.leverageStep||'1'} value={leverage} onChange={e=>setLeverage(e.target.value)} required/></label></div>
      {!historical&&<div className="private-segments" role="group" aria-label="Тип ордера"><button type="button" aria-pressed={type==='MARKET'} onClick={()=>setType('MARKET')}>Рынок</button><button type="button" aria-pressed={type==='LIMIT'} onClick={()=>setType('LIMIT')}>Лимит</button></div>}
      {!historical&&type==='LIMIT'&&<label>Цена лимита<input type="number" inputMode="decimal" min={rules?.tickSize||'0.00000001'} step={rules?.tickSize||'any'} value={limit} onChange={e=>setLimit(e.target.value)} required/></label>}
      <label><select aria-label="Способ задания размера" value={sizeType} onChange={e=>setSizeType(e.target.value as 'quantity'|'margin')}><option value="margin">Маржа, USDT</option><option value="quantity">Количество, {symbol.replace('/USDT','').replace('USDT','')}</option></select><input aria-label={sizeType==='quantity'?'Количество':'Маржа, USDT'} type="number" inputMode="decimal" min={sizeType==='quantity'?rules?.minOrderQty||'0.00000001':'0.00000001'} step={sizeType==='quantity'?rules?.qtyStep||'any':'any'} value={size} onChange={e=>setSize(e.target.value)} required/></label>
      {historical&&<div className="private-history-fields"><p className="private-timezone">Все даты и время — UTC. Период расчёта — до 90 дней.</p><label>Вход в прошлом<input type="datetime-local" value={opened} max={new Date().toISOString().slice(0,16)} onChange={e=>setOpened(e.target.value)} required/></label><label className="private-check"><input type="checkbox" checked={toNow} onChange={e=>setToNow(e.target.checked)}/>Рассчитать до сейчас</label>{!toNow&&<label>Выход в прошлом<input type="datetime-local" value={closed} min={opened} max={new Date().toISOString().slice(0,16)} onChange={e=>setClosed(e.target.value)} required/></label>}<label>Капитал сценария, USDT<input type="number" min="0.00000001" step="any" value={capital} onChange={e=>setCapital(e.target.value)} required/></label><details><summary>Допущение цены</summary><label className="private-check"><input type="checkbox" checked={manualOn} onChange={e=>setManualOn(e.target.checked)}/>Ручная цена входа</label>{manualOn&&<label>Цена по допущению<input type="number" min="0.00000001" step="any" value={manual} onChange={e=>setManual(e.target.value)} required/></label>}</details></div>}
      <details className="private-protection"><summary>Take-profit / Stop-loss</summary><div className="private-ticket-row"><label>TP<input type="number" min="0.00000001" step={rules?.tickSize||'any'} value={tp} onChange={e=>setTp(e.target.value)}/></label><label>SL<input type="number" min="0.00000001" step={rules?.tickSize||'any'} value={sl} onChange={e=>setSl(e.target.value)}/></label></div></details>
      {historical&&<details className="private-event-editor"><summary>События сценария ({events.length})</summary><p>Изменения применяются в выбранное время UTC.</p>{events.map((event,index)=>{
        const update=(next:Partial<typeof event>)=>setEvents(current=>current.map(row=>row.id===event.id?{...row,...next}:row));
        return <fieldset key={event.id}><legend>Событие {index+1}</legend><label>Время UTC<input type="datetime-local" min={opened} value={event.effectiveAt} onChange={e=>update({effectiveAt:e.target.value})} required/></label><select aria-label={`Тип события ${index+1}`} value={event.kind} onChange={e=>update({kind:e.target.value as typeof event.kind})}><option value="MARGIN">Изменение маржи</option><option value="CLOSE">Частичное закрытие</option><option value="TPSL">Изменение TP/SL</option></select>{event.kind==='MARGIN'?<label>Добавить / снять USDT<input type="number" step="any" value={event.amount} onChange={e=>update({amount:e.target.value})} required/></label>:event.kind==='CLOSE'?<label>Количество<input type="number" min="0.00000001" step="any" value={event.quantity} onChange={e=>update({quantity:e.target.value})} required/></label>:<><label>Take-profit<input type="number" min="0.00000001" step="any" value={event.takeProfit} onChange={e=>update({takeProfit:e.target.value})}/></label><label>Stop-loss<input type="number" min="0.00000001" step="any" value={event.stopLoss} onChange={e=>update({stopLoss:e.target.value})}/></label></>}<button type="button" onClick={()=>setEvents(current=>current.filter(row=>row.id!==event.id))}>Удалить событие</button></fieldset>;
      })}<button type="button" disabled={events.length>=40} onClick={()=>setEvents(current=>[...current,{id:crypto.randomUUID(),effectiveAt:'',kind:'MARGIN',amount:'',quantity:'',takeProfit:'',stopLoss:''}])}>Добавить событие</button></details>}
      {error&&<p role="alert">{error}</p>}
      <button className={`private-submit ${side==='LONG'?'long':'short'}`} disabled={busy||!wallet||(!historical&&!market)}>{busy?'Расчёт…':'Рассчитать сделку'}</button>
    </form>);
  return <aside className="private-order-ticket">
    <div className="private-segments" role="tablist" aria-label="Время сделки">
      <button type="button" role="tab" aria-selected={!historical} disabled={busy} onClick={()=>selectMode('DEMO_LIVE')}>Сейчас</button>
      <button type="button" role="tab" aria-selected={historical} disabled={busy} onClick={()=>{selectMode('HISTORICAL_REPLAY');onChartEntry?.();}}>Историческая сделка</button>
    </div>
    <div className="private-wallet"><span>Доступно</span><strong>{privateNumber(wallet?.available)} USDT</strong><details><summary>Выделить средства</summary><p>Доступно для перевода: {privateNumber(wallet?.demoAvailable)} USDT</p><label>Сумма, USDT<input inputMode="decimal" type="number" min="0.00000001" step="any" value={allocation} onChange={e=>setAllocation(e.target.value)}/></label><button type="button" disabled={busy||!allocation||Number(allocation)<=0} onClick={()=>onAllocate(allocation)}>Выделить</button></details></div>
    {historical&&onChartEntry?<><button className="private-submit long" type="button" onClick={onChartEntry}>Выбрать свечу на графике</button><details className="private-manual-ticket"><summary>Ручной редактор</summary>{form}</details></>:form} {savedPreviews.some(item=>['RUNNING','READY','INCOMPLETE','AMBIGUOUS'].includes(item.status))&&<details className="private-saved-previews"><summary>Сохранённые расчёты</summary>{savedPreviews.filter(item=>['RUNNING','READY','INCOMPLETE','AMBIGUOUS'].includes(item.status)).map(item=><button type="button" key={item.id} disabled={busy} onClick={()=>onResume?.(item.id)}><strong>{item.result?.position?.symbol||'Сценарий'}</strong><span>{privateUtc(item.createdAt)}</span><small>{item.status==='RUNNING'?'Выполняется':item.status==='READY'?'Готов к подтверждению':'Черновик'}</small></button>)}</details>}
    {preview&&<section className="private-preview" aria-live="polite"><header><strong>Предпросмотр · {livePreview?'Сейчас':'По истории'}</strong><button type="button" disabled={busy} onClick={onCancel} aria-label="Закрыть предпросмотр">×</button></header>
      {preview.status==='RUNNING'&&<><progress max="100" value={preview.progress}/><p>Расчёт сценария · {preview.progress}%</p></>}
      {preview.error&&<p role="alert">{preview.error}</p>}
      {livePreview&&preview.result?.position&&<p className="private-preview-timestamp">Снимок для расчёта: {privateUtc(preview.result.position.asOf)}. Цена исполнения определяется при подтверждении в указанных ниже пределах.</p>}
      {preview.result?.position&&<><p>{preview.result.position.symbol} · {preview.result.position.side} · {preview.result.position.leverage}×</p><dl><dt>Количество</dt><dd>{privateNumber(preview.result.position.quantity,8)}</dd><dt>Цена входа</dt><dd>{privateNumber(preview.result.position.entryPrice,6)}</dd><dt>Маржа</dt><dd>{privateNumber(preview.result.cost.initialMargin)} USDT</dd><dt>Комиссия</dt><dd>{privateNumber(preview.result.cost.fee)} USDT</dd><dt>Резерв закрытия</dt><dd>{privateNumber(preview.result.cost.closeFeeReserve)} USDT</dd><dt>Всего требуется</dt><dd>{privateNumber(preview.result.cost.required)} USDT</dd>{preview.result.position.mode==='HISTORICAL_REPLAY'&&<><dt>Время входа</dt><dd>{privateUtc(preview.result.position.effectiveOpenedAt)}</dd><dt>Прибыль</dt><dd>{privateNumber(preview.result.position.netPnl)} USDT</dd></>}</dl>{preview.result.assumptions?.length?<details><summary>Модель расчёта</summary><ul>{preview.result.assumptions.map((item,i)=><li key={i}>{privateExplanation(item)}</li>)}</ul></details>:null}{preview.result.issues?.map((issue,i)=><p className="private-warning" key={i}>{privateExplanation(issue)}</p>)}</>}
      {['INCOMPLETE','AMBIGUOUS'].includes(preview.status)&&<p className="private-warning">Результат не подтверждён. В итоговые показатели не включается.</p>}
      {preview.status==='EXPIRED'&&<p className="private-warning">Срок расчёта истёк. Рассчитайте сделку ещё раз.</p>}
      {livePreview&&consent&&<section className="private-consent" aria-label="Подтверждаемые условия исполнения"><strong>Условия исполнения</strong><dl>
        <dt>Количество к размещению</dt><dd>{privateNumber(consent.quantity,8)}</dd>
        <dt>Минимальное исполнение</dt><dd>{privateNumber(consent.minimumFillQuantity,8)}</dd>
        <dt>Максимум средств</dt><dd>{privateNumber(consent.maxRequired,8)} USDT</dd>
        {consent.maxAveragePrice!==null&&<><dt>Макс. средняя цена</dt><dd>{privateNumber(consent.maxAveragePrice,8)}</dd></>}
        {consent.minAveragePrice!==null&&<><dt>Мин. средняя цена</dt><dd>{privateNumber(consent.minAveragePrice,8)}</dd></>}
        <dt>Допуск цены</dt><dd>{consent.slippagePercent!==undefined?`${privateNumber(consent.slippagePercent)}%`:`${privateNumber(consent.slippageBps)} б.п.`}</dd>
        {preview?.expiresAt&&<><dt>Подтвердить до</dt><dd>{privateUtc(preview.expiresAt)}</dd></>}
      </dl><p>Перед подтверждением котировка проверяется заново. При выходе за эти границы потребуется новый расчёт.</p></section>}
      {livePreview&&!consent&&preview.status==='READY'&&<p className="private-warning">Обновите расчёт, чтобы увидеть границы исполнения.</p>}
      {['READY','EXPIRED'].includes(preview.status)&&onRefresh&&<button type="button" disabled={busy} onClick={onRefresh}>Обновить расчёт</button>}
      {['READY','INCOMPLETE','AMBIGUOUS'].includes(preview.status)&&<button type="button" className="primary" disabled={busy||(livePreview&&!consent)} onClick={onConfirm}>{preview.status==='READY'?'Подтвердить и сохранить':'Сохранить черновик'}</button>}
    </section>}
  </aside>;
}
