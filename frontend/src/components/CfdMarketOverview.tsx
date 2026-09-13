import { cfdDisplayState,formatCfdAsOf,formatCfdPrice } from '../lib/cfdPresentation';
import { parseChangePercentOrNull } from '../lib/priceChange';
import type { CfdTickerRow } from './CfdInstrumentList';

const TYPE:Record<string,string>={XAUUSD:'Precious metal',XAGUSD:'Precious metal',XPTUSD:'Precious metal',XPDUSD:'Precious metal',WTIUSD:'Energy',XBRUSD:'Energy',EURUSD:'FX major',GBPUSD:'FX major',USDJPY:'FX major',AUDUSD:'FX major',USDCAD:'FX major',USDCHF:'FX major',NZDUSD:'FX major'};

export function CfdMarketOverview({symbol,ticker}:{symbol:string;ticker?:CfdTickerRow}){
  const state=cfdDisplayState(ticker),change=ticker?parseChangePercentOrNull(ticker.changePercent24h,symbol):null,asOf=formatCfdAsOf(ticker?.asOf);
  return <aside className="cfd-market-overview" aria-label="Market overview">
    <div className="cfd-overview-head"><span>Market overview</span><span className={`cfd-state-pill cfd-state-${state.tone}`}>{state.label}</span></div>
    <div className="cfd-overview-instrument"><strong className="mono">{symbol}</strong><span>{ticker?.name??'—'}</span><small>{TYPE[symbol]??'Market'}</small></div>
    <div className="cfd-overview-price"><span>Market price</span><strong className="mono">{formatCfdPrice(ticker?.price??null,symbol)}</strong>{change!==null&&<small className={change>=0?'text-buy':'text-sell'}>{`${change>=0?'+':''}${change.toFixed(2)}% 24h`}</small>}</div>
    <dl className="cfd-overview-grid"><div><dt>Session</dt><dd>{ticker?.status==='market_closed'?'Closed':ticker?.price?'Open':'Unavailable'}</dd></div><div><dt>Updated</dt><dd>{asOf||'—'}</dd></div><div><dt>Quote</dt><dd>{ticker?.providerSymbol??symbol}</dd></div><div><dt>Feed</dt><dd>Multi-source</dd></div></dl>
    <p className="cfd-overview-note">Displayed market data is automatically routed across available public sources. Missing data stays unavailable instead of being estimated.</p>
  </aside>;
}
