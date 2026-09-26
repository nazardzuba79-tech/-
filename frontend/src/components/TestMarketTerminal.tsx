import { useEffect, useRef, useState } from 'react';
import { PanelRightClose } from 'lucide-react';
import { useLanguage } from '../lib/i18n';
import { CryptoIcon } from './CryptoIcon';
import { TerminalChart } from './TerminalChart';
import { testMarketStore } from '../lib/testMarketStore';
import { testMarketCandleLoader } from '../lib/testMarketCandles';
import {
  countdownParts, formatListingTime, formatTestCompact, formatTestPercent, formatTestPrice, formatTestPriceChange, formatTestAxisPrice, sinceListingPercent,
  TEST_ASSET_NOT_TRADABLE_MESSAGE, TEST_ASSET_STATUS_LABEL, type TestAsset,
} from '../lib/testMarkets';
import './TestMarketTerminal.css';

/**
 * The Spot terminal's panels for a VOLTEX test asset (VOLTORA, VTA/USDT).
 *
 * Same grid, same chrome, same chart component — only what cannot be true
 * for a simulated market is replaced: there is no order book (no
 * liquidity), no order entry (nothing can trade), and before the listing
 * no chart (there is no history yet). Every figure comes from the server's
 * simulation; nothing here invents a price.
 */

/** Server "now", ticking once a second — only while a countdown is shown. */
function useServerNow(clockOffsetMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now() + clockOffsetMs);
  useEffect(() => {
    setNow(Date.now() + clockOffsetMs);
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now() + clockOffsetMs), 1000);
    return () => window.clearInterval(timer);
  }, [clockOffsetMs, active]);
  return now;
}

export function TestMarketBadge() {
  return <span className="vta-badge">{TEST_ASSET_STATUS_LABEL}</span>;
}

export function TestMarketTickerBar({ pair, asset, onSelectPair }: { pair: string; asset: TestAsset | null; onSelectPair?: () => void }) {
  const { t } = useLanguage();
  const [base, quote] = pair.split('/');
  const state = asset?.state;
  const live = state?.phase === 'live' && state.lastPrice !== null;
  const change = live ? state!.change24hPercent : null;
  const dir = change === null || change >= 0 ? 'up' : 'down';
  const absolute = live && change !== null ? state!.lastPrice! - state!.lastPrice! / (1 + change / 100) : null;
  const price = (value: number | null | undefined) => (live ? formatTestPrice(value ?? null) : '—');

  return (
    <div className="ticker-bar vta-ticker-bar">
      <div className="pair-selector" role={onSelectPair ? 'button' : undefined} tabIndex={onSelectPair ? 0 : undefined} onClick={onSelectPair}
        onKeyDown={(e) => { if (onSelectPair && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelectPair(); } }}>
        <CryptoIcon symbol={base} size={22} />
        <span className="pair-name">{pair}</span>
        <span className="pair-arrow" aria-hidden="true" />
        <TestMarketBadge />
      </div>
      <div className="ticker-item">
        <span className="label">{t('trade.lastPrice')}</span>
        <span className={`value price ${live ? dir : ''}`}>{price(state?.lastPrice)}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('trade.change24h')}</span>
        <span className={`value change ${live ? dir : ''}`}>
          {live && absolute !== null ? `${formatTestPriceChange(absolute, state!.lastPrice)} (${formatTestPercent(change)})` : '—'}
        </span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('trade.high24h')}</span>
        <span className="value">{price(state?.high24h)}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{t('trade.low24h')}</span>
        <span className="value">{price(state?.low24h)}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{`${t('trade.volume24h')} (${base})`}</span>
        <span className="value">{live ? formatTestCompact(state!.volume24h) : '—'}</span>
      </div>
      <div className="ticker-item">
        <span className="label">{`${t('trade.volume24h')} (${quote})`}</span>
        <span className="value">{live ? formatTestCompact(state!.quoteVolume24h) : '—'}</span>
      </div>
      {live && asset && (
        <div className="ticker-item vta-ticker-listing">
          <span className="label">Since listing</span>
          <span className={`value ${(sinceListingPercent(asset) ?? 0) >= 0 ? 'up' : 'down'}`}>{formatTestPercent(sinceListingPercent(asset))}</span>
        </div>
      )}
      {!live && asset && (
        <div className="ticker-item vta-ticker-listing">
          <span className="label">Listing</span>
          <span className="value">{formatListingTime(asset.listingAt)}</span>
        </div>
      )}
    </div>
  );
}

/** The chart area: the premium pre-listing state, or the simulated chart. */
export function TestMarketChart({ pair, asset, loaded, error, clockOffsetMs }: {
  pair: string; asset: TestAsset | null; loaded: boolean; error: boolean; clockOffsetMs: number;
}) {
  const listingAt = asset ? Date.parse(asset.listingAt) : NaN;
  const preListing = !asset || asset.state.phase === 'pre-listing';
  const now = useServerNow(clockOffsetMs, preListing && Number.isFinite(listingAt));
  const reachedRef = useRef(false);
  const left = Number.isFinite(listingAt) ? listingAt - now : NaN;

  // The listing moment: ask the server once; the chart appears when it
  // says the market is live, never on the browser's say-so alone.
  useEffect(() => {
    if (!preListing || !Number.isFinite(left)) { reachedRef.current = false; return; }
    if (left <= 0 && !reachedRef.current) {
      reachedRef.current = true;
      void testMarketStore.refresh();
    }
  }, [preListing, left]);

  if (asset && !preListing) {
    return <TerminalChart pair={pair} chrome="terminal" drawingTools market="spot" compactTools candleLoader={testMarketCandleLoader}
      tradingView={false} priceScaleMode="logarithmic" priceFormatter={formatTestAxisPrice} />;
  }

  const parts = countdownParts(Number.isFinite(left) ? left : 0);
  const pad = (value: number) => String(value).padStart(2, '0');
  const cells: [string, string][] = [
    [pad(parts.days), 'Days'], [pad(parts.hours), 'Hours'], [pad(parts.minutes), 'Minutes'], [pad(parts.seconds), 'Seconds'],
  ];

  return (
    <section className="vta-prelisting" aria-label={`${asset?.name ?? 'VOLTORA'} listing`} data-state={asset ? 'pre-listing' : loaded && error ? 'error' : 'loading'}>
      <div className="vta-prelisting-card">
        <div className="vta-prelisting-mark"><CryptoIcon symbol={pair.split('/')[0]} size={64} /></div>
        <h2 className="vta-prelisting-name">{asset?.name ?? 'VOLTORA'}</h2>
        <div className="vta-prelisting-pair"><span>{pair}</span><TestMarketBadge /></div>
        {asset ? (
          <>
            <p className="vta-prelisting-when">Listing starts {formatListingTime(asset.listingAt)}</p>
            <div className="vta-countdown" role="timer" aria-label={`Listing in ${parts.days} days ${parts.hours} hours ${parts.minutes} minutes`}>
              {cells.map(([value, label]) => (
                <div className="vta-countdown-cell" key={label}>
                  <strong>{parts.done ? '00' : value}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <dl className="vta-prelisting-facts">
              <div><dt>Initial price</dt><dd>{formatTestPrice(asset.initialPrice)} {asset.quote}</dd></div>
              <div><dt>Market</dt><dd>Simulated</dd></div>
              <div><dt>Trading</dt><dd>Not available</dd></div>
            </dl>
          </>
        ) : (
          <p className="vta-prelisting-when">{loaded && error ? 'Test market data is unavailable right now.' : 'Loading…'}</p>
        )}
        {!asset && <p className="vta-prelisting-note">{TEST_ASSET_NOT_TRADABLE_MESSAGE}</p>}
      </div>
    </section>
  );
}

/** A test asset has no liquidity, so its book is honestly empty. */
export function TestMarketBook({ onCollapse }: { onCollapse?: () => void }) {
  const { t } = useLanguage();
  return (
    <>
      <div className="orderbook-header">
        <span className="orderbook-title">{t('trade.orderBook')}</span>
        {onCollapse && (
          <div className="orderbook-header-actions">
            <button className="orderbook-collapse" type="button" onClick={onCollapse} title="Свернуть стакан" aria-label="Свернуть стакан">
              <PanelRightClose size={16} />
            </button>
          </div>
        )}
      </div>
      <div className="vta-book-empty" role="note">
        <TestMarketBadge />
        <strong>No order book</strong>
        <span>{TEST_ASSET_NOT_TRADABLE_MESSAGE}</span>
      </div>
    </>
  );
}

/**
 * Order entry, visibly present and visibly off. Every control that would
 * start an order says why instead — nothing here can reach the order API.
 */
export function TestMarketOrderPanel({ pair }: { pair: string }) {
  const { t } = useLanguage();
  const [base, quote] = pair.split('/');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [refused, setRefused] = useState(0);
  const refuse = () => setRefused((n) => n + 1);

  return (
    <div className="vta-order-panel" data-test-asset="true">
      <div className="order-form-tabs">
        <button type="button" className={`order-form-tab buy ${side === 'BUY' ? 'active' : ''}`} aria-pressed={side === 'BUY'} onClick={() => setSide('BUY')}>{t('trade.buy')}</button>
        <button type="button" className={`order-form-tab sell ${side === 'SELL' ? 'active' : ''}`} aria-pressed={side === 'SELL'} onClick={() => setSide('SELL')}>{t('trade.sell')}</button>
      </div>
      <div className="order-form-content vta-order-content">
        <div className="form-group">
          <div className="form-label"><span>{t('trade.price')}</span></div>
          <div className="input-group">
            <input aria-label={t('trade.price')} readOnly aria-disabled="true" value="" placeholder="—" onFocus={refuse} />
            <span className="input-suffix">{quote}</span>
          </div>
        </div>
        <div className="form-group">
          <div className="form-label"><span>{t('trade.quantity')}</span></div>
          <div className="input-group">
            <input aria-label={t('trade.quantity')} readOnly aria-disabled="true" value="" placeholder="—" onFocus={refuse} />
            <span className="input-suffix">{base}</span>
          </div>
        </div>
        {/* One message, always visible; a trading attempt turns it red and
            re-announces it (the key remounts the alert on every attempt). */}
        <div className={`vta-order-status${refused > 0 ? ' is-refused' : ''}`} role={refused > 0 ? 'alert' : undefined} key={refused}>
          <TestMarketBadge />
          <span>{TEST_ASSET_NOT_TRADABLE_MESSAGE}</span>
        </div>
        <div className="vta-order-actions">
          <button type="button" className="submit-btn buy vta-disabled" aria-disabled="true" onClick={refuse}>{t('trade.buy')}</button>
          <button type="button" className="submit-btn sell vta-disabled" aria-disabled="true" onClick={refuse}>{t('trade.sell')}</button>
        </div>
      </div>
    </div>
  );
}
