import { Star } from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import { useTestMarkets } from '../../lib/testMarketStore';
import {
  formatListingTime, formatTestCompact, formatTestPercent, formatTestPrice, matchesTestAssetSearch,
  TEST_ASSET_STATUS_LABEL,
} from '../../lib/testMarkets';
import './TestMarketsStrip.css';

/**
 * Test markets on the Markets page, above the catalogue. They are not in
 * the catalogue on purpose: that table is market-wide reference data, and
 * a simulated asset must never be mistaken for a real coin there. Search
 * and favourites apply to these rows exactly as to the table's.
 */
export function TestMarketsStrip({ search, favoritesOnly, favorites, onToggleFavorite, onOpen }: {
  search: string;
  favoritesOnly: boolean;
  favorites: Set<string>;
  onToggleFavorite: (pair: string) => void;
  onOpen: (pair: string) => void;
}) {
  const { assets } = useTestMarkets();
  const rows = assets.filter((asset) => matchesTestAssetSearch(asset, search) && (!favoritesOnly || favorites.has(asset.pair)));
  if (rows.length === 0) return null;

  return (
    <section className="test-markets" aria-label="Тестовый рынок">
      {rows.map((asset) => {
        const { state } = asset;
        const live = state.phase === 'live';
        const change = state.change24hPercent;
        const starred = favorites.has(asset.pair);
        return (
          <div className="test-market-row" key={asset.pair} data-pair={asset.pair} data-phase={state.phase}>
            <button type="button" className={`test-market-star${starred ? ' on' : ''}`} aria-pressed={starred}
              aria-label={`Избранное: ${asset.pair}`} onClick={() => onToggleFavorite(asset.pair)}>
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
              <span className="test-market-badge">{asset.status || TEST_ASSET_STATUS_LABEL}</span>
              <span className="test-market-figure">
                <small>Цена</small>
                <strong>{live ? formatTestPrice(state.lastPrice) : '—'}</strong>
              </span>
              <span className="test-market-figure">
                <small>24ч</small>
                <strong className={!live || change === null ? '' : change >= 0 ? 'positive' : 'negative'}>{live ? formatTestPercent(change) : '—'}</strong>
              </span>
              <span className="test-market-figure test-market-volume">
                <small>Объём 24ч</small>
                <strong>{live ? `${formatTestCompact(state.quoteVolume24h)} ${asset.quote}` : '—'}</strong>
              </span>
              <span className="test-market-listing">
                {live ? 'Simulated market · live' : `Listing starts ${formatListingTime(asset.listingAt)}`}
              </span>
            </button>
          </div>
        );
      })}
    </section>
  );
}
