import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage, Key } from '../lib/i18n';
import { QUOTE_PRIORITY, loadFavorites, saveFavorites, filterAndSortPairs, TickerRow } from '../lib/pairList';
import { parseChangePercent } from '../lib/priceChange';
import { formatPrice } from '../lib/formatNumber';
import { CryptoIcon } from './CryptoIcon';

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

/** The sort modes offered, in menu order. `volume` descending is the
 * default: "which markets are actually being traded right now" is the
 * first thing a trader wants from a pair list, and it sorts on the feed's
 * real 24h quote turnover (see filterAndSortPairs' note on the field). */
const SORT_MODES: { id: string; field: SortField; dir: 1 | -1; labelKey: Key }[] = [
  { id: 'volume_desc', field: 'volume', dir: -1, labelKey: 'trade.sortVolumeDesc' },
  { id: 'volume_asc', field: 'volume', dir: 1, labelKey: 'trade.sortVolumeAsc' },
  { id: 'change_desc', field: 'change', dir: -1, labelKey: 'trade.sortChangeDesc' },
  { id: 'change_asc', field: 'change', dir: 1, labelKey: 'trade.sortChangeAsc' },
  { id: 'price_desc', field: 'price', dir: -1, labelKey: 'trade.sortPriceDesc' },
  { id: 'price_asc', field: 'price', dir: 1, labelKey: 'trade.sortPriceAsc' },
  { id: 'symbol_asc', field: 'symbol', dir: 1, labelKey: 'trade.sortSymbolAsc' },
];

export interface PairListHandle {
  focusSearch: () => void;
}

// How often the row-ranking snapshot below is allowed to refresh. Long
// enough that the list doesn't visibly reorder while someone's looking at
// it, short enough that ranking still tracks real volume shifts over time.
const SORT_SNAPSHOT_INTERVAL_MS = 20000;

/**
 * The reference's `.pairs-section`: a search field, a row of quote tabs
 * (the reference's ⭐ Fav / USDT / BTC / ETH / NEW), and the pair list
 * itself — each row a favourite star, an asset logo, a name, a price and
 * a signed change, with the active pair tinted in the accent. The logo is
 * CryptoIcon, the same icon-set-with-letter-fallback component the rest
 * of the app already uses (Futures' pair list, Wallet, CFD instruments) —
 * not a new asset system.
 *
 * All the existing behaviour is kept: the 4s ticker poll, favourites in
 * localStorage, and the shared filter/sort helper in lib/pairList.
 */
export const PairListSidebar = forwardRef<PairListHandle, { pair: string; onChange: (pair: string) => void }>(
  function PairListSidebar({ pair, onChange }, ref) {
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
    const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
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

    const quoteChips = useMemo(() => {
      const present = new Set(tickers.map((tk) => tk.pair.split('/')[1]));
      return QUOTE_PRIORITY.filter((q) => present.has(q));
    }, [tickers]);

    // Clicking a column header that isn't already active switches to it
    // descending ("biggest first", the more useful default reading for
    // price and % change alike); clicking the active one flips direction.
    // Both the headers and the sort menu drive the same single sortId, so
    // they can never disagree about what the list is sorted by.
    function toggleSort(field: SortField) {
      const wantDir: 1 | -1 = sortField === field && sortDir === -1 ? 1 : -1;
      const next = SORT_MODES.find((m) => m.field === field && m.dir === wantDir);
      if (next) setSortId(next.id);
    }

    function toggleFavorite(p: string, e: React.MouseEvent) {
      e.stopPropagation();
      setFavorites((prev) => {
        const next = new Set(prev);
        if (next.has(p)) next.delete(p);
        else next.add(p);
        saveFavorites(next);
        return next;
      });
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
        <div className="pairs-search">
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('trade.searchPairPlaceholder')}
          />
        </div>

        <div className="pairs-tabs">
          <button
            className={`pairs-tab ${favoritesOnly ? 'active' : ''}`}
            onClick={() => setFavoritesOnly((v) => !v)}
          >
            ★ {t('trade.favorites')}
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
          <button
            className={`pairs-tab ${!favoritesOnly && effectiveQuoteFilter === null ? 'active' : ''}`}
            onClick={() => {
              setFavoritesOnly(false);
              setQuoteFilter(null);
            }}
          >
            {t('trade.allPairs')}
          </button>
        </div>

        {/* The header carries the sort itself rather than a separate panel
            above the list. Цена / 24ч % are the two columns actually shown,
            so they sort by being clicked; 24h volume has no column at this
            panel width, so it lives in the menu on the left — which doubles
            as the readout of what the list is currently sorted by, since
            the default (volume, descending) has no column to mark. */}
        <div className="pairs-col-headers">
          <select
            className={`pch-mode ${sortField === 'volume' || sortField === 'symbol' ? 'active' : ''}`}
            value={sortId}
            onChange={(e) => setSortId(e.target.value)}
            aria-label={t('trade.sortBy')}
            title={t('trade.sortBy')}
          >
            {SORT_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {t(m.labelKey)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`pch-sort ${sortField === 'price' ? 'active' : ''}`}
            onClick={() => toggleSort('price')}
          >
            {t('trade.price')}
            <SortArrow active={sortField === 'price'} dir={sortDir} />
          </button>
          <button
            type="button"
            className={`pch-sort ${sortField === 'change' ? 'active' : ''}`}
            onClick={() => toggleSort('change')}
          >
            {t('markets.change24h')}
            <SortArrow active={sortField === 'change'} dir={sortDir} />
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
                  ★
                </span>
                <span className="p-icon">
                  <CryptoIcon symbol={tk.pair.split('/')[0]} size={20} imageUrl={coinIcons.get(tk.pair.split('/')[0])} />
                </span>
                <span className="p-name">
                  <b className="p-base">{tk.pair.split('/')[0]}</b>
                  <span className="p-quote">/{tk.pair.split('/')[1]}</span>
                </span>
                <span className="p-price">{formatPrice(parseFloat(tk.lastPrice))}</span>
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
      </div>
    );
  }
);

// Faint on an inactive column (still hints it's clickable), solid and
// pointing the live direction on the active one — the same small-arrow
// language the reference's own column headers use.
function SortArrow({ active, dir }: { active: boolean; dir: 1 | -1 }) {
  if (!active) return <span className="pch-arrow idle">⇅</span>;
  return <span className="pch-arrow">{dir === -1 ? '▼' : '▲'}</span>;
}
