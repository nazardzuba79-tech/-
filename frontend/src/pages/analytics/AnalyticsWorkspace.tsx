import { useEffect, useMemo, useState } from 'react';
import { useLanguage, type Key } from '../../lib/i18n';
import { useAnalyticsSnapshot } from './analyticsStore';
import { AnalyticsLiveModules } from './AnalyticsLiveModules';
import {
  DASH,
  LongShortBar,
  Metric,
  FreshnessTag,
  Module,
  UnavailableModule,
  correlationTone,
  formatCountdown,
  formatFundingRate,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatSignedPercent,
  formatUsd,
  rangeOf,
} from './presentation';
import './analytics.css';

/**
 * The Analytics workspace.
 *
 * Structure, ported from the approved archived design and reduced to what
 * this exchange can actually source:
 *
 *   1. Market overview — a dense six-figure strip, most important first.
 *   2. Asset context — the selector, built from the contracts VOLTEX
 *      really lists rather than from a hardcoded BTC/ETH/SOL/XRP.
 *   3. VOLTEX derivatives — open interest, funding, mark/index for the
 *      selected contract, explicitly venue-scoped.
 *   4. External derivatives and positioning.
 *   5. Real public liquidation, implied-volatility and futures-curve data.
 *   6. Market risk and market structure.
 *   7. Explicitly unsupported modules remain dashes rather than estimates.
 *
 * Every figure on this page is either real or a dash.
 */

/** The future modules, in display order. The backend removes a module from
 * its unsupported map as soon as a real source is wired, so this list can
 * safely keep the full product roadmap without rendering stale placeholders. */
const PENDING_MODULES: { key: string; titleKey: Key }[] = [
  { key: 'liquidations', titleKey: 'analytics.liquidations' },
  { key: 'impliedVolatility', titleKey: 'analytics.impliedVolatility' },
  { key: 'futuresTermStructure', titleKey: 'analytics.futuresTermStructure' },
  { key: 'etfFlows', titleKey: 'analytics.etfFlows' },
  { key: 'exchangeFlows', titleKey: 'analytics.exchangeFlows' },
  { key: 'whaleActivity', titleKey: 'analytics.whaleActivity' },
];

const RATIO_LABEL: Record<string, Key> = {
  global_account: 'analytics.lsGlobalAccount',
  top_account: 'analytics.lsTopAccount',
  top_position: 'analytics.lsTopPosition',
};

function baseAsset(symbol: string): string {
  return symbol.split('/')[0] ?? symbol;
}

export function AnalyticsWorkspace() {
  const { t } = useLanguage();
  const { snapshot, status, loaded, refresh, setAsset } = useAnalyticsSnapshot();
  const [selected, setSelected] = useState<string | null>(null);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const overview = snapshot?.sections.marketOverview;
  const sentiment = snapshot?.sections.sentiment;
  const derivatives = snapshot?.sections.derivatives;
  const externalOi = snapshot?.sections.externalOpenInterest;
  const externalFunding = snapshot?.sections.externalFunding;
  const basis = snapshot?.sections.perpetualBasis;
  const positioning = snapshot?.sections.longShortPositioning;
  const volatility = snapshot?.sections.realizedVolatility;
  const correlations = snapshot?.sections.cryptoCorrelations;
  const sectors = snapshot?.sections.sectorRotation;

  const trackedAsset = snapshot?.selectedAsset ?? null;
  const contracts = useMemo(() => snapshot?.contracts ?? [], [snapshot]);
  const activeSymbol = selected && contracts.includes(selected) ? selected : contracts[0] ?? null;

  const contract = useMemo(() => {
    if (!derivatives?.available || !activeSymbol) return null;
    return derivatives.value.contracts.find((c) => c.symbol === activeSymbol) ?? null;
  }, [derivatives, activeSymbol]);

  const countdown = derivatives?.available ? formatCountdown(derivatives.value.nextSettlementAt, now) : null;

  const pending = useMemo(
    () => (snapshot ? PENDING_MODULES.filter((m) => snapshot.unsupported[m.key]?.available === false) : []),
    [snapshot]
  );

  return (
    <main className="vx-analytics">
      <div className="vx-shell">
        <header className="vx-page-head">
          <div>
            <p className="vx-eyebrow">{t('analytics.eyebrow')}</p>
            <h1>{t('analytics.title')}</h1>
            <p className="vx-subtitle">{t('analytics.subtitle')}</p>
          </div>
          <div className="vx-head-actions">
            {status === 'error' ? <span className="vx-status is-error">{t('analytics.loadFailed')}</span> : null}
            {!loaded ? <span className="vx-status">{t('analytics.loading')}</span> : null}
            <button type="button" className="vx-refresh" onClick={refresh}>
              {t('analytics.refresh')}
            </button>
          </div>
        </header>

        <Module
          title={t('analytics.marketOverview')}
          meta={
            <div className="vx-source-row">
              {overview?.available ? <FreshnessTag fetchedAt={overview.fetchedAt} stale={overview.stale} /> : null}
              {sentiment?.available ? <FreshnessTag fetchedAt={sentiment.fetchedAt} stale={sentiment.stale} /> : null}
            </div>
          }
          className="vx-overview-module"
        >
          <div className="vx-overview">
            <Metric emphasis label={t('analytics.marketCap')} value={overview?.available ? formatUsd(overview.value.totalMarketCapUsd) : null} />
            <Metric label={t('analytics.volume24h')} value={overview?.available ? formatUsd(overview.value.totalVolume24hUsd) : null} />
            <Metric
              label={t('analytics.marketCap24h')}
              value={overview?.available ? formatSignedPercent(overview.value.marketCapChangePercent24h) : null}
              tone={
                overview?.available && typeof overview.value.marketCapChangePercent24h === 'number'
                  ? overview.value.marketCapChangePercent24h >= 0
                    ? 'positive'
                    : 'negative'
                  : undefined
              }
            />
            <Metric
              label={t('analytics.btcDominance')}
              value={overview?.available && overview.value.btcDominancePercent !== null ? `${overview.value.btcDominancePercent.toFixed(1)}%` : null}
            />
            <Metric
              label={t('analytics.ethDominance')}
              value={overview?.available && overview.value.ethDominancePercent !== null ? `${overview.value.ethDominancePercent.toFixed(1)}%` : null}
            />
            <Metric label={t('analytics.fearGreed')} value={sentiment?.available ? `${sentiment.value.value} · ${sentiment.value.classification}` : null} />
          </div>
        </Module>

        <div className="vx-context">
          <span className="vx-context-label">{t('analytics.assetContext')}</span>
          {contracts.length > 0 ? (
            <div className="vx-context-chips" role="group" aria-label={t('analytics.assetContext')}>
              {contracts.map((symbol) => (
                <button
                  key={symbol}
                  type="button"
                  aria-pressed={symbol === activeSymbol}
                  className={symbol === activeSymbol ? 'is-selected' : undefined}
                  onClick={() => {
                    setSelected(symbol);
                    setAsset(baseAsset(symbol));
                  }}
                >
                  {baseAsset(symbol)}
                </button>
              ))}
            </div>
          ) : (
            <span className="vx-context-empty">{loaded ? t('analytics.noContracts') : DASH}</span>
          )}
          <small className="vx-context-hint">{t('analytics.assetContextHint')}</small>
        </div>

        <Module
          title={`${t('analytics.derivatives')}${activeSymbol ? ` · ${baseAsset(activeSymbol)}` : ''}`}
          meta={
            <div className="vx-source-row">
              <span className="vx-scope">{t('analytics.venueScope')}</span>
              {derivatives?.available ? <FreshnessTag live /> : null}
            </div>
          }
          note={t('analytics.derivativesNote')}
          className="vx-derivatives-module"
        >
          <div className="vx-grid-3">
            <div className="vx-panel">
              <Metric
                label={t('analytics.openInterest')}
                value={formatQuantity(contract?.openInterestBase ?? null)}
                hint={activeSymbol ? baseAsset(activeSymbol) : undefined}
                emphasis
              />
              <Metric label={t('analytics.openInterestUsd')} value={formatUsd(contract?.openInterestUsd ?? null)} />
            </div>

            <div className="vx-panel">
              <Metric
                label={t('analytics.fundingRate')}
                value={formatFundingRate(contract?.fundingRate ?? null)}
                tone={
                  contract?.fundingRate != null && Number.isFinite(Number(contract.fundingRate))
                    ? Number(contract.fundingRate) >= 0
                      ? 'positive'
                      : 'negative'
                    : undefined
                }
                emphasis
              />
              <Metric label={t('analytics.fundingInterval')} value={derivatives?.available ? `${derivatives.value.intervalHours}h` : null} />
              <Metric label={t('analytics.nextFunding')} value={countdown} />
            </div>

            <div className="vx-panel">
              <Metric label={t('analytics.markPrice')} value={formatPrice(contract?.markPrice ?? null)} emphasis />
              <Metric label={t('analytics.indexPrice')} value={formatPrice(contract?.indexPrice ?? null)} />
            </div>
          </div>
        </Module>

        <h2 className="vx-band-heading">{t('analytics.externalDerivatives')}</h2>
        <div className="vx-grid-2">
          <Module
            title={`${t('analytics.trackedVenueOi')}${trackedAsset ? ` · ${trackedAsset}` : ''}`}
            meta={externalOi?.available ? <div className="vx-source-row"><FreshnessTag fetchedAt={externalOi.fetchedAt} stale={externalOi.stale} /></div> : null}
            note={t('analytics.trackedVenueOiNote')}
          >
            {externalOi?.available ? (
              <Metric emphasis label={t('analytics.openInterestUsd')} value={formatUsd(externalOi.value.totalOpenInterestUsd)} />
            ) : (
              <p className="vx-module-empty" role="status">{t('analytics.noExternalVenue')}</p>
            )}
          </Module>

          <Module
            title={`${t('analytics.fundingComparison')}${trackedAsset ? ` · ${trackedAsset}` : ''}`}
            meta={externalFunding?.available ? <div className="vx-source-row"><FreshnessTag fetchedAt={externalFunding.fetchedAt} stale={externalFunding.stale} /></div> : null}
            note={t('analytics.fundingComparisonNote')}
          >
            {externalFunding?.available ? (
              <Metric
                emphasis
                label={t('analytics.marketRange')}
                value={rangeOf(externalFunding.value.venues.map((v) => v.fundingRate), (n) => formatFundingRate(String(n)) ?? DASH)}
              />
            ) : (
              <p className="vx-module-empty" role="status">{t('analytics.noExternalVenue')}</p>
            )}
          </Module>
        </div>

        <Module
          title={`${t('analytics.positioning')}${trackedAsset ? ` · ${trackedAsset}` : ''}`}
          meta={positioning?.available ? <div className="vx-source-row"><FreshnessTag fetchedAt={positioning.fetchedAt} stale={positioning.stale} /></div> : null}
          note={t('analytics.positioningNote')}
        >
          {positioning?.available ? (
            <div className="vx-grid-3">
              {positioning.value.ratios.map((r) => (
                <LongShortBar
                  key={r.kind}
                  label={`${t(RATIO_LABEL[r.kind] ?? 'analytics.positioning')} · ${r.period}`}
                  long={r.longAccount}
                  short={r.shortAccount}
                  longLabel={t('analytics.long')}
                  shortLabel={t('analytics.short')}
                />
              ))}
            </div>
          ) : (
            <p className="vx-module-empty" role="status">{t('analytics.noExternalVenue')}</p>
          )}
        </Module>

        <AnalyticsLiveModules />

        <h2 className="vx-band-heading">{t('analytics.marketRisk')}</h2>
        <div className="vx-grid-2">
          <Module
            title={`${t('analytics.realizedVolatility')}${volatility?.available ? ` · ${volatility.value.baseAsset}` : ''}`}
            meta={volatility?.available ? <FreshnessTag fetchedAt={volatility.fetchedAt} stale={volatility.stale} /> : null}
            note={t('analytics.realizedVolatilityNote')}
          >
            {volatility?.available ? (
              <div className="vx-grid-3">
                {volatility.value.windows.map((w) => (
                  <Metric key={w.window} label={w.window} value={formatPercent(w.annualizedPercent)} hint={`${t('analytics.samples')}: ${w.samples}`} emphasis={w.window === '30d'} />
                ))}
              </div>
            ) : (
              <p className="vx-module-empty" role="status">{t('analytics.unavailable')}</p>
            )}
          </Module>

          <Module
            title={`${t('analytics.perpetualBasis')}${trackedAsset ? ` · ${trackedAsset}` : ''}`}
            meta={basis?.available ? <div className="vx-source-row"><FreshnessTag fetchedAt={basis.fetchedAt} stale={basis.stale} /></div> : null}
            note={t('analytics.perpetualBasisNote')}
          >
            {basis?.available ? (
              <Metric
                emphasis
                label={t('analytics.marketRange')}
                value={rangeOf(basis.value.venues.map((v) => v.basisPercent), (n) => formatSignedPercent(n, 4) ?? DASH)}
              />
            ) : (
              <p className="vx-module-empty" role="status">{t('analytics.noExternalVenue')}</p>
            )}
          </Module>
        </div>

        <h2 className="vx-band-heading">{t('analytics.marketStructure')}</h2>
        <div className="vx-grid-2">
          <Module
            title={t('analytics.cryptoCorrelations')}
            meta={correlations?.available ? <FreshnessTag fetchedAt={correlations.fetchedAt} stale={correlations.stale} /> : null}
            note={t('analytics.correlationNote')}
          >
            {correlations?.available ? (
              <div className="vx-corr">
                {correlations.value.pairs.map((p) => (
                  <div className="vx-corr-row" key={`${p.a}-${p.b}`}>
                    <span className="vx-corr-pair">{p.a} · {p.b}</span>
                    <span className={`vx-corr-value is-${correlationTone(p.correlation)}`}>{p.correlation.toFixed(2)}</span>
                    <small className="vx-corr-samples">{t('analytics.samples')}: {p.samples}</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="vx-module-empty" role="status">{t('analytics.unavailable')}</p>
            )}
          </Module>

          <Module
            title={t('analytics.sectorRotation')}
            meta={sectors?.available ? <FreshnessTag fetchedAt={sectors.fetchedAt} stale={sectors.stale} /> : null}
            note={t('analytics.sectorNote')}
          >
            {sectors?.available ? (
              <div className="vx-sectors">
                {sectors.value.sectors.map((s) => (
                  <div className="vx-sector-row" key={s.category}>
                    <span className="vx-sector-name">{s.category}</span>
                    <span className={`vx-sector-value ${s.changePercent24h >= 0 ? 'is-positive' : 'is-negative'}`}>{formatSignedPercent(s.changePercent24h)}</span>
                    <small className="vx-sector-meta">
                      {t('analytics.constituents')}: {s.constituents} · {t(s.weighting === 'market_cap' ? 'analytics.weightingCap' : 'analytics.weightingEqual')}
                    </small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="vx-module-empty" role="status">{t('analytics.unavailable')}</p>
            )}
          </Module>
        </div>

        <Module
          title={t('analytics.liquidityMap')}
          meta={<span className="vx-scope is-pending">{t('analytics.noSource')}</span>}
          className="vx-map-module"
        >
          <div className="vx-map-pending" role="status">
            <p>{t('analytics.liquidityMapPending')}</p>
          </div>
        </Module>

        {pending.length > 0 ? (
          <section className="vx-pending-section">
            <h2 className="vx-pending-heading">{t('analytics.futureModules')}</h2>
            <div className="vx-pending-grid">
              {pending.map((m) => <UnavailableModule key={m.key} titleKey={m.titleKey} />)}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
