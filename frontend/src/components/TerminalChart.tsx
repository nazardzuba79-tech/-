import { useEffect, useState } from 'react';
import { PriceChart } from './PriceChart';
import { TradingViewAdvancedChart } from './TradingViewAdvancedChart';
import { TradingViewRulerLayer } from './TradingViewRulerLayer';
import { getFuturesCandles } from '../lib/futuresCandles';
import { getSpotPublicCandles } from '../lib/spotPublicMarket';
import { useLanguage } from '../lib/i18n';
import type { ChartCandleLoader, ChartPositionLine, ChartTradingInteraction } from '../lib/chartTrading';
import './TerminalChart.css';

/** Switch only the chart subtree: tickets, order families and books keep their state. */
export function TerminalChart({ pair, market='spot', compactTools=false, privateTrading, positionLines, candleLoader, tradingView=true, priceScaleMode, priceFormatter, chartSettings=false, foldHeading=false }: {
  pair:string; market?:'spot'|'futures'; chrome?:'default'|'terminal'; drawingTools?:boolean;
  compactTools?:boolean;
  privateTrading?:ChartTradingInteraction;
  /** Open positions to draw on the price scale. See PriceChart. */
  positionLines?:ChartPositionLine[];
  candleLoader?:ChartCandleLoader;
  /** False for a market TradingView does not carry (a VOLTEX test asset):
   *  its embed would show some other venue's symbol under this name. */
  tradingView?:boolean;
  /** See PriceChart. */
  priceScaleMode?:'normal'|'logarithmic';
  priceFormatter?:(price:number)=>string;
  /** The viewer's chart settings and their gear (see PriceChart). */
  chartSettings?:boolean;
  /** Fold the «График» heading into the chart's own toolbar: one row, with
   *  the VOLTEX / TradingView switch at its right end. The heading row comes
   *  back while TradingView is shown, since that chart has no VOLTEX toolbar
   *  to carry the switch. */
  foldHeading?:boolean;
}) {
  const [mode,setMode]=useState<'voltex'|'tradingview'>('voltex');
  const { t }=useLanguage();
  useEffect(() => { if (privateTrading?.enabled && privateTrading.selecting) setMode('voltex'); }, [privateTrading?.enabled, privateTrading?.selecting]);
  useEffect(() => { if (privateTrading?.enabled && privateTrading.focus) setMode('voltex'); }, [privateTrading?.enabled, privateTrading?.focus?.sequence]);
  /**
   * Still read by the TradingView switch below: leaving a chart while a bar
   * is being chosen must cancel that choice rather than strand it.
   */
  const choosing = privateTrading?.enabled && privateTrading.selecting;
  const voltexShown = mode==='voltex' || !tradingView;
  const switcher = <div role="group" aria-label={t('futures.chart')} className="terminal-chart-source">
        <button type="button" aria-pressed={mode==='voltex'} onClick={()=>setMode('voltex')}>VOLTEX</button>
        {tradingView && <button type="button" aria-pressed={mode==='tradingview'} onClick={()=>{ if (choosing) privateTrading?.onCancelSelection(); setMode('tradingview'); }}>TradingView</button>}
      </div>;
  const folded = foldHeading && voltexShown;
  return <div className={`terminal-chart-shell${folded ? ' is-heading-folded' : ''}`}>
    {!folded && <div className="terminal-chart-heading">
      <span>{t('futures.chart')}</span>
      <div role="group" aria-label={t('futures.chart')}>
        {/* The "Сделка с графика" button used to sit here. It is gone from
            the UI on purpose: it duplicated a control the chart already
            offers, and it was the widest thing in this heading. Nothing
            below it changed — the picker is still armed from the chart's
            own tool menu, the two effects above still bring the VOLTEX
            chart forward while a bar is being chosen, and the TradingView
            switch still cancels an unfinished choice. */}
        <button type="button" aria-pressed={mode==='voltex'} onClick={()=>setMode('voltex')}>VOLTEX</button>
        {tradingView && <button type="button" aria-pressed={mode==='tradingview'} onClick={()=>{ if (choosing) privateTrading?.onCancelSelection(); setMode('tradingview'); }}>TradingView</button>}
      </div>
    </div>}
    {voltexShown
      ? <TradingViewRulerLayer>
          <PriceChart key={`${market}:${pair}`} pair={pair} chrome="terminal" drawingTools market={market} compactTools={compactTools}
            privateTrading={privateTrading} positionLines={positionLines} priceScaleMode={priceScaleMode} priceFormatter={priceFormatter}
            chartSettings={chartSettings} toolbarEnd={folded ? switcher : undefined}
            candleLoader={candleLoader ?? (market==='futures'?getFuturesCandles:getSpotPublicCandles)} />
        </TradingViewRulerLayer>
      : <TradingViewAdvancedChart key={`${market}:${pair}`} pair={pair} market={market} />}
  </div>;
}
