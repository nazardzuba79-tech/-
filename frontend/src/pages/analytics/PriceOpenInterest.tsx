import { useEffect, useState } from 'react';
import { api, type AnalyticsSnapshot, type GatewaySection } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { Metric, formatPrice, formatQuantity, formatUsd } from './presentation';
import { contractFor, dateTime, lineCoordinates, valueOf } from './approvedData';
import { Panel, Empty, useCopy } from './approvedPrimitives';
import type { OpenInterestHistoryValue } from './openInterestHistoryApi';

type Candle = { time: number; close: number };
type SnapshotWithOpenInterestHistory = AnalyticsSnapshot & {
  sections: AnalyticsSnapshot['sections'] & {
    openInterestHistory?: GatewaySection<OpenInterestHistoryValue>;
  };
};

/** Reference price candles + a real hourly open-interest series from the shared Analytics snapshot. */
export function PriceOpenInterest({ snapshot, asset }: { snapshot: AnalyticsSnapshot | null; asset: string | null }) {
  const { t } = useLanguage(), c = useCopy();
  const [history, setHistory] = useState<{ asset: string; candles: Candle[]; stale: boolean } | null>(null);

  useEffect(() => {
    if (!asset) return;
    let cancelled = false;
    void api.getExternalCandles(asset + '/USDT', '1h', 168).then(result => {
      if (cancelled) return;
      const candles = result.candles.filter(row => Number.isFinite(row.close) && row.close > 0 && Number.isFinite(row.time)).sort((a, b) => a.time - b.time);
      setHistory({ asset, candles, stale: false });
    }).catch(() => {
      if (!cancelled) setHistory(previous => previous?.asset === asset ? { ...previous, stale: true } : null);
    });
    return () => { cancelled = true; };
  }, [asset, snapshot?.generatedAt]);

  const candles = history?.asset === asset ? history.candles : [];
  const values = candles.map(candle => candle.close);
  const contract = contractFor(snapshot, asset);
  const points = lineCoordinates(values).map(point => point.join(',')).join(' ');
  const timeMs = (time: number) => time < 1e12 ? time * 1000 : time;

  const oiSection = (snapshot as SnapshotWithOpenInterestHistory | null)?.sections.openInterestHistory;
  const oi = valueOf(oiSection);
  const usdPoints = (oi?.points ?? []).filter(point => point.openInterestUsd !== null) as Array<{ observedAt: number; openInterestBase: number; openInterestUsd: number }>;
  const useUsd = usdPoints.length >= 2;
  const oiRows = useUsd ? usdPoints : (oi?.points ?? []);
  const oiValues = oiRows.map(point => useUsd ? point.openInterestUsd! : point.openInterestBase);
  const oiPolyline = lineCoordinates(oiValues).map(point => point.join(',')).join(' ');
  const latestOi = oiRows[oiRows.length - 1];
  const latestOiValue = latestOi ? (useUsd ? formatUsd(latestOi.openInterestUsd) : `${formatQuantity(latestOi.openInterestBase)} ${asset ?? ''}`) : null;

  return <Panel title={c.priceHistory} subtitle={asset ?? undefined} className="ap-price-panel"
    tools={<span className="ap-subtle">{history?.asset === asset && history.stale ? t('analytics.stale') : '7d · 1h'}</span>}>
    <div className="ap-metrics-3">
      <Metric label={t('analytics.markPrice')} value={formatPrice(contract?.markPrice)} />
      <Metric label={c.currentOi + ' · USD'} value={formatUsd(contract?.openInterestUsd)} />
      <Metric label={c.oiHistory} value={latestOiValue} />
    </div>

    {values.length > 1 ? <div className="ap-line-chart" role="img" aria-label={c.priceSeries}>
      <div className="ap-chart-scale"><span>{formatPrice(Math.max(...values))}</span><span>{formatPrice(Math.min(...values))}</span></div>
      <svg viewBox="0 0 720 190" preserveAspectRatio="none" aria-hidden="true">
        {[0, 1, 2, 3].map(i => <line key={i} x1="0" x2="720" y1={i * 60 + 5} y2={i * 60 + 5} stroke="#E3E4E7" strokeDasharray="3 4" />)}
        <polygon points={'8,190 ' + points + ' 712,190'} fill="#FBF4E4" />
        <polyline points={points} fill="none" stroke="#C08A18" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg><div className="ap-chart-axis"><span>{dateTime(timeMs(candles[0].time))}</span><span>{dateTime(timeMs(candles[candles.length - 1].time))}</span></div>
    </div> : <Empty />}
    <div className="ap-chart-legend"><span><i className="ap-gold-key" />{c.reference} · USD</span></div>

    {oiValues.length > 1 ? <div className="ap-line-chart" role="img" aria-label={c.oiHistory}>
      <div className="ap-chart-scale"><span>{useUsd ? formatUsd(Math.max(...oiValues)) : formatQuantity(Math.max(...oiValues))}</span><span>{useUsd ? formatUsd(Math.min(...oiValues)) : formatQuantity(Math.min(...oiValues))}</span></div>
      <svg viewBox="0 0 720 190" preserveAspectRatio="none" aria-hidden="true">
        {[0, 1, 2, 3].map(i => <line key={i} x1="0" x2="720" y1={i * 60 + 5} y2={i * 60 + 5} stroke="#E3E4E7" strokeDasharray="3 4" />)}
        <polyline points={oiPolyline} fill="none" stroke="#64748B" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg><div className="ap-chart-axis"><span>{dateTime(oiRows[0].observedAt)}</span><span>{dateTime(oiRows[oiRows.length - 1].observedAt)}</span></div>
    </div> : null}
    {oiValues.length > 1 && <div className="ap-chart-legend"><span><i className="ap-light-key" />{c.oiHistory}{useUsd ? ' · USD' : ` · ${asset ?? ''}`}</span></div>}
  </Panel>;
}
