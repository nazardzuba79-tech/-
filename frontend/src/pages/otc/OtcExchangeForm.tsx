import { useEffect, useRef, useState } from 'react';
import BigNumber from 'bignumber.js';
import { CountryCombobox } from './CountryCombobox';
import { CRYPTO_CURRENCIES, TIERS, countryName } from './otcConfig';
import cities from './cities.json';
import { CashConfig, CashDraft, CashIntent, CashSummary, cashDraftKey, cashError, cashRequest, rejectedCreate } from './cashApi';
import { openSupportWidget } from '../../lib/supportWidget';
import { invalidateSpendableBalances, onSpendableBalancesChanged } from '../../lib/balanceInvalidation';

const directory=cities as Record<string,{id:string;name:string;timezone:string}[]>;
const blank:CashDraft={country:'',cityId:'',asset:'USDT',quantity:'',fiat:'',tier:'otc-convert'};
export function savedDraft(key:string|null):{draft:CashDraft;intent:CashIntent|null} {
  try {const saved=JSON.parse(key?localStorage.getItem(key)??'null':'null');
    if(saved&&Object.keys(blank).every(k=>typeof saved.draft?.[k]==='string'&&saved.draft[k].length<100))
      return {draft:saved.draft,intent:typeof saved.intent?.idempotencyKey==='string'?saved.intent:null};
  }catch{/* A corrupt draft is never a financial state. */}
  return {draft:blank,intent:null};
}
export function OtcExchangeForm({token,onCreated,onDeposit,tier}:{token:string|null;onCreated:(row:CashSummary)=>void;onDeposit:()=>void;tier:string}) {
  const storageKey=cashDraftKey(token);
  const [initial]=useState(()=>savedDraft(storageKey));
  const [draft,setDraft]=useState(initial.draft),[intent,setIntent]=useState<CashIntent|null>(initial.intent);
  const [config,setConfig]=useState<CashConfig|null>(null),[balances,setBalances]=useState<{asset:string;available:string}[]|null>(null),[eligible,setEligible]=useState(false);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loadError,setLoadError]=useState(''),[confirm,setConfirm]=useState(false),[agree,setAgree]=useState(false),[revision,setRevision]=useState(0);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>onSpendableBalancesChanged(()=>{setBalances(null);setLoading(true);setRevision(x=>x+1);}),[]);
  useEffect(()=>{if(!intent){setDraft(d=>({...d,tier}));setConfirm(false);setAgree(false);}},[tier]);
  useEffect(()=>{
    let active=true;setLoading(true);setLoadError('');
    Promise.all([cashRequest<CashConfig>('/otc/config'),cashRequest<{eligible:boolean;balances:{asset:string;available:string}[]}>('/otc/balances')])
      .then(([c,b])=>{if(active){setConfig(c);setBalances(b.balances);setEligible(b.eligible);}})
      .catch(e=>{if(active){setLoadError(cashError(e));setBalances(null);}}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[revision]);
  useEffect(()=>{if(storageKey)try{localStorage.setItem(storageKey,JSON.stringify({draft,intent}));}catch{/* create requires successful intent persistence below */}},[draft,intent,storageKey]);
  const fiats=[...new Set((config?.routes??[]).filter(r=>r.country===draft.country&&r.cityId===draft.cityId&&r.asset===draft.asset).map(r=>r.fiat))];
  const available=balances?(balances.find(b=>b.asset===draft.asset)?.available??'0'):null;
  const amount=new BigNumber(draft.quantity);
  const valid=/^(0|[1-9]\d{0,17})(\.\d{1,18})?$/.test(draft.quantity)&&amount.gt(0)&&amount.decimalPlaces()!<=({USDT:6,USDC:6,BTC:8,ETH:18}[draft.asset]??0);
  const allowed=!!config?.enabled&&eligible&&!!draft.country&&!!draft.cityId&&fiats.includes(draft.fiat);
  const insufficient=valid&&available!==null&&amount.gt(available);
  const city=directory[draft.country]?.find(c=>c.id===draft.cityId);
  function change(next:Partial<CashDraft>){if(intent)return;setDraft(d=>({...d,...next}));setConfirm(false);setAgree(false);setError('');}
  function done(row:CashSummary){if(!alive.current)return;if(storageKey)try{localStorage.removeItem(storageKey);}catch{/* A confirmed server commit is authoritative even if draft cleanup fails. */}setIntent(null);setDraft(blank);invalidateSpendableBalances();onCreated(row);}
  async function create() {
    if(busy)return;setBusy(true);setError('');
    try {let candidate=intent;
      if(!candidate){if(loading||loadError||available===null||!allowed||!valid||insufficient||!agree||!storageKey)throw Error('INVALID_INPUT');
        candidate={...draft,idempotencyKey:crypto.randomUUID()};
        // Persist BEFORE sending. Only the original key may resolve a timeout.
        localStorage.setItem(storageKey,JSON.stringify({draft,intent:candidate}));setIntent(candidate);
      }
      done(await cashRequest<CashSummary>('/otc/requests',candidate));
    }catch(e){if(alive.current){
      if(rejectedCreate(e)) {
        setIntent(null);if(storageKey)try{localStorage.setItem(storageKey,JSON.stringify({draft,intent:null}));}catch{/* server confirmed rollback */}
      }
      setError(cashError(e));
    }}finally{if(alive.current)setBusy(false);}
  }
  async function check(){if(!intent)return;setBusy(true);setError('');
    try {const response=await cashRequest<{request:CashSummary|null}>(`/otc/requests/by-key/${intent.idempotencyKey}`);
      if(response.request)done(response.request);else if(alive.current)setError('Исходная заявка пока не найдена. Не создавайте новый ключ: можно повторить только исходные параметры.');
    }catch(e){if(alive.current)setError(cashError(e));}finally{if(alive.current)setBusy(false);}
  }
  return <section className="otc-form otc-cash-panel" aria-label="Создать OTC-заявку">
    <div className="otc-cash-row"><h2>Криптовалюта → наличные</h2><button type="button" disabled={loading||busy} onClick={()=>setRevision(x=>x+1)}>Обновить доступный остаток</button></div>
    <p>Категория: {TIERS.find(t=>t.id===draft.tier)?.name} · от ${TIERS.find(t=>t.id===draft.tier)?.minUsd.toLocaleString('ru-RU')}. Минимум обычного депозита — отдельное правило.</p>
    {loading&&<p role="status">Проверяем направления и доступный баланс…</p>}{loadError&&<p role="alert">{loadError}</p>}
    <fieldset disabled={busy||!!intent}>
      <div className="otc-cash-fields"><label>Страна получения<CountryCombobox id="otc-country" value={draft.country||null} onChange={country=>change({country:country??'',cityId:'',fiat:''})}/></label>
        <label>Город получения<select value={draft.cityId} disabled={!draft.country} onChange={e=>change({cityId:e.target.value,fiat:''})}><option value="">Выберите город</option>{(directory[draft.country]??[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Отдаёте<select value={draft.asset} onChange={e=>change({asset:e.target.value,fiat:''})}>{CRYPTO_CURRENCIES.map(c=><option key={c.code}>{c.code}</option>)}</select></label>
        <label>Количество, {draft.asset}<input inputMode="decimal" autoComplete="off" value={draft.quantity} onChange={e=>change({quantity:e.target.value})} placeholder="Введите количество"/></label>
        <label>Получаете наличными<select value={draft.fiat} disabled={!fiats.length} onChange={e=>change({fiat:e.target.value})}><option value="">{fiats.length?'Выберите валюту':'Нет подтверждённого направления'}</option>{fiats.map(f=><option key={f}>{f}</option>)}</select></label>
      </div>
    </fieldset>
    <p>Доступно для обмена: <strong>{loading||loadError||!eligible?'—':available} {draft.asset}</strong></p>
    {!eligible&&!loading&&!loadError&&<p>Нужны подтверждённые KYC и допуск оператора. Для обмена доступен только реальный баланс.</p>}
    <p>Курс, комиссия и сумма к выдаче согласовываются с поддержкой.</p>
    {(!config?.enabled||!fiats.length)&&!loading&&<div className="otc-cash-notice">Страна и город — справочник, а не обещание работающей кассы. Направление пока не подтверждено.<br/><button onClick={openSupportWidget}>Уточнить доступность без резерва</button></div>}
    {insufficient&&<p role="alert">Не хватает {amount.minus(available!).toFixed()} {draft.asset}. <button onClick={onDeposit}>Пополнить обычный баланс</button></p>}
    {!!draft.quantity&&!valid&&<p role="alert">Введите положительное количество без экспоненты и лишних знаков после запятой.</p>}
    {intent?<div className="otc-cash-notice"><p>Результат исходной попытки уточняется. Параметры сохранены, повтор не создаёт новую заявку.</p><button disabled={busy} onClick={()=>void check()}>Проверить исходную попытку</button><button disabled={busy} onClick={()=>void create()}>Повторить с тем же ключом</button></div>
      :!confirm?<button className="otc-btn otc-btn-orange" disabled={loading||!!loadError||!allowed||!valid||insufficient} onClick={()=>setConfirm(true)}>Проверить параметры</button>
      :<div className="otc-cash-confirm"><h3>Подтверждение резерва</h3><p>{countryName(draft.country,'ru')}, {city?.name}<br/>{draft.quantity} {draft.asset} → наличные {draft.fiat}<br/>Доступно после резерва: {loading||loadError||!eligible||available===null?'—':new BigNumber(available).minus(amount).toFixed()} {draft.asset}</p>
        <p>До подготовки выдачи заявку можно отменить с возвратом резерва. После подготовки — только запрос отмены и подтверждение кассы. После начала выдачи автоматического возврата нет.</p>
        <label className="otc-cash-check"><input type="checkbox" checked={agree} onChange={e=>setAgree(e.target.checked)}/>Подтверждаю параметры и правила отмены.</label>
        <button className="otc-btn otc-btn-orange" disabled={!agree||busy||loading||!!loadError||available===null||!allowed||insufficient} onClick={()=>void create()}>Создать заявку и зарезервировать {draft.quantity} {draft.asset}</button>
        <p>Сумма останется на вашем балансе в резерве и будет недоступна для торговли и вывода. Условия выдачи согласовываются с поддержкой.</p>
      </div>}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
