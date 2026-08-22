import { useEffect, useRef, useState, useCallback } from 'react';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  IChartApi,
  ISeriesApi,
  IPriceLine,
  MouseEventParams,
  Time,
} from 'lightweight-charts';

const MA_PERIOD = 200;
const VISIBLE_CANDLES = 300;
// Fetch enough extra history that the MA200 line has a full 200-bar
// warm-up BEFORE the window we actually show — otherwise the line only
// starts partway across the visible chart (no average exists yet for the
// first 200 loaded candles).
const CANDLE_FETCH_LIMIT = VISIBLE_CANDLES + MA_PERIOD + 20;

/** Simple moving average over `period` closes — only emits a point once a
 * full window is available, same convention every charting platform uses
 * (a partial-window "average" at the start of the series would be
 * misleading, not just visually shorter). */
function computeSMA(candles: { time: number; close: number }[], period: number) {
  const points: { time: number; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) points.push({ time: candles[i].time as unknown as number, value: sum / period });
  }
  return points;
}
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
type Interval = (typeof INTERVALS)[number];

type Tool = 'cursor' | 'trendline' | 'horizontal' | 'ruler' | 'text';

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
 * The left-side drawing toolbar (trend line, horizontal line, ruler, text,
 * eraser, fit-to-content) is a deliberately smaller, honest subset of what
 * TradingView's own licensed charting library ships — every tool here is
 * fully functional, drawn with a plain SVG overlay kept in sync with the
 * chart's pan/zoom via its own coordinate-conversion APIs. No icon here is
 * decoration for a feature that doesn't work.
 */
export function PriceChart({ pair }: { pair: string }) {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const maSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const [interval, setInterval_] = useState<Interval>('15m');
  const [empty, setEmpty] = useState(false);

  const [tool, setTool] = useState<Tool>('cursor');
  const [trendLines, setTrendLines] = useState<TrendLine[]>([]);
  const [rulers, setRulers] = useState<Ruler[]>([]);
  const [labels, setLabels] = useState<TextLabel[]>([]);
  const [pendingPoint, setPendingPoint] = useState<Point | null>(null);
  const [cursorPoint, setCursorPoint] = useState<Point | null>(null);
  // Bumped on every pan/zoom/resize to force the SVG overlay to recompute
  // screen coordinates from the stored (time, price) points.
  const [, forceRedraw] = useState(0);

  const toolRef = useRef(tool);
  toolRef.current = tool;
  const pendingRef = useRef(pendingPoint);
  pendingRef.current = pendingPoint;

  // Create the chart once on mount.
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        // Pure black, not the panel's dark-gray — the chart is meant to
        // read as its own "screen" rather than blend into the surrounding
        // panel chrome.
        background: { type: ColorType.Solid, color: '#000000' },
        textColor: '#a3adba',
        fontFamily: 'var(--font-ui)',
        fontSize: 11,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      rightPriceScale: { borderColor: '#2b303a' },
      timeScale: { borderColor: '#2b303a', timeVisible: true },
      crosshair: { mode: 0 },
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
    });
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.3 } });

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

    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;
    maSeriesRef.current = maSeries;

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
      if (activeTool === 'cursor') return;
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
        return;
      }

      if (activeTool === 'text') {
        const text = window.prompt('Текст:');
        if (text && text.trim()) {
          setLabels((prev) => [...prev, { id: nextDrawingId++, at: p, text: text.trim() }]);
        }
        return;
      }

      // Trend line / ruler: two-click tools — first click sets the anchor,
      // second click finalizes the shape and clears the anchor.
      const anchor = pendingRef.current;
      if (!anchor) {
        setPendingPoint(p);
        return;
      }
      if (activeTool === 'trendline') {
        setTrendLines((prev) => [...prev, { id: nextDrawingId++, a: anchor, b: p }]);
      } else if (activeTool === 'ruler') {
        setRulers((prev) => [...prev, { id: nextDrawingId++, a: anchor, b: p }]);
      }
      setPendingPoint(null);
    }

    function handleMove(param: MouseEventParams<Time>) {
      if (!pendingRef.current) return;
      setCursorPoint(pointFromEvent(param));
    }

    chart.subscribeClick(handleClick);
    chart.subscribeCrosshairMove(handleMove);

    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.resize(width, height);
      redraw();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.unsubscribeClick(handleClick);
      chart.unsubscribeCrosshairMove(handleMove);
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

  // Drawings are per-pair — a trend line drawn on BTC/USDT shouldn't show
  // up on ETH/USDT. Native price lines also need explicit cleanup since
  // they live on the series object, not React state.
  useEffect(() => {
    setTrendLines([]);
    setRulers([]);
    setLabels([]);
    setPendingPoint(null);
    for (const line of priceLinesRef.current) {
      seriesRef.current?.removePriceLine(line);
    }
    priceLinesRef.current = [];
  }, [pair]);

  const clearAll = useCallback(() => {
    setTrendLines([]);
    setRulers([]);
    setLabels([]);
    setPendingPoint(null);
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

  function toScreen(p: Point): { x: number; y: number } | null {
    const chart = chartRef.current;
    const series = seriesRef.current;
    if (!chart || !series) return null;
    const x = chart.timeScale().timeToCoordinate(p.time as unknown as Time);
    const y = series.priceToCoordinate(p.price);
    if (x === null || y === null) return null;
    return { x, y };
  }

  return (
    <div style={styles.wrapper}>
      <div style={styles.topToolbar}>
        {INTERVALS.map((i) => (
          <button
            key={i}
            onClick={() => setInterval_(i)}
            style={{ ...styles.intervalBtn, ...(interval === i ? styles.intervalBtnActive : {}) }}
          >
            {i}
          </button>
        ))}
      </div>

      <div style={styles.body}>
        <DrawToolbar tool={tool} onSelect={setTool} onClear={clearAll} onFit={fitContent} />

        <div style={styles.chartArea}>
          <div ref={containerRef} style={styles.chart} />

          <svg style={styles.overlay}>
            {trendLines.map((l) => {
              const a = toScreen(l.a);
              const b = toScreen(l.b);
              if (!a || !b) return null;
              return <line key={l.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#f7a600" strokeWidth={1.5} />;
            })}

            {rulers.map((r) => {
              const a = toScreen(r.a);
              const b = toScreen(r.b);
              if (!a || !b) return null;
              const pct = ((r.b.price - r.a.price) / r.a.price) * 100;
              const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              return (
                <g key={r.id}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#5b8def" strokeWidth={1.5} strokeDasharray="4 3" />
                  <RulerLabel x={mid.x} y={mid.y} pct={pct} />
                </g>
              );
            })}

            {pendingPoint &&
              cursorPoint &&
              (() => {
                const a = toScreen(pendingPoint);
                const b = toScreen(cursorPoint);
                if (!a || !b) return null;
                return (
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={tool === 'ruler' ? '#5b8def' : '#f7a600'}
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                  />
                );
              })()}
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
        </div>
      </div>
    </div>
  );
}

function RulerLabel({ x, y, pct }: { x: number; y: number; pct: number }) {
  const positive = pct >= 0;
  const text = `${positive ? '+' : ''}${pct.toFixed(2)}%`;
  const width = text.length * 7 + 12;
  return (
    <g transform={`translate(${x - width / 2}, ${y - 11})`}>
      <rect width={width} height={22} rx={5} fill={positive ? '#00d68f' : '#ff4d6a'} />
      <text x={width / 2} y={15} textAnchor="middle" fontSize={11} fontWeight={700} fill="#0b0e11">
        {text}
      </text>
    </g>
  );
}

function DrawToolbar({
  tool,
  onSelect,
  onClear,
  onFit,
}: {
  tool: Tool;
  onSelect: (t: Tool) => void;
  onClear: () => void;
  onFit: () => void;
}) {
  const TOOLS: { id: Tool; icon: JSX.Element; title: string }[] = [
    { id: 'cursor', icon: <CursorIcon />, title: 'Курсор' },
    { id: 'trendline', icon: <TrendLineIcon />, title: 'Линия тренда' },
    { id: 'horizontal', icon: <HorizontalIcon />, title: 'Горизонтальная линия' },
    { id: 'ruler', icon: <RulerIcon />, title: 'Линейка' },
    { id: 'text', icon: <TextIcon />, title: 'Текст' },
  ];

  return (
    <div style={styles.drawToolbar}>
      {TOOLS.map((tl) => (
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
      <button title="Показать всё" onClick={onFit} style={styles.toolBtn}>
        <FitIcon />
      </button>
      <button title="Очистить рисунки" onClick={onClear} style={styles.toolBtn}>
        <EraserIcon />
      </button>
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
function EraserIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 16l8-8 6 6-6 6H8l-4-4z" />
      <line x1="9" y1="21" x2="20" y2="21" />
    </svg>
  );
}

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
    gap: 4,
    padding: '8px 12px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
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
