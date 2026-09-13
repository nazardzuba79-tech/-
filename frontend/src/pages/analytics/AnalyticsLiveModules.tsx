import { useMemo, useState } from 'react';
import { useLanguage } from '../../lib/i18n';
import { useAnalyticsSnapshot } from './analyticsStore';
import {
  FreshnessTag,
  Metric,
  Module,
  formatPrice,
  formatQuantity,
  formatSignedPercent,
  formatUsd,
} from './presentation';
import './analytics-live.css';

type Section<T> =
  | { available: true; value: T; source: string; fetchedAt: number; stale: boolean }
  | { available: false; reason: string; detail?: string };

interface LiquidationEvent {
  id: string;
  symbol: string;
  baseAsset: string;
  side: 'LONG' | 'SHORT';
  price: number;
  quantity: number;
  notionalUsd: number;
  tradeTime: number;
}

interface LiquidationBucket {
  fromPrice: number;
  toPrice: number;
  longNotionalUsd: number;
  shortNotionalUsd: number;
  eventCount: number;
}

interface LiquidationWindow {
  hours: number;
  from: number;
  to: number;
  coverageStartAt: number | null;
  coverageComplete: boolean;
  eventCount: number;
  longNotionalUsd: number;
  shortNotionalUsd: number;
  totalNotionalUsd: number;
  largestEvent: LiquidationEvent | null;
  buckets: LiquidationBucket[];
  recent: LiquidationEvent[];
}

interface LiquidationsValue {
  baseAsset: string;
  connected: boolean;
  streamStartedAt: number | null;
  lastMessageAt: number | null;
  windows: LiquidationWindow[];
}

interface ImpliedVolatilityValue {
  baseAsset: string;
  current: number;
  open24h: number | null;
  high24h: number | null;
  low24h: number | null;
  change24hPercent: number | null;
  resolutionSeconds: number;
  points: number;
}

interface FuturesCurvePoint {
  instrument: string;
  expiryAt: number;
  markPrice: number;
  referencePrice: number;
  basisPercent: number;
  annualizedBasisPercent: number;
  openInterest: number | null;
}

interface FuturesTermStructureValue {
  baseAsset: string;
  referencePrice: number;
  points: FuturesCurvePoint[];
}

interface LiveSections {
  liquidations?: Section<LiquidationsValue>;
  impliedVolatility?: Section<ImpliedVolatilityValue>;
  futuresTermStructure?: Section<FuturesTermStructureValue>;
}

export function AnalyticsLiveModules() {
  const { t } = useLanguage();
  const { snapshot } = useAnalyticsSnapshot();
  const [windowHours, setWindowHours] = useState(24);
  const live = (snapshot?.sections ?? {}) as unknown as LiveSections;

  const liquidations = live.liquidations;
  const selectedWindow = useMemo(() => {
    if (!liquidations?.available) return null;
    return liquidations.value.windows.find((window) => window.hours === windowHours) ?? liquidations.value.windows[0] ?? null;
  }, [liquidations, windowHours]);

  const implied = live.impliedVolatility;
  const curve = live.futuresTermStructure;
  const maxBucket = selectedWindow
    ? Math.max(0, ...selectedWindow.buckets.map((bucket) => bucket.longNotionalUsd + bucket.shortNotionalUsd))
    : 0;

  return (
    <>
      <div className="vx-live-analytics-grid">
        <Module
          title={`${t('analytics.liquidations')}${snapshot?.selectedAsset ? ` · ${snapshot.selectedAsset}` : ''}`}
          className="vx-live-liquidations"
          meta={liquidations?.available ? <FreshnessTag fetchedAt={liquidations.fetchedAt} stale={liquidations.stale} /> : undefined}
        >
          <div className="vx-live-window-tabs" role="tablist" aria-label="Liquidation window">
            {[4, 12, 24].map((hours) => (
              <button
                type="button"
                role="tab"
                aria-selected={windowHours === hours}
                className={windowHours === hours ? 'is-active' : ''}
                onClick={() => setWindowHours(hours)}
                key={hours}
              >
                {hours}h
              </button>
            ))}
          </div>

          {liquidations?.available && selectedWindow ? (
            <>
              <div className="vx-metric-grid vx-live-metrics">
                <Metric label={t('analytics.long')} value={formatUsd(selectedWindow.longNotionalUsd)} tone="negative" />
                <Metric label={t('analytics.short')} value={formatUsd(selectedWindow.shortNotionalUsd)} tone="positive" />
                <Metric label={t('analytics.liquidations')} value={String(selectedWindow.eventCount)} />
                <Metric
                  label={t('analytics.marketRange')}
                  value={selectedWindow.largestEvent ? formatUsd(selectedWindow.largestEvent.notionalUsd) : null}
                />
              </div>

              {!selectedWindow.coverageComplete && selectedWindow.coverageStartAt ? (
                <div className="vx-live-coverage" title={new Date(selectedWindow.coverageStartAt).toLocaleString()}>
                  <span className="vx-live-pulse" />
                  {new Date(selectedWindow.coverageStartAt).toLocaleString()} → now
                </div>
              ) : null}

              <div className="vx-liquidation-map" aria-label={`${windowHours}h liquidation distribution`}>
                {selectedWindow.buckets.length ? selectedWindow.buckets.map((bucket, index) => {
                  const total = bucket.longNotionalUsd + bucket.shortNotionalUsd;
                  const width = maxBucket > 0 ? Math.max(2, (total / maxBucket) * 100) : 0;
                  const longShare = total > 0 ? (bucket.longNotionalUsd / total) * 100 : 0;
                  return (
                    <div className="vx-liquidation-row" key={`${bucket.fromPrice}-${index}`}>
                      <span className="vx-liquidation-price">
                        {formatPrice(bucket.fromPrice)}{bucket.toPrice !== bucket.fromPrice ? ` – ${formatPrice(bucket.toPrice)}` : ''}
                      </span>
                      <span className="vx-liquidation-track">
                        <span className="vx-liquidation-bar" style={{ width: `${width}%` }}>
                          <span className="is-long" style={{ width: `${longShare}%` }} />
                          <span className="is-short" style={{ width: `${100 - longShare}%` }} />
                        </span>
                      </span>
                      <span className="vx-liquidation-total">{formatUsd(total)}</span>
                    </div>
                  );
                }) : (
                  <div className="vx-live-empty">—</div>
                )}
              </div>

              {selectedWindow.recent.length ? (
                <div className="vx-liquidation-tape">
                  {selectedWindow.recent.slice(0, 6).map((event) => (
                    <div className="vx-liquidation-event" key={event.id}>
                      <span className={event.side === 'LONG' ? 'is-long' : 'is-short'}>{event.side}</span>
                      <b>{formatPrice(event.price)}</b>
                      <span>{formatUsd(event.notionalUsd)}</span>
                      <time>{new Date(event.tradeTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="vx-live-empty">—</div>
          )}
        </Module>

        <Module
          title={`${t('analytics.impliedVolatility')}${snapshot?.selectedAsset ? ` · ${snapshot.selectedAsset}` : ''}`}
          meta={implied?.available ? <FreshnessTag fetchedAt={implied.fetchedAt} stale={implied.stale} /> : undefined}
        >
          {implied?.available ? (
            <div className="vx-metric-grid vx-live-metrics">
              <Metric label={t('analytics.impliedVolatility')} value={Number.isFinite(implied.value.current) ? implied.value.current.toFixed(2) : null} emphasis />
              <Metric label="24h" value={formatSignedPercent(implied.value.change24hPercent)} tone={tone(implied.value.change24hPercent)} />
              <Metric
                label={t('analytics.marketRange')}
                value={implied.value.low24h !== null && implied.value.high24h !== null ? `${implied.value.low24h.toFixed(2)} … ${implied.value.high24h.toFixed(2)}` : null}
              />
              <Metric label={t('analytics.constituents')} value={String(implied.value.points)} />
            </div>
          ) : (
            <div className="vx-live-empty">—</div>
          )}
        </Module>
      </div>

      <Module
        title={`${t('analytics.futuresTermStructure')}${snapshot?.selectedAsset ? ` · ${snapshot.selectedAsset}` : ''}`}
        className="vx-term-structure"
        meta={curve?.available ? <FreshnessTag fetchedAt={curve.fetchedAt} stale={curve.stale} /> : undefined}
      >
        {curve?.available ? (
          <>
            <div className="vx-term-reference">
              <span>{t('analytics.indexPrice')}</span>
              <b>{formatPrice(curve.value.referencePrice)}</b>
            </div>
            <div className="vx-term-table" role="table">
              <div className="vx-term-row is-head" role="row">
                <span>{t('analytics.assetContext')}</span>
                <span>{t('analytics.markPrice')}</span>
                <span>{t('analytics.perpetualBasis')}</span>
                <span>APR</span>
                <span>{t('analytics.openInterest')}</span>
              </div>
              {curve.value.points.map((point) => (
                <div className="vx-term-row" role="row" key={point.instrument}>
                  <span>
                    <b>{point.instrument}</b>
                    <small>{new Date(point.expiryAt).toLocaleDateString()}</small>
                  </span>
                  <span>{formatPrice(point.markPrice)}</span>
                  <span className={point.basisPercent >= 0 ? 'is-positive' : 'is-negative'}>{formatSignedPercent(point.basisPercent)}</span>
                  <span className={point.annualizedBasisPercent >= 0 ? 'is-positive' : 'is-negative'}>{formatSignedPercent(point.annualizedBasisPercent)}</span>
                  <span>{formatQuantity(point.openInterest)}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="vx-live-empty">—</div>
        )}
      </Module>
    </>
  );
}

function tone(value: number | null): 'positive' | 'negative' | 'neutral' {
  if (value === null || value === 0) return 'neutral';
  return value > 0 ? 'positive' : 'negative';
}
