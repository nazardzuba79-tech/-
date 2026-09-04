import { useState } from 'react';
import { LiquidationIntelligence } from './LiquidationIntelligence';
import { DemoMarketPanels } from './DemoMarketPanels';
import { useAnalyticsSnapshot, type AnalyticsSnapshot } from './useAnalyticsSnapshot';
import { formatUsd, type Asset } from './liquidityModel';
import './analytics.css';
import './refinements.css';

const ASSETS: Asset[] = ['BTC', 'ETH', 'SOL', 'XRP'];
const usd = (n: number | string | null | undefined) => n !== null && n !== undefined && Number.isFinite(Number(n)) ? formatUsd(Number(n)) : '—';
const percent = (n: number | null | undefined) => n === null || n === undefined ? '—' : `${n.toFixed(2)}%`;
function Row({label,value}:{label:string;value:string}) {return <div className="metric-row"><span>{label}</span><b>{value}</b></div>;}

export function AnalyticsWorkspace() {
  const [asset, setAsset] = useState<Asset>('BTC');
  const [demo, setDemo] = useState(false);
  const {snapshot,state,retry} = useAnalyticsSnapshot();
  const overview = snapshot?.sections.marketOverview;
  const sentiment = snapshot?.sections.sentiment;
  const marketValues = demo ? ['$2.73T','$107.4B','59.3%','11.2%','74 · Жадность','+1.33%'] : [
    overview?.available ? usd(overview.totalMarketCapUsd) : '—',
    overview?.available ? usd(overview.totalVolume24hUsd) : '—',
    overview?.available ? percent(overview.btcDominancePercent) : '—',
    overview?.available ? percent(overview.ethDominancePercent) : '—',
    sentiment?.available ? `${sentiment.value} · ${sentiment.classification}` : '—',
    overview?.available ? percent(overview.marketCapChangePercent24h) : '—',
  ];
  return <main className="vx-analytics" lang="ru"><div className="workspace">
    <div className="page-head"><div><p className="eyebrow">VOLTEX · MARKET INTELLIGENCE</p><h1>Аналитика</h1><p>Деривативы, потоки капитала и ключевые индикаторы рынка</p></div>
      <label className="demo-control"><input type="checkbox" checked={demo} onChange={e => setDemo(e.target.checked)}/>Демонстрационный режим</label>
    </div>
    {demo ? <div className="source-banner" role="status"><b>Демонстрационные данные</b><span>Пример из утверждённого дизайна. Цены и графики не отражают текущий рынок.</span></div> : <div className="source-banner" role="status"><b>{state === 'loading' ? 'Загрузка данных' : state === 'error' ? 'Не удалось получить данные' : 'Данные доступных источников'}</b><span>Для неподключённых источников показатели недоступны.</span><button onClick={retry} disabled={state === 'loading'}>Обновить</button></div>}
    <div className="asset-context surface"><span>АНАЛИТИЧЕСКИЙ КОНТЕКСТ</span><div role="group" aria-label="Актив">{ASSETS.map(a => <button key={a} aria-pressed={asset === a} className={asset === a ? 'selected' : ''} onClick={() => setAsset(a)}>{a}</button>)}</div><small>Карта ликвидности и показатели актива · {asset}</small></div>
    <div className="overview surface">{['КАПИТАЛИЗАЦИЯ РЫНКА','ОБЪЁМ 24Ч','ДОМИНИРОВАНИЕ BTC','ДОМИНИРОВАНИЕ ETH','СТРАХ И ЖАДНОСТЬ','РЫНОК 24Ч'].map((label,i) => <div className={`overview-item ${i===0?'strong':''}`} key={label}><small>{label}</small><b>{marketValues[i]}</b></div>)}</div>
    <p className="context-note">{demo ? 'Сводный рынок · демонстрационный срез 24ч' : `Сводный рынок · ${overview?.available ? 'CoinGecko' : 'источник недоступен'} · настроение: ${sentiment?.available ? 'Alternative.me' : 'недоступно'}`}</p>
    <LiquidationIntelligence asset={asset} demo={demo}/>
    {demo ? <DemoMarketPanels asset={asset}/> : <LiveMarketPanels snapshot={snapshot} asset={asset}/>}
  </div></main>;
}

function LiveMarketPanels({snapshot,asset}:{snapshot:AnalyticsSnapshot|null;asset:Asset}) {
  const sections = snapshot?.sections;
  const symbol = `${asset}USDT`;
  const matches = (s:string) => s.replace(/[^A-Z]/g,'') === symbol;
  const oi = sections?.openInterest.available ? sections.openInterest.contracts.find(c=>matches(c.symbol)) : null;
  const funding = sections?.funding.available ? sections.funding.latest.find(c=>matches(c.symbol)) : null;
  const mark = sections?.markPrices.available ? sections.markPrices.contracts.find(c=>matches(c.symbol)) : null;
  return <>
    <p className="context-note">Деривативы VOLTEX · только собственная площадка · {asset}. Эти показатели не являются сводными данными выбранных бирж.</p>
    <div className="analytics-three-col">
      <section className="surface"><div className="section-heading"><h2>Открытый интерес · {asset}</h2></div><Row label="VOLTEX · USD" value={usd(oi?.openInterestUsd)}/><Row label={`Объём · ${asset}`} value={oi?.openInterestBase ?? '—'}/><small className="panel-footnote">Только открытые позиции VOLTEX. История OI недоступна.</small></section>
      <section className="surface"><div className="section-heading"><h2>Ставка финансирования</h2></div><Row label={asset} value={funding ? percent(Number(funding.rate)*100) : '—'}/><Row label="Интервал" value={sections?.funding.available ? `${sections.funding.intervalHours}ч` : '—'}/><small className="panel-footnote">Последняя рассчитанная ставка VOLTEX.</small></section>
      <section className="surface"><div className="section-heading"><h2>Цена маркировки · {asset}</h2></div><Row label="Mark price" value={mark ? Number(mark.markPrice).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:asset==='XRP'?4:2}) : '—'}/><Row label="Index price" value={mark ? Number(mark.indexPrice).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:asset==='XRP'?4:2}) : '—'}/><small className="panel-footnote">Источник: фьючерсный контур VOLTEX.</small></section>
    </div>
    <div className="analytics-two-col">{['ETF потоки','Потоки на биржи','Активность крупных держателей','Крупные ликвидации','Волатильность и базис фьючерсов','Корреляция и сектора рынка'].map(title => <section className="surface" key={title}><div className="section-heading"><h2>{title}</h2></div><div className="analytics-empty compact">Источник данных не подключен</div></section>)}</div>
  </>;
}
