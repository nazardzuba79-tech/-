import { cfdMarketCopy } from '../lib/cfdPresentation';
import { useLanguage } from '../lib/i18n';
import { TradingViewAdvancedChart } from './TradingViewAdvancedChart';

/** Reference chart only. The visible CFD surface is market data, not order entry. */
export function CfdChart({ symbol }: { symbol: string }) {
  const { lang } = useLanguage();
  return <div className="cfd-chart">
    <TradingViewAdvancedChart pair={symbol} market="cfd" chrome="terminal" drawingTools />
    <p className="cfd-disclaimer">{cfdMarketCopy(lang).chartNote}</p>
  </div>;
}
