import { useEffect, useRef, useState } from 'react';
import { createChart, ColorType, CandlestickSeries, IChartApi, ISeriesApi } from 'lightweight-charts';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { parseChangePercent } from '../lib/priceChange';
import type { CfdTickerRow } from './CfdInstrumentList';

const INTERVALS = ['5m', '15m', '1h', '4h', '1d', '1w'] as const;
type Interval = (typeof INTERVALS)[number];

/**
 * Real candlestick chart for CFD instruments, fed by Twelve Data's
 * /time_series endpoint (src/cfd/candles route -> CfdMarketDataService.
 * getCandles). A deliberately smaller sibling of PriceChart — no drawing
 * tools or SL/TP lines, since CFD positions are MARKET-only with no
 * conditional-order concept (see CfdPositionService's doc comment).
 */
export function CfdChart({ symbol, ticker }: { symbol: string; ticker: CfdTickerRow | undefined }) {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [interval, setInterval_] = useState<Interval>('1h');
  const [empty, setEmpty] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#000000' }, textColor: '#a3adba', fontFamily: 'var(--font-ui)', fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderColor: '#2b303a' },
      timeScale: { borderColor: '#2b303a', timeVisible: true },
      crosshair: { mode: 0 },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#eaecef',
      downColor: '#f7a600',
      borderVisible: false,
      wickUpColor: '#eaecef',
      wickDownColor: '#f7a600',
    });
    chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
    chartRef.current = chart;
    seriesRef.current = series;

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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await api.getCfdCandles(symbol, interval);
        if (cancelled || !seriesRef.current) return;
        setErrored(false);
        setEmpty(res.candles.length === 0);
        seriesRef.current.setData(res.candles.map((c) => ({ time: c.time as any, open: c.open, high: c.high, low: c.low, close: c.close })));
        chartRef.current?.timeScale().fitContent();
      } catch {
        if (!cancelled) setErrored(true);
      }
    }
    load();
    // Matches CfdMarketDataService's CANDLES_TTL_MS — see CFD_INSTRUMENTS'
    // doc comment there for the Twelve Data credit budget this is paced
    // against.
    const poll = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [symbol, interval]);

  const change = ticker ? parseChangePercent(ticker.changePercent24h, ticker.symbol) : 0;
  const positive = change >= 0;

  return (
    <div style={styles.wrapper}>
      <div style={styles.topBar}>
        <div style={styles.priceInfo}>
          <span className="mono" style={styles.symbol}>
            {ticker?.symbol ?? symbol}
          </span>
          {ticker && (
            <>
              <span className="mono" style={styles.price}>
                {ticker.price}
              </span>
              <span className={`mono ${positive ? 'text-buy' : 'text-sell'}`} style={styles.change}>
                {positive ? '+' : ''}
                {change.toFixed(2)}%
              </span>
            </>
          )}
        </div>
        <div style={styles.intervalRow}>
          {INTERVALS.map((i) => (
            <button key={i} onClick={() => setInterval_(i)} style={{ ...styles.intervalBtn, ...(interval === i ? styles.intervalBtnActive : {}) }}>
              {i}
            </button>
          ))}
        </div>
      </div>

      <div style={styles.chartArea}>
        <div ref={containerRef} style={styles.chart} />
        {(empty || errored) && (
          <div style={styles.emptyOverlay}>
            <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{errored ? t('trade.cfdChartUnavailable') : t('trade.noChartData', { pair: symbol })}</span>
          </div>
        )}
      </div>
      <p style={styles.disclaimer}>{t('trade.cfdPriceDisclaimer')}</p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--panel)', overflow: 'hidden', minHeight: 300 },
  topBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap' },
  priceInfo: { display: 'flex', alignItems: 'baseline', gap: 10 },
  symbol: { fontSize: 13, fontWeight: 800, letterSpacing: '0.03em' },
  price: { fontSize: 18, fontWeight: 800 },
  change: { fontSize: 13, fontWeight: 700 },
  intervalRow: { display: 'flex', gap: 4 },
  intervalBtn: { background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '5px 10px', borderRadius: 6 },
  intervalBtnActive: { background: 'var(--accent)', color: 'var(--on-accent)' },
  chartArea: { flex: 1, position: 'relative', minWidth: 0 },
  chart: { position: 'absolute', inset: 0 },
  emptyOverlay: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', textAlign: 'center', padding: 24 },
  disclaimer: { fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'center', margin: 0, padding: '6px 12px', borderTop: '1px solid var(--border)' },
};
