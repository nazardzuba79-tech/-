import { useState } from 'react';
import type { AnalyticsSnapshot } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { Metric, formatUsd, formatPrice, formatQuantity } from './presentation';
import { valueOf, coverage, dateTime } from './approvedData';
import { Panel, Empty, Segmented, useCopy } from './approvedPrimitives';

/** Archive layout, but bars are executed events, never latent liquidation levels. */
export function LiquidationMap({ snapshot }: { snapshot: AnalyticsSnapshot | null }) {
  const { t } = useLanguage(), c = useCopy();
  const [hours, setHours] = useState(12);
  const section = snapshot?.sections.liquidations, data = valueOf(section);
  const window = data?.windows.find(w => w.hours === hours) ?? null;
  const buckets = window?.buckets ?? [];
  const maximum = Math.max(0, ...buckets.map(b => b.longNotionalUsd + b.shortNotionalUsd));
  const start = buckets[0]?.fromPrice, end = buckets[buckets.length - 1]?.toPrice;
  return <>
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
