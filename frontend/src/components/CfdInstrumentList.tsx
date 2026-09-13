import { useLanguage } from '../lib/i18n';
import { SkeletonRow } from './Skeleton';
import { cfdDisplayState,formatCfdPrice } from '../lib/cfdPresentation';
import { PriceCell } from './PriceCell';
import { parseChangePercentOrNull } from '../lib/priceChange';

export interface CfdTickerRow{
  symbol:string;name:string;price:string|null;status?:string;stale?:boolean;marketClosed?:boolean;displayOnly?:boolean;executionAllowed?:boolean;
  provider?:string;providerSymbol?:string;providerTimestamp?:number|null;fetchedAt?:number|null;asOf?:number|null;maxQuoteAgeMs?:number;changePercent24h?:string;
}

export const CFD_ICON_BY_SYMBOL:Record<string,string>={
  XAUUSD:'Au',XAGUSD:'Ag',XPTUSD:'Pt',XPDUSD:'Pd',WTIUSD:'WTI',XBRUSD:'Br',
  EURUSD:'€',GBPUSD:'£',USDJPY:'¥',AUDUSD:'A$',USDCAD:'C$',USDCHF:'₣',NZDUSD:'N$',
};

export function CfdInstrumentList({symbol,onChange,tickers,configured,loadError,onRetry}:{symbol:string;onChange:(symbol:string)=>void;tickers:CfdTickerRow[];configured:boolean;loadError:boolean;onRetry:()=>void;}){
  const{t,lang}=useLanguage();
  return <div className="cfd-instruments">
    <div className="cfd-columns"><span>{t('trade.cfdInstrument')}</span><span className="cfd-align-right">{t('markets.price')}</span><span className="cfd-align-right">{t('markets.change24h')}</span></div>
    <div className="cfd-list">
      {tickers.map(tk=>{const change=parseChangePercentOrNull(tk.changePercent24h,tk.symbol),positive=(change??0)>=0,state=cfdDisplayState(tk,lang);
        return <button key={tk.symbol} onClick={()=>onChange(tk.symbol)} className={`cfd-option${tk.symbol===symbol?' active':''}`} aria-pressed={tk.symbol===symbol}>
          <span className="cfd-optionLeft"><span className={`cfd-icon cfd-icon-${tk.symbol}`}>{CFD_ICON_BY_SYMBOL[tk.symbol]??'•'}</span><span className="cfd-optionTitle">
            <span className="mono cfd-optionSymbol">{tk.symbol}</span><span className="cfd-optionName">{tk.name}</span><span className={`cfd-optionState cfd-state-${state.tone}`}>{state.label}</span>
          </span></span>
          {tk.price===null?<span className="mono cfd-price">—</span>:<PriceCell value={Number(tk.price)} className="mono cfd-price" format={value=>formatCfdPrice(value,tk.symbol)}/>}<span className={`mono cfd-change ${change===null?'':positive?'text-buy':'text-sell'}`}>{change===null?'—':`${positive?'+':''}${change.toFixed(2)}%`}</span>
        </button>;})}
      {tickers.length===0&&!configured&&!loadError&&<p className="cfd-hint">{t('trade.cfdUnavailable')}</p>}
      {tickers.length===0&&configured&&!loadError&&Array.from({length:7}).map((_,i)=><SkeletonRow key={i} columns={[3,1,1]}/>)}
      {tickers.length===0&&loadError&&<button onClick={onRetry} className="cfd-retryButton">{t('trade.loadPairsError')}</button>}
    </div>
  </div>;
}
