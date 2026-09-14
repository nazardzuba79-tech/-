import { useEffect, useMemo, useState } from 'react';
import type { AnalyticsSnapshot } from '../../lib/api';
import { useLanguage } from '../../lib/i18n';
import { useAnalyticsSnapshot } from '../analytics/analyticsStore';
import { FreshnessTag } from '../analytics/presentation';
import { SectionLabel, Segmented, useCopy } from '../analytics/approvedPrimitives';
import { SummaryStrips, MarketRegime, MarketNarrative, MarketStructure } from '../analytics/SummaryStrips';
import { LiquidationMap } from '../analytics/LiquidationMap';
import { OpenInterestStructure, FundingPressure, LongShortRatio, FundingRates, FuturesBasis, Volatility } from '../analytics/DerivativesPanels';
import { PriceOpenInterest } from '../analytics/PriceOpenInterest';
import { CorrelationMatrix, FearGreed, Sectors, ImpliedVolatility, FuturesTermStructure } from '../analytics/MarketContextPanels';
import { CapitalFlowPanels } from '../analytics/FlowPanels';
import '../analytics/analytics.css';

type SectionKey = keyof AnalyticsSnapshot['sections'];

function available(snapshot: AnalyticsSnapshot | null, key: SectionKey) {
  return snapshot?.sections[key]?.available === true;
}

/**
 * Analytics now lives inside Markets and is mounted only when the user opens
 * the Analytics sub-view. That keeps the normal Markets page on its existing
 * market-data polling only; the slower Analytics snapshot loop does not run in
 * the background just because /markets is open.
 *
 * Only sections whose backend contract says `available:true` are rendered.
 * Missing licensed/unsupported sources disappear instead of leaving dead cards.
 */
export function MarketsAnalyticsSection() {
  const { t } = useLanguage();
  const copy = useCopy();
  const { snapshot, status, loaded, refresh, setAsset } = useAnalyticsSnapshot();
  const [requestedAsset, setRequestedAsset] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const assets = snapshot?.trackedAssets ?? snapshot?.contracts.map((symbol) => symbol.split('/')[0]) ?? [];
  const echoedAsset = snapshot?.selectedAsset ?? assets[0] ?? null;
  const selected = requestedAsset ?? echoedAsset;
  const switching = selected !== echoedAsset;

  const visible = useMemo(() => {
    if (!snapshot) return 0;
    return (Object.keys(snapshot.sections) as SectionKey[]).filter((key) => available(snapshot, key)).length;
  }, [snapshot]);

  const showSummary = available(snapshot, 'marketOverview') || available(snapshot, 'sentiment') || available(snapshot, 'derivatives');
  const showRegime = available(snapshot, 'marketOverview') || available(snapshot, 'sentiment') || available(snapshot, 'realizedVolatility') || available(snapshot, 'externalFunding');
  const showNarrative = available(snapshot, 'derivatives') || available(snapshot, 'externalOpenInterest');
  const showExternal = available(snapshot, 'externalOpenInterest') || available(snapshot, 'externalFunding') || available(snapshot, 'longShortPositioning');
  const showPriceOi = available(snapshot, 'externalOpenInterest');
  const showMarketStructure = available(snapshot, 'derivatives');
  const showStructureCards = available(snapshot, 'realizedVolatility') || available(snapshot, 'impliedVolatility') || available(snapshot, 'perpetualBasis');
  const showContext = available(snapshot, 'cryptoCorrelations') || available(snapshot, 'sentiment');

  return (
    <section className="vx-analytics markets-analytics-embedded" aria-label={t('analytics.title')}>
      <div className="ap-shell">
        <header className="ap-page-head markets-analytics-head">
          <div>
            <p className="ap-eyebrow">{t('analytics.eyebrow')}</p>
            <h2>{t('analytics.title')}</h2>
            <p className="ap-subtitle">Только доступные сейчас рыночные и деривативные данные.</p>
          </div>
          <div className="ap-head-actions">
            {status === 'error' ? <span className="ap-error" role="status">{t('analytics.loadFailed')}</span>
              : !loaded || switching ? <span role="status">{t('analytics.loading')}</span>
              : <><span>{visible} мод.</span><FreshnessTag fetchedAt={snapshot?.generatedAt} /></>}
            <button type="button" className="ap-refresh" onClick={refresh}>{t('analytics.refresh')}</button>
          </div>
        </header>

        <div className="ap-context vx-context">
          <span className="ap-eyebrow">{t('analytics.assetContext')}</span>
          {assets.length ? (
            <Segmented
              values={assets}
              selected={selected}
              label={t('analytics.assetContext')}
              onChange={(asset) => {
                setRequestedAsset(asset);
                setAsset(asset);
              }}
            />
          ) : <span>{loaded ? t('analytics.noContracts') : '—'}</span>}
        </div>

        <div className="ap-stack" aria-busy={switching || !loaded} data-current-asset={echoedAsset}>
          {showSummary && <SummaryStrips snapshot={snapshot} asset={echoedAsset} now={now} />}
          {showRegime && <MarketRegime snapshot={snapshot} />}
          {showNarrative && <MarketNarrative snapshot={snapshot} asset={echoedAsset} />}

          {available(snapshot, 'liquidations') && <>
            <SectionLabel note={echoedAsset}>{t('analytics.liquidations')}</SectionLabel>
            <LiquidationMap snapshot={snapshot} />
          </>}

          {showExternal && <>
            <SectionLabel note={echoedAsset}>{t('analytics.externalDerivatives')}</SectionLabel>
            <div className="ap-grid ap-grid-3">
              {available(snapshot, 'externalOpenInterest') && <OpenInterestStructure snapshot={snapshot} />}
              {available(snapshot, 'externalFunding') && <FundingPressure snapshot={snapshot} />}
              {available(snapshot, 'longShortPositioning') && <LongShortRatio snapshot={snapshot} />}
            </div>
          </>}

          {(showPriceOi || showMarketStructure) && (
            <div className="ap-grid ap-grid-3">
              {showPriceOi && <div className={showMarketStructure ? 'ap-span-2' : 'ap-span-3'}><PriceOpenInterest snapshot={snapshot} asset={echoedAsset} /></div>}
              {showMarketStructure && <MarketStructure snapshot={snapshot} asset={echoedAsset} />}
            </div>
          )}

          {showStructureCards && <>
            <SectionLabel note={echoedAsset}>{t('analytics.marketStructure')}</SectionLabel>
            <div className="ap-grid ap-grid-3">
              {available(snapshot, 'realizedVolatility') && <Volatility snapshot={snapshot} />}
              {available(snapshot, 'impliedVolatility') && <ImpliedVolatility snapshot={snapshot} />}
              {available(snapshot, 'perpetualBasis') && <FuturesBasis snapshot={snapshot} />}
            </div>
          </>}

          {available(snapshot, 'externalFunding') && <FundingRates snapshot={snapshot} />}
          {available(snapshot, 'futuresTermStructure') && <FuturesTermStructure snapshot={snapshot} />}

          <CapitalFlowPanels snapshot={snapshot} />

          {showContext && <>
            <SectionLabel>{copy.context}</SectionLabel>
            <div className="ap-grid ap-grid-3">
              {available(snapshot, 'cryptoCorrelations') && <div className={available(snapshot, 'sentiment') ? 'ap-span-2' : 'ap-span-3'}><CorrelationMatrix snapshot={snapshot} /></div>}
              {available(snapshot, 'sentiment') && <FearGreed snapshot={snapshot} />}
            </div>
          </>}
          {available(snapshot, 'sectorRotation') && <Sectors snapshot={snapshot} />}

          {loaded && snapshot && visible === 0 && (
            <div className="markets-analytics-empty">Сейчас нет доступных аналитических модулей.</div>
          )}
        </div>
      </div>
    </section>
  );
}
