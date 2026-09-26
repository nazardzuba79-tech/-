import { useState } from 'react';
import { PanelRightClose } from 'lucide-react';
import { useLanguage } from '../lib/i18n';
import { CryptoIcon } from './CryptoIcon';
import {
  LISTING_PREVIEW_ASSET, LISTING_PREVIEW_MESSAGE, LISTING_PREVIEW_STAGES, LISTING_PREVIEW_STATUS,
  readListingPreviewStage, saveListingPreviewStage, type ListingPreviewStage,
} from '../lib/listingPreview';
import './ListingPreview.css';

/**
 * The Spot terminal's panels for the VOLTORA listing PREVIEW.
 *
 * Same grid and chrome as any pair; what cannot exist yet is replaced. There
 * is no chart (no history), no order book (no liquidity) and no order entry
 * (nothing can trade). The countdown is a fixed display — this file reads
 * no clock, starts no timer and makes no request, so the preview never
 * moves on its own and a reload shows the same frame.
 */

const asset = LISTING_PREVIEW_ASSET;

export function ListingPreviewBadge() {
  return <span className="vta-badge">{LISTING_PREVIEW_STATUS}</span>;
}

export function ListingPreviewTickerBar({ onSelectPair }: { onSelectPair?: () => void }) {
  const { t } = useLanguage();
  const dash = <span className="value">—</span>;
  return (
    <div className="ticker-bar vta-ticker-bar">
      <div className="pair-selector" role={onSelectPair ? 'button' : undefined} tabIndex={onSelectPair ? 0 : undefined} onClick={onSelectPair}
        onKeyDown={(e) => { if (onSelectPair && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelectPair(); } }}>
        <CryptoIcon symbol={asset.symbol} size={22} />
        <span className="pair-name">{asset.pair}</span>
        <span className="pair-arrow" aria-hidden="true" />
        <ListingPreviewBadge />
      </div>
      <div className="ticker-item"><span className="label">{t('trade.lastPrice')}</span><span className="value price">—</span></div>
      <div className="ticker-item"><span className="label">{t('trade.change24h')}</span>{dash}</div>
      <div className="ticker-item"><span className="label">{t('trade.high24h')}</span>{dash}</div>
      <div className="ticker-item"><span className="label">{t('trade.low24h')}</span>{dash}</div>
      <div className="ticker-item"><span className="label">{`${t('trade.volume24h')} (${asset.symbol})`}</span>{dash}</div>
      <div className="ticker-item"><span className="label">{`${t('trade.volume24h')} (${asset.quote})`}</span>{dash}</div>
      <div className="ticker-item vta-ticker-listing"><span className="label">Listing</span><span className="value">{asset.listingText}</span></div>
    </div>
  );
}

/** The chart area: the listing card, frozen at the stage the owner picks. */
export function ListingPreviewCard() {
  const [stage, setStage] = useState<ListingPreviewStage>(readListingPreviewStage);
  const view = LISTING_PREVIEW_STAGES[stage];
  const pick = (next: ListingPreviewStage) => { setStage(next); saveListingPreviewStage(next); };
  const cells: [string, string][] = [
    [view.countdown[0], 'Days'], [view.countdown[1], 'Hours'], [view.countdown[2], 'Minutes'], [view.countdown[3], 'Seconds'],
  ];

  return (
    <section className="vta-prelisting" aria-label={`${asset.name} listing preview`} data-stage={stage}>
      <div className="vta-prelisting-card">
        <div className="vta-prelisting-mark"><CryptoIcon symbol={asset.symbol} size={64} /></div>
        <h2 className="vta-prelisting-name">{asset.name}</h2>
        <div className="vta-prelisting-pair"><span>{asset.pair}</span><ListingPreviewBadge /></div>
        <p className="vta-prelisting-when">Listing starts {asset.listingText}</p>
        <span className="vta-stage-badge">{view.badge}</span>
        {/* Fixed digits: the preview has no clock, so they never change. */}
        <div className="vta-countdown" aria-label={`${view.badge} (preview)`}>
          {cells.map(([value, label]) => (
            <div className="vta-countdown-cell" key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div className="vta-stage-switch" role="group" aria-label="Preview stage">
          {(Object.keys(LISTING_PREVIEW_STAGES) as ListingPreviewStage[]).map((key) => (
            <button type="button" key={key} aria-pressed={stage === key} onClick={() => pick(key)}>{LISTING_PREVIEW_STAGES[key].label}</button>
          ))}
        </div>
        <dl className="vta-prelisting-facts">
          <div><dt>Initial price</dt><dd>{asset.initialPriceText}</dd></div>
          <div><dt>Market</dt><dd>Preview</dd></div>
          <div><dt>Trading</dt><dd>Not available</dd></div>
        </dl>
        <p className="vta-prelisting-note">Preview · the countdown is not running and the listing is not started.</p>
      </div>
    </section>
  );
}

/** No liquidity, so the book is honestly empty. */
export function ListingPreviewBook({ onCollapse }: { onCollapse?: () => void }) {
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
        <ListingPreviewBadge />
        <strong>No order book</strong>
        <span>{LISTING_PREVIEW_MESSAGE}</span>
      </div>
    </>
  );
}

/**
 * Order entry, visibly present and visibly off. Every control that would
 * start an order answers with the message instead; nothing here reaches the
 * order API.
 */
export function ListingPreviewOrderPanel() {
  const { t } = useLanguage();
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [refused, setRefused] = useState(0);
  const refuse = () => setRefused((n) => n + 1);

  return (
    <div className="vta-order-panel" data-listing-preview="true">
      <div className="order-form-tabs">
        <button type="button" className={`order-form-tab buy ${side === 'BUY' ? 'active' : ''}`} aria-pressed={side === 'BUY'} onClick={() => setSide('BUY')}>{t('trade.buy')}</button>
        <button type="button" className={`order-form-tab sell ${side === 'SELL' ? 'active' : ''}`} aria-pressed={side === 'SELL'} onClick={() => setSide('SELL')}>{t('trade.sell')}</button>
      </div>
      <div className="order-form-content vta-order-content">
        <div className="form-group">
          <div className="form-label"><span>{t('trade.price')}</span></div>
          <div className="input-group">
            <input aria-label={t('trade.price')} readOnly aria-disabled="true" value="" placeholder="—" onFocus={refuse} />
            <span className="input-suffix">{asset.quote}</span>
          </div>
        </div>
        <div className="form-group">
          <div className="form-label"><span>{t('trade.quantity')}</span></div>
          <div className="input-group">
            <input aria-label={t('trade.quantity')} readOnly aria-disabled="true" value="" placeholder="—" onFocus={refuse} />
            <span className="input-suffix">{asset.symbol}</span>
          </div>
        </div>
        {/* One message, always visible; a trading attempt turns it red and
            re-announces it (the key remounts the alert on every attempt). */}
        <div className={`vta-order-status${refused > 0 ? ' is-refused' : ''}`} role={refused > 0 ? 'alert' : undefined} key={refused}>
          <ListingPreviewBadge />
          <span>{LISTING_PREVIEW_MESSAGE}</span>
        </div>
        <div className="vta-order-actions">
          <button type="button" className="submit-btn buy vta-disabled" aria-disabled="true" onClick={refuse}>{t('trade.buy')}</button>
          <button type="button" className="submit-btn sell vta-disabled" aria-disabled="true" onClick={refuse}>{t('trade.sell')}</button>
        </div>
      </div>
    </div>
  );
}
