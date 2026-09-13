import { TradingViewAdvancedChart } from './TradingViewAdvancedChart';

/** Reference chart only. The visible CFD surface is market data, not order entry. */
export function CfdChart({ symbol }: { symbol: string }) {
  return <div className="cfd-chart">
    <TradingViewAdvancedChart pair={symbol} market="cfd" chrome="terminal" drawingTools />
  </div>;
}
