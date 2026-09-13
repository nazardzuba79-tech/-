import { useEffect, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import { useAnalyticsSnapshot } from './analyticsStore';
import { FreshnessTag } from './presentation';
import { SectionLabel, Segmented, useCopy } from './approvedPrimitives';
import { SummaryStrips, MarketRegime, MarketNarrative, MarketStructure } from './SummaryStrips';
import { LiquidationMap } from './LiquidationMap';
import { OpenInterestStructure, FundingPressure, LongShortRatio, FundingRates, FuturesBasis, Volatility } from './DerivativesPanels';
import { PriceOpenInterest } from './PriceOpenInterest';
import { CorrelationMatrix, FearGreed, Sectors, ImpliedVolatility, FuturesTermStructure } from './MarketContextPanels';
import { CapitalFlowPanels } from './FlowPanels';
import './analytics.css';

/** Layout and visual tokens from analytics-mp; data comes only from the current gateway. */
export function AnalyticsWorkspace() {
  const { t } = useLanguage(), c = useCopy();
  const { snapshot, status, loaded, refresh, setAsset } = useAnalyticsSnapshot();
  const [requestedAsset, setRequestedAsset] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const assets = snapshot?.trackedAssets ?? snapshot?.contracts.map(symbol => symbol.split('/')[0]) ?? [];
  const echoedAsset = snapshot?.selectedAsset ?? assets[0] ?? null;
  const selected = requestedAsset ?? echoedAsset;
  const switching = selected !== echoedAsset;
  // Keep the last coherent layout during switching, labelled with its echoed asset.
  // The selector indicates intent; panels never relabel old figures as a new asset.
  const props = { snapshot };
  return <main className="vx-analytics">
    <div className="ap-shell">
      <header className="ap-page-head">
        <div><p className="ap-eyebrow">{t('analytics.eyebrow')}</p><h1>{t('analytics.title')}</h1><p className="ap-subtitle">{t('analytics.subtitle')}</p></div>
        <div className="ap-head-actions">
          {status === 'error' ? <span className="ap-error" role="status">{t('analytics.loadFailed')}</span>
            : !loaded || switching ? <span role="status">{t('analytics.loading')}</span>
            : <FreshnessTag fetchedAt={snapshot?.generatedAt} />}
          <button type="button" className="ap-refresh" onClick={refresh}>{t('analytics.refresh')}</button>
        </div>
      </header>
      <div className="ap-context vx-context"><span className="ap-eyebrow">{t('analytics.assetContext')}</span>
        {assets.length ? <Segmented values={assets} selected={selected} label={t('analytics.assetContext')} onChange={asset => { setRequestedAsset(asset); setAsset(asset); }} />
          : <span>{loaded ? t('analytics.noContracts') : '—'}</span>}
      </div>
      <div className="ap-stack" aria-busy={switching || !loaded} data-current-asset={echoedAsset}>
        <SummaryStrips {...props} asset={echoedAsset} now={now} />
        <MarketRegime {...props} />
        <MarketNarrative {...props} asset={echoedAsset} />
        <SectionLabel note={echoedAsset}>{t('analytics.liquidations')}</SectionLabel>
        <LiquidationMap {...props} />
        <SectionLabel note={echoedAsset}>{t('analytics.externalDerivatives')}</SectionLabel>
        <div className="ap-grid ap-grid-3"><OpenInterestStructure {...props} /><FundingPressure {...props} /><LongShortRatio {...props} /></div>
        <div className="ap-grid ap-grid-3"><div className="ap-span-2"><PriceOpenInterest {...props} asset={echoedAsset} /></div><MarketStructure {...props} asset={echoedAsset} /></div>
        <SectionLabel note={echoedAsset}>{t('analytics.marketStructure')}</SectionLabel>
        <div className="ap-grid ap-grid-3"><Volatility {...props} /><ImpliedVolatility {...props} /><FuturesBasis {...props} /></div>
        <FundingRates {...props} />
        <FuturesTermStructure {...props} />
        <CapitalFlowPanels {...props} />
        <SectionLabel>{c.context}</SectionLabel>
        <div className="ap-grid ap-grid-3"><div className="ap-span-2"><CorrelationMatrix {...props} /></div><FearGreed {...props} /></div>
        <Sectors {...props} />
      </div>
    </div>
  </main>;
}
