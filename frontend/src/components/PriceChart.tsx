import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CandlestickSeries, HistogramSeries, IChartApi, ISeriesApi } from 'lightweight-charts';
import { api } from '../lib/api';

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
type Interval = (typeof INTERVALS)[number];

export function PriceChart({ pair }: { pair: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [interval, setInterval_] = useState<Interval>('1m');
  const [empty, setEmpty] = useState(false);

  // Create the chart once on mount.
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#848e9c',
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1c1f26' },
        horzLines: { color: '#1c1f26' },
      },
      rightPriceScale: { borderColor: '#23262d' },
      timeScale: { borderColor: '#23262d', timeVisible: true },
      crosshair: { mode: 0 },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#00c076',
      downColor: '#f6465d',
      borderVisible: false,
      wickUpColor: '#00c076',
      wickDownColor: '#f6465d',
    });
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.3 } });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    chartRef.current = chart;
    seriesRef.current = series;
    volumeSeriesRef.current = volumeSeries;

    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.resize(width, height);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, []);

  // Load candles whenever pair/interval changes, and poll for updates.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await api.getExternalCandles(pair, interval, 300);
        if (cancelled || !seriesRef.current || !volumeSeriesRef.current) return;
        setEmpty(res.candles.length === 0);
        seriesRef.current.setData(
          res.candles.map((c) => ({ time: c.time as any, open: c.open, high: c.high, low: c.low, close: c.close }))
        );
        volumeSeriesRef.current.setData(
          res.candles.map((c) => ({
            time: c.time as any,
            value: c.volume,
            color: c.close >= c.open ? 'rgba(0,192,118,0.5)' : 'rgba(246,70,93,0.5)',
          }))
        );
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

  return (
    <div style={styles.wrapper}>
      <div style={styles.toolbar}>
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
      <div ref={containerRef} style={styles.chart} />
      {empty && (
        <div style={styles.emptyOverlay}>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
            Немає даних графіка для {pair}
          </span>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
    minHeight: 300,
  },
  toolbar: {
    display: 'flex',
    gap: 4,
    padding: '8px 12px',
    borderBottom: '1px solid var(--border)',
  },
  intervalBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    padding: '4px 8px',
    borderRadius: 3,
  },
  intervalBtnActive: {
    background: 'var(--panel-alt)',
    color: 'var(--text-primary)',
  },
  chart: {
    flex: 1,
  },
  emptyOverlay: {
    position: 'absolute',
    inset: 0,
    top: 37,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    textAlign: 'center',
    padding: 24,
  },
};
