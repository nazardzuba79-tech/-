import { cfdDisplayState,cfdMarketCopy,formatCfdPrice } from '../lib/cfdPresentation';
import { useLanguage } from '../lib/i18n';
import { parseChangePercentOrNull } from '../lib/priceChange';
import type { CfdTickerRow } from './CfdInstrumentList';

export function CfdMarketOverview({symbol,ticker}:{symbol:string;ticker?:CfdTickerRow}){
  const{lang}=useLanguage(),copy=cfdMarketCopy(lang),state=cfdDisplayState(ticker,lang),change=ticker?parseChangePercentOrNull(ticker.changePercent24h,symbol):null;
  const type=['XAUUSD','XAGUSD','XPTUSD','XPDUSD'].includes(symbol)?copy.metal:['WTIUSD','XBRUSD'].includes(symbol)?copy.energy:['EURUSD','GBPUSD','USDJPY','AUDUSD','USDCAD','USDCHF','NZDUSD'].includes(symbol)?copy.fxMajor:copy.market;
  return <aside className="cfd-market-overview" aria-label={copy.marketOverview}>
    <div className="cfd-overview-head"><span>{copy.marketOverview}</span><span className={`cfd-state-pill cfd-state-${state.tone}`}>{state.label}</span></div>
    <div className="cfd-overview-instrument"><strong className="mono">{symbol}</strong><span>{ticker?.name??'—'}</span><small>{type}</small></div>
    <div className="cfd-overview-price"><span>{copy.marketPrice}</span><strong className="mono">{formatCfdPrice(ticker?.price??null,symbol)}</strong>{change!==null&&<small className={change>=0?'text-buy':'text-sell'}>{`${change>=0?'+':''}${change.toFixed(2)}% 24h`}</small>}</div>
    <dl className="cfd-overview-grid"><div><dt>{copy.session}</dt><dd>{ticker?.status==='market_closed'?copy.closed:ticker?.price?copy.open:copy.unavailable}</dd></div></dl>
  </aside>;
}
