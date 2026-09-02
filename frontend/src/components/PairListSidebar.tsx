import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useLanguage } from '../lib/i18n';
import {
  QUOTE_PRIORITY,
  loadFavorites,
  saveFavorites,
  filterAndSortPairs,
  TickerRow,
} from '../lib/pairList';
import { parseChangePercent } from '../lib/priceChange';
import { CryptoIcon } from './CryptoIcon';

// CoinGecko's own per-coin logo — covers this app's newer/smaller listings
// (SUI, TAO, ENA, …) that the static jsDelivr icon set CryptoIcon falls
// back to has never had. One fetch, not polled: unlike price data, a
// coin's logo doesn't change minute to minute, and the backend's own
// rankings cache only refreshes hourly anyway (see CoinGeckoService).
function useCoinIconMap(): Map<string, string> {
  const [icons, setIcons] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    api
      .getExternalRankings()
      .then((res) => {
        if (cancelled) return;
        const map = new Map<string, string>();
        for (const r of res.rankings) if (r.image) map.set(r.symbol, r.image);
        setIcons(map);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return icons;
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
    const coinIcons = useCoinIconMap();
    const [tickers, setTickers] = useState<TickerRow[]>([]);
    const [loadError, setLoadError] = useState(false);
    const [search, setSearch] = useState('');
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
      sortField: 'volume',
      sortDir: -1,
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
