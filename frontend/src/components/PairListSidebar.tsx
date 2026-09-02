import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import {
  QUOTE_PRIORITY,
  loadFavorites,
  saveFavorites,
  filterAndSortPairs,
  TickerRow,
  SevenDayRange,
} from '../lib/pairList';
import { parseChangePercent } from '../lib/priceChange';
import { CryptoIcon } from './CryptoIcon';

// One CoinGecko rankings fetch feeds two otherwise-unrelated needs, so it's
// done once here rather than twice:
//  - per-coin logos (icons), covering this app's newer/smaller listings
//    (SUI, TAO, ENA, …) that the static jsDelivr icon set CryptoIcon falls
//    back to has never had;
//  - 7-day high/low (sevenDay), derived from CoinGecko's own 7-day
//    sparkline rather than a separate endpoint — nothing here is invented,
//    just min/max over a series CoinGecko already reports.
// Not polled: unlike price data, a coin's logo and week-old price history
// don't change minute to minute, and the backend's own rankings cache only
// refreshes hourly anyway (see CoinGeckoService).
function useCoinGeckoIndex(): { icons: Map<string, string>; sevenDay: Map<string, SevenDayRange> } {
  const [icons, setIcons] = useState<Map<string, string>>(new Map());
  const [sevenDay, setSevenDay] = useState<Map<string, SevenDayRange>>(new Map());
  useEffect(() => {
    let cancelled = false;
    api
      .getExternalRankings()
      .then((res) => {
        if (cancelled) return;
        const iconMap = new Map<string, string>();
        const rangeMap = new Map<string, SevenDayRange>();
        for (const r of res.rankings) {
          if (r.image) iconMap.set(r.symbol, r.image);
          if (r.sparkline.length > 0) {
            rangeMap.set(r.symbol, { high7d: Math.max(...r.sparkline), low7d: Math.min(...r.sparkline) });
          }
        }
        setIcons(iconMap);
        setSevenDay(rangeMap);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return { icons, sevenDay };
}

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
    const { icons: coinIcons, sevenDay } = useCoinGeckoIndex();
    const [tickers, setTickers] = useState<TickerRow[]>([]);
    const [loadError, setLoadError] = useState(false);
    const [search, setSearch] = useState('');
    const [sortMode, setSortMode] = useState<'volume' | 'high24h' | 'low24h' | 'high7d' | 'low7d'>('volume');
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

    useImperativeHandle(ref, () => ({ focusSearch: () => searchRef.current?.focus() }), []);

    function loadTickers() {
      setLoadError(false);
      api
        .getExternalTickers()
        .then((res) => {
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
      sortField: sortMode,
      sortDir: -1,
      sevenDayBySymbol: sevenDay,
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

        <div className="pairs-sort-row">
          <span className="pairs-sort-label">{t('trade.sortBy')}</span>
          <select
            className="pairs-sort-select"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as typeof sortMode)}
            aria-label={t('trade.sortBy')}
          >
            <option value="volume">{t('trade.sortVolume')}</option>
            <option value="high24h">{t('trade.sortHigh24h')}</option>
            <option value="low24h">{t('trade.sortLow24h')}</option>
            <option value="high7d">{t('trade.sortHigh7d')}</option>
            <option value="low7d">{t('trade.sortLow7d')}</option>
          </select>
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

        <div className="pairs-list">
          {filtered.map((tk) => {
            const change = parseChangePercent(tk.changePercent24h, tk.pair);
            const up = change >= 0;
            return (
              <button
                key={tk.pair}
                className={`pair-row ${tk.pair === pair ? 'active' : ''}`}
                onClick={() => onChange(tk.pair)}
              >
                <span className="p-name">
                  <span
                    onClick={(e) => toggleFavorite(tk.pair, e)}
                    style={{ color: favorites.has(tk.pair) ? 'var(--accent-yellow)' : 'var(--text-secondary)', marginRight: 4, flexShrink: 0 }}
                  >
                    ★
                  </span>
                  <span className="p-icon">
                    <CryptoIcon symbol={tk.pair.split('/')[0]} size={18} imageUrl={coinIcons.get(tk.pair.split('/')[0])} />
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tk.pair}</span>
                </span>
                <span className="p-price">{parseFloat(tk.lastPrice).toLocaleString('en-US', { maximumFractionDigits: 4 })}</span>
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
