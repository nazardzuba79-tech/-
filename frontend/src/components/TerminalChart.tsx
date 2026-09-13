import { useState } from 'react';
import { PriceChart } from './PriceChart';
import { TradingViewAdvancedChart } from './TradingViewAdvancedChart';
import { getFuturesCandles } from '../lib/futuresCandles';
import { useLanguage } from '../lib/i18n';
import './TerminalChart.css';

/** Switch only the chart subtree: tickets, order families and books keep their state. */
export function TerminalChart({ pair, market='spot', compactTools=false }: {
  pair:string; market?:'spot'|'futures'; chrome?:'default'|'terminal'; drawingTools?:boolean;
  compactTools?:boolean;
}) {
  const [mode,setMode]=useState<'voltex'|'tradingview'>('voltex');
  const { t }=useLanguage();
  return <div className="terminal-chart-shell">
    <div className="terminal-chart-heading">
      <span>{t('futures.chart')}</span>
      <div role="group" aria-label={t('futures.chart')}>
        <button type="button" aria-pressed={mode==='voltex'} onClick={()=>setMode('voltex')}>VOLTEX</button>
        <button type="button" aria-pressed={mode==='tradingview'} onClick={()=>setMode('tradingview')}>TradingView</button>
      </div>
    </div>
    {mode==='voltex'
      ? <PriceChart key={`${market}:${pair}`} pair={pair} chrome="terminal" drawingTools market={market} compactTools={compactTools}
          candleLoader={market==='futures'?getFuturesCandles:undefined} />
      : <TradingViewAdvancedChart key={`${market}:${pair}`} pair={pair} market={market} />}
  </div>;
}
