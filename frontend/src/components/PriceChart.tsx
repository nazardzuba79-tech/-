import { useEffect, useRef, useState, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  AreaSeries,
  IChartApi,
  ISeriesApi,
  IPriceLine,
  MouseEventParams,
  Time,
  LineStyle,
  CrosshairMode,
  createSeriesMarkers,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
} from 'lightweight-charts';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { computeSMA, computeBollingerBands, computeRSI, computeMACD, Candle } from '../lib/indicators';
import {
  drawingFlyoutPosition,
  drawingRange,
  drawingStorageKey,
  drawingStyle,
  formatDrawingPrice,
  magnetSnap,
  parseStoredDrawings,
  serializeDrawings,
  type DrawingKind,
  type DrawingMarket,
  type DrawingPoint,
  type StoredDrawing,
} from '../lib/chartDrawings';
import type { DrawingView } from '../lib/drawingGeometry';
import { ChartDrawingLayer, CURSOR_TOOLS, newDrawingId, type ChartDrawing, type DrawingTool, type TextRequest } from './ChartDrawingLayer';
import { spotChartPriceFormat } from '../lib/spotChartPriceFormat';
import { chartEntryAnchor, chartEventBar, chartSymbol, completeChartCandle, isCandleHit, mergeChartCandles, CHART_INTERVAL_MS, type ChartCandleLoader, type ChartTradingInteraction, type ChartPositionLine } from '../lib/chartTrading';
import './DrawingTools.css';
import { PrivatePositionLines } from './PrivatePositionLines';

const MA_PERIOD = 200;
const VISIBLE_CANDLES = 300;
// Fetch enough extra history that the MA200 line has a full 200-bar
// warm-up BEFORE the window we actually show — otherwise the line only
// starts partway across the visible chart (no average exists yet for the
// first 200 loaded candles).
const CANDLE_FETCH_LIMIT = VISIBLE_CANDLES + MA_PERIOD + 20;

type ChartType = 'candles' | 'line' | 'area';

// Kept in sync with the actual series colors set at chart-init time below —
// used both for the toolbar toggle dots and the on-chart legend.
const INDICATOR_COLORS = {
  ma: '#f7d51d',
  bollinger: 'rgba(91,141,239,0.9)',
  rsi: '#c084fc',
  macd: '#5b8def',
};

interface ConditionalOrder {
  id: string;
  side: 'BUY' | 'SELL';
  type: string;
  triggerPrice: string | null;
  price: string | null;
  ocoGroupId: string | null;
}

const INTERVALS = ['5m', '15m', '1h', '4h', '1d', '1w'] as const;
type Interval = (typeof INTERVALS)[number];
const INTERVAL_SECONDS: Record<Interval, number> = {
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800,
};

/** Every tool the rail can select — the cursors, the eraser, zoom and each drawing kind. */
type Tool = DrawingTool;
type Point = DrawingPoint;
type MagnetMode = 'weak' | 'strong';
/** A weak magnet snaps only when the pointer is this close to an OHLC level, as TradingView's does. */
const WEAK_MAGNET_PX = 24;

/**
 * Self-rendered chart using lightweight-charts — the actual open-source
 * charting engine published by TradingView, just not their hosted embed
 * widget. Switched back to this from the embedded "Advanced Chart" widget
 * because that widget silently ignored both the candle/volume color
 * overrides and never rendered a working timeframe picker — undocumented,
 * unfixable from our side. Here colors and timeframes are code we control
 * directly, fed by real Kraken candle data (/market/external/candles).
 *
 * The left-side drawing toolbar (trend line, ray, horizontal/vertical line,
 * rectangle, fibonacci retracement, brush, ruler, text, eraser,
 * fit-to-content) is a deliberately smaller, honest subset of what
 * TradingView's own licensed charting library ships — every tool here is
 * fully functional, drawn with a plain SVG overlay kept in sync with the
 * chart's pan/zoom via its own coordinate-conversion APIs. No icon here is
 * decoration for a feature that doesn't work.
 */
/**
 * `chrome` picks the frame drawn around the chart, not the chart itself.
 *
 * 'terminal' renders the supplied reference's `.chart-toolbar` /
 * `.chart-tabs` / `.chart-tool-btn` / `.chart-view` markup, which is styled
 * by TradeTerminal.css under `.trade-terminal`. Futures keeps 'default',
 * the original inline-styled toolbar — those rules are scoped to the trade
 * terminal, so a Futures chart rendering them would come out unstyled.
 */
export function PriceChart({
  pair,
  chrome = 'default',
  drawingTools = false,
  market = 'spot',
  candleLoader,
  compactTools = false,
  privateTrading,
  positionLines,
}: {
  pair: string;
  chrome?: 'default' | 'terminal';
  drawingTools?: boolean;
  compactTools?: boolean;
  /** Which product this chart belongs to. Only used to namespace saved
   *  drawings — spot BTC levels are not futures BTC levels. */
  market?: DrawingMarket;
  candleLoader?: ChartCandleLoader;
  privateTrading?: ChartTradingInteraction;
  /**
   * Open positions to draw on the price scale: entry, take profit, stop
   * loss and the liquidation boundary.
   *
   * Every figure is the SERVER'S. `entryPrice` and `liquidationPrice` come
   * off /futures/positions, and the two protection levels are the armed
   * triggers the protection service holds — not an echo of anything typed
   * into an editor. Nothing here is derived, and nothing is approximated:
   * `previewLiquidationPrice` in lib/futuresMath is a form-time estimate
   * and must never back a line a trader reads as their liquidation level.
   *
   * `liquidationPrice: null` is the engine saying NO PRICE IS REACHABLE
   * with the account's current collateral. There is then no line, because
   * a line drawn at some plausible number would be a boundary the engine
   * does not recognize.
   *
   * Undefined where `privateTrading` already draws the same lines from the
   * simulation transcript, so a position never gets two entry lines.
   */
  positionLines?: ChartPositionLine[];
}) {
  const { t, lang } = useLanguage();
  const terminal = chrome === 'terminal';
  const drawingToolsOn = terminal && drawingTools;
  /**
   * Two spot-terminal refinements that arrived alongside the original
   * Spot-only rail but are NOT part of it: the candle-magnitude price
   * axis and the MACD warm-up.
   *
   * They used to ride on the same flag purely because "has the rail" and
   * "is the spot terminal" were the same thing. Generalizing the rail to
   * Futures separated those, and letting them travel with it would have
   * silently changed the Futures axis precision and its MACD warm-up —
   * indicator and axis behaviour nobody asked this task to touch. Gated
   * on the terminal itself instead, so both pages keep exactly what they
   * had.
   */
  const spotChartRefinements = terminal && market === 'spot';
  /**
   * Conditional (SL/TP trigger) orders are a SPOT-ONLY feature.
   *
   * `/orders/me?status=PENDING_TRIGGER` is the SPOT order book. There is no
   * futures conditional-order contract behind it — a futures trigger order
   * would come from the futures services, and none exists — so on the
   * futures terminal this chart was polling an authenticated spot endpoint
   * every 4 seconds for lines that describe a different product's orders.
   * PR #14's QA measured ~97 such requests in one run.
   *
   * The request is not made at all here, rather than made and hidden: the
   * traffic is the problem, not just the pixels. Nothing about the spot
   * path changes — same endpoint, same 4s cadence, same pair filter, same
   * drag and the same updateOrderTrigger call.
   */
  const spotConditionalOrders = market === 'spot';
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // The candlestick series stays the single coordinate-conversion
  // authority (priceToCoordinate/coordinateToPrice, used throughout the
  // drawing tools and SL/TP drag logic) regardless of which visual chart
  // type is active — switching type just toggles which series is visible,
  // never destroys/recreates the price scale itself.
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const areaSeriesRef = useRef<ISeriesApi<'Area'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const maSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bollUpperRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bollMiddleRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bollLowerRef = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdLineRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdSignalRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdHistRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const candlesRef = useRef<Candle[]>([]);
  const tradingRef = useRef(privateTrading);
  tradingRef.current = privateTrading;
  const privateMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const privateLinesRef = useRef<IPriceLine[]>([]);
  /** Position overlay lines. A ref of their own: the simulation
   *  transcript's effect owns `privateLinesRef` and clears it wholesale,
   *  and two effects sharing one list means whichever runs second erases
   *  the other's work. */
  const positionLinesRef = useRef<IPriceLine[]>([]);
  const positionLineOwnerRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'> | null>(null);
  const privateLineOwnerRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Line'> | ISeriesApi<'Area'> | null>(null);
  const privateHistoryRef = useRef<((time: number) => Promise<void>) | null>(null);
  const [candlesRevision, setCandlesRevision] = useState(0);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [interval, setInterval_] = useState<Interval>('1h');
  const [empty, setEmpty] = useState(false);
  /**
   * The instrument whose candles are currently ON SCREEN — "market|pair|interval".
   *
   * Held in a ref, not state, because it must survive the candle effect being
   * torn down and rebuilt. It is what lets a re-run tell "the user switched
   * instrument" from "the loader identity changed underneath me".
   */
  const paintedSeriesRef = useRef<string | null>(null);
  /** An initial load genuinely failed and there is nothing to show. */
  const [loadFailed, setLoadFailed] = useState(false);
  /** Retries the candle request alone — never a page reload. */
  const retryCandlesRef = useRef<(() => void) | null>(null);
  const [chartType, setChartType] = useState<ChartType>('candles');
  const [showMA, setShowMA] = useState(true);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);
  const chartHitRef = useRef({ pair, interval, showRSI, showMACD });
  chartHitRef.current = { pair, interval, showRSI, showMACD };
  const tradingSelection = !!privateTrading?.enabled && !!privateTrading.selecting;

  const [tool, setTool] = useState<Tool>('cursor');
  /**
   * Every drawing on this chart, in paint order — one model for all kinds
   * (owner, 2026-09-26: «таку ж панель як в трейдінгвю… з таким же
   * функціоналом»). Horizontal lines are data here too; the native price
   * lines are derived from this, never the other way round.
   */
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  /** The drawing the object toolbar is editing, if any. */
  const [selectedDrawing, setSelectedDrawing] = useState<number | null>(null);
  /**
   * Magnet: snap each new anchor to the nearest OHLC level of the nearest
   * loaded candle. Real snapping against the candle array this chart
   * already holds — see `magnetSnap`.
   */
  const [savedMagnet, setMagnet] = useState(false);
  const magnet = savedMagnet;
  /** Weak snaps only near a level; strong always snaps — TradingView's two magnets. */
  const [magnetMode, setMagnetMode] = useState<MagnetMode>('strong');
  /**
   * Lock: drawings stay visible and the chart stays fully navigable, but
   * nothing can add, erase or clear them. It guards exactly the mutating
   * actions this overlay has.
   */
  const [savedLocked, setLocked] = useState(false);
  const locked = savedLocked;
  /** Flipped once the chart and series exist, so effects that create chart
   *  objects from state do not race the chart's own construction. */
  const [chartReady, setChartReady] = useState(false);
  // Drawings stay in state while hidden — this only controls whether the
  // overlay renders them, so toggling back shows exactly what was there.
  const [savedHidden, setDrawingsHidden] = useState(false);
  const drawingsHidden = savedHidden;
  // A drawing tool currently stays selected until the trader picks another,
  // which is TradingView's "stay in drawing mode" behaviour. Turning this
  // off returns to the cursor after each completed shape. Both are real
  // behaviours of this overlay; nothing here simulates anything.
  // TradingView's default: off — a finished drawing hands back the cursor
  // and is selected, ready for the object toolbar.
  const [savedStayInDrawMode, setStayInDrawMode] = useState(false);
  const stayInDrawMode = savedStayInDrawMode;
  const [drawDialog, setDrawDialog] = useState<{ kind: 'text'; request: TextRequest } | { kind: 'clear' } | null>(null);
  // Bumped on every pan/zoom/resize to force the SVG overlay to recompute
  // screen coordinates from the stored (time, price) points.
  const [, forceRedraw] = useState(0);

  // Pending SL/TP orders for this pair, drawn as draggable horizontal
  // lines — real orders, not decoration: dragging one calls
  // api.updateOrderTrigger and the backend re-validates/re-locks funds.
  const [conditionalOrders, setConditionalOrders] = useState<ConditionalOrder[]>([]);
  const [draggingOrderId, setDraggingOrderId] = useState<string | null>(null);
  const [dragPrice, setDragPrice] = useState<number | null>(null);
  const draggingRef = useRef<{ id: string; startPrice: number; startTriggerPrice: number; startExecPrice: number | null } | null>(
    null
  );

  const toolRef = useRef(tool);
  toolRef.current = tool;
  const cancelGestureRef = useRef<(() => void) | null>(null);
  const hiddenRef = useRef(drawingsHidden);
  hiddenRef.current = drawingsHidden;
  // Read from inside native window listeners, which close over the value
  // at bind time — a ref keeps them seeing the current setting.
  const stayInDrawModeRef = useRef(stayInDrawMode);
  stayInDrawModeRef.current = stayInDrawMode;
  const magnetRef = useRef(magnet);
  magnetRef.current = magnet;
  const magnetModeRef = useRef(magnetMode);
  magnetModeRef.current = magnetMode;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const confirmClearRef = useRef('');
  confirmClearRef.current = t('draw.deleteAllConfirm');

  // Create the chart once on mount.
  useEffect(() => {
    if (!containerRef.current) return;

    // Keep the plot clean; axes, the crosshair and actual indicator/order
    // lines provide the price reference without a permanent background grid.
    const surface = typeof getComputedStyle === 'function' ? getComputedStyle(containerRef.current) : null;
    // A terminal's stylesheet may restate the chart's paint as tokens (the
    // Futures terminal's TradingView-style surface does); every other chart
    // keeps the values written here.
    const token = (name: string, fallback: string) => surface?.getPropertyValue(name).trim() || fallback;
    const plotBackground = token('--voltex-plot-background', '');
    const chart = createChart(containerRef.current, {
      layout: {
        // Match the terminal surface, including the axes and drawing rail.
        background: { type: ColorType.Solid, color: plotBackground || '#101014' },
        // A cool, slightly desaturated near-white rather than pure #fff —
        // reads as a premium instrument panel, not a stark spreadsheet.
        // Lifted a step for the terminal: the price and time axes are read
        // as numbers, and 11px of #c7d2e0 on #101014 was drawing the thin
        // strokes of 8, 3 and 5 with a single dim pixel. A point larger and
        // a tone brighter is the whole difference between a figure you read
        // and one you decipher. The terminal's axis now matches the Bybit
        // reference's (owner, 2026-09-24: more contrast): its price scale
        // reads at ~243 of 255, where #dbe3ee read at 211.
        textColor: token('--voltex-axis-text', terminal ? '#f3f4f6' : '#a3adba'),
        fontFamily: 'Inter, Arial, sans-serif',
        fontSize: terminal ? 12 : 11,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      // borderColor is what draws the 1px seam between the candles and the
      // price axis — a graphite/blue tone rather than near-black makes the
      // axis read as an intentional part of the chart instead of text
      // floating in empty space.
      rightPriceScale: { borderColor: token('--voltex-axis-border', '#292c34') },
      timeScale: { borderColor: token('--voltex-axis-border', '#292c34'), timeVisible: true },
      crosshair: terminal
        ? {
            mode: CrosshairMode.Normal,
            vertLine: { color: 'rgba(148, 163, 184, 0.35)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#1c2735' },
            horzLine: { color: '#f0b90b', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#f0b90b' },
          }
        : { mode: 0 },
    });

    // White up / orange down — VOLTEX's own brand accent, not TradingView's
    // default green/red, guaranteed to actually apply since we set it
    // directly on the series rather than hoping a third-party widget
    // honors a config flag.
    const candleUp = token('--voltex-candle-up', '#eaecef');
    const candleDown = token('--voltex-candle-down', '#f7a600');
    const series = chart.addSeries(CandlestickSeries, {
      upColor: candleUp,
      downColor: candleDown,
      borderVisible: false,
      wickUpColor: candleUp,
      wickDownColor: candleDown,
      // The current-price line + its axis tag were "too weak" by design
      // request: a single accent color regardless of up/down direction
      // reads as one deliberate "you are here" marker, rather than
      // blending into whichever candle color the last bar happens to be.
      ...(terminal
        ? { priceLineVisible: true, priceLineWidth: 1, priceLineStyle: LineStyle.Dashed, priceLineColor: '#f0b90b' }
        : {}),
    });
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.3 } });

    // Line/Area alternatives to the candlesticks — same right price scale,
    // just hidden by default (see the chartType effect below for the swap).
    const lineSeries = chart.addSeries(LineSeries, {
      color: '#eaecef',
      lineWidth: 2,
      visible: false,
    });
    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor: '#f7a600',
      topColor: 'rgba(247,166,0,0.35)',
      bottomColor: 'rgba(247,166,0,0.02)',
      lineWidth: 2,
      visible: false,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    const maSeries = chart.addSeries(LineSeries, {
      color: '#f7d51d',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    const bollOpts = { lineWidth: 1 as const, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, visible: false };
    const bollUpper = chart.addSeries(LineSeries, { ...bollOpts, color: 'rgba(91,141,239,0.7)' });
    const bollMiddle = chart.addSeries(LineSeries, { ...bollOpts, color: 'rgba(91,141,239,0.4)', lineStyle: 2 });
    const bollLower = chart.addSeries(LineSeries, { ...bollOpts, color: 'rgba(91,141,239,0.7)' });

    // RSI and MACD get their own price scale (0-100 / unbounded-around-0
    // are meaningless on the price axis) squeezed into a thin band near
    // the bottom — a real second lane, just not a fully separate chart pane
    // (lightweight-charts doesn't support stacked panes in one instance).
    const rsiSeries = chart.addSeries(LineSeries, {
      color: '#c084fc',
      lineWidth: 1,
      priceScaleId: 'rsi',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      visible: false,
    });
    rsiSeries.priceScale().applyOptions({ scaleMargins: { top: 0.75, bottom: 0.02 }, visible: false });

    const macdLine = chart.addSeries(LineSeries, {
      color: '#5b8def',
      lineWidth: 1,
      priceScaleId: 'macd',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      visible: false,
    });
    const macdSignal = chart.addSeries(LineSeries, {
      color: '#f7a600',
      lineWidth: 1,
      priceScaleId: 'macd',
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      visible: false,
    });
    const macdHist = chart.addSeries(HistogramSeries, {
      priceScaleId: 'macd',
      priceLineVisible: false,
      lastValueVisible: false,
      visible: false,
    });
    macdLine.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0.02 }, visible: false });

    chartRef.current = chart;
    seriesRef.current = series;
    lineSeriesRef.current = lineSeries;
    areaSeriesRef.current = areaSeries;
    volumeSeriesRef.current = volumeSeries;
    maSeriesRef.current = maSeries;
    bollUpperRef.current = bollUpper;
    bollMiddleRef.current = bollMiddle;
    bollLowerRef.current = bollLower;
    rsiSeriesRef.current = rsiSeries;
    macdLineRef.current = macdLine;
    macdSignalRef.current = macdSignal;
    macdHistRef.current = macdHist;

    const redraw = () => forceRedraw((n) => n + 1);
    chart.timeScale().subscribeVisibleTimeRangeChange(redraw);
    // Native click is also emitted after some touch/pan gestures. Keep a separate
    // gesture guard; pointer movement never triggers network requests or selection.
    const host = containerRef.current;
    let gesture: { x: number; y: number; moved: boolean } | null = null;
    let dragged = false;
    const pointerDown = (event: PointerEvent) => {
      if (!tradingRef.current?.enabled) return;
      if (!event.isPrimary) { dragged = true; if (gesture) gesture.moved = true; return; }
      gesture = { x: event.clientX, y: event.clientY, moved: false }; dragged = false;
    };
    const pointerMove = (event: PointerEvent) => {
      if (gesture && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 5) { gesture.moved = true; dragged = true; }
    };
    const pointerCancel = () => { dragged = true; gesture = null; };
    host.addEventListener('pointerdown', pointerDown, true);
    host.addEventListener('pointermove', pointerMove, true);
    host.addEventListener('pointercancel', pointerCancel, true);

    function handleClick(param: MouseEventParams<Time>) {
      const interaction = tradingRef.current;
      if (interaction?.enabled) {
        if (dragged) return;
        const objectId = param.hoveredInfo?.objectId ?? param.hoveredObjectId;
        if (!interaction.selecting && typeof objectId === 'string' && objectId.startsWith('private-trade:')) {
          const id = objectId.slice('private-trade:'.length).split('|')[0];
          if (interaction.trades.some(trade => trade.id === id && chartSymbol(trade.symbol) === chartSymbol(chartHitRef.current.pair))) interaction.onTradeSelect(id);
          return;
        }
        if (interaction.selecting) {
          const data = param.seriesData.get(series);
          if (!param.point || !data || !('open' in data) || typeof data.time !== 'number') return;
          const candle = candlesRef.current.find(item => item.time === data.time);
          if (!candle) return;
          const pane = chart.paneSize(0);
          const hovered = param.hoveredInfo?.series ?? param.hoveredSeries;
          if (!isCandleHit({ x: param.point.x, y: param.point.y,
            candleX: chart.timeScale().timeToCoordinate(data.time), highY: series.priceToCoordinate(candle.high), lowY: series.priceToCoordinate(candle.low),
            paneWidth: pane.width, paneHeight: pane.height, barSpacing: chart.timeScale().options().barSpacing,
            paneIndex: param.paneIndex, dragged, indicatorHovered: !!hovered && hovered !== series,
            indicatorPanelVisible: chartHitRef.current.showRSI || chartHitRef.current.showMACD })) return;
          const selected = completeChartCandle(candle, chartHitRef.current.pair, chartHitRef.current.interval);
          if (!selected) return;
          const bounds = host.getBoundingClientRect();
          interaction.onCandleSelect({ ...selected, x: bounds.left + param.point.x, y: bounds.top + param.point.y });
          return;
        }
      }
      // A click on bare chart (drawings sit above it and take their own
      // clicks) clears the drawing selection, as in TradingView.
      if (drawingToolsOn) setSelectedDrawing(null);
    }

    chart.subscribeClick(handleClick);
    setChartReady(true);

    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.resize(width, height);
      redraw();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      host.removeEventListener('pointerdown', pointerDown, true);
      host.removeEventListener('pointermove', pointerMove, true);
      host.removeEventListener('pointercancel', pointerCancel, true);
      chart.unsubscribeClick(handleClick);
      privateMarkersRef.current?.detach();
      privateMarkersRef.current = null;
      privateLinesRef.current = [];
      privateLineOwnerRef.current = null;
      chart.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tradingSelection) return;
    cancelGestureRef.current?.();
    setTool('cursor'); setChartType('candles'); setSelectedDrawing(null); setDrawDialog(null);
  }, [tradingSelection]);

  useEffect(() => {
    if (!privateTrading?.enabled || !chartReady || !seriesRef.current) return;
    const series = chartType === 'line' ? lineSeriesRef.current : chartType === 'area' ? areaSeriesRef.current : seriesRef.current;
    if (!series) return;
    const plugin = createSeriesMarkers(series, [], { autoScale: false });
    privateMarkersRef.current = plugin;
    return () => {
      if (privateMarkersRef.current !== plugin) return;
      plugin.detach(); privateMarkersRef.current = null;
      for (const line of privateLinesRef.current) privateLineOwnerRef.current?.removePriceLine(line);
      privateLinesRef.current = [];
      privateLineOwnerRef.current = null;
    };
  }, [chartReady, privateTrading?.enabled, chartType]);

  useEffect(() => {
    if (!privateTrading?.enabled || !chartReady || !seriesRef.current || !privateMarkersRef.current) return;
    const series = seriesRef.current;
    const relevant = privateTrading.trades.filter(trade => chartSymbol(trade.symbol) === chartSymbol(pair));
    const markers: SeriesMarker<Time>[] = [];
    for (const trade of relevant) {
      const selected = trade.id === privateTrading.selectedTradeId;
      const time = chartEventBar(candlesRef.current, chartEntryAnchor(trade), interval);
      if (time !== null) markers.push({ time: time as Time, id: `private-trade:${trade.id}|entry`, position: trade.side === 'LONG' ? 'belowBar' : 'aboveBar',
        shape: trade.side === 'LONG' ? 'arrowUp' : 'arrowDown', color: selected ? '#f0b90b' : trade.side === 'LONG' ? '#00c79a' : '#ff5278', size: selected ? 1.3 : 1,
        text: `${trade.side === 'LONG' ? 'Long' : 'Short'} ${trade.leverage}× · ${formatDrawingPrice(trade.entryPrice)}` });
      trade.exits.forEach((exit, index) => {
        const exitTime = chartEventBar(candlesRef.current, exit.candleOpenTime ?? exit.time, interval);
        if (exitTime === null) return;
        const liquidated = /LIQUID/i.test(exit.kind);
        markers.push({ time: exitTime as Time, id: `private-trade:${trade.id}|exit:${index}`, position: trade.side === 'LONG' ? 'aboveBar' : 'belowBar',
          shape: 'circle', color: liquidated ? '#ff5278' : '#b8c9df', size: 1,
          text: `${liquidated ? 'LIQ' : /PARTIAL/i.test(exit.kind) ? '½' : '×'} ${formatDrawingPrice(exit.price)}` });
      });
    }
    markers.sort((a, b) => Number(a.time) - Number(b.time));
    privateMarkersRef.current.setMarkers(markers);
    for (const line of privateLinesRef.current) privateLineOwnerRef.current?.removePriceLine(line);
    privateLinesRef.current = [];
    const visibleSeries = chartType === 'line' ? lineSeriesRef.current : chartType === 'area' ? areaSeriesRef.current : series;
    privateLineOwnerRef.current = visibleSeries;
    for (const trade of relevant.filter(t => t.status === 'OPEN')) {
      if (visibleSeries && Number.isFinite(trade.entryPrice) && trade.entryPrice > 0) {
        privateLinesRef.current.push(visibleSeries.createPriceLine({price:trade.entryPrice,title:'',color:trade.side==='LONG'?'#13ad75':'#f33b57',lineWidth:1,lineStyle:LineStyle.Dotted,axisLabelVisible:true}));
      }
    }
    for (const protectedTrade of relevant.filter(trade => trade.status === 'OPEN')) {
      const addLine = (price: number | null | undefined, title: string, color: string, style: LineStyle) => {
        if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return;
        if (visibleSeries) privateLinesRef.current.push(visibleSeries.createPriceLine({ price, title, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true }));
      };
      addLine(protectedTrade.takeProfit, 'TP', '#00c79a', LineStyle.Dashed);
      addLine(protectedTrade.stopLoss, 'SL', '#ff5278', LineStyle.Dashed);
      addLine(protectedTrade.liquidationPrice, 'LIQ', '#d67ad8', LineStyle.Dotted);
    }
  }, [privateTrading, chartReady, candlesRevision, pair, interval, chartType]);

  // Near-live marks/position overlays cannot invalidate historical OHLC.
  // Reapply the existing selected-bar colors only when candles or the selected
  // bar change. In particular, book ticks and PnL updates do not call setData.
  const selectedCandleSymbol = privateTrading?.selectedCandle?.symbol;
  const selectedCandleTime = privateTrading?.selectedCandle?.openTime;
  useEffect(() => {
    if (!privateTrading?.enabled || !chartReady || !seriesRef.current) return;
    const selectedTime = selectedCandleSymbol && selectedCandleTime !== undefined && chartSymbol(selectedCandleSymbol) === chartSymbol(pair)
      ? chartEventBar(candlesRef.current, selectedCandleTime, interval) : null;
    seriesRef.current.setData(candlesRef.current.map(candle => ({ time: candle.time as Time, open: candle.open, high: candle.high, low: candle.low, close: candle.close,
      ...(candle.time === selectedTime ? { color: '#61b9ff', borderColor: '#b8e2ff', wickColor: '#b8e2ff' } : {}) })));
  }, [privateTrading?.enabled, selectedCandleSymbol, selectedCandleTime, chartReady, candlesRevision, pair, interval]);

  // Picking a drawing tool leaves the selection; the layer itself drops any
  // half-placed anchors on a tool, pair or visibility change.
  useEffect(() => {
    if (!CURSOR_TOOLS.includes(tool)) setSelectedDrawing(null);
  }, [tool, pair]);

  // The cursor modes, as TradingView's: a cross shows the crosshair lines,
  // a dot and an arrow hide them (the dot is painted by the drawing layer).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !drawingToolsOn || !terminal) return;
    const lines = tool !== 'dot' && tool !== 'arrowcursor';
    chart.applyOptions({ crosshair: { vertLine: { visible: lines }, horzLine: { visible: lines } } });
  }, [tool, drawingToolsOn, terminal, chartReady]);

  // TradingView's keyboard shortcuts for the common tools.
  useEffect(() => {
    if (!drawingToolsOn) return;
    const keys: Record<string, Tool> = { KeyT: 'trendline', KeyH: 'horizontal', KeyJ: 'ray', KeyV: 'vertical', KeyC: 'crossline', KeyF: 'fib' };
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (!event.altKey || event.ctrlKey || event.metaKey || (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName))) return;
      const next = event.shiftKey ? (event.code === 'KeyR' ? 'rectangle' : null) : keys[event.code];
      if (!next || lockedRef.current) return;
      event.preventDefault();
      setDrawingsHidden(false);
      setTool(next);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawingToolsOn]);

  // Spot gestures cannot survive a tool, instrument or timeframe change,
  // Clear, Escape, focus loss or an unmount and then commit stale anchors.
  useEffect(() => {
    if (!drawingToolsOn) return;
    setDrawDialog(null);
    return () => cancelGestureRef.current?.();
  }, [drawingToolsOn, tool, pair, interval]);

  useEffect(() => {
    if (!drawingToolsOn) return;
    for (const line of priceLinesRef.current) {
      line.applyOptions({ lineVisible: !drawingsHidden, axisLabelVisible: !drawingsHidden });
    }
  }, [drawingToolsOn, drawingsHidden]);

  // Esc abandons whatever is in progress and drops back to the cursor —
  // the same escape hatch every charting package gives you, and the reason
  // a half-drawn trend line can never trap the pointer in drawing mode.
  // Bound to the window because the drag listeners are too, and a drag can
  // legitimately be outside the chart when Esc is pressed.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (tradingRef.current?.selecting) tradingRef.current.onCancelSelection();
      setSelectedDrawing(null);
      setTool('cursor');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Called the moment a shape is committed. With stay-in-drawing-mode off
  // the tool releases back to the cursor, exactly one shape per selection,
  // and — as in TradingView — the new drawing comes up selected.
  const finishDrawing = useCallback((drawing?: ChartDrawing) => {
    if (stayInDrawModeRef.current) return;
    setTool('cursor');
    if (drawing) setSelectedDrawing(drawing.id);
  }, []);

  // Drawings are per-pair — a trend line drawn on BTC/USDT shouldn't show
  // up on ETH/USDT. Native price lines also need explicit cleanup since
  // they live on the series object, not React state.
  useEffect(() => {
    setDrawings([]);
    setSelectedDrawing(null);
  }, [pair]);

  const clearDrawings = useCallback(() => {
    if (drawingToolsOn && lockedRef.current) return;
    if (drawingToolsOn) cancelGestureRef.current?.();
    // Every drawing, horizontal levels included — the one effect that owns
    // the native price lines then removes theirs. Orders are never touched.
    setDrawings([]);
    setSelectedDrawing(null);
  }, [drawingToolsOn]);

  const clearAll = useCallback(() => {
    // Only local drawing objects are cleared, never conditional orders.
    // Locked drawings cannot be cleared, which is the whole point of the
    // lock — the confirmation is not even offered.
    if (drawingToolsOn && locked) return;
    if (drawingToolsOn) {
      cancelGestureRef.current?.();
      setDrawDialog({ kind: 'clear' });
      return;
    }
    if (window.confirm(confirmClearRef.current)) clearDrawings();
  }, [drawingToolsOn, clearDrawings, locked]);

  /**
   * THE POSITION OVERLAY: entry, take profit, stop loss, liquidation.
   *
   * Every one of these four is a figure the SERVER holds. Entry and the
   * liquidation boundary arrive on /futures/positions; the two protection
   * levels are the triggers `FuturesProtectionService` has armed, which is
   * why a level typed into the positions editor and not yet saved draws
   * nothing here. A line on a price scale reads as a commitment, and a
   * commitment nobody made is the one thing this overlay must not draw.
   *
   * NO LIQUIDATION LINE WHEN THE PRICE IS NULL. `null` is the engine
   * saying no liquidation price is reachable with the account's current
   * collateral — a fully hedged Cross position, or one the whole balance
   * backs. `previewLiquidationPrice` in lib/futuresMath could always
   * produce SOME number, and that is exactly why it is not consulted: it
   * is a form-time estimate for an order that does not exist yet, not the
   * boundary this position will actually be closed at.
   *
   * One effect owns the whole lifecycle, same discipline as `horizontals`
   * below: it removes every line it previously made and recreates them, so
   * the chart objects and the data can never drift apart.
   */
  useEffect(() => {
    const visible = chartType === 'line' ? lineSeriesRef.current
      : chartType === 'area' ? areaSeriesRef.current : seriesRef.current;
    const previousOwner = positionLineOwnerRef.current;
    for (const line of positionLinesRef.current) previousOwner?.removePriceLine(line);
    positionLinesRef.current = [];
    positionLineOwnerRef.current = visible;
    if (!chartReady || !visible || !positionLines?.length) return;

    const here = positionLines.filter(p => chartSymbol(p.symbol) === chartSymbol(pair));
    const add = (raw: string | null, title: string, color: string, style: LineStyle) => {
      if (raw === null) return;
      const price = Number(raw);
      if (!Number.isFinite(price) || price <= 0) return;
      positionLinesRef.current.push(visible.createPriceLine({
        price, title, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true,
      }));
    };
    for (const position of here) {
      // Entry carries the direction in its colour, the way the positions
      // table does — the line is the position, so it should read as one.
      add(position.entryPrice, position.side === 'LONG' ? 'Long' : 'Short',
        position.side === 'LONG' ? '#13ad75' : '#f33b57', LineStyle.Solid);
      add(position.takeProfit, 'TP', '#00c79a', LineStyle.Dashed);
      add(position.stopLoss, 'SL', '#ff5278', LineStyle.Dashed);
      add(position.liquidationPrice, 'LIQ', '#d67ad8', LineStyle.Dotted);
    }
    return () => {
      for (const line of positionLinesRef.current) positionLineOwnerRef.current?.removePriceLine(line);
      positionLinesRef.current = [];
    };
  }, [positionLines, chartReady, chartType, pair]);

  /**
   * Native price lines, derived from `horizontals`.
   *
   * One effect owns their whole lifecycle: it removes every line it
   * previously created and recreates them from state. That keeps the
   * chart objects and the serializable data from drifting apart, which is
   * what made horizontals unsaveable before.
   */
  const horizontals = drawings.filter((d) => d.kind === 'horizontal');
  const horizontalsKey = horizontals.map((d) => `${d.points[0].price}|${JSON.stringify(drawingStyle(d))}`).join(';');
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of priceLinesRef.current) series.removePriceLine(line);
    priceLinesRef.current = [];
    if (drawingsHidden) return;
    for (const level of horizontals) {
      const style = drawingStyle(level);
      const price = level.points[0].price;
      priceLinesRef.current.push(
        series.createPriceLine({
          price,
          color: style.color,
          lineWidth: Math.max(1, Math.min(4, style.width)) as 1 | 2 | 3 | 4,
          lineStyle: style.dash === 'dashed' ? LineStyle.Dashed : style.dash === 'dotted' ? LineStyle.Dotted : LineStyle.Solid,
          axisLabelVisible: true,
          title: drawingToolsOn ? formatDrawingPrice(price) : price.toFixed(2),
        })
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [horizontalsKey, drawingsHidden, drawingToolsOn, chartReady]);

  // ── Persistence ────────────────────────────────────────────────────
  //
  // Saved per market AND per symbol, so BTC drawings can never appear on
  // ETH. NOT per timeframe: every point below is a real (time, price)
  // pair, so the same drawing is the same drawing on 15m and on 1d, and
  // keying by timeframe would hide a trader's own levels on a zoom change.

  const storageKey = drawingToolsOn ? drawingStorageKey(market, pair) : null;
  /**
   * The key the CURRENT drawing state belongs to.
   *
   * Deliberately state, not a ref. On a symbol switch the load effect
   * queues ten state updates and then marks the key; a ref would be set
   * synchronously, so the save effect could run in that same commit with
   * the NEW key and the OLD symbol's drawings still in state — writing
   * BTC's levels into ETH's slot. Keeping it in state means the marker
   * lands in the same batch as the drawings it describes, so the save
   * effect never sees one without the other.
   */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  /** Everything currently on the chart, in the serializable form. */
  const collectDrawings = useCallback((): StoredDrawing[] =>
    drawings.map(({ id: _id, ...stored }) => stored), [drawings]);

  /** Load whatever was saved for this market+symbol, replacing the lot. */
  useEffect(() => {
    if (!storageKey) return;
    setLoadedKey(null);
    let stored;
    try {
      stored = parseStoredDrawings(window.localStorage.getItem(storageKey));
    } catch {
      // A browser with storage disabled is a working chart without
      // persistence, not a broken one.
      stored = parseStoredDrawings(null);
    }
    setDrawings(stored.drawings.map((d) => ({ ...d, id: newDrawingId() })));
    setSelectedDrawing(null);
    setDrawingsHidden(stored.hidden);
    setLocked(stored.locked);
    setLoadedKey(storageKey);
  }, [storageKey]);

  /** Save on every change, once this key's load has completed. */
  useEffect(() => {
    if (!storageKey || loadedKey !== storageKey) return;
    try {
      window.localStorage.setItem(storageKey, serializeDrawings({ drawings: collectDrawings(), hidden: savedHidden, locked: savedLocked }));
    } catch {
      // Quota or a privacy mode that refuses writes. The chart keeps
      // working; only persistence is lost, and silently is correct here.
    }
  }, [storageKey, loadedKey, collectDrawings, savedHidden, savedLocked]);

  const fitContent = useCallback(() => {
    chartRef.current?.timeScale().fitContent();
  }, []);

  // Load candles whenever pair/interval changes, and poll for updates.
  useEffect(() => {
    let cancelled = false;
    // Only set the initial visible range once per pair/interval — every
    // later poll must leave the user's own pan/zoom alone.
    let hasSetInitialRange = false;
    let loading = false;
    let controller: AbortController | null = null;
    let historyController: AbortController | null = null;
    let historyLoading = false;
    let historyEnd = false;
    let historicalWindow = false;
    let suppressBackfill = false;
    let backfillTimer: ReturnType<typeof setTimeout> | undefined;
    const privateMode = !!privateTrading?.enabled && !!candleLoader;
    const clearSeries = () => {
      for (const ref of [seriesRef,volumeSeriesRef,lineSeriesRef,areaSeriesRef,maSeriesRef,bollUpperRef,bollMiddleRef,bollLowerRef,rsiSeriesRef,macdLineRef,macdSignalRef,macdHistRef]) ref.current?.setData([]);
      candlesRef.current=[];
      setEmpty(true);
      if (privateMode) setCandlesRevision(value => value + 1);
    };
    /**
     * WHICH SERIES IS ON SCREEN — not which function fetched it.
     *
     * This effect re-runs whenever `candleLoader` or `privateTrading.enabled`
     * changes, and at cold open both change exactly once, as the native
     * binding resolves from unknown to owner. Clearing unconditionally here
     * therefore wiped a chart that had already painted perfectly good futures
     * candles, purely because the function fetching them had been swapped —
     * and whatever ran next was left staring at a canvas it had emptied
     * itself. If the replacement request was then slow, superseded again, or
     * failed, the blank simply stayed. That is the intermittent blank chart.
     *
     * Candles only go stale when the INSTRUMENT changes, so that is the only
     * thing that clears them. BTC->ETH and 1h->15m still wipe first, which is
     * what stops one instrument's bars being shown under another's name.
     */
    const seriesKey = `${market}|${pair}|${interval}`;
    if (paintedSeriesRef.current !== seriesKey) {
      clearSeries();
      paintedSeriesRef.current = seriesKey;
    }
    setLoadFailed(false);

    function display(res: { candles: Candle[] }) {
        if (cancelled || !seriesRef.current || !volumeSeriesRef.current) return;
        setEmpty(res.candles.length === 0);
        if (spotChartRefinements || candleLoader) {
          const priceFormat = spotChartPriceFormat(res.candles);
          // All series sharing the price axis need the same formatter, even
          // when candles are hidden by Line/Area or an indicator toggle.
          // Volume, RSI and MACD keep their own existing scale semantics.
          if (priceFormat) for (const ref of [seriesRef, lineSeriesRef, areaSeriesRef, maSeriesRef, bollUpperRef, bollMiddleRef, bollLowerRef]) {
            const previous = ref.current?.options().priceFormat;
            if (previous?.type !== 'price' || previous.precision !== priceFormat.precision || previous.minMove !== priceFormat.minMove) {
              ref.current?.applyOptions({ priceFormat });
            }
          }
        }
        seriesRef.current.setData(
          res.candles.map((c) => ({ time: c.time as any, open: c.open, high: c.high, low: c.low, close: c.close }))
        );
        volumeSeriesRef.current.setData(
          res.candles.map((c) => ({
            time: c.time as any,
            value: c.volume,
            color: c.close >= c.open ? 'rgba(234,236,239,0.5)' : 'rgba(247,166,0,0.5)',
          }))
        );
        maSeriesRef.current?.setData(computeSMA(res.candles, MA_PERIOD) as any);

        // Cache for the line/area chart-type swap and indicator toggles
        // below — all computed eagerly here (cheap, pure math) so flipping
        // a toggle is an instant visible-flag flip, not a recompute wait.
        candlesRef.current = res.candles;
        const closeLine = res.candles.map((c) => ({ time: c.time as any, value: c.close }));
        lineSeriesRef.current?.setData(closeLine as any);
        areaSeriesRef.current?.setData(closeLine as any);

        const boll = computeBollingerBands(res.candles);
        bollUpperRef.current?.setData(boll.upper as any);
        bollMiddleRef.current?.setData(boll.middle as any);
        bollLowerRef.current?.setData(boll.lower as any);

        rsiSeriesRef.current?.setData(computeRSI(res.candles) as any);

        const macd = computeMACD(res.candles, 12, 26, 9, { warmupFromValidMacd: spotChartRefinements });
        macdLineRef.current?.setData(macd.macd as any);
        macdSignalRef.current?.setData(macd.signal as any);
        macdHistRef.current?.setData(macd.histogram as any);

        if (!hasSetInitialRange && chartRef.current) {
          hasSetInitialRange = true;
          if (res.candles.length > VISIBLE_CANDLES) {
            // Show only the most recent VISIBLE_CANDLES bars — every one
            // of them sits past the MA's 200-bar warm-up, so the line
            // spans the full visible width instead of trailing off partway.
            chartRef.current.timeScale().setVisibleLogicalRange({
              from: res.candles.length - VISIBLE_CANDLES,
              to: res.candles.length - 1,
            });
          } else {
            chartRef.current.timeScale().fitContent();
          }
        }

        forceRedraw((n) => n + 1);
        if (privateMode) setCandlesRevision(value => value + 1);
    }

    async function load() {
      if (loading || historyLoading || historicalWindow || (typeof document !== 'undefined' && document.hidden)) return;
      loading=true;
      const requestController = new AbortController();
      controller=requestController;
      // Distinguishes OUR deadline from every other reason a request aborts.
      // A supersession and a timeout both surface as `signal.aborted`, but one
      // is bookkeeping and the other is a failure the user needs told about.
      let timedOut = false;
      const timeout=setTimeout(()=>{timedOut=true;requestController.abort();},12000);
      try {
        const res = candleLoader ? await candleLoader(pair, interval, CANDLE_FETCH_LIMIT,requestController.signal)
          : await api.getExternalCandles(pair, interval, CANDLE_FETCH_LIMIT);
        // `controller` is the newest request. If it is no longer this one, a
        // later request owns the chart and this answer is history.
        if (cancelled || controller !== requestController) return;
        display(privateMode ? { candles: mergeChartCandles(candlesRef.current, res.candles) } : res);
        setLoadFailed(false);
      } catch {
        // A superseded or cleanup-aborted request is not evidence of anything.
        // It must never clear candles and never raise an error over a chart
        // that is perfectly fine.
        if (cancelled || controller !== requestController) return;
        if (requestController.signal.aborted && !timedOut) return;
        // Last good wins: bars already on screen stay on screen through a
        // failed tail refresh. Only a chart with nothing to show reports the
        // failure, and it says so out loud instead of leaving a silent blank.
        if (!candlesRef.current.length) { clearSeries(); setLoadFailed(true); }
      } finally {
        clearTimeout(timeout);
        loading=false;
      }
    }

    async function history(targetTime?: number) {
      if (!privateMode || !candleLoader || cancelled || !chartRef.current) return;
      const scale = chartRef.current.timeScale();
      if (targetTime !== undefined) {
        const existing = chartEventBar(candlesRef.current, targetTime, interval);
        if (existing !== null) {
          const index = candlesRef.current.findIndex(candle => candle.time === existing);
          suppressBackfill = true;
          scale.setVisibleLogicalRange({ from: Math.max(0, index - 70), to: index + 90 });
          suppressBackfill = false;
          return;
        }
        historyController?.abort();
      } else if (historyLoading || historyEnd || !candlesRef.current.length || candlesRef.current.length >= 10000) {
        return;
      }
      controller?.abort();
      const requestController = new AbortController();
      historyController = requestController;
      historyLoading = true;
      const timeout = setTimeout(() => requestController.abort(), 12000);
      const range = scale.getVisibleLogicalRange();
      const firstTime = candlesRef.current[0]?.time;
      const endTime = targetTime === undefined ? firstTime * 1000 - 1 : Math.min(Date.now(), targetTime + CHART_INTERVAL_MS[interval] * 120);
      try {
        const res = await candleLoader(pair, interval, CANDLE_FETCH_LIMIT, requestController.signal, endTime);
        if (cancelled || requestController.signal.aborted) return;
        if (!res.candles.length) { historyEnd = true; return; }
        const data = targetTime === undefined ? mergeChartCandles(res.candles, candlesRef.current) : res.candles;
        const added = firstTime === undefined ? 0 : data.filter(candle => candle.time < firstTime).length;
        if (targetTime === undefined && added === 0) { historyEnd = true; return; }
        suppressBackfill = true;
        hasSetInitialRange = true;
        display({ candles: data });
        if (targetTime !== undefined) {
          historicalWindow = data[data.length - 1].time * 1000 + CHART_INTERVAL_MS[interval] < Date.now();
          historyEnd = false;
          const time = chartEventBar(data, targetTime, interval);
          if (time === null) return;
          const index = data.findIndex(candle => candle.time === time);
          scale.setVisibleLogicalRange({ from: Math.max(0, index - 70), to: index + 90 });
        } else if (range) scale.setVisibleLogicalRange({ from: range.from + added, to: range.to + added });
      } catch {
        // Nothing older to show is not an error worth words. The initial
        // load has its own visible failure state; this is only backfill.
      } finally {
        suppressBackfill = false;
        clearTimeout(timeout);
        if (historyController === requestController) historyLoading = false;
      }
    }
    const onRangeChange = (range: { from: number; to: number } | null) => {
      if (!privateMode || !range || range.from > 30 || !hasSetInitialRange || suppressBackfill || historyLoading || loading || historyEnd) return;
      clearTimeout(backfillTimer);
      backfillTimer = setTimeout(() => { void history(); }, 180);
    };
    if (privateMode) {
      privateHistoryRef.current = async time => {
        if (time === 0) { historicalWindow = false; hasSetInitialRange = false; historyEnd = false; historyController?.abort(); historyLoading = false; clearSeries(); await load(); }
        else await history(time);
      };
      chartRef.current?.timeScale().subscribeVisibleLogicalRangeChange(onRangeChange);
    }

    retryCandlesRef.current = () => { setLoadFailed(false); void load(); };
    load();
    const poll = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      retryCandlesRef.current = null;
      controller?.abort();
      historyController?.abort();
      clearTimeout(backfillTimer);
      if (privateMode) {
        privateHistoryRef.current = null;
        chartRef.current?.timeScale().unsubscribeVisibleLogicalRangeChange(onRangeChange);
      }
      window.clearInterval(poll);
    };
  }, [pair, interval, drawingToolsOn, spotChartRefinements, candleLoader, privateTrading?.enabled]);

  useEffect(() => {
    if (!privateTrading?.enabled || !privateTrading.focus || !chartReady) return;
    const trade = privateTrading.trades.find(item => item.id === privateTrading.focus?.tradeId && chartSymbol(item.symbol) === chartSymbol(pair));
    if (trade) void privateHistoryRef.current?.(chartEntryAnchor(trade));
  }, [privateTrading?.focus?.sequence, privateTrading?.enabled, chartReady, pair, interval]);

  // Poll this pair's pending SL/TP orders — cheap enough at 4s, same
  // cadence OpenOrdersPanel already polls at. Spot only: see
  // `spotConditionalOrders` above.
  useEffect(() => {
    if (!spotConditionalOrders) {
      // No request, no timer. Also drop anything a previous spot context
      // left behind, so a chart that is no longer spot cannot keep drawing
      // spot lines. Functional update: no extra render when already empty,
      // and no dependency on the value being cleared.
      setConditionalOrders((previous) => (previous.length === 0 ? previous : []));
      return;
    }
    let cancelled = false;
    function load() {
      api
        .getMyOrders('PENDING_TRIGGER')
        .then((orders) => {
          if (cancelled) return;
          setConditionalOrders(
            orders
              .filter((o) => o.pair === pair)
              .map((o) => ({ id: o.id, side: o.side, type: o.type, triggerPrice: o.triggerPrice, price: o.price, ocoGroupId: o.ocoGroupId }))
          );
        })
        .catch(() => {});
    }
    load();
    const poll = window.setInterval(load, 4000);
    return () => {
      // `cancelled` covers the stale-response case without relying on the
      // router remounting: leaving spot re-runs this effect, the cleanup
      // fires first, and a request already in the air can no longer commit.
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [pair, spotConditionalOrders]);

  // Swap which price series is visible — candlestick stays the permanent
  // coordinate-conversion authority (see the comment on seriesRef above),
  // this only flips which one is drawn.
  useEffect(() => {
    seriesRef.current?.applyOptions({ visible: chartType === 'candles' });
    lineSeriesRef.current?.applyOptions({ visible: chartType === 'line' });
    areaSeriesRef.current?.applyOptions({ visible: chartType === 'area' });
  }, [chartType]);

  useEffect(() => {
    maSeriesRef.current?.applyOptions({ visible: showMA });
  }, [showMA]);

  useEffect(() => {
    bollUpperRef.current?.applyOptions({ visible: showBollinger });
    bollMiddleRef.current?.applyOptions({ visible: showBollinger });
    bollLowerRef.current?.applyOptions({ visible: showBollinger });
  }, [showBollinger]);

  useEffect(() => {
    rsiSeriesRef.current?.applyOptions({ visible: showRSI });
    rsiSeriesRef.current?.priceScale().applyOptions({ visible: showRSI });
  }, [showRSI]);

  useEffect(() => {
    macdLineRef.current?.applyOptions({ visible: showMACD });
    macdSignalRef.current?.applyOptions({ visible: showMACD });
    macdHistRef.current?.applyOptions({ visible: showMACD });
    macdLineRef.current?.priceScale().applyOptions({ visible: showMACD });
  }, [showMACD]);

  const priceToY = useCallback((price: number): number | null => {
    const y = seriesRef.current?.priceToCoordinate(price);
    return y === null || y === undefined ? null : y;
  }, []);

  const yToPrice = useCallback((y: number): number | null => {
    const price = seriesRef.current?.coordinateToPrice(y);
    return price === null || price === undefined ? null : price;
  }, []);

  const startDrag = useCallback(
    (order: ConditionalOrder, e: React.MouseEvent) => {
      // Belt and braces: the lines are not rendered off spot, so there is
      // nothing to grab — but this makes `api.updateOrderTrigger` provably
      // unreachable from a non-spot chart rather than merely unreached.
      if (!spotConditionalOrders) return;
      e.preventDefault();
      const triggerPrice = parseFloat(order.triggerPrice ?? order.price ?? '0');
      draggingRef.current = {
        id: order.id,
        startPrice: triggerPrice,
        startTriggerPrice: triggerPrice,
        startExecPrice: order.price ? parseFloat(order.price) : null,
      };
      setDraggingOrderId(order.id);
      setDragPrice(triggerPrice);

      const container = containerRef.current;
      function handleMove(ev: MouseEvent) {
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const price = yToPrice(ev.clientY - rect.top);
        if (price !== null) setDragPrice(price);
      }
      async function handleUp(ev: MouseEvent) {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
        const drag = draggingRef.current;
        draggingRef.current = null;
        setDraggingOrderId(null);
        setDragPrice(null);
        if (!drag || !container) return;
        const rect = container.getBoundingClientRect();
        const newTriggerPrice = yToPrice(ev.clientY - rect.top);
        if (newTriggerPrice === null) return;
        try {
          const payload: { triggerPrice: string; price?: string } = { triggerPrice: newTriggerPrice.toFixed(8) };
          // Keep the trigger-to-execution gap constant (same slippage
          // protection the trader originally set) rather than snapping the
          // limit price to match the new trigger exactly.
          if (drag.startExecPrice !== null) {
            const gap = drag.startExecPrice - drag.startTriggerPrice;
            payload.price = (newTriggerPrice + gap).toFixed(8);
          }
          await api.updateOrderTrigger(drag.id, payload);
        } catch {
          // Refetch either way below — on failure this just snaps the line
          // back to its last confirmed server position instead of a stale
          // optimistic one.
        }
        api
          .getMyOrders('PENDING_TRIGGER')
          .then((orders) => {
            // A drag that started on spot can still be resolving when the
            // chart is no longer spot. Dropping it here keeps the same
            // guarantee the poll's `cancelled` flag gives.
            if (!spotConditionalOrders) return;
            setConditionalOrders(
              orders
                .filter((o) => o.pair === pair)
                .map((o) => ({ id: o.id, side: o.side, type: o.type, triggerPrice: o.triggerPrice, price: o.price, ocoGroupId: o.ocoGroupId }))
            );
          })
          .catch(() => {});
      }
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    },
    [pair, yToPrice, spotConditionalOrders]
  );

  // ── Drawing coordinates ────────────────────────────────────────────
  //
  // Anchors are (time, price). Times inside the loaded history land on
  // their bar; times past either end extrapolate by the interval, so a
  // drawing can reach into the future to the right of the last candle —
  // the way TradingView lets a ray, a range or a position box run there.

  /** A bar time → logical index, fractional between bars, extrapolated outside them. */
  function timeToLogical(time: number): number | null {
    const candles = candlesRef.current;
    const step = INTERVAL_SECONDS[interval];
    if (!candles.length || !step) return null;
    const first = candles[0].time, lastIndex = candles.length - 1, last = candles[lastIndex].time;
    if (time >= last) return lastIndex + (time - last) / step;
    if (time <= first) return (time - first) / step;
    let lo = 0, hi = lastIndex;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (candles[m].time <= time) lo = m; else hi = m; }
    const span = candles[hi].time - candles[lo].time;
    return lo + (span > 0 ? (time - candles[lo].time) / span : 0);
  }

  /** A logical index → the time of that bar, real or projected. */
  function logicalToTime(logical: number): number | null {
    const candles = candlesRef.current;
    const step = INTERVAL_SECONDS[interval];
    if (!candles.length || !step) return null;
    const index = Math.round(logical);
    const lastIndex = candles.length - 1;
    if (index > lastIndex) return candles[lastIndex].time + (index - lastIndex) * step;
    if (index < 0) return candles[0].time + index * step;
    return candles[index].time;
  }

  /** The projection the drawing layer paints and hit-tests through. */
  const drawingView: DrawingView | null = (() => {
    const chart = chartRef.current;
    const series = seriesRef.current;
    const container = containerRef.current;
    if (!chart || !series || !container || !chartReady) return null;
    const minMove = (series.options().priceFormat as { minMove?: number }).minMove;
    return {
      x: (time) => {
        const logical = timeToLogical(time);
        return logical === null ? null : chart.timeScale().logicalToCoordinate(logical as never);
      },
      y: (price) => series.priceToCoordinate(price),
      width: chart.timeScale().width(),
      height: container.clientHeight,
      lang,
      range: (a, b) => drawingRange(a, b, candlesRef.current, INTERVAL_SECONDS[interval], minMove),
    };
  })();

  /**
   * Container pixels → a chart point, on a bar. With the magnet on, the
   * point snaps to the nearest real OHLC level — always for the strong
   * magnet, only within reach for the weak one. The magnet never invents
   * a level: with no candles loaded the point passes through untouched.
   */
  function drawingPointAt(x: number, y: number, snap: boolean): Point | null {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return null;
    const logical = chart.timeScale().coordinateToLogical(x);
    const price = series.coordinateToPrice(y);
    const time = logical === null ? null : logicalToTime(logical as unknown as number);
    if (time === null || price === null) return null;
    const raw = { time, price };
    if (!snap || !drawingToolsOn || !magnetRef.current) return raw;
    const snapped = magnetSnap(raw, candlesRef.current);
    if (magnetModeRef.current === 'weak') {
      const levelY = series.priceToCoordinate(snapped.price);
      if (levelY === null || Math.abs(levelY - y) > WEAK_MAGNET_PX) return raw;
    }
    return { time: snapped.time, price: snapped.price };
  }

  /** A click with the long/short tool: entry at the click, TradingView's
   *  default 1:2 box — stop a tenth of the visible price range away, the
   *  target twice that — and twenty bars wide. */
  function positionPoints(entry: Point, kind: 'long' | 'short'): Point[] {
    const series = seriesRef.current;
    const container = containerRef.current;
    const top = series && container ? series.coordinateToPrice(0) : null;
    const bottom = series && container ? series.coordinateToPrice(container.clientHeight) : null;
    const visible = top !== null && bottom !== null ? Math.abs(top - bottom) : entry.price * 0.05;
    const risk = visible / 10 || entry.price * 0.01;
    const sign = kind === 'long' ? 1 : -1;
    const end = entry.time + 20 * INTERVAL_SECONDS[interval];
    return [entry, { time: end, price: entry.price + sign * risk * 2 }, { time: end, price: entry.price - sign * risk }];
  }

  /** The zoom tool: the dragged time span fills the chart. */
  function zoomTo(x1: number, x2: number) {
    const scale = chartRef.current?.timeScale();
    const from = scale?.coordinateToLogical(Math.min(x1, x2));
    const to = scale?.coordinateToLogical(Math.max(x1, x2));
    if (scale && from != null && to != null && to > from) scale.setVisibleLogicalRange({ from, to });
    setTool('cursor');
  }

  const intervalButtons = INTERVALS.map((i) => (
    <button
      key={i}
      type="button"
      aria-pressed={interval === i}
      onClick={() => { if (tradingRef.current?.selecting) tradingRef.current.onCancelSelection(); setInterval_(i); }}
      className={terminal ? `chart-tab ${interval === i ? 'active' : ''}` : undefined}
      style={terminal ? undefined : { ...styles.intervalBtn, ...(interval === i ? styles.intervalBtnActive : {}) }}
    >
      {i}
    </button>
  ));

  const typeButtons = (
    [
      ['candles', t('chart.type.candles')],
      ['line', t('chart.type.line')],
      ['area', t('chart.type.area')],
    ] as [ChartType, string][]
  ).map(([ct, label]) => (
    <button
      key={ct}
      type="button"
      aria-pressed={chartType === ct}
      onClick={() => { if (tradingRef.current?.selecting && ct !== 'candles') tradingRef.current.onCancelSelection(); setChartType(ct); }}
      className={terminal ? `chart-tool-btn ${chartType === ct ? 'active' : ''}` : undefined}
      style={terminal ? undefined : { ...styles.intervalBtn, ...(chartType === ct ? styles.intervalBtnActive : {}) }}
    >
      {label}
    </button>
  ));

  const indicatorButtons = (
    [
      ['ma', showMA, setShowMA, INDICATOR_COLORS.ma, t('chart.indicator.ma')],
      ['bollinger', showBollinger, setShowBollinger, INDICATOR_COLORS.bollinger, t('chart.indicator.bollinger')],
      ['rsi', showRSI, setShowRSI, INDICATOR_COLORS.rsi, t('chart.indicator.rsi')],
      ['macd', showMACD, setShowMACD, INDICATOR_COLORS.macd, t('chart.indicator.macd')],
    ] as [string, boolean, (v: boolean) => void, string, string][]
  ).map(([key, active, setter, color, label]) => (
    <button
      key={key}
      type="button"
      aria-pressed={active}
      onClick={() => setter(!active)}
      className={terminal ? `chart-tool-btn ${active ? 'active' : ''}` : undefined}
      style={
        terminal
          ? undefined
          : {
              ...styles.indicatorToggle,
              ...(active ? styles.indicatorToggleActive : {}),
              color: active ? color : 'var(--text-secondary)',
            }
      }
    >
      {!terminal && <span style={{ ...styles.indicatorDot, background: color, opacity: active ? 1 : 0.35 }} />}
      {label}
    </button>
  ));

  return (
    <div className={drawingToolsOn ? 'drawing-tools' : undefined} data-chart-trade-selecting={tradingSelection || undefined} style={terminal ? TERMINAL_WRAPPER : styles.wrapper}>
      {terminal ? (
        <div className="chart-toolbar" data-mobile-tools={mobileToolsOpen}>
          <div className="chart-tabs" role="group" aria-label={t('chart.group.timeframe')}>{intervalButtons}{privateTrading?.enabled && <button type="button" className="chart-history-now" onClick={() => void privateHistoryRef.current?.(0)}>{lang === 'ru' ? 'Сейчас' : 'Now'}</button>}</div>
          <button type="button" className="futures-mobile-tools-toggle" aria-label={t('chart.group.indicators')}
            aria-expanded={mobileToolsOpen} onClick={() => setMobileToolsOpen(open => !open)}>•••</button>
          <div className="chart-tools">
            <div className="chart-type-group" role="group" aria-label={t('chart.group.type')}>{typeButtons}</div>
            <div className="chart-indicator-group" role="group" aria-label={t('chart.group.indicators')}>{indicatorButtons}</div>
          </div>
        </div>
      ) : (
        <div style={styles.topToolbar}>
          {intervalButtons}
          <div style={styles.toolbarDivider} />
          {typeButtons}
          <div style={styles.toolbarDivider} />
          {indicatorButtons}
        </div>
      )}

      {/* Only a real user action speaks here.
        *
        * This strip used to double as a running commentary on the backfill:
        * loading, at the 10k cap, nothing older to fetch. None of that is a
        * customer's problem. A chart that has loaded every candle that
        * exists is a chart working correctly, and announcing it invites the
        * reader to think something went wrong. Reaching the end of history
        * is now SILENT.
        *
        * A chart that genuinely could not load at all is a different thing,
        * and still says so — «Не удалось загрузить график» with «Повторить»,
        * from PR #169, further down this file and untouched. */}
      {privateTrading?.enabled && tradingSelection && <div className="chart-trade-status" role="status">
        <span>{lang === 'ru'
          ? (privateTrading.selecting === 'exit' ? 'Выберите свечу выхода' : 'Выберите завершённую свечу')
          : 'Select a completed candle'}</span>
        <button type="button" aria-label={lang === 'ru' ? 'Отменить выбор' : 'Cancel selection'} onClick={() => privateTrading.onCancelSelection()}>×</button>
      </div>}

      <div className={terminal ? 'chart-view' : undefined} style={terminal ? TERMINAL_VIEW : styles.body}>
        <DrawToolbar
          compactTools={compactTools}
          onCollapse={() => { cancelGestureRef.current?.(); setTool('cursor'); }}
          tool={tool}
          onSelect={(next) => { if (tradingRef.current?.selecting) tradingRef.current.onCancelSelection(); if (drawingToolsOn) setDrawingsHidden(false); setTool(next); }}
          onClear={clearAll}
          onFit={fitContent}
          terminal={terminal}
          drawingTools={drawingToolsOn}
          drawingsHidden={drawingsHidden}
          magnet={magnet}
          onToggleMagnet={() => setMagnet((v) => !v)}
          magnetMode={magnetMode}
          onMagnetMode={(mode) => { setMagnetMode(mode); setMagnet(true); }}
          drawingCount={drawings.length}
          locked={locked}
          onToggleLock={() => {
            // Leaving a half-drawn shape behind a lock would be a shape
            // the trader can neither finish nor remove.
            cancelGestureRef.current?.();
            setLocked((v) => !v);
          }}
          onToggleHidden={() => {
            if (drawingToolsOn) { cancelGestureRef.current?.(); setTool('cursor'); }
            setDrawingsHidden((v) => !v);
          }}
          stayInDrawMode={stayInDrawMode}
          onToggleStay={() => setStayInDrawMode((v) => !v)}
        />

        {/*
          * What the chart is actually showing, in one word, derived purely
          * from the state that already drives the overlays below. No new
          * state, no behaviour — it exists so acceptance tooling can measure
          * "time to first visible candle" against the real page instead of
          * guessing at canvas pixels.
          */}
        <div style={styles.chartArea} data-chart-state={loadFailed ? 'error' : empty ? 'empty' : 'candles'}>
          <div ref={containerRef} style={styles.chart} />
          {privateTrading?.enabled && chartReady && <PrivatePositionLines chart={chartRef.current} series={seriesRef.current} interaction={privateTrading} pair={pair}/>}
          {terminal && <div className="voltex-plot-title">{pair} · {interval}</div>}

          {terminal && <div className="chart-watermark">{pair.split('/')[0]}</div>}

          {drawingToolsOn && <ChartDrawingLayer
            drawings={drawings}
            setDrawings={(update) => setDrawings(update)}
            tool={tool}
            onCommitted={(drawing) => finishDrawing(drawing)}
            view={drawingView}
            pointAt={drawingPointAt}
            positionPoints={positionPoints}
            overlayStyle={styles.overlay}
            hidden={drawingsHidden}
            locked={locked}
            blocked={tradingSelection}
            selectedId={selectedDrawing}
            onSelect={setSelectedDrawing}
            onRequestText={(request) => { cancelGestureRef.current?.(); setDrawDialog({ kind: 'text', request }); }}
            onZoom={zoomTo}
            cancelRef={cancelGestureRef}
            t={t}
          />}

          {/* Real conditional orders sit ABOVE the drawings, outside the
              hidden drawing group, and are never touched by Hide, Lock or
              Clear. Only their labels take the pointer. */}
          <svg className="order-overlay" style={{ ...styles.overlay, pointerEvents: 'none' }}>
            {spotConditionalOrders && conditionalOrders.map((o) => {
              const isDragging = draggingOrderId === o.id;
              const price = isDragging && dragPrice !== null ? dragPrice : parseFloat(o.triggerPrice ?? o.price ?? '0');
              const y = priceToY(price);
              if (y === null) return null;
              const isStop = o.type === 'STOP_LIMIT' || o.type === 'STOP_MARKET';
              const color = isStop ? '#ff4d6a' : '#00d68f';
              const label = `${isStop ? t('trade.orderType.STOP_LIMIT') : t('trade.orderType.TAKE_PROFIT_LIMIT')} ${price.toFixed(2)}`;
              return (
                <g key={o.id}>
                  <line x1={0} y1={y} x2="100%" y2={y} stroke={color} strokeWidth={1} strokeDasharray="6 4" opacity={isDragging ? 1 : 0.7} />
                  <g
                    transform={`translate(4, ${y - 10})`}
                    style={{ pointerEvents: 'auto', cursor: 'ns-resize' }}
                    onMouseDown={(e) => startDrag(o, e)}
                  >
                    <rect width={label.length * 6.2 + 14} height={20} rx={4} fill={color} />
                    <text x={7} y={14} fontSize={11} fontWeight={700} fill="#0b0e11">
                      {label}
                    </text>
                  </g>
                </g>
              );
            })}
          </svg>

          {/*
            * A blank canvas must never be the whole message.
            *
            * `loadFailed` is only set when an initial load really failed AND
            * there is nothing on screen to fall back to, so this never covers
            * a chart that still has usable bars. Retry re-runs the candle
            * request alone — no page reload — and the wording stays on the
            * customer's side of the line: what happened, not which provider
            * said what.
            */}
          {loadFailed ? (
            <div style={styles.chartErrorOverlay}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('trade.chartLoadFailed')}</span>
              <button type="button" style={styles.chartRetryButton} onClick={() => retryCandlesRef.current?.()}>
                {t('trade.chartRetry')}
              </button>
            </div>
          ) : empty && (
            <div style={styles.emptyOverlay}>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{t('trade.noChartData', { pair })}</span>
            </div>
          )}

          {(showMA || showBollinger || showRSI || showMACD) && (
            <div className="voltex-indicator-legend" style={styles.legend}>
              {showMA && <LegendItem color={INDICATOR_COLORS.ma} label={t('chart.indicator.ma')} />}
              {showBollinger && <LegendItem color={INDICATOR_COLORS.bollinger} label={t('chart.indicator.bollinger')} />}
              {showRSI && <LegendItem color={INDICATOR_COLORS.rsi} label={t('chart.indicator.rsi')} />}
              {showMACD && <LegendItem color={INDICATOR_COLORS.macd} label={t('chart.indicator.macd')} />}
            </div>
          )}
        </div>
      </div>
      {drawingToolsOn && drawDialog && createPortal(<DrawingDialog
        kind={drawDialog.kind} t={t}
        initial={drawDialog.kind === 'text' && 'edit' in drawDialog.request ? drawDialog.request.edit.text : undefined}
        onCancel={() => setDrawDialog(null)}
        onConfirm={text => {
          if (drawDialog.kind === 'text') {
            const value = text.trim();
            if (!value) return;
            const request = drawDialog.request;
            if ('edit' in request) {
              setDrawings(previous => previous.map(d => (d.id === request.edit.id ? { ...d, text: value } : d)));
            } else {
              const drawing: ChartDrawing = { id: newDrawingId(), kind: request.kind, points: request.points, text: value };
              setDrawings(previous => [...previous, drawing]);
              finishDrawing(drawing);
            }
          } else clearDrawings();
          setDrawDialog(null);
        }}
      />, document.body)}
    </div>
  );
}

/** Modal content is React text, not HTML; no prompt/confirm or network action. */
function DrawingDialog({ kind, t, onConfirm, onCancel, initial = '' }: {
  kind: 'text' | 'clear'; t: (key: any) => string;
  onConfirm: (text: string) => void; onCancel: () => void; initial?: string;
}) {
  const [draft, setDraft] = useState(initial);
  const id = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const textMode = kind === 'text';
  useEffect(() => {
    const previous = document.activeElement;
    // Confirming destructive local Clear is deliberately not the default focus.
    dialogRef.current?.querySelector<HTMLElement>(textMode ? 'input' : '[data-drawing-cancel]')?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [textMode]);
  return <div className="chart-draw-dialog-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget) onCancel();
  }}>
    <form ref={dialogRef} className="chart-draw-dialog" role="dialog" aria-modal="true"
      aria-labelledby={`${id}-title`} aria-describedby={textMode ? undefined : `${id}-description`}
      onSubmit={event => { event.preventDefault(); if (!textMode || draft.trim()) onConfirm(draft.trim()); }}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); return; }
        if (event.key !== 'Tab') return;
        const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button') ?? []).filter(control => !control.disabled);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <h2 id={`${id}-title`}>{t(textMode ? 'draw.text' : 'draw.deleteAll')}</h2>
      {textMode ? <label className="chart-draw-dialog-label" htmlFor={`${id}-text`}>
        <span>{t('draw.text')}</span>
        <input id={`${id}-text`} type="text" value={draft} maxLength={280} autoComplete="off"
          onChange={event => setDraft(event.target.value)} />
      </label> : <p id={`${id}-description`}>{t('draw.deleteAllConfirm')}</p>}
      <div className="chart-draw-dialog-actions">
        <button type="button" data-drawing-cancel onClick={onCancel}>{t('trade.cancel')}</button>
        <button type="submit" className={textMode ? 'primary' : 'danger'} disabled={textMode && !draft.trim()}>{t(textMode ? 'draw.addText' : 'draw.deleteAll')}</button>
      </div>
    </form>
  </div>;
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={styles.legendItem}>
      <span style={{ ...styles.legendDot, background: color }} />
      {label}
    </div>
  );
}

/**
 * The left drawing rail, laid out as TradingView's (owner, 2026-09-26:
 * «таку ж панель як в трейдінгвю, не похожу, а з таким же функціоналом»):
 * cursors, line tools, Fibonacci and pitchforks, patterns, forecasting and
 * measurement, shapes, text and notes — each a group whose main button
 * re-picks the tool last used in it and whose corner chevron opens the
 * rest, sectioned as TradingView sections them — then the ruler and zoom,
 * the magnet with its weak/strong modes, stay-in-drawing mode, lock all,
 * hide all and remove all.
 *
 * Every entry is a tool this chart implements; nothing here is an icon for
 * a feature that does nothing.
 */
type ToolEntry = { id: Tool; label: string; icon: JSX.Element; shortcut?: string };
type ToolSection = { title?: string; tools: ToolEntry[] };
type ToolGroupSpec = { id: string; label: string; sections: ToolSection[] };

function drawingToolGroups(t: (key: any) => string): ToolGroupSpec[] {
  const e = (id: Tool, label: string, icon: JSX.Element, shortcut?: string): ToolEntry => ({ id, label: t(label), icon, shortcut });
  return [
    { id: 'cursors', label: t('draw.cursors'), sections: [{ tools: [
      e('cursor', 'draw.cross', <CursorIcon />), e('dot', 'draw.cursorDot', <DotCursorIcon />),
      e('arrowcursor', 'draw.cursorArrow', <ArrowCursorIcon />), e('erase', 'draw.eraser', <EraseOneIcon />),
    ] }] },
    { id: 'lines', label: t('draw.trendTools'), sections: [
      { title: t('draw.section.lines'), tools: [
        e('trendline', 'draw.trendline', <TrendLineIcon />, 'Alt + T'), e('rayline', 'draw.ray', <RayLineIcon />),
        e('infoline', 'draw.infoline', <InfoLineIcon />), e('extended', 'draw.extendedLine', <ExtendedIcon />),
        e('trendangle', 'draw.trendangle', <TrendAngleIcon />), e('horizontal', 'draw.horizontal', <HorizontalIcon />, 'Alt + H'),
        e('ray', 'draw.hray', <RayIcon />, 'Alt + J'), e('vertical', 'draw.vertical', <VerticalIcon />, 'Alt + V'),
        e('crossline', 'draw.crossline', <CrossLineIcon />, 'Alt + C'),
      ] },
      { title: t('draw.section.channels'), tools: [e('channel', 'draw.channel', <ChannelIcon />)] },
    ] },
    { id: 'fibs', label: t('draw.fibGroup'), sections: [
      { title: t('draw.section.fib'), tools: [e('fib', 'draw.fibRetracement', <FibIcon />, 'Alt + F'), e('fibext', 'draw.fibext', <FibExtIcon />)] },
      { title: t('draw.section.pitchforks'), tools: [e('pitchfork', 'draw.pitchfork', <PitchforkIcon />)] },
    ] },
    { id: 'patterns', label: t('draw.patterns'), sections: [
      { title: t('draw.section.chartPatterns'), tools: [
        e('xabcd', 'draw.xabcd', <XabcdIcon />), e('abcd', 'draw.abcd', <AbcdIcon />),
        e('trianglepattern', 'draw.trianglepattern', <TrianglePatternIcon />), e('headshoulders', 'draw.headshoulders', <HeadShouldersIcon />),
      ] },
      { title: t('draw.section.elliott'), tools: [e('elliott', 'draw.elliott', <ElliottIcon />)] },
    ] },
    { id: 'forecast', label: t('draw.forecast'), sections: [
      { title: t('draw.section.projection'), tools: [e('long', 'draw.long', <LongIcon />), e('short', 'draw.short', <ShortIcon />)] },
      { title: t('draw.section.measurers'), tools: [
        e('pricerange', 'draw.pricerange', <PriceRangeIcon />), e('daterange', 'draw.daterange', <DateRangeIcon />),
        e('ruler', 'draw.datepricerange', <DatePriceRangeIcon />),
      ] },
    ] },
    { id: 'shapes', label: t('draw.shapesGroup'), sections: [
      { title: t('draw.section.brushes'), tools: [e('brush', 'draw.brush', <BrushIcon />), e('highlighter', 'draw.highlighter', <HighlighterIcon />)] },
      { title: t('draw.section.arrows'), tools: [
        e('arrow', 'draw.arrow', <ArrowDrawIcon />), e('arrowup', 'draw.arrowup', <ArrowUpIcon />), e('arrowdown', 'draw.arrowdown', <ArrowDownIcon />),
      ] },
      { title: t('draw.section.shapes'), tools: [
        e('rectangle', 'draw.rectangle', <RectangleIcon />, 'Alt + Shift + R'), e('ellipse', 'draw.ellipse', <EllipseIcon />),
        e('triangleshape', 'draw.triangleshape', <TriangleShapeIcon />), e('polyline', 'draw.polyline', <PolylineIcon />),
      ] },
    ] },
    { id: 'annotations', label: t('draw.annotations'), sections: [{ title: t('draw.section.text'), tools: [
      e('text', 'draw.text', <TextIcon />), e('note', 'draw.note', <NoteIcon />),
      e('callout', 'draw.callout', <CalloutIcon />), e('pricelabel', 'draw.pricelabel', <PriceLabelIcon />),
    ] }] },
  ];
}

function DrawToolbar({
  compactTools = false,
  tool,
  onSelect,
  onClear,
  onFit,
  terminal,
  drawingTools = false,
  drawingsHidden,
  onToggleHidden,
  stayInDrawMode,
  onToggleStay,
  magnet = false,
  onToggleMagnet,
  magnetMode = 'strong',
  onMagnetMode,
  locked = false,
  onToggleLock,
  onCollapse,
  drawingCount = 0,
}: {
  tool: Tool;
  onSelect: (t: Tool) => void;
  onClear: () => void;
  compactTools?: boolean;
  onFit: () => void;
  terminal?: boolean;
  drawingTools?: boolean;
  drawingsHidden: boolean;
  onToggleHidden: () => void;
  stayInDrawMode: boolean;
  onToggleStay: () => void;
  magnet?: boolean;
  onToggleMagnet?: () => void;
  magnetMode?: MagnetMode;
  onMagnetMode?: (mode: MagnetMode) => void;
  locked?: boolean;
  onToggleLock?: () => void;
  onCollapse?: () => void;
  drawingCount?: number;
}) {
  const { t } = useLanguage();
  // Presentation state only: keep the rail mounted so each group's
  // last-used tool survives collapse. Drawings and preferences live above.
  const [collapsed, setCollapsed] = useState(false);
  const railId = useId();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [toolHint, setToolHint] = useState<{ label:string; left:number; top:number } | null>(null);
  const showToolHint = (target: EventTarget | null) => {
    if (!compactTools || !(target instanceof Element)) return;
    const button = target.closest('button');
    const label = button?.getAttribute('aria-label');
    if (!button || !label) return;
    const rect = button.getBoundingClientRect();
    setToolHint({ label, left:Math.max(8, Math.min(window.innerWidth - 208, rect.right + 8)),
      top:Math.max(8, Math.min(window.innerHeight - 42, rect.top)) });
  };
  // Where to paint the flyout, in viewport coordinates. The rail has to
  // scroll on short screens, and an element that scrolls on one axis can
  // never let content overflow the other — `overflow-x: visible` computes
  // to `auto` — so a flyout positioned inside the rail is clipped away
  // rather than shown. Rendering it into a portal at fixed coordinates is
  // what keeps it visible without giving up the rail's own scrolling.
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  // Last tool picked inside each group, so its button keeps offering that
  // one — the familiar behaviour from professional terminals.
  const [lastUsed, setLastUsed] = useState<Record<string, Tool>>({});
  const groupRef = useRef<HTMLDivElement | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!drawingTools || !openGroup) return;
    flyoutRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"], button')?.focus();
    const close = () => setOpenGroup(null);
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, [drawingTools, openGroup]);

  // A flyout that outlives a click elsewhere would sit over the chart and
  // eat the next drawing gesture.
  useEffect(() => {
    if (!openGroup) return;
    function onDocDown(e: MouseEvent) {
      const t = e.target as Node;
      const inGroup = groupRef.current?.contains(t);
      const inFlyout = flyoutRef.current?.contains(t);
      if (!inGroup && !inFlyout) setOpenGroup(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpenGroup(null);
        if (drawingTools) groupRef.current?.querySelector<HTMLButtonElement>('.tool-group-chevron')?.focus();
      }
    }
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openGroup, drawingTools]);

  const GROUPS = drawingToolGroups(t);
  const TREND_TOOLS = GROUPS[1].sections[0].tools;

  // Non-terminal chrome (other pages embedding this chart) keeps the plain
  // inline-styled rail it always had; only the terminal gets the grouped
  // presentation, whose hover/active states live in TradeTerminal.css.
  if (!terminal) {
    const FLAT: { id: Tool; icon: JSX.Element; title: string }[] = [
      { id: 'cursor', icon: <CursorIcon />, title: t('draw.cursor') },
      ...TREND_TOOLS.map((x) => ({ id: x.id, icon: x.icon, title: x.label })),
      { id: 'rectangle', icon: <RectangleIcon />, title: t('draw.rectangle') },
      { id: 'fib', icon: <FibIcon />, title: t('draw.fib') },
      { id: 'brush', icon: <BrushIcon />, title: t('draw.brush') },
      { id: 'ruler', icon: <RulerIcon />, title: t('draw.measure') },
      { id: 'text', icon: <TextIcon />, title: t('draw.text') },
    ];
    return (
      <div style={styles.drawToolbar}>
        {FLAT.map((tl) => (
          <button
            key={tl.id}
            title={tl.title}
            onClick={() => onSelect(tl.id)}
            style={{ ...styles.toolBtn, ...(tool === tl.id ? styles.toolBtnActive : {}) }}
          >
            {tl.icon}
          </button>
        ))}
        <div style={styles.toolDivider} />
        <button title={t('draw.zoom')} onClick={onFit} style={styles.toolBtn}>
          <FitIcon />
        </button>
        <button title={t('draw.deleteAll')} onClick={onClear} style={styles.toolBtn}>
          <EraserIcon />
        </button>
      </div>
    );
  }

  const btn = (
    id: string,
    title: string,
    icon: JSX.Element,
    onClick: () => void,
    active: boolean
  ) => (
    <button key={id} type="button" data-drawing-tool={drawingTools ? id : undefined} title={title} aria-label={title} aria-pressed={active} onClick={onClick} className={`tool-btn ${active ? 'active' : ''}`}>
      {icon}
    </button>
  );

  const openFlyout = (group: string, wrap: DOMRect, items: number, sections: number) => {
    const size = { width: 356, height: Math.min(560, 12 + items * 36 + sections * 26) };
    setFlyoutPos(drawingTools ? drawingFlyoutPosition(wrap, { width: window.innerWidth, height: window.innerHeight }, window.innerWidth <= 767, size) : { top: wrap.top - 4, left: wrap.right + 6 });
    setOpenGroup((g) => (g === group ? null : group));
  };

  const flyoutKeys = drawingTools ? (event: React.KeyboardEvent) => {
    const items = Array.from(flyoutRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length
      : event.key === 'ArrowUp' ? (index + items.length - 1) % items.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : null;
    if (next !== null) { event.preventDefault(); items[next]?.focus(); }
    if (event.key === 'Tab') setOpenGroup(null);
  } : undefined;

  const chevron = (label: string, open: boolean, onClick: (wrap: DOMRect) => void) => (
    <button
      type="button"
      className="tool-group-chevron"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={drawingTools && open ? menuId : undefined}
      title={label}
      onClick={(e) => onClick((e.currentTarget.parentElement as HTMLElement).getBoundingClientRect())}
    >
      <svg width="5" height="5" viewBox="0 0 5 5" aria-hidden="true">
        <path d="M5 0v5H0z" fill="currentColor" />
      </svg>
    </button>
  );

  /** One tool group: the main button re-picks its last tool, the chevron lists them all. */
  const group = (spec: ToolGroupSpec) => {
    const all = spec.sections.flatMap((section) => section.tools);
    const current = all.find((x) => x.id === (lastUsed[spec.id] ?? all[0].id)) ?? all[0];
    const active = all.some((x) => x.id === tool);
    const shown = active ? all.find((x) => x.id === tool) ?? current : current;
    const open = openGroup === spec.id;
    return <div key={spec.id} className={`tool-group ${open ? 'open' : ''}`} data-tool-group={spec.id}
      ref={open ? (node) => { groupRef.current = node; } : undefined}>
      <button
        type="button"
        data-drawing-tool={drawingTools ? shown.id : undefined}
        title={shown.shortcut ? `${shown.label} (${shown.shortcut})` : shown.label}
        aria-label={shown.label}
        aria-pressed={active}
        onClick={() => onSelect(shown.id)}
        className={`tool-btn ${active ? 'active' : ''}`}
      >
        {shown.icon}
      </button>
      {chevron(spec.label, open, (wrap) => openFlyout(spec.id, wrap, all.length, spec.sections.filter((s) => s.title).length))}
      {open && flyoutPos && createPortal(
        <div
          className={`tool-flyout${drawingTools ? ' drawing-flyout' : ''}`}
          id={drawingTools ? menuId : undefined}
          role="menu"
          aria-label={spec.label}
          ref={flyoutRef}
          style={{ top: flyoutPos.top, left: flyoutPos.left }}
          onKeyDown={flyoutKeys}
        >
          {spec.sections.map((section, s) => <div key={s} role="group" aria-label={section.title}>
            {section.title && <div className="tool-flyout-section">{section.title}</div>}
            {section.tools.map((x) => (
              <button
                key={x.id}
                type="button"
                data-drawing-tool={drawingTools ? x.id : undefined}
                role={drawingTools ? 'menuitemradio' : 'menuitem'}
                aria-checked={drawingTools ? tool === x.id : undefined}
                className={`tool-flyout-item ${tool === x.id ? 'active' : ''}`}
                onClick={() => {
                  setLastUsed((previous) => ({ ...previous, [spec.id]: x.id }));
                  onSelect(x.id);
                  setOpenGroup(null);
                }}
              >
                {x.icon}
                <span>{x.label}</span>
                {x.shortcut && <kbd>{x.shortcut}</kbd>}
              </button>
            ))}
          </div>)}
        </div>,
        document.body
      )}
    </div>;
  };

  const magnetOpen = openGroup === 'magnet';
  const rail = (
    <div className={`draw-toolbar${drawingTools ? ' drawing-rail' : ''}`} id={drawingTools ? railId : undefined} hidden={drawingTools && collapsed} role={drawingTools ? 'toolbar' : undefined} aria-label={drawingTools ? t('draw.shapes') : undefined}
      onMouseOver={event => showToolHint(event.target)} onFocusCapture={event => showToolHint(event.target)}
      onMouseLeave={() => setToolHint(null)} onBlurCapture={() => setToolHint(null)} onPointerDown={() => setToolHint(null)}
      onKeyDown={event => { if (event.key === 'Escape') setToolHint(null); }}
      onScroll={drawingTools ? () => { setOpenGroup(null); setToolHint(null); } : undefined}>
      {group(GROUPS[0])}

      <div className="tool-divider" />

      {GROUPS.slice(1).map(group)}

      <div className="tool-divider" />

      {btn('ruler', t('draw.measure'), <RulerIcon />, () => onSelect('ruler'), tool === 'ruler')}
      {btn('zoom', t('draw.zoomIn'), <ZoomInIcon />, () => onSelect('zoom'), tool === 'zoom')}
      {btn('fit', t('draw.zoom'), <FitIcon />, onFit, false)}

      <div className="tool-divider" />

      {/* Magnet and lock only exist where the overlay implements them. */}
      {drawingTools && onToggleMagnet
        ? <div className={`tool-group ${magnetOpen ? 'open' : ''}`} data-tool-group="magnet" ref={magnetOpen ? (node) => { groupRef.current = node; } : undefined}>
            {btn('magnet', `${t('draw.magnet')}: ${t(magnetMode === 'weak' ? 'draw.magnetWeak' : 'draw.magnetStrong')}`, <MagnetIcon />, onToggleMagnet, magnet)}
            {onMagnetMode && chevron(t('draw.magnet'), magnetOpen, (wrap) => openFlyout('magnet', wrap, 2, 0))}
            {magnetOpen && flyoutPos && onMagnetMode && createPortal(
              <div className="tool-flyout drawing-flyout" id={menuId} role="menu" aria-label={t('draw.magnet')} ref={flyoutRef} style={{ top: flyoutPos.top, left: flyoutPos.left }} onKeyDown={flyoutKeys}>
                {(['weak', 'strong'] as const).map((mode) => (
                  <button key={mode} type="button" role="menuitemradio" aria-checked={magnet && magnetMode === mode} data-magnet-mode={mode}
                    className={`tool-flyout-item ${magnet && magnetMode === mode ? 'active' : ''}`}
                    onClick={() => { onMagnetMode(mode); setOpenGroup(null); }}>
                    <MagnetIcon /><span>{t(mode === 'weak' ? 'draw.magnetWeak' : 'draw.magnetStrong')}</span>
                  </button>
                ))}
              </div>,
              document.body
            )}
          </div>
        : null}
      {btn('stay', t('draw.stayMode'), <StayModeIcon />, onToggleStay, stayInDrawMode)}
      {drawingTools && onToggleLock
        ? btn('lock', locked ? t('draw.unlock') : t('draw.lock'), locked ? <LockedIcon /> : <UnlockedIcon />, onToggleLock, locked)
        : null}
      {btn(
        'hide',
        drawingsHidden ? t('draw.show') : t('draw.hide'),
        drawingsHidden ? <EyeOffIcon /> : <EyeIcon />,
        onToggleHidden,
        drawingsHidden
      )}

      <div className="tool-divider" />

      {btn('clear', drawingCount > 0 ? `${t('draw.deleteAll')} (${drawingCount})` : t('draw.deleteAll'), <EraserIcon />, onClear, false)}
      {toolHint && createPortal(<div className="terminal-tool-hint" role="tooltip"
        style={{left:toolHint.left,top:toolHint.top}}>{toolHint.label}</div>, document.body)}
    </div>
  );
  if (!drawingTools) return rail;
  const toggleLabel = t(collapsed ? 'draw.expandToolbar' : 'draw.collapseToolbar');
  return <div className={`drawing-rail-shell${collapsed ? ' is-collapsed' : ''}`}>
    {rail}
    <button type="button" className="drawing-rail-toggle" data-drawing-toolbar-toggle
      aria-expanded={!collapsed} aria-controls={railId} aria-label={toggleLabel} title={toggleLabel}
      onClick={() => {
        setOpenGroup(null);
        setToolHint(null);
        if (!collapsed) onCollapse?.();
        setCollapsed(!collapsed);
      }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m14 6-6 6 6 6" />
      </svg>
    </button>
  </div>;
}

/* Terminal chrome. The reference has `.chart-toolbar` and `.chart-view` as
   direct children of `.chart-area`; PriceChart is shared with the Futures
   page, so it keeps its own wrapper element around them. The wrapper is a
   flex column that simply fills `.chart-area` (itself a flex column), so
   the rendered result is identical to the reference's — it only gives the
   shared component one root to switch chrome on.

   `.chart-view` in the reference styles a plain block; here it also holds
   the drawing-tool rail beside the canvas, so display:flex is the one
   property added — nothing the reference sets is overridden. */
const TERMINAL_WRAPPER: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  overflow: 'hidden',
};
const TERMINAL_VIEW: React.CSSProperties = { display: 'flex' };

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--panel)',
    overflow: 'hidden',
    minHeight: 300,
  },
  topToolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    padding: '8px 12px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
    flexWrap: 'wrap',
  },
  intervalBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    fontWeight: 700,
    padding: '5px 10px',
    borderRadius: 6,
  },
  intervalBtnActive: {
    background: 'var(--accent)',
    color: 'var(--on-accent)',
  },
  toolbarDivider: {
    width: 1,
    alignSelf: 'stretch',
    background: 'var(--border)',
    margin: '2px 4px',
  },
  indicatorToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    background: 'transparent',
    border: '1px solid transparent',
    color: 'var(--text-secondary)',
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    padding: '5px 9px',
    borderRadius: 6,
  },
  indicatorToggleActive: {
    border: '1px solid var(--border)',
    background: 'var(--panel-alt)',
  },
  indicatorDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    flexShrink: 0,
  },
  legend: {
    position: 'absolute',
    top: 8,
    left: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '7px 10px',
    background: 'rgba(30,34,42,0.85)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6,
    pointerEvents: 'none',
    zIndex: 1,
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    color: '#eaecef',
    whiteSpace: 'nowrap',
  },
  legendDot: {
    width: 10,
    height: 3,
    borderRadius: 1.5,
    flexShrink: 0,
  },
  body: {
    flex: 1,
    display: 'flex',
    minHeight: 0,
  },
  drawToolbar: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    padding: '10px 6px',
    borderRight: '1px solid var(--border)',
    background: 'var(--panel)',
    flexShrink: 0,
  },
  toolBtn: {
    width: 30,
    height: 30,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: 6,
    color: 'var(--text-secondary)',
  },
  toolBtnActive: {
    background: 'var(--accent-dim)',
    color: 'var(--accent)',
  },
  toolDivider: {
    width: 18,
    height: 1,
    background: 'var(--border)',
    margin: '6px 0',
  },
  chartArea: {
    flex: 1,
    position: 'relative',
    minWidth: 0,
  },
  chart: {
    position: 'absolute',
    inset: 0,
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    // lightweight-charts' own crosshair canvas sits at z-index: 2 inside
    // the chart div — a plain z-index:auto sibling loses hit-testing to it
    // regardless of DOM order (a positioned z-index:auto element always
    // paints below a positioned descendant with an explicit positive
    // z-index, even one nested many levels deep with no stacking context
    // of its own in between). This has to clear that 2.
    zIndex: 3,
    pointerEvents: 'none',
  },
  textLabel: {
    position: 'absolute',
    transform: 'translate(4px, -50%)',
    background: 'var(--panel-alt)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '2px 6px',
    fontSize: 11,
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
  },
  emptyOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    textAlign: 'center',
    padding: 24,
  },
  // Unlike emptyOverlay this one must take clicks — it carries the retry.
  // Which is exactly why it needs the z-index the `overlay` comment above
  // explains: at z-index:auto the chart's own crosshair canvas paints over
  // it and swallows the press, so the button is visible but dead. Above
  // the drawing overlay's 3 and any drawing label's 4, so nothing the
  // chart draws can cover the one control the customer has left.
  chartErrorOverlay: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    textAlign: 'center',
    padding: 24,
    zIndex: 5,
  },
  chartRetryButton: {
    padding: '7px 18px',
    borderRadius: 8,
    border: '1px solid var(--border-color)',
    background: 'var(--panel)',
    color: 'var(--text-primary)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  },
};

// ── Drawing-tool icons ──────────────────────────────────────────────
//
// Drawn for VOLTEX in the visual language traders already know from
// TradingView, so every tool reads at a glance: a 28-unit grid rendered at
// 28px, 1-unit strokes on half-pixel lines, and anchors as small hollow
// rings the line stops short of. Our own paths, stroke only, currentColor —
// never a copied asset, a text glyph or an emoji.

const TV_ICON = {
  width: 28,
  height: 28,
  viewBox: '0 0 28 28',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': 'true' as const,
};

/** An anchor ring and the radius lines stop at. */
const RING = 2;
const Ring = ({ x, y, r = RING }: { x: number; y: number; r?: number }) => <circle cx={x} cy={y} r={r} />;

/** A segment from a to b, trimmed at either end to a ring's edge. */
function seg(a: [number, number], b: [number, number], trimStart = 0, trimEnd = 0): string {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const f = (n: number) => +n.toFixed(2);
  return `M${f(a[0] + ux * trimStart)} ${f(a[1] + uy * trimStart)}L${f(b[0] - ux * trimEnd)} ${f(b[1] - uy * trimEnd)}`;
}

/** A chain of anchors joined by segments, each ring left open. */
function Chain({ points, r = 1.5, rings = true, closed = false }: { points: [number, number][]; r?: number; rings?: boolean; closed?: boolean }) {
  const pairs = points.slice(1).map((p, i) => [points[i], p] as const);
  if (closed) pairs.push([points[points.length - 1], points[0]]);
  const t = rings ? r : 0;
  return <>
    <path d={pairs.map(([a, b]) => seg(a, b, t, t)).join('')} />
    {rings && points.map(([x, y], i) => <Ring key={i} x={x} y={y} r={r} />)}
  </>;
}

// Cursors

/** Cross: the chart's own crosshair. */
function CursorIcon() {
  return <svg {...TV_ICON}><path d="M14.5 4.5v20M4.5 14.5h20" /></svg>;
}
function DotCursorIcon() {
  return <svg {...TV_ICON}><circle cx="14.5" cy="14.5" r="2.5" fill="currentColor" stroke="none" /></svg>;
}
function ArrowCursorIcon() {
  return <svg {...TV_ICON}><path d="M10.5 5.5V20l3.5-3.5 2.8 6 2-.9-2.8-5.8 4.5-.3z" /></svg>;
}
function EraseOneIcon() {
  return <svg {...TV_ICON}><path d="M12 24 5 17l9-9 7 7-9 9zM8.5 13.5l7 7M14.5 24.5h9" /></svg>;
}

// Lines

function TrendLineIcon() {
  return <svg {...TV_ICON}><Ring x={6.5} y={21.5} /><Ring x={21.5} y={6.5} /><path d={seg([6.5, 21.5], [21.5, 6.5], RING, RING)} /></svg>;
}
function RayLineIcon() {
  return <svg {...TV_ICON}>
    <Ring x={6.5} y={21.5} /><Ring x={14.5} y={13.5} />
    <path d={seg([6.5, 21.5], [14.5, 13.5], RING, RING) + seg([14.5, 13.5], [24.5, 3.5], RING, 0)} />
  </svg>;
}
function InfoLineIcon() {
  return <svg {...TV_ICON}>
    <Ring x={5.5} y={19.5} /><Ring x={17.5} y={7.5} />
    <path d={seg([5.5, 19.5], [17.5, 7.5], RING, RING)} />
    <path d="M13.5 15.5h11v8h-11zM16 18.5h6M16 21h4" />
  </svg>;
}
function ExtendedIcon() {
  return <svg {...TV_ICON}>
    <Ring x={10.5} y={17.5} /><Ring x={17.5} y={10.5} />
    <path d={seg([3.5, 24.5], [10.5, 17.5], 0, RING) + seg([10.5, 17.5], [17.5, 10.5], RING, RING) + seg([17.5, 10.5], [24.5, 3.5], RING, 0)} />
  </svg>;
}
function TrendAngleIcon() {
  return <svg {...TV_ICON}>
    <Ring x={6.5} y={20.5} /><Ring x={20.5} y={8.5} />
    <path d={seg([6.5, 20.5], [20.5, 8.5], RING, RING)} />
    <path d="M8.5 20.5h16M15.5 20.5A9 9 0 0 0 13.3 14.6" />
  </svg>;
}
function HorizontalIcon() {
  return <svg {...TV_ICON}><Ring x={14.5} y={14.5} /><path d="M3.5 14.5h9M16.5 14.5h9" /></svg>;
}
/** Horizontal ray: one anchor, running to the right edge. */
function RayIcon() {
  return <svg {...TV_ICON}><Ring x={6.5} y={14.5} /><path d="M8.5 14.5h17" /></svg>;
}
function VerticalIcon() {
  return <svg {...TV_ICON}><Ring x={14.5} y={14.5} /><path d="M14.5 3.5v9M14.5 16.5v9" /></svg>;
}
function CrossLineIcon() {
  return <svg {...TV_ICON}><Ring x={14.5} y={14.5} /><path d="M3.5 14.5h9M16.5 14.5h9M14.5 3.5v9M14.5 16.5v9" /></svg>;
}
function ChannelIcon() {
  return <svg {...TV_ICON}>
    <Ring x={5.5} y={16.5} /><Ring x={16.5} y={5.5} /><Ring x={22.5} y={11.5} />
    <path d={seg([5.5, 16.5], [16.5, 5.5], RING, RING) + seg([11.5, 22.5], [22.5, 11.5], 0, RING)} />
  </svg>;
}

// Fibonacci

function FibIcon() {
  return <svg {...TV_ICON}>
    <Ring x={4.5} y={23.5} /><Ring x={23.5} y={5.5} />
    <path d="M3.5 5.5h18M3.5 11.5h21M3.5 17.5h21M6.5 23.5h18" />
  </svg>;
}
function FibExtIcon() {
  return <svg {...TV_ICON}>
    <path d="M11.5 5.5h13M11.5 9.5h13M11.5 13.5h13" />
    <Chain points={[[4.5, 23.5], [9.5, 17.5], [14.5, 21.5]]} r={RING} />
  </svg>;
}
function PitchforkIcon() {
  return <svg {...TV_ICON}>
    <Ring x={5} y={23} /><Ring x={8.5} y={10.5} /><Ring x={17.5} y={19.5} />
    <path d={seg([5, 23], [13, 15], RING, 0) + seg([8.5, 10.5], [17.5, 19.5], RING, RING)
      + seg([13, 15], [22.5, 5.5]) + seg([8.5, 10.5], [15, 4], RING, 0) + seg([17.5, 19.5], [24, 13], RING, 0)} />
  </svg>;
}

// Patterns

function XabcdIcon() {
  return <svg {...TV_ICON}>
    <Chain points={[[3.5, 20.5], [8.5, 6.5], [13.5, 16.5], [18.5, 9.5], [24.5, 22.5]]} />
    <path d={seg([3.5, 20.5], [13.5, 16.5], 1.5, 1.5) + seg([13.5, 16.5], [24.5, 22.5], 1.5, 1.5)} strokeDasharray="1.5 2" />
  </svg>;
}
function AbcdIcon() {
  return <svg {...TV_ICON}><Chain points={[[4.5, 20.5], [11, 7.5], [17, 16.5], [24, 5.5]]} /></svg>;
}
function TrianglePatternIcon() {
  return <svg {...TV_ICON}>
    <path d="M3.5 5.5 24.5 12M3.5 23.5l21-6.5" />
    <Chain points={[[4.5, 6], [9.5, 21.5], [14.5, 9], [19.5, 18.5], [24, 14.5]]} rings={false} />
  </svg>;
}
function HeadShouldersIcon() {
  return <svg {...TV_ICON}>
    <Chain points={[[3.5, 21.5], [7.5, 12.5], [10.5, 17.5], [14.5, 5.5], [18.5, 17.5], [21.5, 12.5], [25, 21.5]]} rings={false} />
    <path d="M6 17.5h16" strokeDasharray="1.5 2" />
  </svg>;
}
function ElliottIcon() {
  return <svg {...TV_ICON}><Chain points={[[3.5, 22.5], [8.5, 13.5], [11.5, 17.5], [18.5, 6.5], [21.5, 11.5], [25, 4.5]]} /></svg>;
}

// Forecasting and measuring

/** Long position: the reward box above the entry, the risk box below. */
function LongIcon() {
  return <svg {...TV_ICON}><path d="M5.5 5.5h17v17h-17zM5.5 16.5h17M14 13.5V8M11.5 10.5 14 8l2.5 2.5" /></svg>;
}
function ShortIcon() {
  return <svg {...TV_ICON}><path d="M5.5 5.5h17v17h-17zM5.5 11.5h17M14 14.5V20M11.5 17.5 14 20l2.5-2.5" /></svg>;
}
function PriceRangeIcon() {
  return <svg {...TV_ICON}><path d="M6.5 5.5h15M6.5 22.5h15M14 8v12M11.5 10.5 14 8l2.5 2.5M11.5 17.5 14 20l2.5-2.5" /></svg>;
}
function DateRangeIcon() {
  return <svg {...TV_ICON}><path d="M5.5 6.5v15M22.5 6.5v15M8 14h12M10.5 11.5 8 14l2.5 2.5M17.5 11.5 20 14l-2.5 2.5" /></svg>;
}
function DatePriceRangeIcon() {
  return <svg {...TV_ICON}><path d="M5.5 5.5h17v17h-17zM14 8.5v11M12 10.5l2-2 2 2M12 17.5l2 2 2-2M8.5 14h11M10.5 12l-2 2 2 2M17.5 12l2 2-2 2" /></svg>;
}

// Shapes

function BrushIcon() {
  return <svg {...TV_ICON}>
    <path d="m21 4 3 3-8.5 8.5-3-3z" />
    <path d="M12.5 12.5c-2.6 0-4.5 2-4.5 4.5 0 2-1 3.5-3.5 4.5 4 1.5 9.5.5 10.7-3.3.5-1.6 0-3.6-2.7-5.7z" />
  </svg>;
}
function HighlighterIcon() {
  return <svg {...TV_ICON}><path d="m18.5 5.5 4 4-9 9-4-4zM9.5 14.5l-2 6 6-2M4.5 24.5h19" /></svg>;
}
function ArrowDrawIcon() {
  return <svg {...TV_ICON}><path d="M6 22 21.5 6.5M13.5 6.5h8v8" /></svg>;
}
function ArrowUpIcon() {
  return <svg {...TV_ICON}><path d="m14 4.5 7.5 8.5H17v10.5h-6V13H6.5z" /></svg>;
}
function ArrowDownIcon() {
  return <svg {...TV_ICON}><path d="M14 23.5 6.5 15H11V4.5h6V15h4.5z" /></svg>;
}
function RectangleIcon() {
  return <svg {...TV_ICON}>
    <Ring x={5.5} y={7.5} /><Ring x={22.5} y={20.5} />
    <path d="M7.5 7.5h15v11M5.5 9.5v11h15" />
  </svg>;
}
function EllipseIcon() {
  return <svg {...TV_ICON}><ellipse cx="14" cy="14.5" rx="9.5" ry="7" /></svg>;
}
function TriangleShapeIcon() {
  return <svg {...TV_ICON}><Chain points={[[14, 5.5], [23.5, 21.5], [4.5, 21.5]]} closed /></svg>;
}
function PolylineIcon() {
  return <svg {...TV_ICON}><Chain points={[[5, 21.5], [8, 8], [18, 6], [23, 19], [13.5, 15]]} /></svg>;
}

// Text and notes

function TextIcon() {
  return <svg {...TV_ICON}><path d="M7.5 8.5v-2h13v2M14 6.5v15M11 21.5h6" /></svg>;
}
function NoteIcon() {
  return <svg {...TV_ICON}><path d="M6.5 5.5h15V17l-5 5h-10zM21.5 17h-5v5M9.5 10.5h9M9.5 13.5h6" /></svg>;
}
function CalloutIcon() {
  return <svg {...TV_ICON}><path d="M5.5 6.5h17v11h-9l-4 4v-4h-4z" /></svg>;
}
function PriceLabelIcon() {
  return <svg {...TV_ICON}><path d="m4.5 14.5 5-5h14v10h-14zM13 14.5h7" /><Ring x={9.5} y={14.5} r={1} /></svg>;
}

// The rest of the rail

function RulerIcon() {
  return <svg {...TV_ICON}><path d="M3.4 19.7 19.7 3.4l4.9 4.9L8.3 24.6zM6.7 16.4l2.1 2.1M9.9 13.2l1.4 1.4M13.2 9.9l2.1 2.1M16.4 6.7l1.4 1.4" /></svg>;
}
function ZoomInIcon() {
  return <svg {...TV_ICON}><circle cx="12.5" cy="12.5" r="7" /><path d="m17.5 17.5 6 6M12.5 9.5v6M9.5 12.5h6" /></svg>;
}
function FitIcon() {
  return <svg {...TV_ICON}><path d="M4.5 9.5v-5h5M18.5 4.5h5v5M23.5 18.5v5h-5M9.5 23.5h-5v-5M9.5 14.5h9M14 10v9" /></svg>;
}
function MagnetIcon() {
  return <svg {...TV_ICON}><path d="M7.5 6.5h4V15a2.5 2.5 0 0 0 5 0V6.5h4V15a6.5 6.5 0 0 1-13 0zM7.5 10.5h4M16.5 10.5h4" /></svg>;
}
/** Stay in drawing mode: the pen, held by a lock. */
function StayModeIcon() {
  return <svg {...TV_ICON}><path d="m5.5 22.5 1-4.5L17 7.5l3.5 3.5L10 21.5zM15 9.5l3.5 3.5M17.5 19.5h7v5h-7zM18.5 19.5V18a2.5 2.5 0 0 1 5 0v1.5" /></svg>;
}
function LockedIcon() {
  return <svg {...TV_ICON}><path d="M8.5 12.5h11v10h-11zM10.5 12.5v-3a3.5 3.5 0 0 1 7 0v3M14 16.5v2" /></svg>;
}
function UnlockedIcon() {
  return <svg {...TV_ICON}><path d="M8.5 12.5h11v10h-11zM10.5 12.5v-3a3.5 3.5 0 0 1 6.8-1.2M14 16.5v2" /></svg>;
}
function EyeIcon() {
  return <svg {...TV_ICON}><path d="M3.5 14.5S7.5 7.5 14 7.5s10.5 7 10.5 7-4 7-10.5 7-10.5-7-10.5-7z" /><circle cx="14" cy="14.5" r="3" /></svg>;
}
function EyeOffIcon() {
  return <svg {...TV_ICON}><path d="M3.5 14.5S7.5 7.5 14 7.5s10.5 7 10.5 7-4 7-10.5 7-10.5-7-10.5-7z" /><circle cx="14" cy="14.5" r="3" /><path d="m5.5 23.5 17-17" /></svg>;
}
/** Remove all drawings: TradingView's bin. */
function EraserIcon() {
  return <svg {...TV_ICON}><path d="M5.5 7.5h17M11.5 7.5v-2h5v2M7.5 7.5l1 15h11l1-15M12 11.5v7M16 11.5v7" /></svg>;
}
