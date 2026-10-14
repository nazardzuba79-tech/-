import type { BarStats } from '../../lib/chartCandleStats';
import { formatPercent } from '../../lib/chartCompare';
import type { Key } from '../../lib/i18n';
import { ICONS } from './chartWorkspaceIcons';

export interface DataWindowIndicator { id: string; label: string; color: string; lines: { label: string; value: number | null }[] }
export interface DataWindowCompare { pair: string; color: string; value: number | null }

export interface ChartDataWindowProps {
  stats: BarStats | null;
  indicators: DataWindowIndicator[];
  compare: DataWindowCompare[] | null;
  formatPrice: (value: number) => string;
  formatVolume: (value: number) => string;
  lang: string;
  t: (key: Key, params?: Record<string, string | number>) => string;
  touch: boolean;
  onClose: () => void;
}

const utc = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ');
const signed = (value: number, format: (v: number) => string) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${format(Math.abs(value))}`;

/** «Данные»: the hovered (or tapped) candle's own numbers and the indicator values at that bar. */
export function ChartDataWindow({ stats, indicators, compare, formatPrice, formatVolume, lang, t, touch, onClose }: ChartDataWindowProps) {
  const rows: [string, string, string?][] = stats ? [
    [t('chart.ws.data.time'), utc(stats.time)],
    [t('chart.ws.data.open'), formatPrice(stats.open)],
    [t('chart.ws.data.high'), formatPrice(stats.high)],
    [t('chart.ws.data.low'), formatPrice(stats.low)],
    [t('chart.ws.data.close'), formatPrice(stats.close)],
    [t('chart.ws.data.volume'), formatVolume(stats.volume)],
    [t('chart.ws.data.change'), signed(stats.change, formatPrice), stats.change > 0 ? 'up' : stats.change < 0 ? 'down' : undefined],
    [t('chart.ws.data.changePct'), formatPercent(stats.changePct, lang), stats.changePct > 0 ? 'up' : stats.changePct < 0 ? 'down' : undefined],
    [t('chart.ws.data.body'), formatPrice(stats.body)],
    [t('chart.ws.data.upperWick'), formatPrice(stats.upperWick)],
    [t('chart.ws.data.lowerWick'), formatPrice(stats.lowerWick)],
  ] : [];
  return (
    <section className="cw-panel cw-data" role="region" aria-label={t('chart.ws.data.title')} data-cw-data-window>
      <header className="cw-panel-head">
        <span>{t('chart.ws.data.title')}</span>
        {stats && <span className={`cw-panel-tag${stats.forming ? ' is-forming' : ''}`}>{t(stats.forming ? 'chart.ws.data.forming' : 'chart.ws.data.completed')}</span>}
        <button type="button" className="cw-icon-button" aria-label={t('chart.ws.close')} title={t('chart.ws.close')} data-cw-data-close onClick={onClose}>{ICONS.close}</button>
      </header>
      {!stats && <p className="cw-hint">{t(touch ? 'chart.ws.data.hintTouch' : 'chart.ws.data.hint')}</p>}
      {stats && (
        <dl className="cw-rows">
          {rows.map(([label, value, tone]) => <div key={label} className={`cw-row-line${tone ? ` is-${tone}` : ''}`}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      )}
      {stats && indicators.length > 0 && (
        <div className="cw-panel-section">
          <div className="cw-section-title">{t('chart.ws.data.indicators')}</div>
          <dl className="cw-rows">
            {indicators.map(ind => ind.lines.map(line => (
              <div key={`${ind.id}:${line.label}`} className="cw-row-line" data-cw-data-indicator={ind.id}>
                <dt><span className="cw-swatch" style={{ background: ind.color }} aria-hidden="true" />{ind.lines.length > 1 ? `${ind.label} · ${line.label}` : ind.label}</dt>
                <dd>{line.value === null ? '—' : formatPrice(line.value)}</dd>
              </div>
            )))}
          </dl>
        </div>
      )}
      {stats && compare && compare.length > 0 && (
        <div className="cw-panel-section">
          <div className="cw-section-title">{t('chart.ws.data.compare')}</div>
          <dl className="cw-rows">
            {compare.map(item => (
              <div key={item.pair} className="cw-row-line" data-cw-data-compare={item.pair}>
                <dt><span className="cw-swatch" style={{ background: item.color }} aria-hidden="true" />{item.pair}</dt>
                <dd>{formatPercent(item.value, lang)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
