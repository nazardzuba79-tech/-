import { useLanguage } from '../lib/i18n';
import { SkeletonRow } from './Skeleton';
import { cfdMarketCopy,formatCfdPrice } from '../lib/cfdPresentation';
import { PriceCell } from './PriceCell';
import { useMemo, useRef, useState } from 'react';
import { compareMarketValues, MarketColumnSort, nextMarketColumnSort } from '../lib/marketColumnSort';
import { CfdInstrumentIcon } from './CfdInstrumentIcon';
import { CFD_ASSET_CLASSES, CFD_SYMBOLS, cfdAsset, cfdAssetName, type CfdAssetClass } from '../lib/cfdAssetIdentity';
import { cfdInfoStripModel, type CfdMarketStatus } from '../lib/cfdInfoStrip';
import { useCfdDailySeries } from '../lib/useCfdDailySeries';

export interface CfdTickerRow{
  symbol:string;name:string;price:string|null;status?:string;stale?:boolean;marketClosed?:boolean;displayOnly?:boolean;executionAllowed?:boolean;
  provider?:string;providerSymbol?:string;providerTimestamp?:number|null;fetchedAt?:number|null;asOf?:number|null;maxQuoteAgeMs?:number;changePercent24h?:string;
  /** The provider's own bid and ask at the same instant as `price`, when it publishes both (never derived from the mid). */
  bid?:string|null;ask?:string|null;
}

type Row={ticker:CfdTickerRow;name:string;change:number|null;status:CfdMarketStatus;group:CfdAssetClass|'other'};

/**
 * The CFD market list (2026-10-15): grouped by asset class (metals, energy,
 * FX majors) in catalogue order, each row two lines — symbol and readable
 * name on the left, price over day change on the right — so a name is no
 * longer cut to «Gold …». The day change is the strip's own figure (price
 * against the previous session's close, lib/useCfdDailySeries); the market
 * status dot is the strip's status. Sorting a column flattens the groups.
 */
export function CfdInstrumentList({symbol,onChange,tickers,configured,loadError,onRetry}:{symbol:string;onChange:(symbol:string)=>void;tickers:CfdTickerRow[];configured:boolean;loadError:boolean;onRetry:()=>void;}){
  const{t,lang}=useLanguage(),copy=cfdMarketCopy(lang);
  const [search,setSearch]=useState('');
  const [sort,setSort]=useState<MarketColumnSort>(null);
  const listRef=useRef<HTMLDivElement>(null);
  const daily=useCfdDailySeries(CFD_SYMBOLS,tickers.length>0);
  const rows=useMemo<Row[]>(()=>tickers.map(ticker=>{
    const bars=daily.get(ticker.symbol),model=cfdInfoStripModel(ticker.symbol,ticker,bars?{symbol:ticker.symbol,bars}:null);
    return{ticker,name:cfdAssetName(ticker.symbol,lang,ticker.name),change:model.change?.pct??null,status:model.status,group:cfdAsset(ticker.symbol)?.assetClass??'other'};
  }),[tickers,daily,lang]);
  const shown=useMemo(()=>{
    const query=search.trim().toLowerCase();
    const filtered=rows.filter(r=>!query||`${r.ticker.symbol} ${r.ticker.name} ${r.name}`.toLowerCase().includes(query));
    if(!sort)return filtered;
    const value=(r:Row)=>sort.field==='change'?r.change:r.ticker.price!==null&&r.ticker.price.trim()!==''&&Number(r.ticker.price)>0?Number(r.ticker.price):null;
    return [...filtered].sort((a,b)=>compareMarketValues(value(a),value(b),sort.dir));
  },[rows,search,sort]);
  const groups=useMemo(()=>sort?[{id:'sorted' as const,rows:shown}]:[...CFD_ASSET_CLASSES,'other' as const].map(id=>({id,rows:shown.filter(r=>r.group===id)})).filter(g=>g.rows.length),[shown,sort]);
  const groupLabel={metals:copy.metals,energy:copy.energy,forex:copy.fxMajors,other:t('markets.title'),sorted:''} as const;
  const statusLabel=(status:CfdMarketStatus)=>status==='open'?copy.open:status==='closed'?copy.closed:copy.sessionUnknown;
  const toggleSort=(field:'price'|'change')=>{setSort(current=>nextMarketColumnSort(current,field));if(listRef.current)listRef.current.scrollTop=0;};
  const arrow=(field:'price'|'change')=>sort?.field===field?(sort.dir===-1?'▼':'▲'):'⇅';
  return <div className="cfd-instruments" data-cfd-list>
    {/* The same «Рынки» title row the Spot market list carries (owner 2026-10-13: the CFD panel read as untitled and empty). */}
    <div className="pairs-header cfd-instruments-header"><span>{t('markets.title')}</span>{tickers.length>0&&<span className="cfd-list-count">{tickers.length}</span>}</div>
    <div className="pairs-search"><input type="search" aria-label={t('trade.cfdInstrument')} placeholder={t('trade.cfdInstrument')} value={search} onChange={event=>setSearch(event.target.value)}/></div>
    {loadError&&tickers.length>0&&<div className="cfd-list-stale" role="status"><span>{copy.listStale}</span><button type="button" onClick={onRetry}>{copy.retry}</button></div>}
    <div className="cfd-columns"><span>{t('trade.cfdInstrument')}</span><span className="cfd-column-sorts"><button type="button" className="cfd-align-right" aria-pressed={sort?.field==='price'} onClick={()=>toggleSort('price')}>{t('markets.price')} <span aria-hidden>{arrow('price')}</span></button><button type="button" className="cfd-align-right" aria-pressed={sort?.field==='change'} onClick={()=>toggleSort('change')} title={copy.prevClose}>{copy.dayChange} <span aria-hidden>{arrow('change')}</span></button></span></div>
    <div className="cfd-list" ref={listRef}>
      {groups.map(group=><div key={group.id} className="cfd-group" role="group" aria-label={groupLabel[group.id]||undefined} data-cfd-group={group.id}>
        {group.id!=='sorted'&&<div className="cfd-group-title">{groupLabel[group.id]}</div>}
        {group.rows.map(({ticker:tk,name,change,status})=>{const positive=(change??0)>=0;
          return <button key={tk.symbol} type="button" onClick={()=>onChange(tk.symbol)} className={`cfd-option${tk.symbol===symbol?' active':''}${tk.stale?' is-stale':''}`} aria-pressed={tk.symbol===symbol} data-cfd-symbol={tk.symbol} title={tk.name}>
            <span className="cfd-optionLeft"><CfdInstrumentIcon symbol={tk.symbol}/><span className="cfd-optionTitle">
              <span className="cfd-optionSymbolLine"><span className="mono cfd-optionSymbol">{tk.symbol}</span><span className={`cfd-row-state cfd-row-state-${status}`} title={statusLabel(status)} aria-label={statusLabel(status)}/></span><span className="cfd-optionName">{name}</span>
            </span></span>
            {tk.price===null?<span className="mono cfd-price">—</span>:<PriceCell value={Number(tk.price)} className="mono cfd-price" format={value=>formatCfdPrice(value,tk.symbol)}/>}<span className={`mono cfd-change ${change===null?'':positive?'text-buy':'text-sell'}`}>{change===null?'—':`${positive?'+':''}${change.toFixed(2)}%`}</span>
          </button>;})}
      </div>)}
      {tickers.length===0&&!configured&&!loadError&&<p className="cfd-hint">{copy.priceUnavailable}</p>}
      {tickers.length===0&&configured&&!loadError&&Array.from({length:7}).map((_,i)=><SkeletonRow key={i} columns={[3,1,1]}/>)}
      {tickers.length===0&&loadError&&<button type="button" onClick={onRetry} className="cfd-retryButton">{t('trade.loadPairsError')}</button>}
      {tickers.length>0&&shown.length===0&&<p className="cfd-hint">{t('trade.nothingFound')}</p>}
    </div>
  </div>;
}
