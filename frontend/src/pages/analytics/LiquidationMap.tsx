import { useState } from 'react';
import type { AnalyticsSnapshot, GatewaySection } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { Metric, formatUsd, formatPrice, formatQuantity } from './presentation';
import { valueOf, coverage, dateTime } from './approvedData';
import { Panel, Empty, Segmented, useCopy } from './approvedPrimitives';

type HeatmapCell = { x: number; y: number; intensity: number };
type HeatmapCandle = { time: number; open: number; high: number; low: number; close: number; volumeUsd: number };
type HeatmapValue = {
  baseAsset: string; exchange: string; symbol: string; range: '3d'; prices: number[];
  cells: HeatmapCell[]; candles: HeatmapCandle[];
};
type PremiumSnapshot = AnalyticsSnapshot & {
  sections: AnalyticsSnapshot['sections'] & { liquidationHeatmap?: GatewaySection<HeatmapValue> };
};

function LicensedHeatmap({ snapshot }: { snapshot: AnalyticsSnapshot | null }) {
  const { lang } = useLanguage();
  const section = (snapshot as PremiumSnapshot | null)?.sections.liquidationHeatmap;
  const data = valueOf(section);
  if (!section?.available || !data || data.prices.length < 2 || data.cells.length === 0 || data.candles.length < 2) return null;

  const positive = data.cells.filter(cell => cell.intensity > 0);
  const maxIntensity = Math.max(0, ...positive.map(cell => cell.intensity));
  if (maxIntensity <= 0) return null;
  const xCount = Math.max(data.candles.length, ...data.cells.map(cell => cell.x + 1));
  const yCount = data.prices.length;
  const minPrice = Math.min(...data.prices);
  const maxPrice = Math.max(...data.prices);
  const lastPrice = data.candles[data.candles.length - 1]?.close ?? null;
  const strongest = positive.reduce((best, cell) => cell.intensity > best.intensity ? cell : best, positive[0]);
  const strongestPrice = data.prices[strongest.y] ?? null;
  const line = data.candles.map((candle, i) => {
    const x = data.candles.length <= 1 ? 50 : i / (data.candles.length - 1) * 100;
    const y = maxPrice === minPrice ? 50 : 100 - ((candle.close - minPrice) / (maxPrice - minPrice) * 100);
    return `${x.toFixed(2)},${Math.max(0, Math.min(100, y)).toFixed(2)}`;
  }).join(' ');

  return <Panel title={lang === 'ru' ? 'Карта ликвидаций' : 'Liquidation heatmap'}
    subtitle={data.baseAsset} section={section} tools={<span className="ap-subtle">3D</span>}>
    <div className="ap-metrics-3">
      <Metric label={lang === 'ru' ? 'Текущая цена' : 'Current price'} value={formatPrice(lastPrice)} />
      <Metric label={lang === 'ru' ? 'Макс. концентрация' : 'Max concentration'} value={formatQuantity(maxIntensity)} />
      <Metric label={lang === 'ru' ? 'Сильнейший уровень' : 'Strongest level'} value={formatPrice(strongestPrice)} />
    </div>
    <div role="img" aria-label={lang === 'ru' ? 'Карта потенциальных уровней ликвидаций' : 'Potential liquidation levels heatmap'}
      style={{ position: 'relative', height: 300, border: '1px solid #e3e4e7', background: '#101215', overflow: 'hidden' }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" style={{ width: '100%', height: '100%', display: 'block' }}>
        {positive.slice(0, 12000).map((cell, i) => {
          const width = 100 / Math.max(1, xCount);
          const height = 100 / Math.max(1, yCount);
          const x = cell.x * width;
          const y = 100 - (cell.y + 1) * height;
          const opacity = Math.max(.08, Math.min(.9, cell.intensity / maxIntensity));
          return <rect key={`${cell.x}-${cell.y}-${i}`} x={x} y={y} width={width + .08} height={height + .08}
            fill={`rgba(217,164,59,${opacity})`} />;
        })}
        <polyline points={line} fill="none" stroke="#f3f4f5" strokeWidth=".45" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
    <div className="ap-chart-axis"><span>{formatPrice(minPrice)}</span><span>{data.symbol}</span><span>{formatPrice(maxPrice)}</span></div>
  </Panel>;
}

/** Observed forced-liquidation executions remain separate from latent heatmap levels. */
export function LiquidationMap({ snapshot }: { snapshot: AnalyticsSnapshot | null }) {
  const { t } = useLanguage(), c = useCopy();
  const [hours, setHours] = useState(12);
  const section = snapshot?.sections.liquidations, data = valueOf(section);
  const window = data?.windows.find(w => w.hours === hours) ?? null;
  const buckets = window?.buckets ?? [];
  const maximum = Math.max(0, ...buckets.map(b => b.longNotionalUsd + b.shortNotionalUsd));
  const start = buckets[0]?.fromPrice, end = buckets[buckets.length - 1]?.toPrice;
  return <>
    <LicensedHeatmap snapshot={snapshot} />
    <Panel title={c.observed} subtitle={c.distribution} className="ap-liquidations" section={section}
      tools={<Segmented values={[4, 12, 24]} selected={hours} onChange={setHours} label={c.sourcePeriod} suffix="h" />}>
      <div className="ap-metrics-4">
        <Metric label={c.total} value={formatUsd(window?.totalNotionalUsd)} />
        <Metric label={t('analytics.long')} value={formatUsd(window?.longNotionalUsd)} />
        <Metric label={t('analytics.short')} value={formatUsd(window?.shortNotionalUsd)} />
        <Metric label={c.largest} value={formatUsd(window?.largestEvent?.notionalUsd)} />
      </div>
      {window && !window.coverageComplete && <div className="ap-coverage" data-coverage="partial">
        <strong>{c.partial}</strong><span>{window.coverageStartAt == null ? '—' : dateTime(window.coverageStartAt)} — {dateTime(window.to)}</span>
        <div role="progressbar" aria-label={c.collected} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(coverage(window))}><i style={{ width: coverage(window) + '%' }} /></div>
      </div>}
      {maximum > 0 ? <div className="ap-bucket-chart" role="img" aria-label={c.distribution}>
        <div className="ap-chart-scale"><span>{formatUsd(maximum)}</span><span>{formatUsd(maximum / 2)}</span><span>$0</span></div>
        <div className="ap-bucket-bars">{buckets.map((b, i) => <div className="ap-bucket-column" key={i}>
          <div className="ap-bucket-stack" style={{ height: (b.longNotionalUsd + b.shortNotionalUsd) / maximum * 100 + '%' }}
            title={formatPrice(b.fromPrice) + '–' + formatPrice(b.toPrice) + ' · ' + t('analytics.long') + ': ' + formatUsd(b.longNotionalUsd) + ' · ' + t('analytics.short') + ': ' + formatUsd(b.shortNotionalUsd)}>
            <i className="ap-bucket-short" style={{ flex: b.shortNotionalUsd }} /><i className="ap-bucket-long" style={{ flex: b.longNotionalUsd }} />
          </div>
        </div>)}</div>
        <div className="ap-chart-axis"><span>{formatPrice(start)}</span><span>{c.price} · USD</span><span>{formatPrice(end)}</span></div>
      </div> : <div className="ap-empty">{window ? c.noEvents : '—'}</div>}
      <div className="ap-chart-legend"><span><i className="ap-gold-key" />{t('analytics.long')}</span><span><i className="ap-light-key" />{t('analytics.short')}</span><span>{c.observedOnly} · {formatQuantity(window?.eventCount) ?? '—'}</span></div>
    </Panel>
    <Panel title={c.recent} tools={<span className="ap-subtle">{hours}h</span>}>
      {window?.recent.length ? <div className="ap-table-scroll"><table>
        <thead><tr>{[c.time, t('analytics.assetContext'), c.side, c.price + ' · USD', c.notional].map(h => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{window.recent.slice(0, 8).map(event => <tr key={event.id}>
          <td>{dateTime(event.tradeTime)}</td><td><strong>{event.baseAsset}</strong></td><td><span className={'ap-side ' + (event.side === 'LONG' ? 'ap-long' : 'ap-short')}>{event.side === 'LONG' ? t('analytics.long') : t('analytics.short')}</span></td>
          <td>{formatPrice(event.price)}</td><td>{formatUsd(event.notionalUsd)}</td>
        </tr>)}</tbody></table></div> : <Empty />}
    </Panel>
  </>;
}
