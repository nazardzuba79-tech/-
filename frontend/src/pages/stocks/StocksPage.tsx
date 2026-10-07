import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CandlestickSeries, ColorType, createChart, type UTCTimestamp } from 'lightweight-charts';
import { Nav } from '../../components/Nav';
import { useLanguage, localeOf, type Key } from '../../lib/i18n';
import { useStocks, type StockInstrument, type StockCandle } from '../../lib/stocks';
import './stocks.css';

function StockLogo({instrument}:{instrument:StockInstrument}){
  const [failed,setFailed]=useState(false);
  return <span className="stocks-logo" aria-hidden="true">{!failed&&instrument.logoPath?.startsWith('/assets/stocks/')?<img src={instrument.logoPath} width="34" height="34" loading="lazy" alt="" onError={()=>setFailed(true)}/>:instrument.type==='index'?'∑':instrument.symbol.slice(0,2)}</span>;
}
function CandleChart({candles}:{candles:StockCandle[]}){
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{if(!root.current||!candles.length)return;const chart=createChart(root.current,{autoSize:true,layout:{background:{type:ColorType.Solid,color:'#111318'},textColor:'#b8bdc7'},grid:{vertLines:{color:'#202329'},horzLines:{color:'#202329'}},timeScale:{timeVisible:true},height:360});
    chart.addSeries(CandlestickSeries,{upColor:'#16b887',downColor:'#ef455e',wickUpColor:'#16b887',wickDownColor:'#ef455e',borderVisible:false}).setData(candles.map(c=>({time:Math.floor(c.openTimeUtc/1000) as UTCTimestamp,open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)})));chart.timeScale().fitContent();return()=>chart.remove();},[candles]);
  return <div ref={root} className="stocks-chart"/>;
}
function History({id}:{id:string}){
  const {t}=useLanguage();const {data,error}=useStocks<{candles:StockCandle[];next:number|null}>('/stocks/history/'+encodeURIComponent(id));
  return <section className="stocks-panel"><h2>{t('stocks.history')}</h2><p>{t('stocks.closed')}</p>{error?<p role="status">{t('stocks.unavailable')}</p>:data?.candles.length?<CandleChart candles={data.candles}/>:<p className="stocks-empty">{t(data?'stocks.empty':'stocks.loading')}</p>}</section>;
}
export function StocksPage(){
  const {instrumentId}=useParams(),{t,lang}=useLanguage();const {data,error}=useStocks<{instruments:StockInstrument[]}>('/stocks');
  const [query,setQuery]=useState(''),[filter,setFilter]=useState('all');
  const [favorites,setFavorites]=useState<string[]>(()=>{try{const a=JSON.parse(localStorage.getItem('voltex.stockFavorites')??'[]');return Array.isArray(a)?a.filter(x=>typeof x==='string').slice(0,250):[];}catch{return [];}});
  const favorite=(id:string)=>setFavorites(old=>{const next=old.includes(id)?old.filter(x=>x!==id):[...old,id].slice(0,250);try{localStorage.setItem('voltex.stockFavorites',JSON.stringify(next));}catch{}return next;});
  const items=data?.instruments??[],selected=items.find(i=>i.instrumentId===instrumentId);
  const shown=items.filter(i=>(filter==='all'||filter==='favorites'&&favorites.includes(i.instrumentId)||filter==='index'&&i.type==='index'||i.region===filter)&&`${i.symbol} ${i.name}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const format=(v:string|number|null|undefined)=>v==null?'—':new Intl.NumberFormat(localeOf(lang),{maximumFractionDigits:6}).format(Number(v));
  const stamp=(c:StockCandle|null)=>c?new Date(c.closeTimeUtc).toLocaleString(localeOf(lang)):'—';
  return <><Nav active="/stocks" hideTicker readProfile={false}/><main className="stocks-page">
    <header><h1>{t('stocks.title')}</h1><p>{t('stocks.closed')}</p></header>
    {instrumentId?<><Link to="/stocks">← {t('stocks.title')}</Link>{selected?<><div className="stocks-detail"><div><h2>{selected.name}</h2><p>{selected.symbol} · {selected.exchange} · {selected.currency}</p><p>{selected.exchangeTimeZone}</p></div><div><strong>{format(selected.latest?.close)}</strong><p>{stamp(selected.latest)}</p><button onClick={()=>favorite(selected.instrumentId)} aria-pressed={favorites.includes(selected.instrumentId)}>{t('stocks.favorites')}</button></div></div><History id={selected.instrumentId}/></>:<p>{t(error?'stocks.unavailable':data?'stocks.empty':'stocks.loading')}</p>}</>:
    <><div className="stocks-controls"><input aria-label={t('stocks.search')} placeholder={t('stocks.search')} value={query} onChange={e=>setQuery(e.target.value)}/><div className="stocks-filters">{(['all','USA','Russia','Asia','index','favorites']as const).map(k=><button key={k} aria-pressed={filter===k} onClick={()=>setFilter(k)}>{t(('stocks.'+k)as Key)}</button>)}</div></div>
      {error&&<p role="status">{t('stocks.unavailable')}</p>}
      <div className="stocks-table"><div className="stocks-row stocks-labels"><span>{t('stocks.instrument')}</span><span>{t('stocks.price')}</span><span>{t('stocks.change')}</span><span>{t('stocks.exchange')}</span><span>{t('stocks.time')}</span></div>
      {shown.map(i=><div className="stocks-row" key={i.instrumentId}><div className="stocks-identity"><button className="stocks-star" aria-label={t('stocks.favorites')+' '+i.symbol} aria-pressed={favorites.includes(i.instrumentId)} onClick={()=>favorite(i.instrumentId)}>{favorites.includes(i.instrumentId)?'★':'☆'}</button><StockLogo instrument={i}/><Link to={'/stocks/'+encodeURIComponent(i.instrumentId)}><strong>{i.symbol}</strong><small>{i.name}</small></Link></div><span>{format(i.latest?.close)} <small>{i.currency}</small></span><span className={i.sessionChange==null?'':i.sessionChange>=0?'stocks-positive':'stocks-negative'}>{format(i.sessionChange)}{i.sessionChange!=null?'%':''}</span><span className="stocks-desktop">{i.exchange}</span><span className="stocks-desktop">{stamp(i.latest)}</span></div>)}
      {!shown.length&&<p className="stocks-empty">{t(data?'stocks.empty':'stocks.loading')}</p>}</div></>}
  </main></>;
}
