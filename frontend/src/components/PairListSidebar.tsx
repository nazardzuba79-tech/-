import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import { QUOTE_PRIORITY, filterAndSortPairs, TickerRow } from '../lib/pairList';
import { useFavorites } from '../lib/useFavorites';
import { parseChangePercent } from '../lib/priceChange';
import { formatPrice } from '../lib/formatNumber';
import { CryptoIcon } from './CryptoIcon';
import { ChevronDown, ChevronUp, GripVertical, PanelLeftClose, Star } from 'lucide-react';

// Per-coin logos, covering this app's newer/smaller listings (SUI, TAO,
// ENA, …) that the static jsDelivr icon set CryptoIcon falls back to has
// never had. Not polled: unlike price data, a coin's logo doesn't change
// minute to minute, and the backend's own rankings cache only refreshes
// hourly anyway (see CoinGeckoService).
function useCoinIconMap(): Map<string, string> {
  const [icons, setIcons] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    api
      .getExternalRankings()
      .then((res) => {
        if (cancelled) return;
        const iconMap = new Map<string, string>();
        for (const r of res.rankings) {
          if (r.image) iconMap.set(r.symbol, r.image);
        }
        setIcons(iconMap);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return icons;
}

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
    /** Optional display precision only; sorting still uses the raw ticker. */
    priceFormatter?: (price: number) => string;
  }
>(
  function PairListSidebar({ pair, onChange, onCollapse, onResizeStart, priceFormatter = formatPrice }, ref) {
    const { t } = useLanguage();
    const coinIcons = useCoinIconMap();
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

    function loadTickers() {
      setLoadError(false);
      api
        .getExternalTickers()
        .then((res) => {
          if (res.tickers.length === 0) {
            // The feed can come back with an empty array instead of throwing
            // (a real backend hiccup, not a thrown error). Before any real
            // data has ever loaded that must still surface a retry state —
            // otherwise the list just goes silently blank with nothing to
            // click. Once we've shown a real list at least once, though,
            // keep it on screen rather than wiping it for a likely-transient
            // empty poll (same "keep last known good data" behavior TickerBar
            // already uses on its own fetch failures).
            if (!hasLoadedTickersRef.current) setLoadError(true);
            return;
          }
          hasLoadedTickersRef.current = true;
          setTickers(res.tickers);
          const now = Date.now();
          if (sortSnapshotRef.current.size === 0 || now - lastSnapshotAtRef.current >= SORT_SNAPSHOT_INTERVAL_MS) {
            const snapshot = new Map<string, number>();
            for (const tk of res.tickers) snapshot.set(tk.pair, parseFloat(tk.quoteVolume24h || '0'));
            sortSnapshotRef.current = snapshot;
            lastSnapshotAtRef.current = now;
          }
        })
        .catch(() => setLoadError(true));
    }

    useEffect(() => {
      loadTickers();
      const poll = window.setInterval(loadTickers, 4000);
      return () => window.clearInterval(poll);
    }, []);

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
          />
          <kbd>/</kbd>
        </div>

        <div className="pairs-tabs">
          <button
            className={`pairs-tab ${favoritesOnly ? 'active' : ''}`}
            onClick={() => setFavoritesOnly((v) => !v)}
          >
            <Star size={12} fill={favoritesOnly ? 'currentColor' : 'none'} /> {t('trade.favorites')}
          </button>
          {quoteChips.map((q) => (
            <button
              key={q}
              className={`pairs-tab ${!favoritesOnly && effectiveQuoteFilter === q ? 'active' : ''}`}
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
          <button type="button" onClick={() => toggleSort('volume')}>
            {t('trade.volume24h')} <SortArrow active={sortField === 'volume'} dir={sortDir} />
          </button>
          <button type="button" onClick={() => toggleSort('price')}>
            {t('trade.price')} <SortArrow active={sortField === 'price'} dir={sortDir} />
          </button>
          <button type="button" onClick={() => toggleSort('change')}>
            {t('markets.change24h')} <SortArrow active={sortField === 'change'} dir={sortDir} />
          </button>
          <button type="button" onClick={() => toggleSort('symbol')} title="Символ A–Z">
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
              <button
                key={tk.pair}
                className={`pair-row ${tk.pair === pair ? 'active' : ''}`}
                onClick={() => onChange(tk.pair)}
              >
                {/* Five sibling grid cells, matching the reference's
                    .market-row template (star | logo | pair | price |
                    change) — nesting the first three inside one flex cell
                    made the pair column's width depend on the icon's own
                    layout instead of on the grid. */}
                <span
                  className={`p-star${favorites.has(tk.pair) ? ' on' : ''}`}
                  onClick={(e) => toggleFavorite(tk.pair, e)}
                  title={t('trade.favorites')}
                >
                  <Star size={12} fill={favorites.has(tk.pair) ? 'currentColor' : 'none'} />
                </span>
                <span className="p-icon">
                  <CryptoIcon symbol={tk.pair.split('/')[0]} size={20} imageUrl={coinIcons.get(tk.pair.split('/')[0])} />
                </span>
                <span className="p-name">
                  <b className="p-base">{tk.pair.split('/')[0]}</b>
                  <span className="p-quote">/{tk.pair.split('/')[1]}</span>
                </span>
                <span className="p-price">{priceFormatter(parseFloat(tk.lastPrice))}</span>
                <span className={`p-change ${up ? 'up' : 'down'}`}>
                  {up ? '▲' : '▼'} {up ? '+' : ''}
                  {change.toFixed(2)}%
                </span>
              </button>
            );
          })}

          {tickers.length === 0 && loadError && (
            <button className="pair-row" onClick={loadTickers}>
              <span className="p-name">{t('trade.loadPairsError')}</span>
            </button>
          )}
          {tickers.length > 0 && filtered.length === 0 && <div className="empty-state">{t('trade.nothingFound')}</div>}
        </div>

        {onResizeStart && (
          <div className="pairs-resize-handle" onPointerDown={onResizeStart} aria-hidden="true">
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
