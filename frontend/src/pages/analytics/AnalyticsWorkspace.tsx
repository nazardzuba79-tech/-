import { useEffect, useMemo, useState } from 'react';
import { useLanguage, type Key } from '../../lib/i18n';
import { useAnalyticsSnapshot } from './analyticsStore';
import {
  DASH,
  LongShortBar,
  Metric,
  Module,
  SourceTag,
  UnavailableModule,
  VenueRow,
  correlationTone,
  formatCountdown,
  formatFundingRate,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatSignedPercent,
  formatUsd,
  venuesLabel,
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
 *   4. Liquidity map — the archived module's slot, holding a compact
 *      unavailable state until a real liquidation feed exists.
 *   5. Future modules — one dense grid of pending slots, not a page of
 *      giant empty cards.
 *
 * ── What was deliberately NOT ported ────────────────────────────────
 *
 * The archived branch's `liquidityModel.ts` generated a seeded synthetic
 * order-flow map — walls, clusters, voids, long/short shares and a cascade
 * risk score — from hardcoded prices, behind a "Демонстрационный режим"
 * checkbox. It is well built and completely fictional. None of it is here:
 * no synthetic values, no demo toggle, no code path that could produce
 * one. When a liquidation provider exists, the module slot below is where
 * its real data plugs in.
 *
 * Every figure on this page is either real or a dash.
 */

/** The future modules, in display order. Each maps to a key the backend
 *  reports as unsupported, so the two lists cannot silently diverge: a
 *  module the server does support would never reach this grid. */
const PENDING_MODULES: { key: string; titleKey: Key }[] = [
  { key: 'liquidations', titleKey: 'analytics.liquidations' },
  { key: 'impliedVolatility', titleKey: 'analytics.impliedVolatility' },
  { key: 'futuresTermStructure', titleKey: 'analytics.futuresTermStructure' },
  { key: 'etfFlows', titleKey: 'analytics.etfFlows' },
  { key: 'exchangeFlows', titleKey: 'analytics.exchangeFlows' },
  { key: 'whaleActivity', titleKey: 'analytics.whaleActivity' },
];

/** The three positioning measures, in the order they are displayed. Each
 *  maps to its own definition — they are never merged into one ratio. */
const RATIO_LABEL: Record<string, Key> = {
  global_account: 'analytics.lsGlobalAccount',
  top_account: 'analytics.lsTopAccount',
  top_position: 'analytics.lsTopPosition',
};

/** The base asset of a contract symbol, for the selector chips. */
function baseAsset(symbol: string): string {
  return symbol.split('/')[0] ?? symbol;
}

export function AnalyticsWorkspace() {
  const { t } = useLanguage();
  const { snapshot, status, loaded, refresh, setAsset } = useAnalyticsSnapshot();
  const [selected, setSelected] = useState<string | null>(null);

  // A one-second tick, only for the funding countdown. It re-renders this
  // component and nothing fetches on it — the data cadence is the store's
  // 30s, entirely separate from this clock.
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

  /** The asset the EXTERNAL/DERIVED sections actually describe. The server
   *  validates the request against its own tracked list and echoes this
   *  back, so each module below is titled with the asset its numbers are
   *  for rather than with whatever was clicked. */
  const trackedAsset = snapshot?.selectedAsset ?? null;

  // The selector is built from what the exchange actually lists. An asset
  // VOLTEX does not carry is never offered as a choice.
  const contracts = useMemo(() => snapshot?.contracts ?? [], [snapshot]);
  const activeSymbol = selected && contracts.includes(selected) ? selected : contracts[0] ?? null;

  const contract = useMemo(() => {
    if (!derivatives?.available || !activeSymbol) return null;
    return derivatives.value.contracts.find((c) => c.symbol === activeSymbol) ?? null;
  }, [derivatives, activeSymbol]);

  const countdown = derivatives?.available ? formatCountdown(derivatives.value.nextSettlementAt, now) : null;

  // Driven by the server's own `unsupported` map rather than by this list
  // alone: a module the backend starts supporting disappears from the
  // pending grid automatically instead of sitting here claiming to have no
  // source. Before the first load nothing is asserted either way.
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

        {/* ── 1. Market overview ─────────────────────────────────── */}
        <Module
          title={t('analytics.marketOverview')}
          meta={
            <div className="vx-source-row">
              {overview?.available ? (
                <SourceTag source={overview.source} fetchedAt={overview.fetchedAt} stale={overview.stale} />
              ) : null}
              {sentiment?.available ? (
                <SourceTag source={sentiment.source} fetchedAt={sentiment.fetchedAt} stale={sentiment.stale} />
              ) : null}
            </div>
          }
          className="vx-overview-module"
        >
          <div className="vx-overview">
            <Metric
              emphasis
              label={t('analytics.marketCap')}
              value={overview?.available ? formatUsd(overview.value.totalMarketCapUsd) : null}
            />
            <Metric
              label={t('analytics.volume24h')}
              value={overview?.available ? formatUsd(overview.value.totalVolume24hUsd) : null}
            />
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
              value={
                overview?.available && overview.value.btcDominancePercent !== null
                  ? `${overview.value.btcDominancePercent.toFixed(1)}%`
                  : null
              }
            />
            <Metric
              label={t('analytics.ethDominance')}
              value={
                overview?.available && overview.value.ethDominancePercent !== null
                  ? `${overview.value.ethDominancePercent.toFixed(1)}%`
                  : null
              }
            />
            <Metric
              label={t('analytics.fearGreed')}
              value={sentiment?.available ? `${sentiment.value.value} · ${sentiment.value.classification}` : null}
            />
          </div>
        </Module>

        {/* ── 2. Asset context ───────────────────────────────────── */}
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
                    // The external/derived sections are per-asset, so the
                    // selection travels to the server with the next
                    // snapshot. Unsupported assets fall back server-side
                    // and the modules re-title themselves accordingly.
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

        {/* ── 3. VOLTEX derivatives ──────────────────────────────── */}
        <Module
          title={`${t('analytics.derivatives')}${activeSymbol ? ` · ${baseAsset(activeSymbol)}` : ''}`}
          meta={
            <div className="vx-source-row">
              <span className="vx-scope">{t('analytics.venueScope')}</span>
              {derivatives?.available ? <SourceTag source="voltex" live /> : null}
            </div>
          }
          note={t('analytics.derivativesNote')}
          className="vx-derivatives-module"
        >
          <div className="vx-grid-3">
            <div className="vx-panel">
              <Metric
                label={t('analytics.openInterest')}
                // A listed-but-untraded contract has a REAL zero here, and
                // it renders as 0. Only a failed read is null.
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
              <Metric
                label={t('analytics.fundingInterval')}
                value={derivatives?.available ? `${derivatives.value.intervalHours}h` : null}
              />
              <Metric label={t('analytics.nextFunding')} value={countdown} />
            </div>

            <div className="vx-panel">
              <Metric label={t('analytics.markPrice')} value={formatPrice(contract?.markPrice ?? null)} emphasis />
              {/* Index price is hidden from the FUTURES header by design,
                  but Analytics is where comparing mark against index is
                  the actual point, so it is shown here. */}
              <Metric label={t('analytics.indexPrice')} value={formatPrice(contract?.indexPrice ?? null)} />
            </div>
          </div>
        </Module>


        {/* ── 4. External derivatives ────────────────────────────── */}
        <h2 className="vx-band-heading">{t('analytics.externalDerivatives')}</h2>
        <div className="vx-grid-2">
          <Module
            title={`${t('analytics.trackedVenueOi')}${trackedAsset ? ` · ${trackedAsset}` : ''}`}
            meta={
              externalOi?.available ? (
                <div className="vx-source-row">
                  {/* Derived from the venues that CONTRIBUTED, so it can
                      never keep naming one that was down. */}
                  <span className="vx-scope">{venuesLabel(externalOi.venues) ?? t('analytics.trackedVenues')}</span>
                  <SourceTag source={externalOi.source} fetchedAt={externalOi.fetchedAt} stale={externalOi.stale} />
                </div>
              ) : null
            }
            note={t('analytics.trackedVenueOiNote')}
          >
            {externalOi?.available ? (
              <>
                <Metric
                  emphasis
                  label={t('analytics.openInterestUsd')}
                  value={formatUsd(externalOi.value.totalOpenInterestUsd)}
                  hint={venuesLabel(externalOi.venues) ?? undefined}
                />
                <div className="vx-venue-table">
                  {externalOi.value.venues.map((v) => (
                    <VenueRow
                      key={v.venue}
                      venue={v.venue}
                      contract={v.contract}
                      value={formatUsd(v.openInterestUsd)}
                      stale={v.stale}
                    />
                  ))}
                </div>
              </>
            ) : (
              <p className="vx-module-empty" role="status">{t('analytics.noExternalVenue')}</p>
            )}
          </Module>

          <Module
            title={`${t('analytics.fundingComparison')}${trackedAsset ? ` · ${trackedAsset}` : ''}`}
            meta={
              externalFunding?.available ? (
                <div className="vx-source-row">
                  <span className="vx-scope">{venuesLabel(externalFunding.venues) ?? t('analytics.trackedVenues')}</span>
                  <SourceTag source={externalFunding.source} fetchedAt={externalFunding.fetchedAt} stale={externalFunding.stale} />
                </div>
              ) : null
            }
            note={t('analytics.fundingComparisonNote')}
          >
            {externalFunding?.available ? (
              <div className="vx-venue-table">
                {/* VOLTEX's own rate sits alongside for comparison and is
                    labelled VOLTEX — the external rates never replace it. */}
                <VenueRow
                  venue="voltex"
                  contract={activeSymbol ?? undefined}
                  value={formatFundingRate(contract?.fundingRate ?? null)}
                  tone={
                    contract?.fundingRate != null && Number.isFinite(Number(contract.fundingRate))
                      ? Number(contract.fundingRate) >= 0 ? 'positive' : 'negative'
                      : undefined
                  }
                />
                {externalFunding.value.venues.map((v) => (
                  <VenueRow
                    key={v.venue}
                    venue={v.venue}
                    contract={v.contract}
                    value={v.fundingRate === null ? null : formatFundingRate(String(v.fundingRate))}
                    tone={v.fundingRate === null ? undefined : v.fundingRate >= 0 ? 'positive' : 'negative'}
                    stale={v.stale}
                  />
                ))}
              </div>
            ) : (
              <p className="vx-module-empty" role="status">{t('analytics.noExternalVenue')}</p>
            )}
          </Module>
        </div>

        <Module
          title={`${t('analytics.positioning')}${trackedAsset ? ` · ${trackedAsset}` : ''}`}
          meta={
            positioning?.available ? (
              <div className="vx-source-row">
                <span className="vx-scope">{t('analytics.trackedVenues')}: Binance</span>
                <SourceTag source={positioning.source} fetchedAt={positioning.fetchedAt} stale={positioning.stale} />
              </div>
            ) : null
          }
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

        {/* ── 5. Market risk ─────────────────────────────────────── */}
        <h2 className="vx-band-heading">{t('analytics.marketRisk')}</h2>
        <div className="vx-grid-2">
          <Module
            title={`${t('analytics.realizedVolatility')}${volatility?.available ? ` · ${volatility.value.baseAsset}` : ''}`}
            meta={
              volatility?.available ? (
                <SourceTag source={volatility.source} fetchedAt={volatility.fetchedAt} stale={volatility.stale} />
              ) : null
            }
            note={t('analytics.realizedVolatilityNote')}
          >
            {volatility?.available ? (
              <div className="vx-grid-3">
                {volatility.value.windows.map((w) => (
                  <Metric
                    key={w.window}
                    label={w.window}
                    value={formatPercent(w.annualizedPercent)}
                    hint={`${t('analytics.samples')}: ${w.samples}`}
                    emphasis={w.window === '30d'}
                  />
                ))}
              </div>
            ) : (
              <p className="vx-module-empty" role="status">{t('analytics.unavailable')}</p>
            )}
          </Module>

          <Module
            title={`${t('analytics.perpetualBasis')}${trackedAsset ? ` · ${trackedAsset}` : ''}`}
            meta={
              basis?.available ? (
                <div className="vx-source-row">
                  <span className="vx-scope">{venuesLabel(basis.venues) ?? t('analytics.trackedVenues')}</span>
                  <SourceTag source={basis.source} fetchedAt={basis.fetchedAt} stale={basis.stale} />
                </div>
              ) : null
            }
            note={t('analytics.perpetualBasisNote')}
          >
            {basis?.available ? (
              <div className="vx-venue-table">
                {basis.value.venues.map((v) => (
                  <VenueRow
                    key={v.venue}
                    venue={v.venue}
                    contract={v.contract}
                    value={v.basisPercent === null ? null : formatSignedPercent(v.basisPercent, 4)}
                    tone={v.basisPercent === null ? undefined : v.basisPercent >= 0 ? 'positive' : 'negative'}
                    stale={v.stale}
                  />
                ))}
              </div>
            ) : (
              <p className="vx-module-empty" role="status">{t('analytics.noExternalVenue')}</p>
            )}
          </Module>
        </div>

        {/* ── 6. Market structure ────────────────────────────────── */}
        <h2 className="vx-band-heading">{t('analytics.marketStructure')}</h2>
        <div className="vx-grid-2">
          <Module
            title={t('analytics.cryptoCorrelations')}
            meta={
              correlations?.available ? (
                <SourceTag source={correlations.source} fetchedAt={correlations.fetchedAt} stale={correlations.stale} />
              ) : null
            }
            note={t('analytics.correlationNote')}
          >
            {correlations?.available ? (
              <div className="vx-corr">
                {correlations.value.pairs.map((p) => (
                  <div className="vx-corr-row" key={`${p.a}-${p.b}`}>
                    <span className="vx-corr-pair">
                      {p.a} · {p.b}
                    </span>
                    <span className={`vx-corr-value is-${correlationTone(p.correlation)}`}>
                      {p.correlation.toFixed(2)}
                    </span>
                    <small className="vx-corr-samples">
                      {t('analytics.samples')}: {p.samples}
                    </small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="vx-module-empty" role="status">{t('analytics.unavailable')}</p>
            )}
          </Module>

          <Module
            title={t('analytics.sectorRotation')}
            meta={
              sectors?.available ? (
                <SourceTag source={sectors.source} fetchedAt={sectors.fetchedAt} stale={sectors.stale} />
              ) : null
            }
            note={t('analytics.sectorNote')}
          >
            {sectors?.available ? (
              <div className="vx-sectors">
                {sectors.value.sectors.map((s) => (
                  <div className="vx-sector-row" key={s.category}>
                    <span className="vx-sector-name">{s.category}</span>
                    <span className={`vx-sector-value ${s.changePercent24h >= 0 ? 'is-positive' : 'is-negative'}`}>
                      {formatSignedPercent(s.changePercent24h)}
                    </span>
                    <small className="vx-sector-meta">
                      {t('analytics.constituents')}: {s.constituents} ·{' '}
                      {t(s.weighting === 'market_cap' ? 'analytics.weightingCap' : 'analytics.weightingEqual')}
                    </small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="vx-module-empty" role="status">{t('analytics.unavailable')}</p>
            )}
          </Module>
        </div>

        {/* ── 7. Liquidity map: the archived module's slot ────────── */}
        <Module
          title={t('analytics.liquidityMap')}
          meta={<span className="vx-scope is-pending">{t('analytics.noSource')}</span>}
          className="vx-map-module"
        >
          <div className="vx-map-pending" role="status">
            <p>{t('analytics.liquidityMapPending')}</p>
          </div>
        </Module>

        {/* ── 5. Future modules ──────────────────────────────────── */}
        {pending.length > 0 ? (
        <section className="vx-pending-section">
          <h2 className="vx-pending-heading">{t('analytics.futureModules')}</h2>
          <div className="vx-pending-grid">
            {pending.map((m) => (
              <UnavailableModule key={m.key} titleKey={m.titleKey} />
            ))}
          </div>
        </section>
        ) : null}
      </div>
    </main>
  );
}
