import { useEffect, useState } from 'react';
import { PriceChart } from './PriceChart';
import { TradingViewAdvancedChart } from './TradingViewAdvancedChart';
import { getFuturesCandles } from '../lib/futuresCandles';
import { useLanguage } from '../lib/i18n';
import type { ChartCandleLoader, ChartTradingInteraction } from '../lib/chartTrading';
import './TerminalChart.css';

/** Switch only the chart subtree: tickets, order families and books keep their state. */
export function TerminalChart({ pair, market='spot', compactTools=false, privateTrading, candleLoader }: {
  pair:string; market?:'spot'|'futures'; chrome?:'default'|'terminal'; drawingTools?:boolean;
  compactTools?:boolean;
  privateTrading?:ChartTradingInteraction;
  candleLoader?:ChartCandleLoader;
}) {
  const [mode,setMode]=useState<'voltex'|'tradingview'>('voltex');
  const { t, lang }=useLanguage();
  useEffect(() => { if (privateTrading?.enabled && privateTrading.selecting) setMode('voltex'); }, [privateTrading?.enabled, privateTrading?.selecting]);
  useEffect(() => { if (privateTrading?.enabled && privateTrading.focus) setMode('voltex'); }, [privateTrading?.enabled, privateTrading?.focus?.sequence]);
  const choosing = privateTrading?.enabled && privateTrading.selecting;
  const tradeLabel = lang === 'ru' ? 'Сделка с графика' : 'Trade from chart';
  return <div className="terminal-chart-shell">
    <div className="terminal-chart-heading">
      <span>{t('futures.chart')}</span>
      <div role="group" aria-label={t('futures.chart')}>
        {privateTrading?.enabled && <button type="button" className="chart-trade-action" aria-pressed={!!choosing}
          title={mode === 'tradingview' ? `${tradeLabel} · VOLTEX` : tradeLabel}
          onClick={() => { setMode('voltex'); if (choosing) privateTrading.onCancelSelection(); else privateTrading.onSelectionModeChange?.('entry'); }}>
          <span aria-hidden="true">↗</span> {tradeLabel}
        </button>}
        <button type="button" aria-pressed={mode==='voltex'} onClick={()=>setMode('voltex')}>VOLTEX</button>
        <button type="button" aria-pressed={mode==='tradingview'} onClick={()=>{ if (choosing) privateTrading?.onCancelSelection(); setMode('tradingview'); }}>TradingView</button>
      </div>
    </div>
    {mode==='voltex'
      ? <PriceChart key={`${market}:${pair}`} pair={pair} chrome="terminal" drawingTools market={market} compactTools={compactTools}
          privateTrading={privateTrading} candleLoader={candleLoader ?? (market==='futures'?getFuturesCandles:undefined)} />
      : <TradingViewAdvancedChart key={`${market}:${pair}`} pair={pair} market={market} />}
  </div>;
}
