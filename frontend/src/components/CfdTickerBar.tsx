import { useLanguage } from '../lib/i18n';
import { cfdDisplayState,cfdMarketCopy,formatCfdPrice } from '../lib/cfdPresentation';
import { parseChangePercentOrNull } from '../lib/priceChange';
import { PriceCell } from './PriceCell';
import type { CfdTickerRow } from './CfdInstrumentList';

export function CfdTickerBar({symbol,ticker}:{symbol:string;ticker?:CfdTickerRow}){
  const{t,lang}=useLanguage(),copy=cfdMarketCopy(lang),change=ticker?parseChangePercentOrNull(ticker.changePercent24h,symbol):null,state=cfdDisplayState(ticker,lang);
  return <header className="cfd-ticker-bar">
    <div className="cfd-selected-instrument"><span className="cfd-symbol mono">{symbol}</span><span className="cfd-instrument-name">{ticker?.name??'—'}</span></div>
    <div className="cfd-ticker-metric"><span>{t('markets.price')}</span>{ticker?.price!==null&&ticker?<PriceCell key={symbol} className="mono cfd-ticker-price" value={Number(ticker.price)} format={v=>formatCfdPrice(v,symbol)}/>:<span className="mono cfd-ticker-price">—</span>}</div>
    <div className="cfd-ticker-metric"><span>{t('markets.change24h')}</span><span className={`mono cfd-ticker-change ${change===null?'':change>=0?'text-buy':'text-sell'}`}>{change===null?'—':`${change>=0?'+':''}${change.toFixed(2)}%`}</span></div>
    <div className="cfd-ticker-metric cfd-market-state"><span>{copy.status}</span><span className={`cfd-state-pill cfd-state-${state.tone}`}>{state.label}</span></div>
  </header>;
}
