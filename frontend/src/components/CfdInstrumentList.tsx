import { useLanguage } from '../lib/i18n';
import { SkeletonRow } from './Skeleton';
import { cfdMarketCopy,formatCfdPrice } from '../lib/cfdPresentation';
import { PriceCell } from './PriceCell';
import { parseChangePercentOrNull } from '../lib/priceChange';
import { useMemo, useRef, useState } from 'react';
import { compareMarketValues, MarketColumnSort, nextMarketColumnSort } from '../lib/marketColumnSort';
import { CfdInstrumentIcon } from './CfdInstrumentIcon';

export interface CfdTickerRow{
  symbol:string;name:string;price:string|null;status?:string;stale?:boolean;marketClosed?:boolean;displayOnly?:boolean;executionAllowed?:boolean;
  provider?:string;providerSymbol?:string;providerTimestamp?:number|null;fetchedAt?:number|null;asOf?:number|null;maxQuoteAgeMs?:number;changePercent24h?:string;
}


export function CfdInstrumentList({symbol,onChange,tickers,configured,loadError,onRetry}:{symbol:string;onChange:(symbol:string)=>void;tickers:CfdTickerRow[];configured:boolean;loadError:boolean;onRetry:()=>void;}){
  const{t,lang}=useLanguage(),copy=cfdMarketCopy(lang);
  const [search,setSearch]=useState('');
  const [sort,setSort]=useState<MarketColumnSort>(null);
  const listRef=useRef<HTMLDivElement>(null);
  const rows=useMemo(()=>{
    const query=search.trim().toLowerCase();
    const filtered=tickers.filter(tk=>!query||`${tk.symbol} ${tk.name}`.toLowerCase().includes(query));
    if(!sort)return filtered;
    const value=(tk:CfdTickerRow)=>sort.field==='change'?parseChangePercentOrNull(tk.changePercent24h,tk.symbol)
      :tk.price!==null&&tk.price.trim()!==''&&Number(tk.price)>0?Number(tk.price):null;
    return filtered.sort((a,b)=>compareMarketValues(value(a),value(b),sort.dir));
  },[tickers,search,sort]);
  const toggleSort=(field:'price'|'change')=>{setSort(current=>nextMarketColumnSort(current,field));if(listRef.current)listRef.current.scrollTop=0;};
  const arrow=(field:'price'|'change')=>sort?.field===field?(sort.dir===-1?'▼':'▲'):'⇅';
  return <div className="cfd-instruments">
    <div className="pairs-search"><input aria-label={t('trade.cfdInstrument')} placeholder={t('trade.cfdInstrument')} value={search} onChange={event=>setSearch(event.target.value)}/></div>
    <div className="cfd-columns"><span>{t('trade.cfdInstrument')}</span><button type="button" className="cfd-align-right" aria-pressed={sort?.field==='price'} onClick={()=>toggleSort('price')}>{t('markets.price')} <span aria-hidden>{arrow('price')}</span></button><button type="button" className="cfd-align-right" aria-pressed={sort?.field==='change'} onClick={()=>toggleSort('change')}>{t('markets.change24h')} <span aria-hidden>{arrow('change')}</span></button></div>
    <div className="cfd-list" ref={listRef}>
      {rows.map(tk=>{const change=parseChangePercentOrNull(tk.changePercent24h,tk.symbol),positive=(change??0)>=0;
        return <button key={tk.symbol} onClick={()=>onChange(tk.symbol)} className={`cfd-option${tk.symbol===symbol?' active':''}`} aria-pressed={tk.symbol===symbol}>
          <span className="cfd-optionLeft"><CfdInstrumentIcon symbol={tk.symbol}/><span className="cfd-optionTitle">
            <span className="mono cfd-optionSymbol">{tk.symbol}</span><span className="cfd-optionName">{tk.name}</span>
          </span></span>
          {tk.price===null?<span className="mono cfd-price">—</span>:<PriceCell value={Number(tk.price)} className="mono cfd-price" format={value=>formatCfdPrice(value,tk.symbol)}/>}<span className={`mono cfd-change ${change===null?'':positive?'text-buy':'text-sell'}`}>{change===null?'—':`${positive?'+':''}${change.toFixed(2)}%`}</span>
        </button>;})}
      {tickers.length===0&&!configured&&!loadError&&<p className="cfd-hint">{copy.priceUnavailable}</p>}
      {tickers.length===0&&configured&&!loadError&&Array.from({length:7}).map((_,i)=><SkeletonRow key={i} columns={[3,1,1]}/>)}
      {tickers.length===0&&loadError&&<button onClick={onRetry} className="cfd-retryButton">{t('trade.loadPairsError')}</button>}
      {tickers.length>0&&rows.length===0&&<p className="cfd-hint">{t('trade.nothingFound')}</p>}
    </div>
  </div>;
}
