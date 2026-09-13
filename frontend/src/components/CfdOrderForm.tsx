import type { CfdTickerRow } from './CfdInstrumentList';
import { CfdMarketOverview } from './CfdMarketOverview';

/** CFD is a read-only market-data surface. The prop shape stays stable so the
 * terminal shell does not need a risky structural rewrite. */
export function CfdOrderForm({symbol,ticker}:{symbol:string;ticker:CfdTickerRow|undefined;configured?:boolean;onPlaced:()=>void}){
  return <CfdMarketOverview symbol={symbol} ticker={ticker}/>;
}
