// Test-only composition from main 1aa8e21a. The public route never imports this.
// Preserve real reserve/detail/account-switch regressions without exposing them.
import { useState, useSyncExternalStore } from 'react';
import { Nav } from '../../../components/Nav';
import { Footer } from '../../../components/Footer';
import { DepositModal } from '../../../components/DepositModal';
import { getToken, onSessionChange } from '../../../lib/api';
import { OtcExchangeForm, savedDraft } from '../OtcExchangeForm';
import { CashList, CashDetailPanel } from '../OtcCashDesk';
import { TIERS } from '../otcConfig';
import type { CashSummary } from '../cashApi';
import { cashDraftKey, CASH_STATUSES } from '../cashApi';
import '../otc.css';
import '../otc-cash.css';

export function OtcPage(){const token=useSyncExternalStore(onSessionChange,getToken,()=>null);return <OtcContent key={token} token={token}/>;}
function OtcContent({token}:{token:string|null}){
  const [tier,setTier]=useState(()=>savedDraft(cashDraftKey(token)).draft.tier),[deposit,setDeposit]=useState(false),[list,setList]=useState(false),[selected,setSelected]=useState<string|null>(null),[created,setCreated]=useState<CashSummary|null>(null);
  return <div className="vx-otc"><Nav active="/otc"/><main>
    <section className="otc-hero"><div className="otc-hero-bg" aria-hidden="true"><img src="/media/otc/hero-skyline.webp" alt="" width="1408" height="768"/></div>
      <div className="otc-wrap otc-hero-inner"><div className="otc-hero-head"><h1>Обмен криптовалюты на наличные</h1><p className="otc-hero-lead">Ваш реальный баланс. Согласованные условия. Приватная поддержка по каждой заявке.</p></div>
        <div className="otc-tiers">{TIERS.map(t=><div key={t.id} className={`otc-tier${tier===t.id?' is-accent':''}`}><h3>{t.name}</h3><p>Объём обмена от ${t.minUsd.toLocaleString('ru-RU')}</p><p>Криптовалюта → наличные<br/>Одна процедура, разные уровни объёма.</p><button className="otc-btn otc-btn-ghost" onClick={()=>{setTier(t.id);document.getElementById('otc-create')?.scrollIntoView({behavior:'smooth'});}}>Выбрать категорию</button></div>)}</div>
      </div>
    </section>
    <section className="otc-section"><div className="otc-wrap"><ol className="otc-cash-steps"><li>Выберите страну и город получения.</li><li>Укажите криптовалюту, сумму обмена и валюту наличных.</li><li>Подтвердите заявку — указанная сумма будет зарезервирована на вашем балансе.</li><li>Согласуйте курс, комиссию и время с поддержкой. Точный адрес кассы появится в переписке по заявке.</li></ol>
      <div id="otc-create"><OtcExchangeForm token={token} tier={tier} onDeposit={()=>setDeposit(true)} onCreated={row=>{setCreated(row);setList(true);setSelected(row.id);}}/></div>
      {created&&<div className="otc-cash-notice" role="status">Заявка {created.number} подтверждена сервером: {CASH_STATUSES[created.status]}. {['RESERVED','OFFERED','ACCEPTED','PICKUP_READY','PAYOUT_IN_PROGRESS'].includes(created.status)&&`В резерве: ${created.quantity} ${created.asset}. Поддержка согласует условия и сообщит адрес кассы.`}</div>}
      <div className="otc-cash-row"><button className="otc-btn otc-btn-orange" onClick={()=>{setList(true);setSelected(null);}}>Мои заявки</button>{created&&<button onClick={()=>setSelected(created.id)}>Открыть поддержку по заявке</button>}</div>
      {selected?<CashDetailPanel key={selected} id={selected} onClose={()=>setSelected(null)}/>:list&&<CashList onOpen={setSelected}/>}
      <p className="otc-cash-geography">Справочник: GeoNames, CC BY 4.0. География не подтверждает наличие кассы или юридическую доступность обслуживания. Доступные направления подтверждаются оператором отдельно.</p>
    </div></section>
  </main><Footer/>{deposit&&<DepositModal onClose={()=>setDeposit(false)}/>}</div>;
}
