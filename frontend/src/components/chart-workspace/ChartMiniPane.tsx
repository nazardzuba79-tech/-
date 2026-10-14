import { useEffect, useMemo, useRef, useState } from 'react';
import { CandlestickSeries, ColorType, CrosshairMode, HistogramSeries, LineStyle, createChart, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts';
import { browserClearInterval, browserSetInterval, isBrowserInactive } from '../../lib/browserActivity';
import { chartCapabilities, resolveTimeframe } from '../../lib/chartCapabilities';
import { CHART_CANDLE_LOADERS, candleHistoryStart } from '../../lib/chartCandleLoaders';
import { loadChartCandles } from '../../lib/chartCandleSource';
import { getChartSettings, rgbaOf, subscribeChartSettings, type ChartSettings } from '../../lib/chartSettings';
import type { ChartSyncBus } from '../../lib/chartSyncBus';
import { timeframeLabelKey, timeframeSpec, type ChartTimeframe } from '../../lib/chartTimeframes';
import { dataBoundsFromEdges, initialLogicalRange, safeBottomMargin, timeTickLabel } from '../../lib/chartViewport';
import type { Candle } from '../../lib/indicators';
import type { Key } from '../../lib/i18n';
import { ICONS } from './chartWorkspaceIcons';

export interface ChartMiniPaneProps {
  index: number;
  market: 'spot' | 'futures';
  pair: string | null;
  /** The pane's own interval, or the main chart's when it has none; shown as the nearest one its source serves. */
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

/**
 * What the pane shows about its data (2026-10-14):
 *   idle     no instrument chosen
 *   loading  the first answer for this instrument + interval is on its way; nothing of a previous one is shown
 *   ok       bars on screen, refreshed every 10 s while the tab is active
 *   empty    the source answered with no bars (a listing before its first trade, an instrument without history)
 *   error    the first request failed; a key retries it
 *   stale    bars on screen, but the last refresh failed or came back empty — the bars stay, dated
 */
export type MiniPaneState = 'idle' | 'loading' | 'ok' | 'empty' | 'error' | 'stale';

const REFRESH_MS = 10000;
export const MINI_PANE_LIMIT = 300;
const PANE_VISIBLE = 120;
const BASE_MARGINS = { top: 0.08, bottom: 0.22 };

/**
 * A second, third or fourth chart beside the main one (2026-10-13): one
 * candlestick series with its volume, its own instrument and timeframe, its
 * own scale, a 10 s refresh that pauses with the tab, and cursor / time
 * sync through the workspace bus. It is a chart canvas, not a terminal: no
 * book, no ticket, no engine, and the only way it touches trading is the
 * explicit «Торговать» key that switches the whole terminal to its pair.
 *
 * The pane reads its own instrument's source (lib/chartCapabilities): a BTC
 * pane beside a managed listing asks Spot, a listing pane beside BTC asks the
 * simulation. Changing the instrument or the interval clears the canvas at
 * once and cancels the request in flight; an answer that arrives for a
 * previous identity is dropped, so bars of one instrument are never shown
 * under another's name, whatever order the network answers in.
 */
/** A terminal without its own price formatter (Futures) still shows a readable price: two decimals above 1000, four to 1, six below. */
const fallbackPrice = (value: number): string => (Math.abs(value) >= 1000 ? value.toFixed(2) : Math.abs(value) >= 1 ? value.toFixed(4) : value.toFixed(6));
const clock = (ms: number) => new Date(ms).toISOString().slice(11, 16);

export function ChartMiniPane({ index, market, pair, timeframe, instruments, onChange, onTrade, syncBus, sync, expanded, onExpand, t, formatPrice = fallbackPrice }: ChartMiniPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const marginRef = useRef<number | null>(null);
  const [settings, setSettings] = useState<ChartSettings>(() => getChartSettings());
  const [state, setState] = useState<MiniPaneState>('idle');
  const [last, setLast] = useState<number | null>(null);
  const [staleSince, setStaleSince] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const id = `pane-${index}`;
  useEffect(() => subscribeChartSettings(setSettings), []);

  // The pane's own capabilities: its source, its loader, the intervals it can show.
  const caps = useMemo(() => (pair ? chartCapabilities({ market, pair, loaders: CHART_CANDLE_LOADERS }) : null), [market, pair]);
  const shown = caps ? resolveTimeframe(timeframe, caps) : timeframe;
  const shownRef = useRef(shown); shownRef.current = shown;
  const options = caps ? caps.timeframes : [];

  // The chart, once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const token = (name: string, fallback: string) => (typeof getComputedStyle === 'function' ? getComputedStyle(host).getPropertyValue(name).trim() : '') || fallback;
    const chart = createChart(host, {
      layout: { background: { type: ColorType.Solid, color: token('--voltex-plot-background', '#101014') }, textColor: token('--voltex-axis-text', '#9aa3ad'), fontFamily: 'Inter, Arial, sans-serif', fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderColor: token('--voltex-axis-border', '#292c34'), scaleMargins: { ...BASE_MARGINS } },
      timeScale: { borderColor: token('--voltex-axis-border', '#292c34'), timeVisible: true, tickMarkFormatter: (time: Time, tickMarkType: number, locale: string) => timeTickLabel(Number(time), timeframeSpec(shownRef.current).seconds, tickMarkType, locale) },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: 'rgba(148,163,184,.35)', style: LineStyle.Dashed, labelBackgroundColor: '#1c2735' }, horzLine: { color: '#f0b90b', style: LineStyle.Dashed, labelBackgroundColor: '#f0b90b' } },
    });
    const series = chart.addSeries(CandlestickSeries, { borderVisible: false, priceLineVisible: true, priceLineWidth: 1, priceLineStyle: LineStyle.Dashed, priceLineColor: '#f0b90b' });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume' });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart; seriesRef.current = series; volumeRef.current = volume;
    // Read-only handle for acceptance tooling (scripts/qa-*): never read by the product itself.
    Object.defineProperty(host, '__voltexChart', { value: { chart, series }, configurable: true, enumerable: false, writable: true });
    const observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect; chart.resize(width, height); });
    observer.observe(host);
    // A positive-price pane never autoscales below zero (see PriceChart and lib/chartViewport).
    let marginFrame: number | null = null;
    const safeMargins = () => {
      marginFrame = null;
      const scale = chart.priceScale('right');
      if (!scale.options().autoScale || !candlesRef.current.length || typeof chart.paneSize !== 'function') return;
      const height = chart.paneSize(0).height;
      const top = series.coordinateToPrice(0), bottom = series.coordinateToPrice(height - 1);
      if (!(height > 0) || typeof top !== 'number' || typeof bottom !== 'number' || !(top > bottom)) return;
      const current = marginRef.current ?? BASE_MARGINS.bottom;
      const { lo, hi } = dataBoundsFromEdges(top, bottom, BASE_MARGINS.top, current);
      const next = safeBottomMargin(lo, hi, BASE_MARGINS.top, BASE_MARGINS.bottom);
      if (Math.abs(next - current) < 0.004) return;
      marginRef.current = next;
      scale.applyOptions({ scaleMargins: { top: BASE_MARGINS.top, bottom: next } });
    };
    const scheduleMargins = () => { if (marginFrame === null && typeof requestAnimationFrame === 'function') marginFrame = requestAnimationFrame(safeMargins); };
    // Outgoing sync: this pane's crosshair and visible window.
    let publishTimer: ReturnType<typeof setTimeout> | undefined;
    const onCrosshair = (param: { time?: unknown; point?: unknown }) => {
      syncBus.publish(id, { kind: 'crosshair', time: typeof param.time === 'number' && param.point ? param.time : null });
    };
    const onRange = () => {
      scheduleMargins();
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
      if (marginFrame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(marginFrame);
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

  // Data: one identity (instrument + interval + source) per run of this effect. Changing it clears
  // the canvas first, aborts the request in flight and drops any late answer of the old identity.
  const identity = pair && caps ? `${market}|${pair}|${shown}|${caps.source}` : null;
  useEffect(() => {
    const series = seriesRef.current, volume = volumeRef.current, chart = chartRef.current;
    candlesRef.current = [];
    series?.setData([]); volume?.setData([]);
    marginRef.current = null;
    chart?.priceScale('right').applyOptions({ scaleMargins: { ...BASE_MARGINS } });
    setLast(null); setStaleSince(null);
    if (!identity || !pair || !caps || !series || !volume || !chart) { setState('idle'); return; }
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
        const answer = await loadChartCandles(caps.loader, caps.source, { market, pair, timeframe: shown, limit: MINI_PANE_LIMIT, signal: own.signal, historyStart: candleHistoryStart(market, pair) });
        if (cancelled || controller !== own) return;
        if (!answer.candles.length) {
          // An empty answer is not a success: a first one is an empty pane, a later one keeps the bars and dates them.
          if (first) setState('empty'); else { setState('stale'); setStaleSince(current => current ?? Date.now()); }
          return;
        }
        candlesRef.current = answer.candles;
        series.setData(answer.candles.map(c => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })));
        volume.setData(answer.candles.map(c => ({ time: c.time as Time, value: c.volume, color: c.close >= c.open ? up : down })));
        setLast(answer.candles[answer.candles.length - 1].close);
        setStaleSince(null);
        setState('ok');
        if (first) { first = false; const range = initialLogicalRange(answer.candles.length, PANE_VISIBLE); if (range) chart.timeScale().setVisibleLogicalRange(range); }
      } catch (error) {
        if (cancelled || controller !== own || (error as { name?: string })?.name === 'AbortError') return;
        if (!candlesRef.current.length) setState('error');
        else { setState('stale'); setStaleSince(current => current ?? Date.now()); }
      }
    };
    void load();
    const poll = browserSetInterval(load, REFRESH_MS);
    return () => { cancelled = true; controller?.abort(); browserClearInterval(poll); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, attempt, settings.bodyUp, settings.bodyDown, settings.volumeOpacity]);

  const label = (tf: ChartTimeframe) => t(timeframeLabelKey(tf));
  return (
    <section className={`cw-pane${expanded ? ' is-expanded' : ''}`} data-cw-pane={index} data-cw-pane-state={state} data-cw-pane-source={caps?.source} aria-label={t('chart.ws.pane.title', { n: index + 1 })}>
      <header className="cw-pane-head">
        <select className="cw-pane-select" aria-label={t('chart.ws.pane.symbol')} value={pair ?? ''} data-cw-pane-symbol onChange={e => onChange({ pair: e.target.value || null })}>
          <option value="">{t('chart.ws.pane.pick')}</option>
          {instruments.map(p => <option key={p} value={p}>{p}</option>)}
          {pair && !instruments.includes(pair) && <option value={pair}>{pair}</option>}
        </select>
        <select className="cw-pane-select is-tf" aria-label={t('chart.ws.pane.timeframe')} value={shown} data-cw-pane-timeframe disabled={!options.length} onChange={e => onChange({ timeframe: e.target.value as ChartTimeframe })}>
          {options.length ? options.map(tf => <option key={tf} value={tf}>{label(tf)}</option>) : <option value={shown}>{label(shown)}</option>}
        </select>
        {last !== null && <span className="cw-pane-last" data-cw-pane-last>{formatPrice(last)}</span>}
        {/* The dated «not updating» note takes the analysis tag's place while it applies, so neither it nor the last price is clipped in a narrow pane. */}
        {state === 'stale'
          ? <span className="cw-pane-stale" data-cw-pane-stale role="status" title={t('chart.ws.pane.stale', { time: clock(staleSince ?? Date.now()) })}>{t('chart.ws.pane.stale', { time: clock(staleSince ?? Date.now()) })}</span>
          : <span className="cw-pane-tag">{t('chart.ws.pane.analysis')}</span>}
        {pair && onTrade && <button type="button" className="cw-pane-button" data-cw-pane-trade aria-label={t('chart.ws.pane.trade', { pair })} title={t('chart.ws.pane.trade', { pair })} onClick={() => onTrade(pair)}>{ICONS.trade}<span>{t('chart.ws.pane.trade', { pair })}</span></button>}
        <button type="button" className="cw-icon-button" data-cw-pane-expand aria-pressed={expanded} aria-label={t(expanded ? 'chart.ws.pane.collapse' : 'chart.ws.pane.expand')} title={t(expanded ? 'chart.ws.pane.collapse' : 'chart.ws.pane.expand')} onClick={() => onExpand(!expanded)}>{expanded ? ICONS.exitFullscreen : ICONS.expand}</button>
      </header>
      <div className="cw-pane-plot">
        <div ref={hostRef} className="cw-pane-chart" />
        {state === 'loading' && <div className="cw-pane-note is-loading" role="status" aria-live="polite">{t('chart.ws.pane.loading')}</div>}
        {state === 'empty' && <div className="cw-pane-note" role="status">{t('chart.ws.pane.empty')}</div>}
        {state === 'error' && (
          <div className="cw-pane-note is-error" role="status">
            <span>{t('chart.ws.pane.error')}</span>
            <button type="button" className="cw-button" data-cw-pane-retry onClick={() => setAttempt(value => value + 1)}>{t('chart.ws.pane.retry')}</button>
          </div>
        )}
        {!pair && <div className="cw-pane-note">{t('chart.ws.pane.pick')}</div>}
      </div>
    </section>
  );
}
