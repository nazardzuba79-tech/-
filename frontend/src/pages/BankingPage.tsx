import { useEffect,useMemo,useState } from 'react';
import { Landmark,LockKeyhole,RefreshCw,WalletCards,X } from 'lucide-react';
import { Nav } from '../components/Nav';
import { bankingApi,bankingErrorText,bankingNumber,type BankingAsset,type BankingCalculation,type BankingConfig,type BankingProgramId,type BankingState } from '../lib/bankingApi';
import './banking/BankingPage.css';

const today=()=>new Date().toISOString().slice(0,10);
const percent=(rate:string)=>`${bankingNumber(String(Number(rate)*100),0)}%`;

export function BankingPage(){
  const[config,setConfig]=useState<BankingConfig|null>(null),[state,setState]=useState<BankingState|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const[programId,setProgramId]=useState<BankingProgramId>('COMPOUND_21_12M'),[asset,setAsset]=useState<BankingAsset>('USDT'),[amount,setAmount]=useState(''),[startDate,setStartDate]=useState(today()),[period,setPeriod]=useState<'6'|'12'|'24'|'custom'>('6'),[endDate,setEndDate]=useState('');
  const[calculation,setCalculation]=useState<BankingCalculation|null>(null),[busy,setBusy]=useState(false),[confirmOpen,setConfirmOpen]=useState(false),[success,setSuccess]=useState('');
  const program=config?.programs.find(row=>row.id===programId)??null;
  const assetInfo=config?.assets.find(row=>row.asset===asset)??null;
  const refresh=async()=>{setLoading(true);setError('');try{const[c,s]=await Promise.all([bankingApi.config(),bankingApi.state()]);setConfig(c);setState(s);}catch(e){setError(bankingErrorText(e));}finally{setLoading(false);}};
  useEffect(()=>{void refresh();},[]);
  useEffect(()=>{setCalculation(null);if(programId==='COMPOUND_21_12M'&&period==='24')setPeriod('12');},[programId,asset,amount,startDate,period,endDate]);
  const availablePeriods=programId==='MONTHLY_17_24M'?['6','12','24','custom'] as const:['6','12','custom'] as const;
  const canCalculate=Boolean(amount&&startDate&&assetInfo?.priceUsd&&(period!=='custom'||endDate));
  async function calculate(){if(!canCalculate)return;setBusy(true);setError('');try{setCalculation(await bankingApi.calculate({programId,asset,amount,startDate,...(period==='custom'?{endDate}:{periodMonths:Number(period)})}));}catch(e){setError(bankingErrorText(e));}finally{setBusy(false);}}
  async function place(){setBusy(true);setError('');setSuccess('');try{await bankingApi.createPlacement({programId,asset,amount,idempotencyKey:crypto.randomUUID()});setConfirmOpen(false);setSuccess('Розміщення створено. Дані збережено в Banking ledger.');setAmount('');setCalculation(null);setState(await bankingApi.state());}catch(e){setError(bankingErrorText(e));}finally{setBusy(false);}}
  const placements=state?.placements??[];
  const minText=assetInfo?.minimumAssetQty?`${assetInfo.minimumAssetQty} ${asset}`:'—';
  return <div className="banking-page"><Nav active="/banking"/>
    <main className="banking-main">
      <section className="banking-hero"><div><p className="banking-eyebrow">VOLTEX BANKING</p><h1>VOLTEX Banking &amp; Earn</h1><h2>Ваш цифровий банк у кишені.</h2><p>Торгівля, картка та дохід — в одному VOLTEX-акаунті.</p></div><div className="banking-hero-mark"><Landmark size={28}/><span>Banking &amp; Earn</span></div></section>
      {error&&<div className="banking-alert" role="alert"><span>{error}</span><button onClick={()=>void refresh()}><RefreshCw size={14}/>Оновити</button></div>}
      {success&&<div className="banking-success" role="status">{success}</div>}
      <section className="banking-summary" aria-label="Огляд Banking & Earn">
        <article><span>Усього в Earn</span><strong>{state?.summary.totalUsd===null?'—':`$${bankingNumber(state?.summary.totalUsd)}`}</strong><small>Поточна reference USD-оцінка</small></article>
        <article><span>Нараховано</span><strong>{state?.summary.accruedUsd===null?'—':`$${bankingNumber(state?.summary.accruedUsd)}`}</strong><small>За завершені календарні місяці</small></article>
        <article><span>Активні розміщення</span><strong>{state?.summary.activeCount??(loading?'—':'0')}</strong><small>Ledger-backed</small></article>
      </section>

      <section className="banking-section"><div className="banking-heading"><div><h2>Програми Earn</h2><p>Винагорода завжди нараховується в активі внеску. USD — лише reference equivalent.</p></div></div>
        <div className="banking-program-grid">{(config?.programs??[]).map(item=><article key={item.id} className={`banking-program${programId===item.id?' selected':''}`} onClick={()=>setProgramId(item.id)}>
          <div className="banking-program-top"><div><span>{item.compound?'Накопичення':'Щомісячні виплати'}</span><h3>{percent(item.monthlyRate)} <small>на місяць</small></h3></div>{item.compound?<LockKeyhole/>:<RefreshCw/>}</div>
          <dl><dt>Строк</dt><dd>{item.termMonths} місяців</dd><dt>Мінімум</dt><dd>$2,500 equivalent</dd><dt>Капіталізація</dt><dd>{item.compound?'Щомісячна':'Без auto-compound'}</dd><dt>Виплата</dt><dd>{item.payoutFrequency==='MONTHLY'?'Щомісяця':'Після завершення строку'}</dd></dl>
          <p className="banking-condition">{item.lockRule==='PRINCIPAL_RETURN_UNDEFINED'?'Умови дострокового повернення principal не визначені.':'Principal + rewards заблоковані на 12 місяців.'}</p>
          <div className="banking-assets">USDT · USDC · BTC · ETH · SOL</div><button type="button" onClick={e=>{e.stopPropagation();setProgramId(item.id);document.getElementById('banking-calculator')?.scrollIntoView({behavior:'smooth'});}}>Розрахувати</button>
        </article>)}</div>
      </section>

      <section className="banking-section" id="banking-calculator"><div className="banking-heading"><div><h2>Калькулятор доходу</h2><p>Розрахунок ведеться на сервері через BigNumber і враховує тільки завершені календарні місяці.</p></div></div>
        <div className="banking-calculator"><div className="banking-form">
          <label>Програма<select value={programId} onChange={e=>setProgramId(e.target.value as BankingProgramId)}>{config?.programs.map(item=><option key={item.id} value={item.id}>{item.name} · {percent(item.monthlyRate)}</option>)}</select></label>
          <div className="banking-field-row"><label>Актив<select value={asset} onChange={e=>setAsset(e.target.value as BankingAsset)}>{(['USDT','USDC','BTC','ETH','SOL'] as BankingAsset[]).map(item=><option key={item}>{item}</option>)}</select></label><label>Сума<input inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0.00"/></label></div>
          <div className="banking-reference"><span>USD equivalent</span><strong>{amount&&assetInfo?.priceUsd?`≈ $${bankingNumber(String(Number(amount)*Number(assetInfo.priceUsd)))}`:'—'}</strong></div>
          <div className="banking-reference"><span>Мінімум за поточною ціною</span><strong>{minText}</strong></div>
          <label>Дата старту<input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></label>
          <div className="banking-periods">{availablePeriods.map(value=><button type="button" key={value} className={period===value?'active':''} onClick={()=>setPeriod(value)}>{value==='custom'?'Обрати дату':`${value} міс.`}</button>)}</div>
          {period==='custom'&&<label>Дата завершення розрахунку<input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></label>}
          <button className="banking-primary" disabled={!canCalculate||busy} onClick={()=>void calculate()}>{busy?'Розрахунок…':'Розрахувати'}</button>
        </div>
        <div className="banking-result">{calculation?<>
          <div className="banking-result-head"><div><span>{program?.name}</span><strong>{asset}</strong></div><span>{calculation.completedMonths} завершених міс.</span></div>
          <div className="banking-result-grid"><article><span>Principal</span><strong>{bankingNumber(calculation.principal,asset==='USDT'||asset==='USDC'?2:8)} <small>{asset}</small></strong></article>{calculation.monthlyReward&&<article><span>Щомісячна виплата</span><strong>{bankingNumber(calculation.monthlyReward,asset==='USDT'||asset==='USDC'?2:8)} <small>{asset}</small></strong></article>}<article><span>Нарахований дохід</span><strong>{bankingNumber(calculation.profit,asset==='USDT'||asset==='USDC'?2:8)} <small>{asset}</small></strong></article><article className="featured"><span>{program?.compound?'Розрахунковий баланс':'Сукупні виплати'}</span><strong>{bankingNumber(program?.compound?calculation.balance:calculation.totalRewards,asset==='USDT'||asset==='USDC'?2:8)} <small>{asset}</small></strong></article></div>
          <p>Період: {calculation.startDate} — {calculation.endDate}. Maturity: {calculation.maturityDate}. Без комісій і податків.</p>
          <button className="banking-primary" disabled={busy} onClick={()=>setConfirmOpen(true)}>Розмістити кошти</button>
        </>:<div className="banking-result-empty"><Landmark size={30}/><h3>Ваш розрахунок з’явиться тут</h3><p>Введіть суму та період. Невідомі ринкові значення не підміняються нулями.</p></div>}</div></div>
      </section>

      <section className="banking-card-yield"><div className="banking-card-icon"><WalletCards/></div><div><span className="banking-eyebrow">ОКРЕМИЙ ПРОДУКТ</span><h2>VOLTEX Card Yield</h2><p><strong>12% річних на USDT</strong> — на фактичний доступний card balance. Кошти не блокуються й можуть витрачатися в будь-який момент.</p></div><div className="banking-card-metric"><span>Доступний card balance</span><strong>{state?.cardYield.availableCardBalance??'—'} USDT</strong><small>Не змішується з Earn balance</small></div></section>

      <section className="banking-section"><div className="banking-heading"><div><h2>Мої розміщення</h2><p>Тільки фактичні server-side placements. Demo-дані не використовуються.</p></div></div>
        <div className="banking-table-wrap">{placements.length?<table><thead><tr><th>Актив</th><th>Програма</th><th>Principal</th><th>Ставка</th><th>Нараховано</th><th>Статус</th><th>Maturity</th></tr></thead><tbody>{placements.map(row=><tr key={row.id}><td><b>{row.asset}</b></td><td>{row.programName}</td><td>{bankingNumber(row.principal,row.asset==='USDT'||row.asset==='USDC'?2:8)}</td><td>{percent(row.monthlyRate)} / міс.</td><td>{bankingNumber(row.rewardAccrued,row.asset==='USDT'||row.asset==='USDC'?2:8)} {row.asset}</td><td>{row.status==='ACTIVE'?'Активно':'Завершено'}</td><td>{row.maturityDate}</td></tr>)}</tbody></table>:<div className="banking-empty">Активних розміщень ще немає.</div>}</div>
      </section>
    </main>
    {confirmOpen&&calculation&&<div className="banking-modal-backdrop" role="presentation"><div className="banking-modal" role="dialog" aria-modal="true" aria-label="Підтвердження розміщення"><button className="banking-modal-close" onClick={()=>setConfirmOpen(false)} aria-label="Закрити"><X/></button><h2>Підтвердити розміщення</h2><p>{program?.name} · {asset}</p><div className="banking-modal-amount">{bankingNumber(amount,asset==='USDT'||asset==='USDC'?2:8)} <span>{asset}</span></div><dl><dt>Ставка</dt><dd>{program&&percent(program.monthlyRate)} на місяць</dd><dt>Строк</dt><dd>{program?.termMonths} місяців</dd><dt>Reward currency</dt><dd>{asset}</dd><dt>Мінімум</dt><dd>$2,500 equivalent</dd></dl><p className="banking-condition">{program?.lockRule==='PRINCIPAL_RETURN_UNDEFINED'?'Дострокове повернення principal не визначено.':'Principal і rewards locked на 12 місяців.'}</p><button className="banking-primary" disabled={busy} onClick={()=>void place()}>{busy?'Збереження…':'Підтвердити'}</button></div></div>}
  </div>;
}
