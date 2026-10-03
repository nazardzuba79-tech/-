import { useEffect, useRef, useState } from 'react';
import { CashDetail, CashMessage, CashSummary, CASH_STATUSES, cashError, cashRequest, dateTime } from './cashApi';
import cities from './cities.json';
import { countryName } from './otcConfig';
import { invalidateSpendableBalances } from '../../lib/balanceInvalidation';

const directory = cities as Record<string,{id:string;name:string;timezone:string}[]>;
export function cashCity(row: Pick<CashSummary,'country'|'cityId'>) { return directory[row.country]?.find(c=>c.id===row.cityId); }
export function CashList({ admin = false, active = true, onOpen }: { admin?: boolean; active?: boolean; onOpen: (id:string)=>void }) {
  const [rows,setRows]=useState<CashSummary[]>([]),[page,setPage]=useState(0),[more,setMore]=useState(false);
  const [filter,setFilter]=useState(''),[applied,setApplied]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(true),[revision,setRevision]=useState(0);
  useEffect(()=>{
    if (!active) return;
    let alive=true;setBusy(true);setError('');
    const base=admin?'/admin/otc':'/otc/requests';
    cashRequest<{rows:CashSummary[];hasMore:boolean}>(`${base}?page=${page}${applied?`&status=${applied}`:''}`)
      .then(data=>{if(alive){setRows(data.rows);setMore(data.hasMore);}})
      .catch(e=>{if(alive)setError(cashError(e));}).finally(()=>{if(alive)setBusy(false);});
    return()=>{alive=false;};
  },[admin,page,applied,revision,active]);
  return <section className="otc-cash-panel" aria-label={admin?'OTC-заявки':'Мои заявки'}>
    <div className="otc-cash-row"><h2>{admin?'OTC-заявки':'Мои заявки'}</h2><button onClick={()=>setRevision(x=>x+1)} disabled={busy}>Обновить</button></div>
    {admin&&<form className="otc-cash-row" onSubmit={e=>{e.preventDefault();setApplied(filter);setPage(0);setRevision(x=>x+1);}}>
      <label>Статус<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">Все статусы</option>{Object.entries(CASH_STATUSES).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
      <button disabled={busy}>Применить</button>
    </form>}
    {busy?<p role="status">Загрузка заявок…</p>:error?<p role="alert">{error} Список не подтверждён.</p>:<>
      {!rows.length&&<p>Заявок нет.</p>}
      <div className="otc-cash-cards">{rows.map(row=><button className="otc-cash-list-item" key={row.id} onClick={()=>onOpen(row.id)}>
        <strong>{row.number} · {CASH_STATUSES[row.status]}</strong>
        {row.user&&<span>{row.user.email} · UID {row.user.id}</span>}
        <span>{countryName(row.country,'ru')}, {cashCity(row)?.name} · {row.quantity} {row.asset} → {row.fiat}</span>
        <span>Резерв: {row.reservedQuantity ?? '—'} {row.asset} · {dateTime(row.createdAt)}</span>
      </button>)}</div>
    </>}
    <div className="otc-cash-row"><button disabled={busy||page===0} onClick={()=>setPage(x=>x-1)}>Назад</button><span>Страница {page+1}</span><button disabled={busy||!more} onClick={()=>setPage(x=>x+1)}>Далее</button></div>
  </section>;
}

export function CashDetailPanel({id,admin=false,onClose}:{id:string;admin?:boolean;onClose:()=>void}) {
  const base=admin?'/admin/otc':'/otc/requests';
  const [detail,setDetail]=useState<CashDetail|null>(null),[messages,setMessages]=useState<CashMessage[]>([]),[more,setMore]=useState(false),[page,setPage]=useState(0);
  const [busy,setBusy]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0),[text,setText]=useState(''),[sending,setSending]=useState(false);
  const alive=useRef(true),messageIntent=useRef<{text:string;idempotencyKey:string}|null>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    let active=true;setBusy(true);setError('');
    Promise.all([cashRequest<CashDetail>(`${base}/${id}`),cashRequest<{rows:CashMessage[];hasMore:boolean}>(`${base}/${id}/messages?page=${page}`)])
      .then(([row,msg])=>{if(active){setDetail(row);setMessages(msg.rows);setMore(msg.hasMore);}})
      .catch(e=>{if(active)setError(cashError(e));}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[base,id,page,revision]);
  const refresh=()=>setRevision(x=>x+1);
  async function send() {
    if(!text.trim()||sending)return;
    messageIntent.current??={text,idempotencyKey:crypto.randomUUID()};setSending(true);
    try {await cashRequest(`${base}/${id}/messages`,messageIntent.current);if(alive.current){messageIntent.current=null;setText('');setPage(0);refresh();}}
    catch(e){if(alive.current)setError(cashError(e));}finally{if(alive.current)setSending(false);}
  }
  return <section className="otc-cash-panel" aria-label="Заявка OTC">
    <div className="otc-cash-row"><button onClick={onClose}>← К списку</button><button disabled={busy} onClick={refresh}>Обновить заявку и переписку</button></div>
    {busy&&<p role="status">Проверяем актуальное состояние…</p>}
    {error&&<p role="alert">{error} Денежные действия недоступны до обновления.</p>}
    {detail&&<>
      <h2>{detail.number} · {CASH_STATUSES[detail.status]}</h2>
      <p>{detail.user&&`${detail.user.email} · UID ${detail.user.id} · `}{countryName(detail.country,'ru')}, {cashCity(detail)?.name}</p>
      <p>Количество: <strong>{detail.quantity} {detail.asset}</strong> · Наличные: {detail.fiat}</p>
      {detail.completion&&<p>Reference выдачи: {detail.completion.reference} · {dateTime(detail.completion.completedAt)}</p>}
      <p>Резерв: {detail.reservation.status==='HELD'?detail.reservation.quantity:'0'} {detail.asset} · {detail.reservation.status==='HELD'?'Средства недоступны для торговли и вывода':detail.reservation.status==='CONSUMED'?'Списан после выдачи наличных':'Возвращён в доступный остаток'}</p>
      {detail.pickupRevision>0&&<p className="otc-cash-notice">Адрес и время — в приватной переписке. Актуальная версия инструкции: {detail.pickupRevision}. При изменении используйте последнее сообщение оператора.</p>}
      {detail.cancelRequested&&<p className="otc-cash-notice">Отмена запрошена. Резерв сохраняется, начало выдачи заблокировано до подтверждения кассы.</p>}
      {detail.status==='PAYOUT_IN_PROGRESS'&&<p className="otc-cash-notice">Выдача начата. Если результат неизвестен, нужна ручная сверка кассы. Не выдавайте повторно и не возвращайте криптовалюту автоматически.</p>}
      <h3>Условия и история согласия</h3>
      {!detail.offers.length&&<p>Курс, комиссия и сумма к выдаче согласовываются с поддержкой.</p>}
      {detail.offers.map(offer=><div key={offer.version} className="otc-cash-offer">
        <strong>Версия {offer.version}{offer.acceptedAt?' · Принята пользователем':''}</strong>
        <p>1 {offer.asset} = {offer.rate} {offer.fiat} · Всего {offer.gross} {offer.fiat}<br/>Комиссия {offer.fee} {offer.fiat} · К выдаче <strong>{offer.net} {offer.fiat}</strong></p>
        <p>Принять до: {dateTime(offer.expiresAt)}{offer.acceptedAt&&` · Согласие: ${dateTime(offer.acceptedAt)}`}</p>
      </div>)}
      <CashActions key={`${detail.id}:${detail.version}`} row={detail} admin={admin} disabled={busy||!!error} refresh={refresh}/>
    </>}
    <h3>Приватная поддержка по заявке</h3>
    <p>Сообщения обновляются только по вашему действию. Здесь нет статуса «оператор онлайн».</p>
    {!busy&&!error&&<div className="otc-cash-messages">{messages.length?messages.map(message=><article key={message.id} data-sender={message.sender}>
      <strong>{message.sender==='ADMIN'?'Оператор':'Пользователь'}</strong><time>{dateTime(message.createdAt)}</time><p>{message.text}</p>
    </article>):<p>Сообщений пока нет.</p>}</div>}
    <div className="otc-cash-row"><button disabled={busy||page===0} onClick={()=>setPage(x=>x-1)}>Новые сообщения</button><button disabled={busy||!more} onClick={()=>setPage(x=>x+1)}>Предыдущие сообщения</button></div>
    <form onSubmit={e=>{e.preventDefault();void send();}}>
      <label>Сообщение<textarea maxLength={3000} value={text} disabled={sending||!!messageIntent.current} onChange={e=>setText(e.target.value)}/></label>
      <button disabled={busy||sending||!text.trim()}>{sending?'Отправляем…':messageIntent.current?'Повторить исходное сообщение':'Отправить сообщение'}</button>
    </form>
  </section>;
}

function CashActions({row,admin,disabled,refresh}:{row:CashDetail;admin:boolean;disabled:boolean;refresh:()=>void}) {
  const [selected,setSelected]=useState(''),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [rate,setRate]=useState(''),[fee,setFee]=useState(''),[expires,setExpires]=useState(''),[address,setAddress]=useState(''),[appointment,setAppointment]=useState(''),[reference,setReference]=useState('');
  const intent=useRef<Record<string,unknown>|null>(null),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const choices:{action:string;label:string}[]=[];
  const pre=['RESERVED','OFFERED','ACCEPTED'].includes(row.status);
  if(admin){
    if(pre)choices.push({action:'offer',label:'Предложить условия'},{action:'reject',label:'Отклонить и вернуть резерв'});
    if(['ACCEPTED','PICKUP_READY'].includes(row.status)&&!row.cancelRequested)choices.push({action:'pickup',label:row.pickupRevision?'Обновить адрес / время':'Подготовить выдачу'});
    if(row.status==='PICKUP_READY')choices.push(row.cancelRequested?{action:'confirm-cancel',label:'Касса подтвердила отмену — вернуть резерв'}:{action:'begin-payout',label:'Начать выдачу'});
    if(row.status==='PAYOUT_IN_PROGRESS')choices.push({action:'complete',label:'Подтвердить фактическую выдачу'});
  } else {
    if(row.status==='OFFERED')choices.push({action:'accept',label:`Принять условия версии ${row.offerVersion}`});
    if(pre||row.status==='PICKUP_READY')choices.push({action:'cancel',label:pre?'Отменить и вернуть резерв':'Запросить отмену без освобождения резерва'});
  }
  const base=admin?'/admin/otc':'/otc/requests';
  function payload() {
    const fields=selected==='offer'?{rate,fee,expiresAt:new Date(`${expires}Z`).toISOString()}:selected==='pickup'?{address,appointment:new Date(`${appointment}Z`).toISOString(),timezone:cashCity(row)?.timezone}
      :selected==='complete'?{reference}:selected==='accept'?{offerVersion:row.offerVersion}:selected==='confirm-cancel'?{cashDeskConfirmed:true}:{};
    return {action:selected,version:row.version,idempotencyKey:crypto.randomUUID(),...fields};
  }
  async function submit() {
    if(busy||disabled||!confirmed)return;setBusy(true);setError('');
    try{intent.current??=payload();await cashRequest(`${base}/${row.id}/actions`,intent.current);
      if(alive.current){if(['cancel','reject','confirm-cancel','complete'].includes(selected))invalidateSpendableBalances();refresh();}}
    catch(e){if(alive.current)setError(cashError(e));}finally{if(alive.current)setBusy(false);}
  }
  async function check() {
    setBusy(true);
    try{const result=await cashRequest<{result:unknown}>(`${base}/${row.id}/commands/${intent.current?.idempotencyKey}`);
      if(alive.current){if(result.result){invalidateSpendableBalances();refresh();}else setError('Исходный результат пока не найден. Повтор допустим только с тем же ключом и параметрами.');}}
    catch(e){if(alive.current)setError(cashError(e));}finally{if(alive.current)setBusy(false);}
  }
  if(!choices.length)return null;
  return <div className="otc-cash-actions"><h3>Действия</h3><div className="otc-cash-row">{choices.map(c=><button key={c.action} disabled={disabled||busy||!!intent.current} aria-pressed={selected===c.action} onClick={()=>{setSelected(c.action);setConfirmed(false);setError('');}}>{c.label}</button>)}</div>
    {selected&&<form onSubmit={e=>{e.preventDefault();void submit();}}><fieldset disabled={disabled||busy||!!intent.current}>
      {selected==='offer'&&<><label>Курс: {row.fiat} за 1 {row.asset}<input value={rate} onChange={e=>setRate(e.target.value)} inputMode="decimal" required/></label><label>Комиссия в {row.fiat}<input value={fee} onChange={e=>setFee(e.target.value)} inputMode="decimal" required/></label><label>Срок принятия (UTC)<input type="datetime-local" value={expires} onChange={e=>setExpires(e.target.value)} required/></label><p>Всего = Q × курс, округление вниз до точности наличных. Комиссия вычитается из наличных, дополнительной криптовалюты не списывается.</p></>}
      {selected==='pickup'&&<><label>Адрес действительной кассы<textarea value={address} onChange={e=>setAddress(e.target.value)} maxLength={1500} minLength={5} required/></label><label>Согласованное время (введите UTC)<input type="datetime-local" value={appointment} onChange={e=>setAppointment(e.target.value)} required/></label><p>В переписке время будет показано для города: {cashCity(row)?.timezone}. Адрес не публикуется в общем списке.</p></>}
      {selected==='complete'&&<label>Reference фактической выдачи<input value={reference} onChange={e=>setReference(e.target.value)} minLength={4} maxLength={160} required/></label>}
      <div className="otc-cash-notice">{row.user&&`${row.user.email} · UID ${row.user.id} · `}{row.number} · {cashCity(row)?.name} · {row.quantity} {row.asset} · {row.offers[0]?.net ?? 'Сумма согласовывается'} {row.fiat}</div>
      <label className="otc-cash-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Я проверил(а) параметры{selected==='complete'?' и подтверждаю фактическую выдачу наличных':selected==='confirm-cancel'?' и подтверждение кассы об отмене выдачи':''}.</label>
    </fieldset><button disabled={disabled||busy||!confirmed}>{busy?'Подтверждаем…':intent.current?'Повторить исходное действие':'Подтвердить действие'}</button></form>}
    {error&&<p role="alert">{error}</p>}{intent.current&&error&&<button disabled={busy} onClick={()=>void check()}>Проверить исходную попытку</button>}
  </div>;
}
