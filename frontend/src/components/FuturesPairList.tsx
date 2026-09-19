import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Search, Star, X } from 'lucide-react';
import { useFuturesReference } from '../lib/useFuturesReference';
import { referenceNumber } from '../lib/futuresReference';
import { useLanguage } from '../lib/i18n';
import { CryptoIcon } from './CryptoIcon';
import { formatPrice } from '../lib/formatNumber';
import { useFavorites } from '../lib/useFavorites';
import { useWindowedRows } from '../lib/useWindowedRows';
import './FuturesPairList.css';

export interface FuturesPairListHandle {
  focusSearch: () => void;
}

interface Row {
  symbol: string;
  /** Null when no live ticker covers this market. NOT zero: at 500+
   *  markets most of the tail has no reference quote at any given moment,
   *  and a zero would both render as a price and sort as the cheapest
   *  market on the exchange. */
  lastPrice: number | null;
  change: number | null;
  quoteVolume24h: number | null;
}

type SortField = 'price' | 'change';
type Sort = { field: SortField; dir: 1 | -1 } | null;

/**
 * The futures market list, on the spot terminal's own `.pair-row` grid so
 * both panels read as one system: star slot, logo, symbol, price, 24h %,
 * with the two numeric columns at fixed widths and tabular figures so live
 * updates cannot move them.
 *
 * Shows the discoverable USDT perpetual catalogue. The order form and
 * server independently enforce the narrower execution whitelist.
 * Prices and 24h figures come from the same live ticker feed the rest of
 * the app uses. Default order pins BTC first, then ranks by real volume.
 *
 * Favorites use the exact same store as Spot and Markets (lib/pairList's
 * loadFavorites/saveFavorites, keyed by pair string) — a contract starred
 * here shows starred there too, rather than three independent favorite
 * lists under one product.
 */
export const FuturesPairList = forwardRef<
  FuturesPairListHandle,
  {
    symbols: string[];
    symbol: string;
    onChange: (symbol: string) => void;
  }
>(function FuturesPairList({ symbols, symbol, onChange }, ref) {
  const { t } = useLanguage();
  const tickers = useFuturesReference();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>(null);
  // Shared store — see lib/useFavorites; the spot terminal, Markets and
  // the homepage table all read the same set, live.
  const { favorites, toggle: toggleFavoritePair } = useFavorites();
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLElement | null>(null);

  /**
   * Search is a header control, not a permanent field.
   *
   * A full-width input sat above the list at all times and bought nothing:
   * on a 500-contract catalogue it is used for a few seconds and then takes
   * a row's worth of height for the rest of the session. It is now a
   * magnifier in the «Рынки» header that swaps the header for the field.
   *
   * The open is deliberately dumb: one state flip and a focus. No request,
   * no fetch, no debounce, no spinner — the list is already in memory and
   * the filter below is a `.filter()` over it, so the first keystroke
   * paints on the next frame. The trap here would be making the button feel
   * dead; nothing it does can block.
   */
  const [searchOpen, setSearchOpen] = useState(false);

  const openSearch = useCallback(() => {
    setSearchOpen(true);
    // The field carries `autoFocus`, so React focuses it in the same commit
    // that mounts it — no frame of dead input. This call covers the OTHER
    // path: the ticker bar asking for search while it is already open, where
    // nothing mounts and autoFocus cannot fire.
    searchRef.current?.focus();
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearch('');
  }, []);

  // The ticker bar's own entry points come through here. Opening from
  // there must behave exactly like pressing the magnifier.
  useImperativeHandle(ref, () => ({ focusSearch: openSearch }), [openSearch]);

  function toggleFavorite(pair: string, e: React.MouseEvent) {
    e.stopPropagation();
    toggleFavoritePair(pair);
  }

  const sortField = sort?.field;
  const sortDir = sort?.dir ?? -1;

  function toggleSort(field: SortField) {
    // Descending -> ascending -> default (BTC first). Sorting never
    // switches the selected contract or discards search/favorites.
    setSort(current => current?.field !== field ? { field, dir: -1 }
      : current.dir === -1 ? { field, dir: 1 } : null);
    if (listRef.current) listRef.current.scrollTop = 0;
  }

  // Asset artwork now resolves inside CryptoIcon from the gateway's asset
  // registry (one batched /market/assets/icons request for the symbols on
  // screen), replacing a full 500-coin rankings download — sparklines and
  // all — that existed only to build a symbol->image map.

  const rows: Row[] = useMemo(() => {
    const built = symbols
      .filter((s) => s.toLowerCase().replace('/', '').includes(search.trim().toLowerCase().replace('/', '')))
      .filter((s) => !favoritesOnly || favorites.has(s))
      .map((s) => {
        const tk = tickers.get(s);
        return {
          symbol: s,
          lastPrice: referenceNumber(tk?.lastPrice),
          change: referenceNumber(tk?.changePercent24h),
          quoteVolume24h: referenceNumber(tk?.quoteVolume24h),
        };
      });

    // Nulls last in BOTH directions. An unpriced market is not the
    // cheapest market and not the biggest faller; it is absent, and
    // absent belongs at the bottom whichever way the column is sorted.
    const by = (a: number | null, b: number | null) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return (a - b) * sortDir;
    };
    return built.sort((a, b) => {
      if (sortField === 'price') return by(a.lastPrice, b.lastPrice);
      if (sortField === 'change') return by(a.change, b.change);
      if (a.symbol === 'BTC/USDT') return -1;
      if (b.symbol === 'BTC/USDT') return 1;
      return by(a.quoteVolume24h, b.quoteVolume24h);
    });
  }, [symbols, tickers, search, sortField, sortDir, favoritesOnly, favorites]);

  const windowed = useWindowedRows(rows.length);
  const attachList = useCallback((node: HTMLElement | null) => {
    listRef.current = node;
    windowed.ref(node);
  }, [windowed.ref]);

  return (
    <>
      {/* «Рынки» and a magnifier, or the field in their place. The row keeps
          its height either way, so opening search moves nothing below it and
          the chart, book and ticket never reflow. */}
      <div className={`pairs-head${searchOpen ? ' searching' : ''}`}>
        {searchOpen ? (
          <input
            ref={searchRef}
            autoFocus
            className="pairs-head-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              // preventDefault, not just stopPropagation. On mobile this
              // list lives inside a <dialog>, and Escape is that element's
              // native cancel — without this, backing out of the field
              // dismissed the whole market panel. Now the first Escape
              // closes the field and a second one closes the panel, which
              // is the order a user expects and matches the desktop rail.
              e.preventDefault();
              e.stopPropagation();
              closeSearch();
            }}
            placeholder={t('trade.searchPair')}
            aria-label={t('trade.searchPair')}
          />
        ) : (
          <span className="pairs-head-title">{t('nav.markets')}</span>
        )}
        <button
          type="button"
          className="pairs-head-search"
          aria-label={t('trade.searchPair')}
          aria-expanded={searchOpen}
          title={t('trade.searchPair')}
          onClick={() => (searchOpen ? closeSearch() : openSearch())}
        >
          {searchOpen ? <X size={14} /> : <Search size={14} />}
        </button>
      </div>

      <div className="pairs-tabs">
        <span className="pairs-count" aria-label={t('nav.futures')}>{symbols.length}</span>
        <button
          type="button"
          className={`pairs-tab ${favoritesOnly ? 'active' : ''}`}
          onClick={() => setFavoritesOnly((v) => !v)}
        >
          <Star size={12} fill={favoritesOnly ? 'currentColor' : 'none'} /> {t('trade.favorites')}
        </button>
      </div>

      <div className="pairs-col-headers futures-pair-headers">
        <span aria-hidden />
        <button type="button" aria-pressed={sortField === 'price'} className={`pch-sort ${sortField === 'price' ? 'active' : ''}`} onClick={() => toggleSort('price')}>
          {t('trade.price')}
          <SortArrow active={sortField === 'price'} dir={sortDir} />
        </button>
        <button type="button" aria-pressed={sortField === 'change'} className={`pch-sort ${sortField === 'change' ? 'active' : ''}`} onClick={() => toggleSort('change')}>
          {t('markets.change24h')}
          <SortArrow active={sortField === 'change'} dir={sortDir} />
        </button>
      </div>

      {/* Windowed: the market universe is data-driven now and routinely
          runs to hundreds of contracts, so only the rows the panel can
          actually show are in the DOM. Spacers preserve the real scroll
          height, so the scrollbar and keyboard scrolling behave exactly as
          they would with every row mounted. */}
      <div className="pairs-list futures-pair-list" ref={attachList} data-total={rows.length}>
        {rows.length === 0 && <div className="empty-state">{t('trade.nothingFound')}</div>}
        {windowed.padTop > 0 && <div style={{ height: windowed.padTop }} aria-hidden />}
        {rows.slice(windowed.start, windowed.end).map((r) => {
          const up = (r.change ?? 0) >= 0;
          const base = r.symbol.split('/')[0];
          return (
            <button
              key={r.symbol}
              data-row
              aria-label={r.symbol}
              title={r.symbol}
              className={`pair-row ${r.symbol === symbol ? 'active' : ''}`}
              onClick={() => onChange(r.symbol)}
            >
              <span
                className={`p-star${favorites.has(r.symbol) ? ' on' : ''}`}
                onClick={(e) => toggleFavorite(r.symbol, e)}
                title={t('trade.favorites')}
              >
                <Star size={12} fill={favorites.has(r.symbol) ? 'currentColor' : 'none'} />
              </span>
              <span className="p-icon">
                <CryptoIcon symbol={base} size={20} />
              </span>
              <span className="p-name">
                  <b className="p-base">{r.symbol.split('/')[0]}</b>
                  {r.symbol.split('/')[1] !== 'USDT' && <span className="p-quote">/{r.symbol.split('/')[1]}</span>}
                </span>
              <span className="p-price">{r.lastPrice !== null ? formatPrice(r.lastPrice) : '—'}</span>
              <span className={`p-change ${up ? 'up' : 'down'}`}>
                {r.change !== null ? `${up ? '+' : ''}${r.change.toFixed(2)}%` : '—'}
              </span>
            </button>
          );
        })}
        {windowed.padBottom > 0 && <div style={{ height: windowed.padBottom }} aria-hidden />}
      </div>
    </>
  );
});

function SortArrow({ active, dir }: { active: boolean; dir: 1 | -1 }) {
  if (!active) return <span className="pch-arrow idle">⇅</span>;
  return <span className="pch-arrow">{dir === -1 ? '▼' : '▲'}</span>;
}
