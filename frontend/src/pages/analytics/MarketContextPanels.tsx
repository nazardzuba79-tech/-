import type { AnalyticsSnapshot } from '../../lib/api';
import { useLanguage, type Key } from '../../lib/i18n';
import { Metric, formatQuantity, formatPercent, formatSignedPercent, formatUsd, formatPrice } from './presentation';
import { valueOf, dateTime, lineCoordinates } from './approvedData';
import { Panel, StatRow, Empty, Tone, useCopy } from './approvedPrimitives';
const sectorKeys: Record<string, Key> = { DEFI: 'markets.category.defi', LAYER_1: 'markets.category.layer1', MEME: 'markets.category.meme', STABLECOIN: 'markets.category.stablecoin', AI: 'markets.category.ai', GAMING: 'markets.category.gaming', RWA: 'markets.category.rwa' };

export function CorrelationMatrix({ snapshot }: { snapshot: AnalyticsSnapshot | null }) {
  const { t } = useLanguage(), section = snapshot?.sections.cryptoCorrelations, data = valueOf(section);
  return <Panel title={t('analytics.cryptoCorrelations')} subtitle={data ? data.lookbackHours + 'h · ' + data.interval : undefined} section={section}>
    {data?.assets.length ? <div className="ap-table-scroll"><table className="ap-correlation"><thead><tr><th></th>{data.assets.map(asset => <th key={asset}>{asset}</th>)}</tr></thead><tbody>
      {data.assets.map(a => <tr key={a}><th>{a}</th>{data.assets.map(b => {
        const pair = data.pairs.find(p => (p.a === a && p.b === b) || (p.a === b && p.b === a));
        // A diagonal is not a reported observation; leave it neutral.
        const value = a === b ? null : pair?.correlation;
        return <td key={b}><span style={value == null ? undefined : { background: value >= 0 ? 'rgba(192,138,24,' + Math.abs(value) * .2 + ')' : 'rgba(200,64,46,' + Math.abs(value) * .13 + ')' }}>{value == null || !Number.isFinite(value) ? '—' : value.toFixed(2)}</span></td>;
      })}</tr>)}</tbody></table></div> : <Empty />}
  </Panel>;
}
export function FearGreed({ snapshot }: { snapshot: AnalyticsSnapshot | null }) {
  const { t } = useLanguage(), c = useCopy(), section = snapshot?.sections.sentiment, data = valueOf(section);
  return <Panel title={t('analytics.fearGreed')} section={section}>
    <div className="ap-sentiment-value">{formatQuantity(data?.value) ?? '—'}<small>/ 100</small></div>
    <div className="ap-sentiment-track">{data && <i style={{ left: Math.max(0, Math.min(100, data.value)) + '%' }} />}</div>
    <div className="ap-chart-axis"><span>{c.fear}</span><span>{c.neutral}</span><span>{c.greed}</span></div>
    <StatRow label={c.sourcePeriod} value={data ? dateTime(data.updatedAt < 1e12 ? data.updatedAt * 1000 : data.updatedAt) : null} />
  </Panel>;
}
export function Sectors({ snapshot }: { snapshot: AnalyticsSnapshot | null }) {
  const { t } = useLanguage(), section = snapshot?.sections.sectorRotation, data = valueOf(section);
  return <Panel title={t('analytics.sectorRotation')} subtitle={data ? data.window : undefined} section={section}>
    {data?.sectors.length ? <div className="ap-table-scroll"><table><thead><tr><th>{t('analytics.sectorRotation')}</th><th>{t('analytics.marketCap24h')}</th><th>{t('analytics.constituents')}</th></tr></thead><tbody>
      {data.sectors.map(row => <tr key={row.category}><td><strong>{sectorKeys[row.category] ? t(sectorKeys[row.category]) : row.category}</strong><small className="ap-cell-note">{t(row.weighting === 'market_cap' ? 'analytics.weightingCap' : 'analytics.weightingEqual')}</small></td><td><Tone value={row.changePercent24h}>{formatSignedPercent(row.changePercent24h)}</Tone></td><td>{formatQuantity(row.constituents)}</td></tr>)}
    </tbody></table></div> : <Empty />}
  </Panel>;
}
export function ImpliedVolatility({ snapshot }: { snapshot: AnalyticsSnapshot | null }) {
  const { t } = useLanguage(), c = useCopy(), section = snapshot?.sections.impliedVolatility, data = valueOf(section);
  return <Panel title={t('analytics.impliedVolatility')} subtitle={c.index} section={section}>
    <Metric label={c.volatility} value={formatPercent(data?.current)} emphasis />
    <StatRow label={c.change} value={formatSignedPercent(data?.change24hPercent)} />
    <StatRow label={c.high} value={formatPercent(data?.high24h)} />
    <StatRow label={c.low} value={formatPercent(data?.low24h)} />
  </Panel>;
}
export function FuturesTermStructure({ snapshot }: { snapshot: AnalyticsSnapshot | null }) {
  const { t } = useLanguage(), c = useCopy(), section = snapshot?.sections.futuresTermStructure, data = valueOf(section);
  const points = [...(data?.points ?? [])].sort((a, b) => a.expiryAt - b.expiryAt);
  const coords = lineCoordinates(points.map(p => p.annualizedBasisPercent), 720, 120);
  // Expiry spacing is chronological, not equal spacing between contracts.
  const from = points[0]?.expiryAt, to = points[points.length - 1]?.expiryAt;
  const curve = coords.map(([, y], i) => [8 + (points[i].expiryAt - from) / Math.max(1, to - from) * 704, y].join(',')).join(' ');
  return <Panel title={t('analytics.futuresTermStructure')} subtitle={c.annualized} section={section}>
    {points.length ? <>
      <StatRow label={c.reference + ' · USD'} value={formatPrice(data?.referencePrice)} />
      {points.length > 1 && <div className="ap-curve" role="img" aria-label={t('analytics.futuresTermStructure')}>
        <div className="ap-chart-axis"><span>{formatSignedPercent(Math.min(...points.map(p => p.annualizedBasisPercent)))}</span><span>{formatSignedPercent(Math.max(...points.map(p => p.annualizedBasisPercent)))}</span></div>
        <svg viewBox="0 0 720 140" preserveAspectRatio="none" aria-hidden="true"><polyline points={curve} fill="none" stroke="#C08A18" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>
        <div className="ap-chart-axis"><span>{dateTime(from)}</span><span>{dateTime(to)}</span></div>
      </div>}
      <div className="ap-table-scroll"><table><thead><tr><th>{c.contract}</th><th>{c.expiry}</th><th>{c.basis}</th><th>{c.annualized}</th><th>{t('analytics.openInterest')}</th></tr></thead><tbody>
        {points.map(row => <tr key={row.instrument}><td><strong>{row.instrument}</strong></td><td>{new Date(row.expiryAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })}</td><td>{formatSignedPercent(row.basisPercent)}</td><td><Tone value={row.annualizedBasisPercent}>{formatSignedPercent(row.annualizedBasisPercent)}</Tone></td><td>{row.openInterestUnit === 'USD' ? formatUsd(row.openInterest) ?? '—' : row.openInterest == null ? '—' : formatQuantity(row.openInterest) + ' ' + data?.baseAsset}</td></tr>)}
      </tbody></table></div>
    </> : <Empty />}
  </Panel>;
}
