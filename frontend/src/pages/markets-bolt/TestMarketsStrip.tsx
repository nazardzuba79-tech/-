import { useState } from 'react';
import { Star } from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import { localeOf, useLanguage } from '../../lib/i18n';
import { useTestMarkets } from '../../lib/testMarketStore';
import { nrxListingTime } from '../../lib/nrxMarket';
import { countdownParts, formatListingMoment, formatTestCompact, formatTestPercent, formatTestPrice, managedListingTime, matchesTestAssetSearch, testMarketPresentation, type TestAsset } from '../../lib/testMarkets';
import { orderListings, type ListingOrder } from '../../lib/listingsOrder';
import './TestMarketsStrip.css';

/**
 * New listings on the Markets page, above the catalogue. They are not in
 * the catalogue on purpose: that table is market-wide reference data from
 * the venues. Search and favourites apply to these rows exactly as to the
 * table's. With `heading` the strip carries its own title and the
 * «Скоро / Торгуются» order switch (the phone shows it at the top of the page).
 */
export function TestMarketsStrip({ search, favoritesOnly, favorites, onToggleFavorite, onOpen, heading = false, top = false }: {
  search: string;
  favoritesOnly: boolean;
  favorites: Set<string>;
  onToggleFavorite: (pair: string) => void;
  onOpen: (pair: string) => void;
  heading?: boolean;
  /** Placed at the top of the page (phone). */
  top?: boolean;
}) {
  const { t, lang } = useLanguage();
  const { assets, error, clockOffsetMs } = useTestMarkets();
  const [order, setOrder] = useState<ListingOrder>('soon');
  const now = Date.now() + clockOffsetMs;
  const rows = orderListings(assets.filter((asset) => matchesTestAssetSearch(asset, search) && (!favoritesOnly || favorites.has(asset.pair))), order);
  if (rows.length === 0 && !error) return null;

  const eta = (asset: TestAsset): string | null => {
    const at = Date.parse(asset.listingAt);
    if (!Number.isFinite(at) || at <= now) return null;
    const parts = countdownParts(at - now);
    const time = parts.days > 0 ? `${parts.days} ${t('listings.unitDay')} ${parts.hours} ${t('listings.unitHour')}`
      : parts.hours > 0 ? `${parts.hours} ${t('listings.unitHour')} ${parts.minutes} ${t('listings.unitMinute')}`
        : `${Math.max(1, parts.minutes)} ${t('listings.unitMinute')}`;
    return t('listings.in', { time });
  };

  return (
    <section className={`test-markets${top ? ' is-top' : ''}`} aria-label={t('listings.title')} data-listing-order={order}>
      {heading && (
        <div className="test-markets-head">
          <h2>{t('listings.title')}</h2>
          <div className="test-markets-order" role="group" aria-label={t('listings.sortLabel')}>
            {(['soon', 'live'] as const).map(value => (
              <button key={value} type="button" aria-pressed={order === value} data-listing-sort={value} onClick={() => setOrder(value)}>
                {t(value === 'soon' ? 'listings.sortSoon' : 'listings.sortLive')}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <p role="alert">{t(assets.length ? 'listing.dataStale' : 'listing.loadFailed')}</p>}
      {rows.map((asset) => {
        const { state } = asset;
        const live = state.phase === 'live';
        const change = state.change24hPercent;
        const starred = favorites.has(asset.pair);
        const presentation = testMarketPresentation(asset, now);
        const remaining = !live && presentation.showCountdown ? eta(asset) : null;
        return (
          <div className="test-market-row" key={asset.pair} data-pair={asset.pair} data-phase={state.phase}>
            <button type="button" className={`test-market-star${starred ? ' on' : ''}`} aria-pressed={starred}
              aria-label={`${t('trade.favorites')}: ${asset.pair}`} onClick={() => onToggleFavorite(asset.pair)}>
              <Star size={15} fill={starred ? 'currentColor' : 'none'} />
            </button>
            <button type="button" className="test-market-open" onClick={() => onOpen(asset.pair)} aria-label={`${asset.name} ${asset.pair}`}>
              <span className="test-market-identity">
                <CryptoIcon symbol={asset.symbol} size={30} />
                <span>
                  <strong>{asset.pair}</strong>
                  <small>{asset.name}</small>
                  {asset.provenanceLabel && <small data-demo-provenance>{asset.provenanceLabel}</small>}
                </span>
              </span>
              <span className="test-market-figure">
                <small>{t('trade.price')}</small>
                <strong>{live ? formatTestPrice(state.lastPrice) : '—'}</strong>
              </span>
              <span className="test-market-figure">
                <small>24ч</small>
                <strong className={!live || change === null ? '' : change >= 0 ? 'positive' : 'negative'}>{live ? formatTestPercent(change) : '—'}</strong>
              </span>
              <span className="test-market-figure test-market-volume">
                <small>{t('listing.volume24h')}</small>
                <strong>{live ? `${formatTestCompact(state.quoteVolume24h)} ${asset.quote}` : '—'}</strong>
              </span>
              <span className="test-market-listing">
                {!live && <span>{presentation.scheduleKey ? t(presentation.scheduleKey)
                  : `${t('listing.scheduledAt')}: ${asset.symbol === 'NRX' ? nrxListingTime(asset.listingAt)
                    : asset.managed ? managedListingTime(asset.listingAt, asset.displayTimeZone ?? 'UTC', localeOf(lang)) : formatListingMoment(asset.listingAt, localeOf(lang))}`}</span>}
                {remaining && <span className="test-market-eta" data-listing-eta>{remaining}</span>}
              </span>
            </button>
          </div>
        );
      })}
    </section>
  );
}
