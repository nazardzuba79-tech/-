import { useEffect, useRef, useState, useCallback } from 'react';
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
} from 'lightweight-charts';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { computeSMA, computeBollingerBands, computeRSI, computeMACD, Candle } from '../lib/indicators';

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

type Tool = 'cursor' | 'trendline' | 'ray' | 'horizontal' | 'vertical' | 'rectangle' | 'fib' | 'brush' | 'ruler' | 'text';

interface Point {
  time: number;
  price: number;
}
interface TrendLine {
  id: number;
  a: Point;
  b: Point;
}
interface Ruler {
  id: number;
  a: Point;
  b: Point;
}
interface TextLabel {
  id: number;
  at: Point;
  text: string;
}
// A horizontal ray: unlike 'horizontal' (a native price line spanning the
// full chart width), this only extends rightward from the point it was
// drawn at — same distinction TradingView's own toolbar makes.
interface RayLine {
  id: number;
  a: Point;
}
interface VerticalLine {
  id: number;
  time: number;
}
interface RectShape {
  id: number;
  a: Point;
  b: Point;
}
interface FibShape {
  id: number;
  a: Point;
  b: Point;
}
interface BrushStroke {
  id: number;
  points: Point[];
}

// Standard retracement levels — the same set every charting tool ships.
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

let nextDrawingId = 1;

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
export function PriceChart({ pair, chrome = 'default' }: { pair: string; chrome?: 'default' | 'terminal' }) {
  const { t } = useLanguage();
  const terminal = chrome === 'terminal';
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
  const [interval, setInterval_] = useState<Interval>('15m');
  const [empty, setEmpty] = useState(false);
  const [chartType, setChartType] = useState<ChartType>('candles');
  const [showMA, setShowMA] = useState(true);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
  const [showMACD, setShowMACD] = useState(false);

  const [tool, setTool] = useState<Tool>('cursor');
  const [trendLines, setTrendLines] = useState<TrendLine[]>([]);
  const [rulers, setRulers] = useState<Ruler[]>([]);
  const [labels, setLabels] = useState<TextLabel[]>([]);
  const [rays, setRays] = useState<RayLine[]>([]);
  const [verticals, setVerticals] = useState<VerticalLine[]>([]);
  const [rectangles, setRectangles] = useState<RectShape[]>([]);
  const [fibs, setFibs] = useState<FibShape[]>([]);
  const [brushStrokes, setBrushStrokes] = useState<BrushStroke[]>([]);
  const [pendingBrush, setPendingBrush] = useState<Point[] | null>(null);
  const [pendingPoint, setPendingPoint] = useState<Point | null>(null);
  // Drawings stay in state while hidden — this only controls whether the
  // overlay renders them, so toggling back shows exactly what was there.
  const [drawingsHidden, setDrawingsHidden] = useState(false);
  // A drawing tool currently stays selected until the trader picks another,
  // which is TradingView's "stay in drawing mode" behaviour. Turning this
  // off returns to the cursor after each completed shape. Both are real
  // behaviours of this overlay; nothing here simulates anything.
  const [stayInDrawMode, setStayInDrawMode] = useState(true);
  const [cursorPoint, setCursorPoint] = useState<Point | null>(null);
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
  // Read from inside native window listeners, which close over the value
  // at bind time — a ref keeps them seeing the current setting.
  const stayInDrawModeRef = useRef(stayInDrawMode);
  stayInDrawModeRef.current = stayInDrawMode;
  const textPromptRef = useRef('');
  textPromptRef.current = `${t('draw.text')}:`;
  const confirmClearRef = useRef('');
  confirmClearRef.current = t('draw.deleteAllConfirm');

  // Create the chart once on mount.
  useEffect(() => {
    if (!containerRef.current) return;

    // The terminal chrome gets a more legible price axis than Futures'
    // default chrome — brighter axis text, a faint horizontal grid tying
    // candles to price levels, and a clearer crosshair — requested
    // specifically for the spot terminal. Gated on `terminal` rather than
    // applied everywhere so Futures' chart (out of scope here) is
    // pixel-identical to before.
    const chart = createChart(containerRef.current, {
      layout: {
        // Pure black, not the panel's dark-gray — the chart is meant to
        // read as its own "screen" rather than blend into the surrounding
        // panel chrome.
        background: { type: ColorType.Solid, color: '#000000' },
        // A cool, slightly desaturated near-white rather than pure #fff —
        // reads as a premium instrument panel, not a stark spreadsheet.
        textColor: terminal ? '#c7d2e0' : '#a3adba',
        fontFamily: 'var(--font-ui)',
        fontSize: terminal ? 12 : 11,
      },
      grid: {
        vertLines: { visible: false },
        // Faint horizontal reference lines only — enough to tie a candle
        // to its price level without turning the chart into a spreadsheet
        // grid. Vertical (time) gridlines stay off; the crosshair below
        // already marks a specific moment when the trader needs one.
        horzLines: terminal ? { color: 'rgba(148, 163, 184, 0.07)' } : { visible: false },
      },
      // borderColor is what draws the 1px seam between the candles and the
      // price axis — a graphite/blue tone rather than near-black makes the
      // axis read as an intentional part of the chart instead of text
      // floating in empty space.
      rightPriceScale: { borderColor: terminal ? '#334155' : '#2b303a' },
      timeScale: { borderColor: terminal ? '#334155' : '#2b303a', timeVisible: true },
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
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#eaecef',
      downColor: '#f7a600',
      borderVisible: false,
      wickUpColor: '#eaecef',
      wickDownColor: '#f7a600',
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

    function pointFromEvent(param: MouseEventParams<Time>): Point | null {
      if (!param.point || !seriesRef.current) return null;
      const price = seriesRef.current.coordinateToPrice(param.point.y);
      const time = param.time ?? chart.timeScale().coordinateToTime(param.point.x);
      if (price === null || time === null) return null;
      return { time: time as unknown as number, price };
    }

    function handleClick(param: MouseEventParams<Time>) {
      const activeTool = toolRef.current;
      if (activeTool !== 'horizontal' && activeTool !== 'text' && activeTool !== 'ray' && activeTool !== 'vertical') return;
      const p = pointFromEvent(param);
      if (!p) return;

      if (activeTool === 'horizontal') {
        const line = seriesRef.current!.createPriceLine({
          price: p.price,
          color: '#f7a600',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: p.price.toFixed(2),
        });
        priceLinesRef.current.push(line);
        if (!stayInDrawModeRef.current) setTool('cursor');
        return;
      }

      if (activeTool === 'ray') {
        setRays((prev) => [...prev, { id: nextDrawingId++, a: p }]);
        if (!stayInDrawModeRef.current) setTool('cursor');
        return;
      }

      if (activeTool === 'vertical') {
        setVerticals((prev) => [...prev, { id: nextDrawingId++, time: p.time }]);
        if (!stayInDrawModeRef.current) setTool('cursor');
        return;
      }

      if (activeTool === 'text') {
        // Prompt label read from a ref: this handler is bound once, so a
        // captured `t` would keep showing the language active at mount.
        const text = window.prompt(textPromptRef.current);
        if (text && text.trim()) {
          setLabels((prev) => [...prev, { id: nextDrawingId++, at: p, text: text.trim() }]);
          if (!stayInDrawModeRef.current) setTool('cursor');
        }
      }
    }

    chart.subscribeClick(handleClick);

    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.resize(width, height);
      redraw();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.unsubscribeClick(handleClick);
      chart.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching tools (or pairs) cancels any half-drawn shape so a stray
  // anchor point from a previous tool never leaks into the next drawing.
  useEffect(() => {
    setPendingPoint(null);
    setCursorPoint(null);
  }, [tool, pair]);

  // Esc abandons whatever is in progress and drops back to the cursor —
  // the same escape hatch every charting package gives you, and the reason
  // a half-drawn trend line can never trap the pointer in drawing mode.
  // Bound to the window because the drag listeners are too, and a drag can
  // legitimately be outside the chart when Esc is pressed.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setPendingPoint(null);
      setPendingBrush(null);
      setCursorPoint(null);
      setTool('cursor');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Called the moment a shape is committed. With stay-in-drawing-mode off
  // the tool releases back to the cursor, exactly one shape per selection.
  const finishDrawing = useCallback(() => {
    if (!stayInDrawModeRef.current) setTool('cursor');
  }, []);

  // Drawings are per-pair — a trend line drawn on BTC/USDT shouldn't show
  // up on ETH/USDT. Native price lines also need explicit cleanup since
  // they live on the series object, not React state.
  useEffect(() => {
    setTrendLines([]);
    setRulers([]);
    setLabels([]);
    setRays([]);
    setVerticals([]);
    setRectangles([]);
    setFibs([]);
    setBrushStrokes([]);
    setPendingPoint(null);
    setPendingBrush(null);
    for (const line of priceLinesRef.current) {
      seriesRef.current?.removePriceLine(line);
    }
    priceLinesRef.current = [];
  }, [pair]);

  const clearAll = useCallback(() => {
    // One click used to wipe every drawing on the chart with no way back.
    // There is no undo and no per-object selection here, so the confirm is
    // the only thing standing between a misclick and losing the lot.
    if (!window.confirm(confirmClearRef.current)) return;
    setTrendLines([]);
    setRulers([]);
    setLabels([]);
    setRays([]);
    setVerticals([]);
    setRectangles([]);
    setFibs([]);
    setBrushStrokes([]);
    setPendingPoint(null);
    setPendingBrush(null);
    for (const line of priceLinesRef.current) {
      seriesRef.current?.removePriceLine(line);
    }
    priceLinesRef.current = [];
  }, []);

  const fitContent = useCallback(() => {
    chartRef.current?.timeScale().fitContent();
  }, []);

  // Load candles whenever pair/interval changes, and poll for updates.
  useEffect(() => {
    let cancelled = false;
    // Only set the initial visible range once per pair/interval — every
    // later poll must leave the user's own pan/zoom alone.
    let hasSetInitialRange = false;

    async function load() {
      try {
        const res = await api.getExternalCandles(pair, interval, CANDLE_FETCH_LIMIT);
        if (cancelled || !seriesRef.current || !volumeSeriesRef.current) return;
        setEmpty(res.candles.length === 0);
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

        const macd = computeMACD(res.candles);
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
      } catch {
        // Chart just stays empty on failure — not worth a full error state
        // for a background poll.
      }
    }

    load();
    const poll = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [pair, interval]);

  // Poll this pair's pending SL/TP orders — cheap enough at 4s, same
  // cadence OpenOrdersPanel already polls at.
  useEffect(() => {
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
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [pair]);

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
          .then((orders) =>
            setConditionalOrders(
              orders
                .filter((o) => o.pair === pair)
                .map((o) => ({ id: o.id, side: o.side, type: o.type, triggerPrice: o.triggerPrice, price: o.price, ocoGroupId: o.ocoGroupId }))
            )
          )
          .catch(() => {});
      }
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    },
    [pair, yToPrice]
  );

  function toScreen(p: Point): { x: number; y: number } | null {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return null;
    const x = chart.timeScale().timeToCoordinate(p.time as unknown as Time);
    const y = series.priceToCoordinate(p.price);
    if (x === null || y === null) return null;
    return { x, y };
  }

  // Vertical lines only need an x — unlike toScreen, this doesn't require a
  // price to also be on-screen at that time.
  function timeToX(time: number): number | null {
    return chartRef.current?.timeScale().timeToCoordinate(time as unknown as Time) ?? null;
  }

  function pointFromClientXY(clientX: number, clientY: number): Point | null {
    const container = containerRef.current;
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!container || !chart || !series) return null;
    const rect = container.getBoundingClientRect();
    const price = series.coordinateToPrice(clientY - rect.top);
    const time = chart.timeScale().coordinateToTime(clientX - rect.left);
    if (price === null || time === null) return null;
    return { time: time as unknown as number, price };
  }

  // Trend line / ruler / rectangle / fib: a genuine press-drag-release
  // gesture (like TradingView's own tools) instead of two separate clicks —
  // mousedown sets the anchor, mousemove live-previews the shape, mouseup
  // finalizes it. Native window listeners (not React handlers) so the drag
  // keeps tracking even if the cursor leaves the chart area mid-gesture.
  const handleOverlayMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (tool === 'brush') {
        const start = pointFromClientXY(e.clientX, e.clientY);
        if (!start) return;
        let points: Point[] = [start];
        setPendingBrush(points);
        function handleMove(ev: MouseEvent) {
          const p = pointFromClientXY(ev.clientX, ev.clientY);
          if (p) {
            points = [...points, p];
            setPendingBrush(points);
          }
        }
        function handleUp() {
          window.removeEventListener('mousemove', handleMove);
          window.removeEventListener('mouseup', handleUp);
          setPendingBrush(null);
          if (points.length > 1) {
            setBrushStrokes((prev) => [...prev, { id: nextDrawingId++, points }]);
            finishDrawing();
          }
        }
        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        return;
      }

      if (tool !== 'trendline' && tool !== 'ruler' && tool !== 'rectangle' && tool !== 'fib') return;
      const startPoint = pointFromClientXY(e.clientX, e.clientY);
      if (!startPoint) return;
      const start: Point = startPoint;
      const startX = e.clientX;
      const startY = e.clientY;
      setPendingPoint(start);
      setCursorPoint(start);

      function handleMove(ev: MouseEvent) {
        const p = pointFromClientXY(ev.clientX, ev.clientY);
        if (p) setCursorPoint(p);
      }
      function handleUp(ev: MouseEvent) {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
        setPendingPoint(null);
        setCursorPoint(null);
        // A near-zero drag is a stray click, not an intended measurement —
        // don't leave a zero-length shape behind.
        if (Math.abs(ev.clientX - startX) < 3 && Math.abs(ev.clientY - startY) < 3) return;
        const end = pointFromClientXY(ev.clientX, ev.clientY);
        if (!end) return;
        const activeTool = toolRef.current;
        if (activeTool === 'trendline') {
          setTrendLines((prev) => [...prev, { id: nextDrawingId++, a: start, b: end }]);
        } else if (activeTool === 'ruler') {
          setRulers((prev) => [...prev, { id: nextDrawingId++, a: start, b: end }]);
        } else if (activeTool === 'rectangle') {
          setRectangles((prev) => [...prev, { id: nextDrawingId++, a: start, b: end }]);
        } else if (activeTool === 'fib') {
          setFibs((prev) => [...prev, { id: nextDrawingId++, a: start, b: end }]);
        }
        finishDrawing();
      }
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    },
    [tool, finishDrawing]
  );

  const intervalButtons = INTERVALS.map((i) => (
    <button
      key={i}
      onClick={() => setInterval_(i)}
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
      onClick={() => setChartType(ct)}
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
    <div style={terminal ? TERMINAL_WRAPPER : styles.wrapper}>
      {terminal ? (
        <div className="chart-toolbar">
          <div className="chart-tabs">{intervalButtons}</div>
          <div className="chart-tools">
            {typeButtons}
            {indicatorButtons}
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

      <div className={terminal ? 'chart-view' : undefined} style={terminal ? TERMINAL_VIEW : styles.body}>
        <DrawToolbar
          tool={tool}
          onSelect={setTool}
          onClear={clearAll}
          onFit={fitContent}
          terminal={terminal}
          drawingsHidden={drawingsHidden}
          onToggleHidden={() => setDrawingsHidden((v) => !v)}
          stayInDrawMode={stayInDrawMode}
          onToggleStay={() => setStayInDrawMode((v) => !v)}
        />

        <div style={styles.chartArea}>
          <div ref={containerRef} style={styles.chart} />

          {terminal && <div className="chart-watermark">{pair.split('/')[0]}</div>}

          <svg
            className="drawing-overlay"
            style={{
              ...styles.overlay,
              // Hiding is purely visual — every shape stays in state, so
              // toggling back restores exactly what was there. While hidden
              // the overlay also stops taking pointer events, otherwise an
              // invisible layer would swallow clicks meant for the chart.
              display: drawingsHidden ? 'none' : undefined,
              pointerEvents:
                !drawingsHidden && ['trendline', 'ruler', 'rectangle', 'fib', 'brush'].includes(tool)
                  ? 'auto'
                  : 'none',
            }}
            onMouseDown={handleOverlayMouseDown}
          >
            {/* A bare <svg> only hit-tests its painted children, not its own
                empty viewport — without this transparent (not "none") rect
                covering the whole area, drags over blank chart space would
                fall straight through to the canvas underneath. */}
            {['trendline', 'ruler', 'rectangle', 'fib', 'brush'].includes(tool) && (
              <rect x={0} y={0} width="100%" height="100%" fill="transparent" />
            )}

            {trendLines.map((l) => {
              const a = toScreen(l.a);
              const b = toScreen(l.b);
              if (!a || !b) return null;
              return <line key={l.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f7a600" strokeWidth={1.5} />;
            })}

            {rays.map((r) => {
              const a = toScreen(r.a);
              if (!a) return null;
              return <line key={r.id} x1={a.x} y1={a.y} x2="100%" y2={a.y} stroke="#f7a600" strokeWidth={1.5} strokeDasharray="5 3" />;
            })}

            {verticals.map((v) => {
              const x = timeToX(v.time);
              if (x === null) return null;
              return <line key={v.id} x1={x} y1={0} x2={x} y2="100%" stroke="#5b8def" strokeWidth={1.5} strokeDasharray="5 3" />;
            })}

            {rectangles.map((r) => {
              const a = toScreen(r.a);
              const b = toScreen(r.b);
              if (!a || !b) return null;
              const x = Math.min(a.x, b.x);
              const y = Math.min(a.y, b.y);
              return (
                <rect
                  key={r.id}
                  x={x}
                  y={y}
                  width={Math.abs(b.x - a.x)}
                  height={Math.abs(b.y - a.y)}
                  fill="rgba(91,141,239,0.12)"
                  stroke="#5b8def"
                  strokeWidth={1.5}
                />
              );
            })}

            {fibs.map((f) => {
              const a = toScreen(f.a);
              const b = toScreen(f.b);
              if (!a || !b) return null;
              const x1 = Math.min(a.x, b.x);
              const x2 = Math.max(a.x, b.x);
              return (
                <g key={f.id}>
                  {FIB_LEVELS.map((level) => {
                    const price = f.a.price + (f.b.price - f.a.price) * level;
                    const y = priceToY(price);
                    if (y === null) return null;
                    return (
                      <g key={level}>
                        <line x1={x1} y1={y} x2={x2} y2={y} stroke="#c084fc" strokeWidth={1} strokeDasharray="3 3" />
                        <text x={x2 + 4} y={y + 3} fontSize={10} fontWeight={600} fill="#c084fc">
                          {level.toFixed(3)} ({price.toFixed(2)})
                        </text>
                      </g>
                    );
                  })}
                </g>
              );
            })}

            {brushStrokes.map((s) => {
              const pts = s.points.map(toScreen).filter((p): p is { x: number; y: number } => p !== null);
              if (pts.length < 2) return null;
              return <polyline key={s.id} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#00d68f" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />;
            })}

            {pendingBrush &&
              (() => {
                const pts = pendingBrush.map(toScreen).filter((p): p is { x: number; y: number } => p !== null);
                if (pts.length < 2) return null;
                return <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#00d68f" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />;
              })()}

            {rulers.map((r) => {
              const a = toScreen(r.a);
              const b = toScreen(r.b);
              if (!a || !b) return null;
              const priceDiff = r.b.price - r.a.price;
              const pct = (priceDiff / r.a.price) * 100;
              const bars = Math.round(Math.abs(r.b.time - r.a.time) / INTERVAL_SECONDS[interval]);
              const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              return (
                <g key={r.id}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#5b8def" strokeWidth={1.5} strokeDasharray="4 3" />
                  <RulerLabel x={mid.x} y={mid.y} pct={pct} priceDiff={priceDiff} bars={bars} />
                </g>
              );
            })}

            {pendingPoint &&
              cursorPoint &&
              (() => {
                const a = toScreen(pendingPoint);
                const b = toScreen(cursorPoint);
                if (!a || !b) return null;
                if (tool === 'ruler') {
                  const priceDiff = cursorPoint.price - pendingPoint.price;
                  const pct = (priceDiff / pendingPoint.price) * 100;
                  const bars = Math.round(Math.abs(cursorPoint.time - pendingPoint.time) / INTERVAL_SECONDS[interval]);
                  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                  return (
                    <g>
                      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#5b8def" strokeWidth={1.5} strokeDasharray="3 3" />
                      <RulerLabel x={mid.x} y={mid.y} pct={pct} priceDiff={priceDiff} bars={bars} />
                    </g>
                  );
                }
                if (tool === 'rectangle') {
                  const x = Math.min(a.x, b.x);
                  const y = Math.min(a.y, b.y);
                  return (
                    <rect
                      x={x}
                      y={y}
                      width={Math.abs(b.x - a.x)}
                      height={Math.abs(b.y - a.y)}
                      fill="rgba(91,141,239,0.12)"
                      stroke="#5b8def"
                      strokeWidth={1.5}
                      strokeDasharray="3 3"
                    />
                  );
                }
                if (tool === 'fib') {
                  const x1 = Math.min(a.x, b.x);
                  const x2 = Math.max(a.x, b.x);
                  return (
                    <g>
                      {FIB_LEVELS.map((level) => {
                        const price = pendingPoint.price + (cursorPoint.price - pendingPoint.price) * level;
                        const y = priceToY(price);
                        if (y === null) return null;
                        return <line key={level} x1={x1} y1={y} x2={x2} y2={y} stroke="#c084fc" strokeWidth={1} strokeDasharray="3 3" />;
                      })}
                    </g>
                  );
                }
                return (
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f7a600" strokeWidth={1.5} strokeDasharray="3 3" />
                );
              })()}

            {conditionalOrders.map((o) => {
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

          {labels.map((l) => {
            const p = toScreen(l.at);
            if (!p) return null;
            return (
              <div key={l.id} style={{ ...styles.textLabel, left: p.x, top: p.y }}>
                {l.text}
              </div>
            );
          })}

          {empty && (
            <div style={styles.emptyOverlay}>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{t('trade.noChartData', { pair })}</span>
            </div>
          )}

          {(showMA || showBollinger || showRSI || showMACD) && (
            <div style={styles.legend}>
              {showMA && <LegendItem color={INDICATOR_COLORS.ma} label={t('chart.indicator.ma')} />}
              {showBollinger && <LegendItem color={INDICATOR_COLORS.bollinger} label={t('chart.indicator.bollinger')} />}
              {showRSI && <LegendItem color={INDICATOR_COLORS.rsi} label={t('chart.indicator.rsi')} />}
              {showMACD && <LegendItem color={INDICATOR_COLORS.macd} label={t('chart.indicator.macd')} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div style={styles.legendItem}>
      <span style={{ ...styles.legendDot, background: color }} />
      {label}
    </div>
  );
}

function RulerLabel({ x, y, pct, priceDiff, bars }: { x: number; y: number; pct: number; priceDiff: number; bars: number }) {
  const positive = pct >= 0;
  const sign = positive ? '+' : '';
  const pctText = `${sign}${pct.toFixed(2)}%`;
  const diffMagnitude = Math.abs(priceDiff);
  const diffText = `${sign}${priceDiff.toFixed(diffMagnitude !== 0 && diffMagnitude < 1 ? 6 : 2)}`;
  const detailText = `${diffText} · ${bars} бар${bars === 1 ? '' : 'ів'}`;
  const width = Math.max(pctText.length, detailText.length) * 6.6 + 14;
  return (
    <g transform={`translate(${x - width / 2}, ${y - 20})`}>
      <rect width={width} height={38} rx={5} fill={positive ? '#00d68f' : '#ff4d6a'} />
      <text x={width / 2} y={16} textAnchor="middle" fontSize={12} fontWeight={700} fill="#0b0e11">
        {pctText}
      </text>
      <text x={width / 2} y={30} textAnchor="middle" fontSize={10} fontWeight={600} fill="#0b0e11" opacity={0.85}>
        {detailText}
      </text>
    </g>
  );
}

/**
 * The left drawing rail, laid out the way a TradingView or Bybit user
 * expects: cursor first, then the drawing tools grouped by kind, then
 * measure/zoom, then the drawing-session toggles, and destructive actions
 * last behind a separator.
 *
 * Only tools this chart actually implements are exposed. That is why there
 * is no magnet and no lock button — this overlay has no snapping and no
 * per-object selection, so either one would be a control that does
 * nothing. Fibonacci, shapes, brush, text and measure each have exactly one
 * implemented tool, so they stay direct buttons rather than one-item menus;
 * trend lines are the one family with four, so they get the flyout.
 *
 * The trend group behaves like the reference terminals': the main button
 * activates whichever tool of the group you used last, and the small
 * chevron opens the list. Nothing about that is persisted beyond the
 * session — see `lastTrend`.
 */
function DrawToolbar({
  tool,
  onSelect,
  onClear,
  onFit,
  terminal,
  drawingsHidden,
  onToggleHidden,
  stayInDrawMode,
  onToggleStay,
}: {
  tool: Tool;
  onSelect: (t: Tool) => void;
  onClear: () => void;
  onFit: () => void;
  terminal?: boolean;
  drawingsHidden: boolean;
  onToggleHidden: () => void;
  stayInDrawMode: boolean;
  onToggleStay: () => void;
}) {
  const { t } = useLanguage();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  // Where to paint the flyout, in viewport coordinates. The rail has to
  // scroll on short screens, and an element that scrolls on one axis can
  // never let content overflow the other — `overflow-x: visible` computes
  // to `auto` — so a flyout positioned inside the rail is clipped away
  // rather than shown. Rendering it into a portal at fixed coordinates is
  // what keeps it visible without giving up the rail's own scrolling.
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  // Last tool picked inside the trend group, so its button keeps offering
  // that one — the familiar behaviour from professional terminals.
  const [lastTrend, setLastTrend] = useState<Tool>('trendline');
  const groupRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);

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
      if (e.key === 'Escape') setOpenGroup(null);
    }
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openGroup]);

  const TREND_TOOLS: { id: Tool; icon: JSX.Element; label: string }[] = [
    { id: 'trendline', icon: <TrendLineIcon />, label: t('draw.trendline') },
    { id: 'ray', icon: <RayIcon />, label: t('draw.ray') },
    { id: 'horizontal', icon: <HorizontalIcon />, label: t('draw.horizontal') },
    { id: 'vertical', icon: <VerticalIcon />, label: t('draw.vertical') },
  ];
  const trendActive = TREND_TOOLS.some((x) => x.id === tool);
  const trendCurrent = TREND_TOOLS.find((x) => x.id === lastTrend) ?? TREND_TOOLS[0];

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
    <button key={id} title={title} aria-label={title} aria-pressed={active} onClick={onClick} className={`tool-btn ${active ? 'active' : ''}`}>
      {icon}
    </button>
  );

  return (
    <div className="draw-toolbar">
      {btn('cursor', t('draw.cursor'), <CursorIcon />, () => onSelect('cursor'), tool === 'cursor')}

      <div className="tool-divider" />

      {/* The one family with several implemented tools. Main button picks
          the last-used one; the chevron opens the rest. */}
      <div className={`tool-group ${openGroup === 'trend' ? 'open' : ''}`} ref={groupRef}>
        <button
          title={trendCurrent.label}
          aria-label={trendCurrent.label}
          aria-pressed={trendActive}
          onClick={() => onSelect(trendCurrent.id)}
          className={`tool-btn ${trendActive ? 'active' : ''}`}
        >
          {trendCurrent.icon}
        </button>
        <button
          className="tool-group-chevron"
          aria-label={t('draw.trend')}
          aria-haspopup="menu"
          aria-expanded={openGroup === 'trend'}
          onClick={(e) => {
            const wrap = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
            setFlyoutPos({ top: wrap.top - 4, left: wrap.right + 6 });
            setOpenGroup((g) => (g === 'trend' ? null : 'trend'));
          }}
        >
          <svg width="5" height="5" viewBox="0 0 5 5" aria-hidden="true">
            <path d="M5 0v5H0z" fill="currentColor" />
          </svg>
        </button>
        {openGroup === 'trend' && flyoutPos && createPortal(
          <div
            className="tool-flyout"
            role="menu"
            ref={flyoutRef}
            style={{ top: flyoutPos.top, left: flyoutPos.left }}
          >
            {TREND_TOOLS.map((x) => (
              <button
                key={x.id}
                role="menuitem"
                className={`tool-flyout-item ${tool === x.id ? 'active' : ''}`}
                onClick={() => {
                  setLastTrend(x.id);
                  onSelect(x.id);
                  setOpenGroup(null);
                }}
              >
                {x.icon}
                <span>{x.label}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
      </div>

      {btn('fib', t('draw.fib'), <FibIcon />, () => onSelect('fib'), tool === 'fib')}
      {btn('rectangle', t('draw.rectangle'), <RectangleIcon />, () => onSelect('rectangle'), tool === 'rectangle')}
      {btn('brush', t('draw.brush'), <BrushIcon />, () => onSelect('brush'), tool === 'brush')}
      {btn('text', t('draw.text'), <TextIcon />, () => onSelect('text'), tool === 'text')}

      <div className="tool-divider" />

      {btn('ruler', t('draw.measure'), <RulerIcon />, () => onSelect('ruler'), tool === 'ruler')}
      {btn('fit', t('draw.zoom'), <FitIcon />, onFit, false)}

      <div className="tool-divider" />

      {btn('stay', t('draw.stayMode'), <StayModeIcon />, onToggleStay, stayInDrawMode)}
      {btn(
        'hide',
        drawingsHidden ? t('draw.show') : t('draw.hide'),
        drawingsHidden ? <EyeOffIcon /> : <EyeIcon />,
        onToggleHidden,
        drawingsHidden
      )}

      <div className="tool-divider" />

      {btn('clear', t('draw.deleteAll'), <EraserIcon />, onClear, false)}
    </div>
  );
}

const ICON_PROPS = {
  width: 17,
  height: 17,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function CursorIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 4l7 16 2.5-6.5L20 11 4 4z" />
    </svg>
  );
}
function TrendLineIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="6" r="2" />
      <line x1="7.5" y1="16.5" x2="16.5" y2="7.5" />
    </svg>
  );
}
function HorizontalIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="3" y1="8" x2="21" y2="8" />
      <line x1="3" y1="16" x2="21" y2="16" strokeDasharray="3 3" />
    </svg>
  );
}
function RayIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none" />
      <line x1="7" y1="12" x2="20" y2="12" strokeDasharray="3 2" />
    </svg>
  );
}
function VerticalIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="3 2" />
    </svg>
  );
}
function RectangleIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="4" y="6" width="16" height="12" rx="1" />
    </svg>
  );
}
function FibIcon() {
  return (
    <svg {...ICON_PROPS}>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="11" x2="21" y2="11" strokeDasharray="3 2" />
      <line x1="3" y1="16" x2="21" y2="16" strokeDasharray="3 2" />
      <line x1="3" y1="21" x2="21" y2="21" />
    </svg>
  );
}
function BrushIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 20c2-5 3-8 8-13l3 3c-5 5-8 6-13 8z" />
      <path d="M14 8l2-2a2 2 0 0 1 3 3l-2 2" />
    </svg>
  );
}
function RulerIcon() {
  return (
    <svg {...ICON_PROPS}>
      <rect x="3" y="9" width="18" height="6" rx="1" transform="rotate(-20 12 12)" />
      <path d="M8 10l1 1.5M11 9l1 1.5M14 8l1 1.5" transform="rotate(-20 12 12)" />
    </svg>
  );
}
function TextIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M5 5h14M12 5v14" />
    </svg>
  );
}
function FitIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}
/* Same stroke system as every other tool icon in this rail — one coherent
   set, no mixed icon families. */
function StayModeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M14 4l6 6-9.5 9.5H4.5V13L14 4z" />
      <line x1="12" y1="6" x2="18" y2="12" />
    </svg>
  );
}
function EyeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}
function EyeOffIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M9.6 5.8A10.8 10.8 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a18 18 0 0 1-3.3 4.2" />
      <path d="M6.3 7.7A17.6 17.6 0 0 0 2 12s3.6 6.5 10 6.5a10.6 10.6 0 0 0 3.4-.55" />
      <line x1="3.5" y1="3.5" x2="20.5" y2="20.5" />
    </svg>
  );
}
function EraserIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 16l8-8 6 6-6 6H8l-4-4z" />
      <line x1="9" y1="21" x2="20" y2="21" />
    </svg>
  );
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
};
