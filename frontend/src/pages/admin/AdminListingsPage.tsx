import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE, getToken } from '../../lib/api';
import './adminListings.css';

type Input = {name:string;ticker:string;logo:string;initialPrice:string;listingAt:string;ownerAllocation:string;seed?:string};
type Listing = Input & {id:string;pair:string;seed:string;revision:number;status:'draft'|'published';version:number};
type Preview = {listing:Listing;asset:{state:{phase:string;lastPrice:number|null}};liveSample:{candles:{close:number}[]}};
const messages:Record<string,string> = {
  invalid_listing:'Проверьте все поля: название, тикер, изображение, цену, дату и количество.', invalid_logo:'Выберите PNG, JPEG или WebP размером до 64 КБ.',
  invalid_listing_date:'Выберите будущую дату в пределах года.', duplicate_ticker_or_pair:'Такой тикер или торговая пара уже существует.',
  revision_conflict:'Листинг изменён в другой вкладке. Обновите список и откройте его заново.',
  idempotency_conflict:'Этот запрос уже использован с другими данными. Обновите список перед новой попыткой.',
  published_immutable:'Опубликованный листинг нельзя изменить.', listing_date_elapsed:'Дата листинга уже наступила. Сохраните новую дату перед публикацией.',
  listings_not_configured:'Раздел пока не подключён к хранилищу.', listings_unavailable:'Не удалось получить ответ. Повторите запрос — повторная публикация безопасна.',
  allocation_not_enabled:'Начисление не включено.', identity_immutable:'Тикер и seed сохраняются после создания.', market_registry_unavailable:'Не удалось проверить существующие рынки. Повторите позже.',
};
export async function listingRequest<T>(path='',method='GET',data?:unknown,revision?:number,key?:string):Promise<T> {
  const token=getToken(); if (!token) throw new Error('Нужен вход администратора.');
  const response=await fetch(`${API_BASE}/admin/listings${path}`,{method,signal:AbortSignal.timeout(15_000),cache:'no-store',
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(revision?{'If-Match':String(revision)}:{}),...(key?{'Idempotency-Key':key}:{})},
    ...(data!==undefined?{body:JSON.stringify(data)}:{})});
  const body=await response.json();
  if (!response.ok) throw new Error(messages[body.error] || (response.status===403?'Нет доступа.':messages.listings_unavailable));
  return body;
}
const empty=():Input=>({name:'',ticker:'',logo:'',initialPrice:'',ownerAllocation:'0',listingAt:new Date(Date.now()+86400_000).toISOString().slice(0,16)});
export function AdminListingsPage() {
  const [rows,setRows]=useState<Listing[]>([]),[form,setForm]=useState<Input>(empty),[selected,setSelected]=useState<Listing|null>(null);
  const [editing,setEditing]=useState(false),[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [seedMode,setSeedMode]=useState('auto'),[dirty,setDirty]=useState(false);
  const createKey=useRef(crypto.randomUUID()),publishKey=useRef(crypto.randomUUID()),inFlight=useRef(false);
  const run=async(task:()=>Promise<void>)=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');setNotice('');try{await task();}catch(e){setError(e instanceof Error?e.message:messages.listings_unavailable);}finally{inFlight.current=false;setBusy(false);}};
  const load=async()=>setRows(await listingRequest<Listing[]>());
  useEffect(()=>{void run(load);},[]);
  const open=(row:Listing)=>{setSelected(row);setPreview(null);setEditing(true);setSeedMode('manual');setDirty(false);publishKey.current=crypto.randomUUID();setForm({...row,listingAt:row.listingAt.slice(0,19)});setError('');};
  const change=(field:keyof Input,value:string)=>{setForm(f=>({...f,[field]:value}));setDirty(true);setPreview(null);};
  const save=()=>run(async()=>{
    const date=new Date(`${form.listingAt}Z`); if(!Number.isFinite(date.getTime()))throw new Error(messages.invalid_listing_date);
    const data:Input={name:form.name,ticker:form.ticker,logo:form.logo,initialPrice:form.initialPrice,ownerAllocation:form.ownerAllocation,listingAt:date.toISOString(),
      ...(selected || seedMode==='manual'?{seed:form.seed}: {})};
    const row=await listingRequest<Listing>(selected?`/${selected.id}`:'',selected?'PUT':'POST',data,selected?.revision,selected?undefined:createKey.current);
    open(row);await load();setNotice('Черновик сохранён. Баланс не изменён.');
  });
  const publish=()=>run(async()=>{
    if(!selected||!preview||preview.listing.revision!==selected.revision)return;
    const row=await listingRequest<Listing>(`/${selected.id}/publish`,'POST',undefined,selected.revision,publishKey.current);
    open(row);await load();setNotice('Листинг опубликован. Начисление выполняется отдельно.');
  });
  const disabled=busy||selected?.status==='published';
  return <section className="admin-listings"><header><div><h1>Listings</h1><p>Создание и публикация симулированных рынков</p></div>
    <button disabled={busy} onClick={()=>{setSelected(null);setForm(empty());setEditing(true);setPreview(null);setSeedMode('auto');createKey.current=crypto.randomUUID();setError('');}}>Создать листинг</button>
    <button disabled={busy} onClick={()=>void run(load)}>Обновить</button></header>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{busy&&<p role="status">Загрузка…</p>}
    <div className="listing-list">{rows.map(row=><button className="listing-row" key={row.id} onClick={()=>open(row)} disabled={busy}>
      <img src={row.logo} alt=""/><span><strong>{row.name} · {row.pair}</strong><small>{row.status==='draft'?'Черновик':'Опубликован'} · revision {row.revision} · {row.listingAt.replace('T',' ').replace('.000Z',' UTC')}</small></span><span>→</span>
    </button>)}</div>
    {editing&&<form className="listing-editor" onSubmit={e=>{e.preventDefault();void save();}}>
      <h2>{selected?selected.name:'Новый листинг'}</h2><div className="listing-fields">
        <label>Название<input required maxLength={64} value={form.name} disabled={disabled} onChange={e=>change('name',e.target.value)}/></label>
        <label>Тикер<input required pattern="[A-Z][A-Z0-9]{1,11}" value={form.ticker} disabled={disabled||!!selected} onChange={e=>change('ticker',e.target.value.toUpperCase())}/></label>
        <label>Начальная цена · USDT<input required inputMode="decimal" value={form.initialPrice} disabled={disabled} onChange={e=>change('initialPrice',e.target.value)}/></label>
        <label>Дата и время · UTC<input required type="datetime-local" step="1" value={form.listingAt} disabled={disabled} onChange={e=>change('listingAt',e.target.value)}/></label>
        <label>Owner allocation · количество<input required inputMode="decimal" value={form.ownerAllocation} disabled={disabled} onChange={e=>change('ownerAllocation',e.target.value)}/></label>
        <label>Seed<select value={seedMode} disabled={disabled||!!selected} onChange={e=>setSeedMode(e.target.value)}><option value="auto">Автоматически</option><option value="manual">Вручную</option></select>
          {seedMode==='manual'&&<input aria-label="Seed вручную" required maxLength={128} disabled={disabled||!!selected} value={form.seed||''} onChange={e=>change('seed',e.target.value)}/>}</label>
        <label>Логотип · PNG / JPEG / WebP, до 64 КБ<input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} onChange={e=>{
          const file=e.target.files?.[0];if(!file)return;if(file.size>65536){setError(messages.invalid_logo);return;}
          const reader=new FileReader();reader.onload=()=>change('logo',String(reader.result));reader.readAsDataURL(file);
        }}/>{form.logo&&<img className="listing-logo" src={form.logo} alt="Логотип"/>}</label>
      </div><div className="listing-actions">
        {selected?.status!=='published'&&<button type="submit" disabled={busy||!form.logo}>{selected?'Сохранить черновик':'Создать черновик'}</button>}
        {selected&&<button type="button" disabled={busy||dirty} title={dirty?'Сначала сохраните изменения':undefined} onClick={()=>void run(async()=>{setPreview(await listingRequest<Preview>(`/${selected.id}/preview`));})}>Preview</button>}
        <button type="button" disabled={busy} onClick={()=>{setEditing(false);setPreview(null);}}>Закрыть</button>
      </div>
      {preview&&<section className="listing-preview"><h3>{preview.listing.name} · {preview.listing.pair}</h3><p>Начальная цена: {preview.listing.initialPrice} USDT · {preview.listing.listingAt} · UTC</p>
        <p>Предпросмотр первых трёх часов после старта · revision {preview.listing.revision}</p>
        <svg viewBox="0 0 600 160" role="img" aria-label="Предпросмотр графика"><polyline fill="none" stroke="#b79130" strokeWidth="2" points={(()=>{const values=preview.liveSample.candles.map(c=>c.close),min=Math.min(...values),span=Math.max(...values)-min||1;return values.map((v,i)=>`${10+i/Math.max(1,values.length-1)*580},${145-(v-min)/span*130}`).join(' ');})()}/></svg>
        {selected?.status==='draft'&&<button type="button" disabled={busy} onClick={()=>{if(window.confirm('Опубликовать эту revision? После публикации конфигурация и история неизменны.'))void publish();}}>Publish</button>}
      </section>}
      {selected?.status==='published'&&<div className="listing-actions"><Link to={`/trade?pair=${encodeURIComponent(selected.pair)}`}>Открыть рынок ↗</Link>
        <button type="button" disabled={busy} onClick={()=>{if(window.confirm(`Начислить ${selected.ownerAllocation} ${selected.ticker} на ваш Spot-баланс? Это отдельная операция.`))void run(async()=>{
          const result=await listingRequest<{applied:boolean}>(`/${selected.id}/allocation`,'POST',{confirm:true},selected.revision,`managed-listing:${selected.id}:allocation:v1`);
          setNotice(result.applied?'Начисление выполнено.':'Это начисление уже выполнено. Повторного зачисления нет.');
        });}}>Начислить owner allocation</button></div>}
    </form>}
  </section>;
}
