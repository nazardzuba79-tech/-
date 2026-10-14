import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PriceChart } from './PriceChart';
import { TradingViewAdvancedChart } from './TradingViewAdvancedChart';
import { TradingViewRulerLayer } from './TradingViewRulerLayer';
import { ChartMultiLayout } from './chart-workspace/ChartMultiLayout';
import { ChartMiniPane } from './chart-workspace/ChartMiniPane';
import { useCompareInstruments } from './chart-workspace/useCompareInstruments';
import { getFuturesCandles } from '../lib/futuresCandles';
import { getSpotPublicCandles } from '../lib/spotPublicMarket';
import { isEdgeMarketPair } from '../lib/nrxMarket';
import { useLanguage } from '../lib/i18n';
import { useMediaQuery } from '../lib/useMediaQuery';
import { createChartSyncBus } from '../lib/chartSyncBus';
import { getChartWorkspace, subscribeChartWorkspace, updateChartWorkspace, type ChartWorkspaceState, type WorkspaceView } from '../lib/chartWorkspace';
import type { CandleSourceKind } from '../lib/chartTimeframes';
import type { ChartCandleLoader, ChartPositionLine, ChartTradingInteraction } from '../lib/chartTrading';
import './TerminalChart.css';

/** Switch only the chart subtree: tickets, order families and books keep their state. */
export function TerminalChart({ pair, market='spot', compactTools=false, privateTrading, positionLines, candleLoader, tradingView=true, priceScaleMode, priceFormatter, chartSettings=false, foldHeading=false, onSelectPair }: {
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
  /** The terminal's instrument switch (2026-10-13, chart workspace): a
   *  second pane's «Торговать …» hands its pair here, so the whole terminal
   *  — ticker, book, ticket — moves together and visibly. */
  onSelectPair?:(pair:string)=>void;
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

  // ── Chart workspace (2026-10-13) ─────────────────────────────────────────
  // The view tabs («График | Данные | Аналитика»), the pane layout, the
  // cursor / time sync bus and full screen live here, around the chart.
  const [workspace, setWorkspace] = useState<ChartWorkspaceState>(() => getChartWorkspace(market));
  useEffect(() => { setWorkspace(getChartWorkspace(market)); return subscribeChartWorkspace(market, setWorkspace); }, [market]);
  const compact = useMediaQuery('(max-width: 900px)');
  const wide = useMediaQuery('(min-width: 1200px)');
  const syncBus = useMemo(() => createChartSyncBus(), []);
  const loader = candleLoader ?? (market==='futures'?getFuturesCandles:getSpotPublicCandles);
  const source: CandleSourceKind = market === 'futures' ? 'futures-public' : isEdgeMarketPair(pair) ? 'test-market' : 'spot-public';
  const instruments = useCompareInstruments(market, [pair]);
  /** A pane nobody has set yet opens on another liquid instrument, so a 2- or 4-chart layout is useful at once; a choice in the pane overrides it. */
  const paneDefaults = useMemo(() => {
    const preferred = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT', 'DOGE/USDT'].filter(p => p !== pair && instruments.includes(p));
    return [...preferred, ...instruments.filter(p => p !== pair && !preferred.includes(p))];
  }, [instruments, pair]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  /**
   * Full screen is the chart shell pinned over the viewport, not the
   * browser's Fullscreen API: every chart menu and dialog is a portal into
   * document.body, and the native API would hide all of them behind the
   * fullscreen element. The ticket, the book and the page stay mounted
   * underneath; the chart keeps its state; Escape and the button leave.
   */
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const fullscreen = pseudoFullscreen;
  useEffect(() => {
    if (!pseudoFullscreen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPseudoFullscreen(false); };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = previous; };
  }, [pseudoFullscreen]);
  const toggleFullscreen = useCallback(() => setPseudoFullscreen(value => !value), []);
  const layout = voltexShown ? (wide || compact || workspace.layout <= 2 ? workspace.layout : 2) : 1;
  const effectiveLayout = (compact ? Math.min(layout, 4) : layout) as 1 | 2 | 4;
  const setView = (view: WorkspaceView) => updateChartWorkspace(market, { view });
  const viewTabs = <nav className="cw-views" role="tablist" aria-label={t('futures.chart')} data-cw-views>
    {(['chart', 'data', 'analytics'] as const).map(view => (
      <button key={view} type="button" role="tab" className="cw-view-tab" aria-selected={workspace.view === view} data-cw-view={view}
        disabled={!voltexShown && view !== 'chart'} title={!voltexShown && view !== 'chart' ? t('chart.ws.view.tvOnly') : undefined}
        onClick={() => setView(view)}>{t(`chart.ws.view.${view}`)}</button>
    ))}
  </nav>;
  const switcher = <div role="group" aria-label={t('futures.chart')} className="terminal-chart-source">
        <button type="button" aria-pressed={mode==='voltex'} onClick={()=>setMode('voltex')}>VOLTEX</button>
        {tradingView && <button type="button" aria-pressed={mode==='tradingview'} onClick={()=>{ if (choosing) privateTrading?.onCancelSelection(); setMode('tradingview'); }}>TradingView</button>}
      </div>;
  const folded = foldHeading && voltexShown;
  const parked = compact && effectiveLayout > 1 && workspace.activePane !== 0;
  const main = <TradingViewRulerLayer>
    <PriceChart key={`${market}:${pair}`} pair={pair} chrome="terminal" drawingTools market={market} compactTools={compactTools}
      privateTrading={privateTrading} positionLines={positionLines} priceScaleMode={priceScaleMode} priceFormatter={priceFormatter}
      chartSettings={chartSettings} toolbarEnd={folded ? <>{viewTabs}{switcher}</> : undefined}
      candleLoader={loader} candleSource={source} onSelectPair={onSelectPair} syncBus={syncBus} syncId="main"
      compactLayout={compact} fullscreen={fullscreen} onFullscreen={toggleFullscreen} paused={parked || (expanded !== null && expanded !== 0)} />
  </TradingViewRulerLayer>;
  const panes = effectiveLayout > 1 ? workspace.panes.slice(0, effectiveLayout - 1).map((pane, i) => (
    <ChartMiniPane key={`pane-${i}`} index={i + 1} market={market} source={source} loader={loader}
      pair={pane.pair ?? paneDefaults[i] ?? null} timeframe={pane.timeframe ?? workspace.timeframe} instruments={instruments}
      onChange={patch => updateChartWorkspace(market, s => ({ panes: s.panes.map((p, k) => (k === i ? { ...p, ...patch } : p)) }))}
      onTrade={onSelectPair ? p => { onSelectPair(p); updateChartWorkspace(market, s => ({ panes: s.panes.map((x, k) => (k === i ? { ...x, pair } : x)), activePane: 0 })); setExpanded(null); } : undefined}
      syncBus={syncBus} sync={{ cursor: workspace.syncCursor, time: workspace.syncTime }}
      expanded={expanded === i + 1} onExpand={value => setExpanded(value ? i + 1 : null)} t={t} formatPrice={priceFormatter} />
  )) : [];
  return <div ref={shellRef} className={`terminal-chart-shell${folded ? ' is-heading-folded' : ''}${pseudoFullscreen ? ' is-pseudo-fullscreen' : ''}`} data-cw-fullscreen={fullscreen || undefined}>
    {!folded && <div className="terminal-chart-heading">
      {viewTabs}
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
      ? <ChartMultiLayout layout={effectiveLayout} compact={compact} activePane={workspace.activePane} onActivePane={index => updateChartWorkspace(market, { activePane: index })}
          expanded={expanded} main={main} panes={panes} paneLabels={workspace.panes.map(p => p.pair ?? '')} mainPair={pair} t={t} />
      : <TradingViewAdvancedChart key={`${market}:${pair}`} pair={pair} market={market} />}
  </div>;
}
