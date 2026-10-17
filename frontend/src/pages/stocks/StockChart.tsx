import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CandlestickSeries, ColorType, createChart, CrosshairMode, HistogramSeries, TickMarkType, type IChartApi, type ISeriesApi, type MouseEventParams, type Time, type UTCTimestamp } from 'lightweight-charts';
import { RotateCcw } from 'lucide-react';
import type { StockCandle } from '../../lib/stocks';
import { localeOf, useLanguage, type Key } from '../../lib/i18n';
import type { ChartPeriod, PeriodRange } from './stockModel';
import { currencyDigits, formatStockDay, formatStockPrice } from './stockFormat';

export type ChartStatus = 'loading' | 'ready' | 'empty' | 'error';

interface Props {
  /** The instrument the candles belong to; a change re-frames the chart. */
  instrumentId: string;
  candles: readonly StockCandle[];
  currency: string;
  timeZone: string;
  status: ChartStatus;
  periods: ReadonlyMap<ChartPeriod, PeriodRange>;
  period: ChartPeriod;
  onPeriod: (period: ChartPeriod) => void;
  onRetry: () => void;
  /** Text of the error overlay (no data to show). */
  errorText?: Key;
  /** A compact strip between the toolbar and the plot, e.g. a failed refresh over kept data. */
  notice?: ReactNode;
}

const PERIOD_ORDER: readonly ChartPeriod[] = ['1D', '5D', '1M', 'all'];
const PERIOD_LABEL: Record<ChartPeriod, Key> = { '1D': 'stocks.period1D', '5D': 'stocks.period5D', '1M': 'stocks.period1M', all: 'stocks.periodAll' };

const seconds = (ms: number) => Math.floor(ms / 1000) as UTCTimestamp;

/** Decimal places the loaded prices carry (at least the currency's), capped for the axis. */
function pricePrecision(candles: readonly StockCandle[], currency: string): number {
  let places = currencyDigits(currency);
  for (const candle of candles.slice(-60)) {
    for (const value of [candle.open, candle.high, candle.low, candle.close]) {
      const fraction = value.split('.')[1]?.replace(/0+$/, '') ?? '';
      places = Math.max(places, fraction.length);
    }
  }
  return Math.min(places, 8);
}

/**
 * One chart for the life of the panel. The host is always in the DOM, so the
 * chart exists before the first answer arrives; loading, empty and error are
 * overlays on top of it. Switching instrument or period re-frames the chart;
 * a refresh of the same instrument keeps the reader's zoom.
 */
export function StockChart({ instrumentId, candles, currency, timeZone, status, periods, period, onPeriod, onRetry, errorText = 'stocks.unavailable', notice }: Props) {
  const { t, lang } = useLanguage();
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const byTime = useRef(new Map<number, StockCandle>());
  const framed = useRef('');
  const zoneRef = useRef(timeZone);
  const localeRef = useRef(localeOf(lang));
  const tokens = useRef({ up: '#20b26c', down: '#ef454a', volumeUp: 'rgba(32,178,108,.28)', volumeDown: 'rgba(239,69,74,.28)' });
  const [hover, setHover] = useState<StockCandle | null>(null);
  zoneRef.current = timeZone;
  localeRef.current = localeOf(lang);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const style = getComputedStyle(host);
    const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    tokens.current = {
      up: token('--vxs-chart-up', '#20b26c'), down: token('--vxs-chart-down', '#ef454a'),
      volumeUp: token('--vxs-chart-volume-up', 'rgba(32,178,108,.28)'), volumeDown: token('--vxs-chart-volume-down', 'rgba(239,69,74,.28)'),
    };
    const axisBorder = token('--vxs-chart-axis-border', '#25282c');
    const zoned = (time: Time, options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(localeRef.current, { ...options, timeZone: zoneRef.current }).format((time as number) * 1000);
    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: token('--vxs-chart-bg', '#101014') },
        textColor: token('--vxs-chart-axis-text', '#8b8b8e'),
        fontFamily: token('--vxs-chart-font', 'Inter, Arial, sans-serif'),
        fontSize: 11,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: token('--vxs-chart-grid', 'rgba(255,255,255,.04)') } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: axisBorder, scaleMargins: { top: 0.08, bottom: 0.2 } },
      timeScale: {
        borderColor: axisBorder, timeVisible: true, secondsVisible: false,
        tickMarkFormatter: (time: Time, type: TickMarkType) => type === TickMarkType.Year ? zoned(time, { year: 'numeric' })
          : type === TickMarkType.Month ? zoned(time, { month: 'short' })
          : type === TickMarkType.DayOfMonth ? zoned(time, { day: 'numeric', month: 'short' })
          : zoned(time, { hour: '2-digit', minute: '2-digit' }),
      },
      localization: {
        timeFormatter: (time: Time) => zoned(time, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
      },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: tokens.current.up, downColor: tokens.current.down, wickUpColor: tokens.current.up, wickDownColor: tokens.current.down,
      borderVisible: false, priceLineColor: token('--vxs-accent', '#f0b90b'),
    });
    const volumeSeries = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume', lastValueVisible: false, priceLineVisible: false });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 }, visible: false });
    const crosshair = (param: MouseEventParams) => setHover(param.time === undefined ? null : byTime.current.get(param.time as number) ?? null);
    chart.subscribeCrosshairMove(crosshair);
    chartRef.current = chart; candleRef.current = candleSeries; volumeRef.current = volumeSeries;
    return () => {
      chart.unsubscribeCrosshairMove(crosshair);
      chartRef.current = null; candleRef.current = null; volumeRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current, candleSeries = candleRef.current, volumeSeries = volumeRef.current;
    if (!chart || !candleSeries || !volumeSeries) return;
    const map = new Map<number, StockCandle>();
    for (const candle of candles) map.set(seconds(candle.openTimeUtc), candle);
    byTime.current = map;
    setHover(null);
    const precision = pricePrecision(candles, currency);
    candleSeries.applyOptions({ priceFormat: { type: 'price', precision, minMove: 1 / 10 ** precision } });
    candleSeries.setData(candles.map(c => ({ time: seconds(c.openTimeUtc), open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) })));
    const { volumeUp, volumeDown } = tokens.current;
    volumeSeries.setData(candles.filter(c => c.volume !== null).map(c => ({ time: seconds(c.openTimeUtc), value: Number(c.volume), color: Number(c.close) >= Number(c.open) ? volumeUp : volumeDown })));
    const frame = `${instrumentId}|${period}`;
    // An emptied chart (another instrument loading) is re-framed by whatever
    // it draws next, even the same instrument again; kept data never empties it.
    if (!candles.length) { framed.current = ''; return; }
    if (framed.current === frame) return;
    const range = periods.get(period);
    if (period === 'all' || !range) chart.timeScale().fitContent();
    else chart.timeScale().setVisibleRange({ from: seconds(range.from), to: seconds(range.to) });
    framed.current = frame;
  }, [candles, currency, instrumentId, period, periods]);

  const shown = hover ?? candles[candles.length - 1];
  const all = periods.get('all');
  const available = PERIOD_ORDER.filter(key => periods.has(key));
  return (
    <section className="vxs-chart" aria-label={t('stocks.history')}>
      <div className="vxs-chart-bar">
        <div className="vxs-periods" role="group" aria-label={t('stocks.period')}>
          {available.map(key => (
            <button key={key} type="button" aria-pressed={period === key} onClick={() => onPeriod(key)}>{t(PERIOD_LABEL[key])}</button>
          ))}
          <span className="vxs-chart-interval">{t('stocks.intervalValue')}</span>
          {all && status === 'ready' && <span className="vxs-chart-span">
            {t('stocks.loadedSpan', { count: candles.length, from: formatStockDay(all.from, lang, timeZone), to: formatStockDay(all.to, lang, timeZone) })}
          </span>}
        </div>
        {shown && status === 'ready' && <dl className="vxs-ohlc" aria-live="off">
          <div><dt>{t('stocks.ohlcOpen')}</dt><dd>{formatStockPrice(shown.open, currency)}</dd></div>
          <div><dt>{t('stocks.ohlcHigh')}</dt><dd>{formatStockPrice(shown.high, currency)}</dd></div>
          <div><dt>{t('stocks.ohlcLow')}</dt><dd>{formatStockPrice(shown.low, currency)}</dd></div>
          <div><dt>{t('stocks.ohlcClose')}</dt><dd>{formatStockPrice(shown.close, currency)}</dd></div>
        </dl>}
      </div>
      {notice}
      <div className="vxs-chart-stage">
        <div ref={hostRef} className="vxs-chart-host" data-instrument={instrumentId} />
        {status !== 'ready' && <div className="vxs-chart-overlay" role="status">
          {status === 'loading' ? <span className="vxs-spinner" aria-hidden="true" /> : null}
          <p>{t(status === 'loading' ? 'stocks.loading' : status === 'empty' ? 'stocks.noHistory' : errorText)}</p>
          {status === 'error' && <button type="button" className="vxs-retry" onClick={onRetry}><RotateCcw size={14} aria-hidden="true" />{t('stocks.retry')}</button>}
        </div>}
      </div>
    </section>
  );
}
