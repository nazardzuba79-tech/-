import { Star } from 'lucide-react';
import { CryptoIcon } from '../../components/CryptoIcon';
import {
  LISTING_PREVIEW_ASSET, LISTING_PREVIEW_STATUS, matchesListingPreviewSearch,
} from '../../lib/listingPreview';
import './ListingPreviewStrip.css';

/**
 * The VOLTORA listing preview on the Markets page, above the catalogue —
 * not inside it: the catalogue is market-wide reference data and a preview
 * must never be mistaken for a real coin there. Search and favourites apply
 * to this row as to the table's. Every figure is a dash; nothing is live.
 */
export function ListingPreviewStrip({ search, favoritesOnly, favorites, onToggleFavorite, onOpen }: {
  search: string;
  favoritesOnly: boolean;
  favorites: Set<string>;
  onToggleFavorite: (pair: string) => void;
  onOpen: (pair: string) => void;
}) {
  const asset = LISTING_PREVIEW_ASSET;
  const starred = favorites.has(asset.pair);
  if (!matchesListingPreviewSearch(search) || (favoritesOnly && !starred)) return null;

  return (
    <section className="test-markets" aria-label="Скоро листинг">
      <div className="test-market-row" data-pair={asset.pair}>
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
          <span className="test-market-badge">{LISTING_PREVIEW_STATUS}</span>
          <span className="test-market-figure"><small>Цена</small><strong>—</strong></span>
          <span className="test-market-figure"><small>24ч</small><strong>—</strong></span>
          <span className="test-market-figure test-market-volume"><small>Объём 24ч</small><strong>—</strong></span>
          <span className="test-market-listing">Listing starts {asset.listingText}</span>
        </button>
      </div>
    </section>
  );
}
