import { useEffect, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineStyle, createChart, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';
import { browserClearInterval, browserSetInterval, isBrowserInactive } from '../../lib/browserActivity';
import { loadChartCandles } from '../../lib/chartCandleSource';
import { getChartSettings, rgbaOf, subscribeChartSettings, type ChartSettings } from '../../lib/chartSettings';
import type { ChartSyncBus } from '../../lib/chartSyncBus';
import { availableTimeframes, timeframeLabelKey, type CandleSourceKind, type ChartTimeframe } from '../../lib/chartTimeframes';
import type { ChartCandleLoader } from '../../lib/chartTrading';
import type { Candle } from '../../lib/indicators';
import type { Key } from '../../lib/i18n';
import { ICONS } from './chartWorkspaceIcons';

export interface ChartMiniPaneProps {
  index: number;
  market: 'spot' | 'futures';
  source: CandleSourceKind;
  loader: ChartCandleLoader;
  pair: string | null;
  timeframe: ChartTimeframe;
  instruments: string[];
  onChange: (patch: { pair?: string | null; timeframe?: ChartTimeframe | null }) => void;
  /** Make this pane's instrument the terminal's: visible everywhere, never silent. */
  onTrade?: (pair: string) => void;
  syncBus: ChartSyncBus;
  sync: { cursor: boolean; time: boolean };
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
  t: (key: Key, params?: Record<string, string | number>) => string;
  formatPrice?: (value: number) => string;
}

const REFRESH_MS = 10000;
export const MINI_PANE_LIMIT = 300;

/**
 * A second, third or fourth chart beside the main one (2026-10-13): one
 * candlestick series with its volume, its own instrument and timeframe, its
 * own scale, a 10 s refresh that pauses with the tab, and cursor / time
 * sync through the workspace bus. It is a chart canvas, not a terminal: no
 * book, no ticket, no engine, and the only way it touches trading is the
 * explicit «Торговать» key that switches the whole terminal to its pair.
 */
/** A terminal without its own price formatter (Futures) still shows a readable price: two decimals above 1000, four to 1, six below. */
const fallbackPrice = (value: number): string => (Math.abs(value) >= 1000 ? value.toFixed(2) : Math.abs(value) >= 1 ? value.toFixed(4) : value.toFixed(6));

export function ChartMiniPane({ index, market, source, loader, pair, timeframe, instruments, onChange, onTrade, syncBus, sync, expanded, onExpand, t, formatPrice = fallbackPrice }: ChartMiniPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const [settings, setSettings] = useState<ChartSettings>(() => getChartSettings());
  const [state, setState] = useState<'idle' | 'loading' | 'ok' | 'failed'>('idle');
  const [last, setLast] = useState<number | null>(null);
  const id = `pane-${index}`;
  useEffect(() => subscribeChartSettings(setSettings), []);

  // The chart, once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const token = (name: string, fallback: string) => (typeof getComputedStyle === 'function' ? getComputedStyle(host).getPropertyValue(name).trim() : '') || fallback;
    const chart = createChart(host, {
      layout: { background: { type: ColorType.Solid, color: token('--voltex-plot-background', '#101014') }, textColor: token('--voltex-axis-text', '#9aa3ad'), fontFamily: 'Inter, Arial, sans-serif', fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderColor: token('--voltex-axis-border', '#292c34'), scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale: { borderColor: token('--voltex-axis-border', '#292c34'), timeVisible: true },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: 'rgba(148,163,184,.35)', style: LineStyle.Dashed, labelBackgroundColor: '#1c2735' }, horzLine: { color: '#f0b90b', style: LineStyle.Dashed, labelBackgroundColor: '#f0b90b' } },
    });
    const series = chart.addSeries(CandlestickSeries, { borderVisible: false, priceLineVisible: true, priceLineWidth: 1, priceLineStyle: LineStyle.Dashed, priceLineColor: '#f0b90b' });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume' });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart; seriesRef.current = series; volumeRef.current = volume;
    const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; chart.resize(width, height); });
    observer.observe(host);
    // Outgoing sync: this pane's crosshair and visible window.
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    const onCrosshair = (param: { time?: unknown; point?: unknown }) => {
      syncBus.publish(id, { kind: 'crosshair', time: typeof param.time === 'number' && param.point ? param.time : null });
    };
    const onRange = () => {
      clearTimeout(publishTimer);
      publishTimer = setTimeout(() => {
        const range = chart.timeScale().getVisibleRange();
        if (range) syncBus.publish(id, { kind: 'range', from: Number(range.from), to: Number(range.to) });
      }, 60);
    };
    chart.subscribeCrosshairMove(onCrosshair);
    chart.timeScale().subscribeVisibleTimeRangeChange(onRange);
    return () => {
      clearTimeout(publishTimer);
      chart.unsubscribeCrosshairMove(onCrosshair);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(onRange);
      observer.disconnect();
      chart.remove();
      chartRef.current = null; seriesRef.current = null; volumeRef.current = null;
    };
  }, [syncBus, id]);

  // Incoming sync from the other panes.
  useEffect(() => syncBus.subscribe((event, from) => {
    const chart = chartRef.current, series = seriesRef.current;
    if (from === id || !chart || !series) return;
    if (event.kind === 'crosshair' && sync.cursor) {
      if (event.time === null) { chart.clearCrosshairPosition(); return; }
      const bar = candlesRef.current.find(c => c.time === event.time);
      if (bar) chart.setCrosshairPosition(bar.close, event.time as Time, series); else chart.clearCrosshairPosition();
    }
    if (event.kind === 'range' && sync.time) {
      try { chart.timeScale().setVisibleRange({ from: event.from as Time, to: event.to as Time }); } catch { /* no bars there yet */ }
    }
  }), [syncBus, id, sync.cursor, sync.time]);

  // Paint.
  useEffect(() => {
    const s = settings;
    seriesRef.current?.applyOptions({ upColor: s.bodyUp, downColor: s.bodyDown, wickUpColor: s.wickUp, wickDownColor: s.wickDown, borderUpColor: s.borderUp, borderDownColor: s.borderDown, borderVisible: s.border });
    volumeRef.current?.applyOptions({ visible: s.volume });
    if (formatPrice) seriesRef.current?.applyOptions({ priceFormat: { type: 'custom', formatter: formatPrice, minMove: 1e-8 } });
  }, [settings, formatPrice]);

  // Data: load, refresh every 10 s while the tab is active, abort on change.
  useEffect(() => {
    const series = seriesRef.current, volume = volumeRef.current, chart = chartRef.current;
    if (!pair || !series || !volume || !chart) { candlesRef.current = []; series?.setData([]); volume?.setData([]); setState('idle'); setLast(null); return; }
    let cancelled = false, first = true;
    let controller: AbortController | null = null;
    setState('loading');
    const up = rgbaOf(settings.bodyUp, settings.volumeOpacity), down = rgbaOf(settings.bodyDown, settings.volumeOpacity);
    const load = async () => {
      if (cancelled || isBrowserInactive()) return;
      controller?.abort();
      const own = new AbortController();
      controller = own;
      try {
        const answer = await loadChartCandles(loader, source, { market, pair, timeframe, limit: MINI_PANE_LIMIT, signal: own.signal });
        if (cancelled || controller !== own) return;
        candlesRef.current = answer.candles;
        series.setData(answer.candles.map(c => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })));
        volume.setData(answer.candles.map(c => ({ time: c.time as Time, value: c.volume, color: c.close >= c.open ? up : down })));
        setLast(answer.candles.length ? answer.candles[answer.candles.length - 1].close : null);
        setState('ok');
        if (first) { first = false; chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, answer.candles.length - 120), to: answer.candles.length - 1 }); }
      } catch (error) {
        if (cancelled || (error as { name?: string })?.name === 'AbortError') return;
        if (!candlesRef.current.length) setState('failed');
      }
    };
    void load();
    const poll = browserSetInterval(load, REFRESH_MS);
    return () => { cancelled = true; controller?.abort(); browserClearInterval(poll); };
  }, [pair, timeframe, market, source, loader, settings.bodyUp, settings.bodyDown, settings.volumeOpacity]);

  const options = availableTimeframes(source);
  return (
    <section className={`cw-pane${expanded ? ' is-expanded' : ''}`} data-cw-pane={index} data-cw-pane-state={state} aria-label={t('chart.ws.pane.title', { n: index + 1 })}>
      <header className="cw-pane-head">
        <select className="cw-pane-select" aria-label={t('chart.ws.pane.symbol')} value={pair ?? ''} data-cw-pane-symbol onChange={e => onChange({ pair: e.target.value || null })}>
          <option value="">{t('chart.ws.pane.pick')}</option>
          {instruments.map(p => <option key={p} value={p}>{p}</option>)}
          {pair && !instruments.includes(pair) && <option value={pair}>{pair}</option>}
        </select>
        <select className="cw-pane-select is-tf" aria-label={t('chart.ws.pane.timeframe')} value={timeframe} data-cw-pane-timeframe onChange={e => onChange({ timeframe: e.target.value as ChartTimeframe })}>
          {options.map(tf => <option key={tf} value={tf}>{t(timeframeLabelKey(tf))}</option>)}
        </select>
        {last !== null && <span className="cw-pane-last" data-cw-pane-last>{formatPrice(last)}</span>}
        <span className="cw-pane-tag">{t('chart.ws.pane.analysis')}</span>
        {pair && onTrade && <button type="button" className="cw-pane-button" data-cw-pane-trade aria-label={t('chart.ws.pane.trade', { pair })} title={t('chart.ws.pane.trade', { pair })} onClick={() => onTrade(pair)}>{ICONS.trade}<span>{t('chart.ws.pane.trade', { pair })}</span></button>}
        <button type="button" className="cw-icon-button" data-cw-pane-expand aria-pressed={expanded} aria-label={t(expanded ? 'chart.ws.pane.collapse' : 'chart.ws.pane.expand')} title={t(expanded ? 'chart.ws.pane.collapse' : 'chart.ws.pane.expand')} onClick={() => onExpand(!expanded)}>{expanded ? ICONS.exitFullscreen : ICONS.expand}</button>
      </header>
      <div className="cw-pane-plot">
        <div ref={hostRef} className="cw-pane-chart" />
        {state === 'failed' && <div className="cw-pane-note" role="status">{t('chart.ws.pane.failed')}</div>}
        {!pair && <div className="cw-pane-note">{t('chart.ws.pane.pick')}</div>}
      </div>
    </section>
  );
}
