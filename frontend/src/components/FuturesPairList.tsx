import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Search, Star } from 'lucide-react';
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
    /**
     * Render the search field above the list.
     *
     * OFF for the left rail, which is the whole point: the rail is a
     * standing panel and a field it does not need costs a row of height for
     * the entire session. ON inside the market chooser and the mobile
     * market dialog, both of which exist FOR picking a contract and are
     * dismissed the moment one is picked.
     *
     * One component either way. The rail and the chooser are the same list,
     * the same rows, the same favourites, the same sorting and the same
     * windowing — this flag only decides whether the field is above them.
     */
    searchable?: boolean;
    /** Escape in the field asks the container to close. See FuturesPage. */
    onDismiss?: () => void;
  }
>(function FuturesPairList({ symbols, symbol, onChange, searchable = false, onDismiss }, ref) {
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
   * There is no open/closed search state here any more, and that is the
   * fix. The field used to be a thing this list could toggle, which meant
   * the rail carried a 34px row for it whether or not anyone wanted it, and
   * opening search was a state flip whose result had to be focused.
   *
   * Now the field simply IS there whenever `searchable` is set, so it
   * mounts with the chooser, `autoFocus` puts the caret in it in that same
   * commit, and there is nothing to wait for: no request, no fetch, no
   * debounce, no spinner, no timer, no frame. The filter below is a
   * `.filter()` over a list that is already in memory.
   */
  useImperativeHandle(ref, () => ({
    // For the mobile dialog only. There the list is mounted long before the
    // dialog is shown, so `autoFocus` has already fired and cannot fire
    // again; the container asks for the caret explicitly instead. Same
    // field, same list — just a second way of reaching it.
    focusSearch: () => searchRef.current?.focus(),
  }), []);

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
      {/* Nothing at all on the left rail — not a collapsed row, not a
          spacer, not a hidden input holding height open. The rail's first
          child is the favourites row, so the list starts where the panel
          starts. */}
      {searchable && (
        <div className="market-chooser-search">
          <Search size={13} aria-hidden="true" />
          <input
            ref={searchRef}
            autoFocus
            className="market-chooser-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              // preventDefault, not only stopPropagation. On mobile this
              // list lives inside a <dialog> and Escape is that element's
              // native cancel, which would close the panel behind our back
              // and leave the page's own state thinking it is still open.
              // The container is told instead, so one Escape does one
              // thing and both surfaces close the same way.
              e.preventDefault();
              e.stopPropagation();
              setSearch('');
              onDismiss?.();
            }}
            placeholder={t('trade.searchPair')}
            aria-label={t('trade.searchPair')}
          />
        </div>
      )}

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
