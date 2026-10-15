import { useMemo } from 'react';
import { ANALYTICS_PERIODS, periodBars, periodStats, volatilityStats, type AnalyticsPeriod } from '../../lib/chartCandleStats';
import { MIN_CORRELATION_POINTS, formatPercent, relativeStrength } from '../../lib/chartCompare';
import type { ChartTimeframe } from '../../lib/chartTimeframes';
import type { Candle } from '../../lib/indicators';
import type { Key } from '../../lib/i18n';
import { ICONS } from './chartWorkspaceIcons';

export interface AnalyticsCompareInput { pair: string; color: string; candles: readonly Candle[] }

export interface ChartAnalyticsPanelProps {
  candles: readonly Candle[];
  timeframe: ChartTimeframe;
  period: AnalyticsPeriod;
  onPeriod: (period: AnalyticsPeriod) => void;
  /** Logical visible range of the main chart, for the «visible» period. */
  visibleRange: { from: number; to: number } | null;
  mainPair: string;
  compare: AnalyticsCompareInput[];
  sameQuote: boolean;
  formatPrice: (value: number) => string;
  formatVolume: (value: number) => string;
  /** False where the bars carry no traded volume (CFD): the row is left out rather than shown as 0. */
  volume?: boolean;
  lang: string;
  t: (key: Key, params?: Record<string, string | number>) => string;
  nowMs: number;
  onClose: () => void;
}

const utc = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ');
const num = (value: number | null, digits = 2, lang = 'ru') => (value === null || !Number.isFinite(value) ? '—' : value.toLocaleString(lang === 'ru' ? 'ru-RU' : lang, { minimumFractionDigits: digits, maximumFractionDigits: digits }));

/** «Аналитика»: the period's figures, relative strength against compared instruments, and volatility — all from the loaded bars. */
export function ChartAnalyticsPanel({ candles, timeframe, period, onPeriod, visibleRange, mainPair, compare, sameQuote, formatPrice, formatVolume, volume = true, lang, t, nowMs, onClose }: ChartAnalyticsPanelProps) {
  const bars = useMemo(() => periodBars(candles, period, visibleRange), [candles, period, visibleRange]);
  const stats = useMemo(() => periodStats(bars, timeframe, nowMs), [bars, timeframe, nowMs]);
  const vol = useMemo(() => volatilityStats(bars, timeframe, { nowMs }), [bars, timeframe, nowMs]);
  const window = stats ? { from: stats.from, to: stats.to } : null;
  const strength = useMemo(() => (window ? compare.map(item => ({ ...item, rs: relativeStrength({ id: mainPair, candles }, { id: item.pair, candles: item.candles }, { ...window, sameQuote }) })) : []), [compare, candles, mainPair, window?.from, window?.to, sameQuote]);
  const pct = (value: number | null) => formatPercent(value, lang);
  const tone = (value: number | null) => (value === null ? '' : value > 0 ? ' is-up' : value < 0 ? ' is-down' : '');
  return (
    <section className="cw-panel cw-analytics" role="region" aria-label={t('chart.ws.analytics.title')} data-cw-analytics>
      <header className="cw-panel-head">
        <span>{t('chart.ws.analytics.title')}</span>
        <button type="button" className="cw-icon-button" aria-label={t('chart.ws.close')} title={t('chart.ws.close')} data-cw-analytics-close onClick={onClose}>{ICONS.close}</button>
      </header>
      <div className="cw-chips" role="group" aria-label={t('chart.ws.analytics.period')}>
        {ANALYTICS_PERIODS.map(p => <button key={p} type="button" className={`cw-chip${period === p ? ' active' : ''}`} aria-pressed={period === p} data-cw-analytics-period={p} onClick={() => onPeriod(p)}>{t(`chart.ws.period.${p}` as Key)}</button>)}
      </div>
      {!stats && <p className="cw-hint">{t('chart.ws.analytics.empty')}</p>}
      {stats && (
        <>
          <dl className="cw-rows" data-cw-analytics-block="period">
            <div className={`cw-row-line${tone(stats.change)}`}><dt>{t('chart.ws.stat.change')}</dt><dd>{`${stats.change > 0 ? '+' : stats.change < 0 ? '−' : ''}${formatPrice(Math.abs(stats.change))} (${pct(stats.changePct)})`}</dd></div>
            <div className="cw-row-line"><dt>{t('chart.ws.stat.high')}</dt><dd>{formatPrice(stats.high)}</dd></div>
            <div className="cw-row-line"><dt>{t('chart.ws.stat.low')}</dt><dd>{formatPrice(stats.low)}</dd></div>
            <div className="cw-row-line"><dt>{t('chart.ws.stat.range')}</dt><dd>{`${formatPrice(stats.range)} (${num(stats.rangePct, 2, lang)}%)`}</dd></div>
            {volume && <div className="cw-row-line"><dt>{t('chart.ws.stat.volume')}</dt><dd>{formatVolume(stats.volume)}</dd></div>}
            <div className="cw-row-line"><dt>{t('chart.ws.stat.bars')}</dt><dd>{stats.completed}{stats.hasForming ? ` ${t('chart.ws.stat.forming')}` : ''}</dd></div>
            {stats.bestBar && <div className="cw-row-line is-up"><dt>{t('chart.ws.stat.best')}</dt><dd>{`${pct(stats.bestBar.changePct)} · ${utc(stats.bestBar.time)}`}</dd></div>}
            {stats.worstBar && <div className="cw-row-line is-down"><dt>{t('chart.ws.stat.worst')}</dt><dd>{`${pct(stats.worstBar.changePct)} · ${utc(stats.worstBar.time)}`}</dd></div>}
          </dl>
          <p className="cw-hint">{t('chart.ws.stat.note', { from: utc(stats.from), to: utc(stats.to) })}</p>
          <div className="cw-panel-section" data-cw-analytics-block="strength">
            <div className="cw-section-title">{t('chart.ws.rs.title')}</div>
            {strength.length === 0 && <p className="cw-hint">{t('chart.ws.rs.off')}</p>}
            {strength.map(item => (
              <dl className="cw-rows" key={item.pair} data-cw-analytics-rs={item.pair}>
                <div className="cw-row-line"><dt><span className="cw-swatch" style={{ background: '#f0b90b' }} aria-hidden="true" />{mainPair} · {t('chart.ws.rs.return')}</dt><dd className={tone(item.rs.returns[mainPair] ?? null)}>{pct(item.rs.returns[mainPair] ?? null)}</dd></div>
                <div className="cw-row-line"><dt><span className="cw-swatch" style={{ background: item.color }} aria-hidden="true" />{item.pair} · {t('chart.ws.rs.return')}</dt><dd className={tone(item.rs.returns[item.pair] ?? null)}>{pct(item.rs.returns[item.pair] ?? null)}</dd></div>
                <div className="cw-row-line"><dt>{t('chart.ws.rs.spread')}</dt><dd className={tone(item.rs.spread)}>{item.rs.spread === null ? '—' : `${item.rs.spread > 0 ? '+' : item.rs.spread < 0 ? '−' : ''}${num(Math.abs(item.rs.spread), 2, lang)}`}</dd></div>
                <div className="cw-row-line"><dt>{t('chart.ws.rs.correlation')}</dt><dd>{item.rs.correlation === null ? t('chart.ws.rs.insufficient', { n: MIN_CORRELATION_POINTS }) : num(item.rs.correlation, 2, lang)}</dd></div>
                {item.rs.ratio !== null && <div className="cw-row-line"><dt>{t('chart.ws.rs.ratio')}</dt><dd>{num(item.rs.ratio, 4, lang)}</dd></div>}
                {item.rs.correlation !== null && <p className="cw-hint">{t('chart.ws.rs.correlationNote', { n: item.rs.common })}</p>}
              </dl>
            ))}
          </div>
          <div className="cw-panel-section" data-cw-analytics-block="volatility">
            <div className="cw-section-title">{t('chart.ws.vol.title')}</div>
            <dl className="cw-rows">
              <div className="cw-row-line"><dt>{t('chart.ws.vol.atr', { n: vol.atrPeriod })}</dt><dd>{vol.atr === null ? '—' : `${formatPrice(vol.atr)} (${num(vol.atrPct, 2, lang)}%)`}</dd></div>
              <div className="cw-row-line"><dt>{t('chart.ws.vol.realized')}</dt><dd>{vol.realized === null ? '—' : `${num(vol.realized, 3, lang)}% ${t('chart.ws.vol.perBar')} · ${num(vol.annualized, 1, lang)}% ${t('chart.ws.vol.annual')}`}</dd></div>
              <div className="cw-row-line"><dt>{t('chart.ws.vol.range')}</dt><dd>{vol.averageRangePct === null ? '—' : `${num(vol.averageRangePct, 2, lang)}%`}</dd></div>
            </dl>
            <p className="cw-hint">{t('chart.ws.vol.realizedNote', { n: vol.barsPerYear ?? '—' })}</p>
          </div>
        </>
      )}
    </section>
  );
}
