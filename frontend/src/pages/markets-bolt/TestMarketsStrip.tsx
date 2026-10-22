import { Star } from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import { localeOf, useLanguage } from '../../lib/i18n';
import { useTestMarkets } from '../../lib/testMarketStore';
import { nrxListingTime } from '../../lib/nrxMarket';
import { formatListingMoment, formatTestCompact, formatTestPercent, formatTestPrice, managedListingTime, matchesTestAssetSearch, testMarketPresentation } from '../../lib/testMarkets';
import './TestMarketsStrip.css';

/**
 * New listings on the Markets page, above the catalogue. They are not in
 * the catalogue on purpose: that table is market-wide reference data from
 * the venues. Search and favourites apply to these rows exactly as to the
 * table's.
 */
export function TestMarketsStrip({ search, favoritesOnly, favorites, onToggleFavorite, onOpen }: {
  search: string;
  favoritesOnly: boolean;
  favorites: Set<string>;
  onToggleFavorite: (pair: string) => void;
  onOpen: (pair: string) => void;
}) {
  const { t, lang } = useLanguage();
  const { assets, error, clockOffsetMs } = useTestMarkets();
  const rows = assets.filter((asset) => matchesTestAssetSearch(asset, search) && (!favoritesOnly || favorites.has(asset.pair)));
  if (rows.length === 0 && !error) return null;

  return (
    <section className="test-markets" aria-label={t('listing.newListing')}>
      {error && <p role="alert">{t(assets.length ? 'listing.dataStale' : 'listing.loadFailed')}</p>}
      {rows.map((asset) => {
        const { state } = asset;
        const live = state.phase === 'live';
        const change = state.change24hPercent;
        const starred = favorites.has(asset.pair);
        const presentation = testMarketPresentation(asset, Date.now() + clockOffsetMs);
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
                <span>{t(presentation.simulationKey)}{presentation.availabilityKey && <> · {t(presentation.availabilityKey)}</>}</span>
                {!live && <span>{presentation.scheduleKey ? t(presentation.scheduleKey)
                  : `${t('listing.scheduledAt')}: ${asset.symbol === 'NRX' ? nrxListingTime(asset.listingAt)
                    : asset.managed ? managedListingTime(asset.listingAt, asset.displayTimeZone ?? 'UTC', localeOf(lang)) : formatListingMoment(asset.listingAt, localeOf(lang))}`}</span>}
              </span>
            </button>
          </div>
        );
      })}
    </section>
  );
}
