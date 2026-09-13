import type { AnalyticsSnapshot } from '../../lib/api';
import { useLanguage, type Key } from '../../lib/i18n';
import { Metric, formatUsd, formatPercent, formatFundingRate, formatQuantity, formatSignedPercent } from './presentation';
import { valueOf, dateTime } from './approvedData';
import { Panel, StatRow, Empty, Tone, useCopy } from './approvedPrimitives';
const ratioKeys: Record<string, Key> = { global_account: 'analytics.lsGlobalAccount', top_account: 'analytics.lsTopAccount', top_position: 'analytics.lsTopPosition' };

export function OpenInterestStructure({ snapshot }: { snapshot: AnalyticsSnapshot | null }) {
  const { t } = useLanguage(), c = useCopy(), section = snapshot?.sections.externalOpenInterest, data = valueOf(section);
  return <Panel title={t('analytics.trackedVenueOi')} subtitle={c.aggregate} section={section}>
    <Metric label="USD" value={formatUsd(data?.totalOpenInterestUsd)} emphasis />
    {data?.venues.map(row => <StatRow key={row.venue + row.contract} label={row.contract} value={formatUsd(row.openInterestUsd)} />)}
  </Panel>;
}
export function FundingPressure({ snapshot }: { snapshot: AnalyticsSnapshot | null }) {
  const { t } = useLanguage(), c = useCopy(), section = snapshot?.sections.externalFunding, data = valueOf(section);
  return <Panel title={t('analytics.fundingComparison')} section={section}>
    {data?.venues.length ? data.venues.map(row => <StatRow key={row.venue + row.contract} label={row.contract}
      value={<Tone value={row.fundingRate}>{formatFundingRate(row.fundingRate == null ? null : String(row.fundingRate)) ?? '—'}<small> / {row.intervalHours == null ? '—' : row.intervalHours + 'h'}</small></Tone>} />) : <Empty />}
    <div className="ap-inset"><span className="ap-eyebrow">{c.aggregate}</span><strong>{data?.venues.length ?? '—'}</strong></div>
  </Panel>;
}
export function LongShortRatio({ snapshot }: { snapshot: AnalyticsSnapshot | null }) {
  const { t } = useLanguage(), section = snapshot?.sections.longShortPositioning, data = valueOf(section);
  return <Panel title={t('analytics.longShortRatio')} section={section}>
    {data?.ratios.length ? data.ratios.map(row => {
      const valid = row.longAccount != null && row.shortAccount != null && Number.isFinite(row.longAccount) && Number.isFinite(row.shortAccount) && row.longAccount >= 0 && row.shortAccount >= 0 && row.longAccount + row.shortAccount > 0;
      return <div className="ap-positioning" key={row.kind + row.venue + row.contract}>
        <div className="ap-positioning-title"><strong>{t(ratioKeys[row.kind] ?? 'analytics.positioning')}</strong><span>{row.period}</span></div>
        <div className="ap-positioning-values"><span>{formatPercent(row.longAccount == null ? null : row.longAccount * 100) ?? '—'}</span><span>{formatPercent(row.shortAccount == null ? null : row.shortAccount * 100) ?? '—'}</span></div>
        <div className="ap-ratio-track" data-available={valid}>{valid && <i style={{ width: row.longAccount! / (row.longAccount! + row.shortAccount!) * 100 + '%' }} />}</div>
        <div className="ap-positioning-values ap-subtle"><span>{t('analytics.long')}</span><span>{t('analytics.short')}</span></div>
      </div>;
    }) : <Empty />}
  </Panel>;
}
export function FundingRates({ snapshot }: { snapshot: AnalyticsSnapshot | null }) {
  const { t } = useLanguage(), c = useCopy(), section = snapshot?.sections.externalFunding, data = valueOf(section);
  return <Panel title={c.rates} section={section}>
    {data?.venues.length ? <div className="ap-table-scroll"><table><thead><tr><th>{c.contract}</th><th>{t('analytics.fundingRate')}</th><th>{t('analytics.fundingInterval')}</th><th>{t('analytics.nextFundingAt')}</th></tr></thead>
      <tbody>{data.venues.map(row => <tr key={row.venue + row.contract}><td><strong>{row.contract}</strong></td><td><Tone value={row.fundingRate}>{formatFundingRate(row.fundingRate == null ? null : String(row.fundingRate)) ?? '—'}</Tone></td>
        <td>{row.intervalHours == null ? '—' : row.intervalHours + 'h'}</td><td>{dateTime(row.nextFundingTime)}</td></tr>)}</tbody></table></div> : <Empty />}
  </Panel>;
}
export function FuturesBasis({ snapshot }: { snapshot: AnalyticsSnapshot | null }) {
  const { t } = useLanguage(), section = snapshot?.sections.perpetualBasis, data = valueOf(section);
  return <Panel title={t('analytics.perpetualBasis')} section={section}>
    {data?.venues.length ? data.venues.map(row => <StatRow key={row.venue + row.contract} label={row.contract} value={<Tone value={row.basisPercent}>{formatSignedPercent(row.basisPercent) ?? '—'}</Tone>} />) : <Empty />}
  </Panel>;
}
export function Volatility({ snapshot }: { snapshot: AnalyticsSnapshot | null }) {
  const { t } = useLanguage(), c = useCopy(), section = snapshot?.sections.realizedVolatility, data = valueOf(section);
  return <Panel title={t('analytics.realizedVolatility')} subtitle={c.annualized} section={section}>
    <Metric label="24h" value={formatPercent(data?.windows.find(w => w.window === '24h')?.annualizedPercent)} emphasis />
    {['7d', '30d'].map(period => <StatRow key={period} label={period} value={formatPercent(data?.windows.find(w => w.window === period)?.annualizedPercent)} />)}
    <StatRow label={t('analytics.samples') + ' · 24h'} value={formatQuantity(data?.windows.find(w => w.window === '24h')?.samples)} />
  </Panel>;
}
