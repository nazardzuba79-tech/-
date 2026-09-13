import type { AnalyticsSnapshot } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { Metric, formatUsd, formatPercent, formatPrice, formatQuantity, formatFundingRate, formatSignedPercent, formatCountdown } from './presentation';
import { valueOf, contractFor, finite } from './approvedData';
import { Panel, StatRow, useCopy } from './approvedPrimitives';

export function SummaryStrips({ snapshot, asset, now }: { snapshot: AnalyticsSnapshot | null; asset: string | null; now: number }) {
  const { t } = useLanguage();
  const s = snapshot?.sections, market = valueOf(s?.marketOverview), sentiment = valueOf(s?.sentiment);
  const contract = contractFor(snapshot, asset), derivatives = valueOf(s?.derivatives);
  return <>
    {(s?.marketOverview?.available && s.marketOverview.stale) && <div className="ap-subtle is-stale">{t('analytics.marketOverview')} · {t('analytics.stale')}</div>}
    <section className="ap-market-strip vx-overview-module" aria-label={t('analytics.marketOverview')}>
      <Metric label={t('analytics.marketCap')} value={formatUsd(market?.totalMarketCapUsd)} />
      <Metric label={t('analytics.volume24h')} value={formatUsd(market?.totalVolume24hUsd)} />
      <Metric label={t('analytics.marketCap24h')} value={formatSignedPercent(market?.marketCapChangePercent24h)} />
      <Metric label={t('analytics.btcDominance')} value={formatPercent(market?.btcDominancePercent, 1)} />
      <Metric label={t('analytics.ethDominance')} value={formatPercent(market?.ethDominancePercent, 1)} />
      <Metric label={t('analytics.fearGreed')} value={formatQuantity(sentiment?.value)} />
    </section>
    <section className="ap-derivatives-strip" aria-label={t('analytics.derivatives')}>
      <div><span className="ap-eyebrow">VOLTEX</span><strong>{asset ?? '—'}</strong><span>{t('analytics.derivatives')}</span></div>
      <Metric label={t('analytics.markPrice')} value={formatPrice(contract?.markPrice)} />
      <Metric label={t('analytics.openInterestUsd')} value={formatUsd(contract?.openInterestUsd)} />
      <Metric label={t('analytics.fundingRate')} value={formatFundingRate(contract?.fundingRate)} />
      <Metric label={t('analytics.nextFunding')} value={formatCountdown(derivatives?.nextSettlementAt, now)} />
    </section>
  </>;
}
/** The archive's dark regime composition, without invented scores or trading advice. */
export function MarketRegime({ snapshot }: { snapshot: AnalyticsSnapshot | null }) {
  const { t } = useLanguage(), c = useCopy(), s = snapshot?.sections;
  const market = valueOf(s?.marketOverview), sentiment = valueOf(s?.sentiment);
  const vol = valueOf(s?.realizedVolatility), funding = valueOf(s?.externalFunding);
  return <section className="ap-regime">
    <div className="ap-regime-lead"><span className="ap-eyebrow">{c.snapshot}</span>
      <strong>{formatSignedPercent(market?.marketCapChangePercent24h) ?? '—'}</strong><span>{t('analytics.marketCap24h')}</span></div>
    <div className="ap-regime-signals">
      <StatRow label={t('analytics.fearGreed')} value={formatQuantity(sentiment?.value)} />
      <StatRow label={t('analytics.realizedVolatility') + ' · 24h'} value={formatPercent(vol?.windows.find(w => w.window === '24h')?.annualizedPercent)} />
      <StatRow label={t('analytics.btcDominance')} value={formatPercent(market?.btcDominancePercent)} />
      <StatRow label={c.aggregate} value={funding ? String(funding.venues.length) : null} />
    </div>
  </section>;
}
export function MarketNarrative({ snapshot, asset }: { snapshot: AnalyticsSnapshot | null; asset: string | null }) {
  const { t } = useLanguage(), c = useCopy(), contract = contractFor(snapshot, asset);
  const oi = valueOf(snapshot?.sections.externalOpenInterest);
  return <Panel title={c.summary}><div className="ap-narrative">
    {[{ title: t('analytics.markPrice'), value: formatPrice(contract?.markPrice), note: asset },
      { title: t('analytics.trackedVenueOi'), value: formatUsd(oi?.totalOpenInterestUsd), note: c.aggregate },
      { title: t('analytics.fundingRate'), value: formatFundingRate(contract?.fundingRate), note: 'VOLTEX' },
    ].map((item, i) => <div key={item.title}><span className="ap-narrative-index">0{i + 1}</span><h3>{item.title}</h3><strong>{item.value ?? '—'}</strong><p>{item.note}</p></div>)}
  </div></Panel>;
}
export function MarketStructure({ snapshot, asset }: { snapshot: AnalyticsSnapshot | null; asset: string | null }) {
  const { t } = useLanguage(), c = useCopy(), contract = contractFor(snapshot, asset);
  const mark = finite(contract?.markPrice), index = finite(contract?.indexPrice);
  return <Panel title={c.structure} subtitle={asset ?? undefined} section={snapshot?.sections.derivatives}>
    <StatRow label={t('analytics.markPrice')} value={formatPrice(mark)} />
    <StatRow label={t('analytics.indexPrice')} value={formatPrice(index)} />
    <StatRow label={c.basis + ' · VOLTEX'} value={formatSignedPercent(mark != null && index != null && index > 0 ? (mark - index) / index * 100 : null)} />
    <StatRow label={t('analytics.openInterest') + (asset ? ' · ' + asset : '')} value={formatQuantity(contract?.openInterestBase)} />
  </Panel>;
}
