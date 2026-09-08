import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useMarketTickers } from '../lib/useMarketData';
import { useLanguage } from '../lib/i18n';
import { QUOTE_PRIORITY, filterAndSortPairs, TickerRow } from '../lib/pairList';
import { useFavorites } from '../lib/useFavorites';
import { parseChangePercent } from '../lib/priceChange';
import { formatSpotBookNumber } from '../lib/spotOrderBook';
import { CryptoIcon } from './CryptoIcon';
import { ChevronDown, ChevronUp, GripVertical, PanelLeftClose, Star } from 'lucide-react';
import './SpotMarketControls.css';

// Per-coin logos now come from the Market Data Gateway's asset registry,
// resolved inside CryptoIcon itself (tier 1 of its fallback chain) via the
// batched /market/assets/icons endpoint.
//
// This replaces a hook that downloaded the ENTIRE 500-coin CoinGecko
// rankings payload — including a 168-point 7-day sparkline per coin — to
// build a symbol->image map and throw the rest away. The registry endpoint
// returns only id/name/logo for the symbols actually on screen, in one
// request, keyed by canonical id rather than by ticker.

type SortField = 'volume' | 'price' | 'change' | 'symbol';

/** The sort states used by the four approved column controls. `volume` descending is the
 * default: "which markets are actually being traded right now" is the
 * first thing a trader wants from a pair list, and it sorts on the feed's
 * real 24h quote turnover (see filterAndSortPairs' note on the field). */
const SORT_MODES: { id: string; field: SortField; dir: 1 | -1 }[] = [
  { id: 'volume_desc', field: 'volume', dir: -1 },
  { id: 'volume_asc', field: 'volume', dir: 1 },
  { id: 'change_desc', field: 'change', dir: -1 },
  { id: 'change_asc', field: 'change', dir: 1 },
  { id: 'price_desc', field: 'price', dir: -1 },
  { id: 'price_asc', field: 'price', dir: 1 },
  { id: 'symbol_asc', field: 'symbol', dir: 1 },
  { id: 'symbol_desc', field: 'symbol', dir: -1 },
];

const REFERENCE_QUOTE_FILTERS = ['USDT', 'USD', 'USDC', 'EUR'];

export interface PairListHandle {
  focusSearch: () => void;
}

// How often the row-ranking snapshot below is allowed to refresh. Long
// enough that the list doesn't visibly reorder while someone's looking at
// it, short enough that ranking still tracks real volume shifts over time.
const SORT_SNAPSHOT_INTERVAL_MS = 20000;

/**
 * The reference's `.pairs-section`: header/collapse, search, live-backed
 * USDT/USD/USDC/EUR tabs, four real sorting controls, resizable width and
 * rows with favourite, current icon, pair, price and signed-change data.
 *
 * All the existing behaviour is kept: the 4s ticker poll, favourites in
 * localStorage, and the shared filter/sort helper in lib/pairList.
 */
export const PairListSidebar = forwardRef<
  PairListHandle,
  {
    pair: string;
    onChange: (pair: string) => void;
    onCollapse?: () => void;
    onResizeStart?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onResizeBy?: (delta: number) => void;
    marketWidth?: number;
  }
>(
  function PairListSidebar({ pair, onChange, onCollapse, onResizeStart, onResizeBy, marketWidth }, ref) {
    const { t } = useLanguage();
    const [tickers, setTickers] = useState<TickerRow[]>([]);
    const [loadError, setLoadError] = useState(false);
    const [search, setSearch] = useState('');
    // Real 24h turnover, descending, until the trader picks otherwise.
    const [sortId, setSortId] = useState('volume_desc');
    const sortMode = SORT_MODES.find((m) => m.id === sortId) ?? SORT_MODES[0];
    const { field: sortField, dir: sortDir } = sortMode;
    const [quoteFilter, setQuoteFilter] = useState<string | null>('USDT');
    const [favoritesOnly, setFavoritesOnly] = useState(false);
    // Shared with Markets, the futures pair list and the homepage table —
    // starring here shows up there immediately (see lib/useFavorites).
    const { favorites, toggle: toggleFavoritePair } = useFavorites();
    const searchRef = useRef<HTMLInputElement>(null);
    // The row ORDER is driven by this snapshot of each pair's volume, not
    // the live figure straight off every 4s poll. Real quoteVolume24h is a
    // rolling window times the live price, so it never sits still — sorting
    // by its live value re-ranks two close-volume pairs on almost every
    // single poll, which is what read as the whole panel jumping. Freezing
    // the ranking between snapshots (and only re-snapshotting every 20s)
    // keeps rows in place while their price/% cells keep updating live.
    const sortSnapshotRef = useRef<Map<string, number>>(new Map());
    const lastSnapshotAtRef = useRef(0);
    // True once the ticker feed has returned a non-empty list at least
    // once — see loadTickers below.
    const hasLoadedTickersRef = useRef(false);

    useImperativeHandle(ref, () => ({ focusSearch: () => searchRef.current?.focus() }), []);

    // The shared market-data store replaces this panel's own 4s poll and
    // its hand-rolled in-flight guard/sequence tracking: the store already
    // runs one timer and one in-flight request for the whole tab, and
    // late-arriving responses cannot land out of order because there is
    // only ever one. Cadence and behaviour are otherwise unchanged.
    const { tickers: tickerMap, loading, error, refresh } = useMarketTickers(4000);

    useEffect(() => {
      // The store keeps the last known good snapshot across a failed poll,
      // so an empty map here means either "still loading" or "the feed has
      // never returned anything" — the same distinction this panel already
      // drew, now driven by the store's own loaded/error state rather than
      // a local ref.
      if (tickerMap.size > 0) {
        hasLoadedTickersRef.current = true;
        setTickers(Array.from(tickerMap.values()));
        const now = Date.now();
        if (sortSnapshotRef.current.size === 0 || now - lastSnapshotAtRef.current >= SORT_SNAPSHOT_INTERVAL_MS) {
          const snapshot = new Map<string, number>();
          for (const tk of tickerMap.values()) snapshot.set(tk.pair, parseFloat(tk.quoteVolume24h || '0'));
          sortSnapshotRef.current = snapshot;
          lastSnapshotAtRef.current = now;
        }
        setLoadError(false);
        return;
      }
      // Empty and not loading: surface retry only if a real list has never
      // been shown, exactly as before — a transient empty poll must not
      // wipe a list the user is already reading.
      if (!loading && !hasLoadedTickersRef.current) setLoadError(true);
    }, [tickerMap, loading]);

    useEffect(() => {
      if (error && !hasLoadedTickersRef.current) setLoadError(true);
    }, [error]);

    function loadTickers() {
      setLoadError(false);
      refresh();
    }

    useEffect(() => {
      function focusSearch(event: KeyboardEvent) {
        const target = event.target as HTMLElement | null;
        if (event.key !== '/' || target?.matches('input, textarea, select, [contenteditable="true"]')) return;
        event.preventDefault();
        searchRef.current?.focus();
      }
      window.addEventListener('keydown', focusSearch);
      return () => window.removeEventListener('keydown', focusSearch);
    }, []);

    const quoteChips = useMemo(() => {
      const present = new Set(tickers.map((tk) => tk.pair.split('/')[1]));
      return QUOTE_PRIORITY.filter((q) => REFERENCE_QUOTE_FILTERS.includes(q) && present.has(q));
    }, [tickers]);

    // Clicking a column header that isn't already active switches to it
    // descending ("biggest first", the more useful default reading for
    // price and % change alike); clicking the active one flips direction.
    // Every header drives the same single sortId, so the visible arrow and
    // the stable snapshot order can never disagree.
    function toggleSort(field: SortField) {
      const defaultDir: 1 | -1 = field === 'symbol' ? 1 : -1;
      const wantDir: 1 | -1 = sortField === field ? (sortDir === -1 ? 1 : -1) : defaultDir;
      const next = SORT_MODES.find((m) => m.field === field && m.dir === wantDir);
      if (next) setSortId(next.id);
    }

    function toggleFavorite(p: string, e: React.MouseEvent) {
      e.stopPropagation();
      toggleFavoritePair(p);
    }

    // Only quoteVolume24h is swapped for the frozen figure — lastPrice and
    // changePercent24h (the only two fields a row actually displays) stay
    // live, so prices keep ticking in place without moving rows around.
    const tickersForSort = useMemo(() => {
      const snapshot = sortSnapshotRef.current;
      if (snapshot.size === 0) return tickers;
      return tickers.map((tk) => {
        const frozenVolume = snapshot.get(tk.pair);
        return frozenVolume === undefined ? tk : { ...tk, quoteVolume24h: String(frozenVolume) };
      });
    }, [tickers]);

    const filtered = filterAndSortPairs(tickersForSort, {
      search,
      quoteFilter,
      favoritesOnly,
      favorites,
      categoryFilter: null,
      sortField,
      sortDir,
      stableSort: true,
    });
    // filterAndSortPairs ignores quoteFilter once a search is typed (a real
    // coin quoted outside the active tab must still be findable); the tab
    // row mirrors that here so it never shows "USDT" highlighted while the
    // results on screen actually span every quote asset.
    const isSearching = search.trim().length > 0;
    const effectiveQuoteFilter = isSearching ? null : quoteFilter;

    return (
      <div className="pairs-section">
        <div className="pairs-header">
          <span>{t('nav.markets')}</span>
          {onCollapse && (
            <button type="button" onClick={onCollapse} title="Свернуть рынки" aria-label="Свернуть рынки">
              <PanelLeftClose size={16} />
            </button>
          )}
        </div>

        <div className="pairs-search">
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('trade.searchPairPlaceholder')}
            aria-label={t('trade.searchPairPlaceholder')}
          />
          <kbd>/</kbd>
        </div>

        <div className="pairs-tabs">
          <button
            className={`pairs-tab ${favoritesOnly ? 'active' : ''}`}
            aria-pressed={favoritesOnly}
            onClick={() => setFavoritesOnly((v) => !v)}
          >
            <Star size={12} fill={favoritesOnly ? 'currentColor' : 'none'} /> {t('trade.favorites')}
          </button>
          {quoteChips.map((q) => (
            <button
              key={q}
              className={`pairs-tab ${!favoritesOnly && effectiveQuoteFilter === q ? 'active' : ''}`}
              aria-pressed={!favoritesOnly && effectiveQuoteFilter === q}
              onClick={() => {
                setFavoritesOnly(false);
                setQuoteFilter(q);
              }}
            >
              {q}
            </button>
          ))}
        </div>

        <div className="pairs-sort">
          <button type="button" data-sort-field="volume" data-sort-dir={sortField === 'volume' ? sortDir : undefined} aria-pressed={sortField === 'volume'} onClick={() => toggleSort('volume')}>
            {t('trade.volume24h')} <SortArrow active={sortField === 'volume'} dir={sortDir} />
          </button>
          <button type="button" data-sort-field="price" data-sort-dir={sortField === 'price' ? sortDir : undefined} aria-pressed={sortField === 'price'} onClick={() => toggleSort('price')}>
            {t('trade.price')} <SortArrow active={sortField === 'price'} dir={sortDir} />
          </button>
          <button type="button" data-sort-field="change" data-sort-dir={sortField === 'change' ? sortDir : undefined} aria-pressed={sortField === 'change'} onClick={() => toggleSort('change')}>
            {t('markets.change24h')} <SortArrow active={sortField === 'change'} dir={sortDir} />
          </button>
          <button type="button" data-sort-field="symbol" data-sort-dir={sortField === 'symbol' ? sortDir : undefined} aria-pressed={sortField === 'symbol'} onClick={() => toggleSort('symbol')} title="Символ A–Z">
            A–Z <SortArrow active={sortField === 'symbol'} dir={sortDir} />
          </button>
        </div>

        <div className="pairs-list">
          {filtered.map((tk) => {
            // Rounded before the direction is picked from it, not after: a
            // change of -0.001% otherwise printed as a red, downward
            // "▼ -0.00%" — an arrow and a sign pointing at nothing.
            const change = Number(parseChangePercent(tk.changePercent24h, tk.pair).toFixed(2));
            const up = change >= 0;
            return (
              <div
                key={tk.pair}
                data-pair={tk.pair}
                role="group"
                aria-label={tk.pair}
                className={`pair-row ${tk.pair === pair ? 'active' : ''}`}
              >
                {/* Five sibling grid cells, matching the reference's
                    .market-row template (star | logo | pair | price |
                    change) — nesting the first three inside one flex cell
                    made the pair column's width depend on the icon's own
                    layout instead of on the grid. */}
                <button
                  type="button"
                  className={`p-star${favorites.has(tk.pair) ? ' on' : ''}`}
                  onClick={(e) => toggleFavorite(tk.pair, e)}
                  title={t('trade.favorites')}
                  aria-label={`${t('trade.favorites')}: ${tk.pair}`}
                  aria-pressed={favorites.has(tk.pair)}
                >
                  <Star size={12} fill={favorites.has(tk.pair) ? 'currentColor' : 'none'} />
                </button>
                <button type="button" className="pair-select" aria-label={tk.pair} aria-pressed={tk.pair === pair} onClick={() => onChange(tk.pair)}>
                <span className="p-icon">
                  <CryptoIcon symbol={tk.pair.split('/')[0]} size={20} />
                </span>
                <span className="p-name">
                  <b className="p-base">{tk.pair.split('/')[0]}</b>
                  <span className="p-quote">/{tk.pair.split('/')[1]}</span>
                </span>
                <span className="p-price">{formatSpotBookNumber(parseFloat(tk.lastPrice))}</span>
                <span className={`p-change ${up ? 'up' : 'down'}`}>
                  {up ? '▲' : '▼'} {up ? '+' : ''}
                  {change.toFixed(2)}%
                </span>
                </button>
              </div>
            );
          })}

          {tickers.length === 0 && loadError && (
            <button className="pair-row" onClick={loadTickers}>
              <span className="p-name">{t('trade.loadPairsError')}</span>
            </button>
          )}
          {tickers.length > 0 && filtered.length === 0 && <div className="empty-state">{t('trade.nothingFound')}</div>}
        </div>

        {(onResizeStart || onResizeBy) && (
          <div className="pairs-resize-handle" onPointerDown={onResizeStart}
            role={onResizeBy ? 'separator' : undefined} tabIndex={onResizeBy ? 0 : undefined}
            aria-hidden={onResizeBy ? undefined : true} aria-label={onResizeBy ? t('nav.markets') : undefined}
            aria-orientation={onResizeBy ? 'vertical' : undefined}
            aria-valuemin={onResizeBy ? 240 : undefined} aria-valuemax={onResizeBy ? 340 : undefined} aria-valuenow={onResizeBy ? marketWidth : undefined}
            onKeyDown={event => { if (onResizeBy && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); onResizeBy(event.key === 'ArrowLeft' ? -10 : 10); } }}>
            <GripVertical size={14} />
          </div>
        )}
      </div>
    );
  }
);

// Faint on an inactive column (still hints it's clickable), solid and
// pointing the live direction on the active one — the same small-arrow
// language the reference's own column headers use.
function SortArrow({ active, dir }: { active: boolean; dir: 1 | -1 }) {
  if (!active) return null;
  return dir === -1 ? <ChevronDown size={11} /> : <ChevronUp size={11} />;
}
