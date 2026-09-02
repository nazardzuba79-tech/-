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

export interface PairListHandle {
  focusSearch: () => void;
}

/**
 * The reference's `.pairs-section`: a search field, a row of quote tabs
 * (the reference's ⭐ Fav / USDT / BTC / ETH / NEW), and the pair list
 * itself — each row a name, a price and a signed change, with the active
 * pair tinted in the accent.
 *
 * All the existing behaviour is kept: the 4s ticker poll, favourites in
 * localStorage, and the shared filter/sort helper in lib/pairList.
 */
export const PairListSidebar = forwardRef<PairListHandle, { pair: string; onChange: (pair: string) => void }>(
  function PairListSidebar({ pair, onChange }, ref) {
    const { t } = useLanguage();
    const [tickers, setTickers] = useState<TickerRow[]>([]);
    const [loadError, setLoadError] = useState(false);
    const [search, setSearch] = useState('');
    const [quoteFilter, setQuoteFilter] = useState<string | null>('USDT');
    const [favoritesOnly, setFavoritesOnly] = useState(false);
    const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
    const searchRef = useRef<HTMLInputElement>(null);

    useImperativeHandle(ref, () => ({ focusSearch: () => searchRef.current?.focus() }), []);

    function loadTickers() {
      setLoadError(false);
      api
        .getExternalTickers()
        .then((res) => setTickers(res.tickers))
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

    const filtered = filterAndSortPairs(tickers, {
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
                    style={{ color: favorites.has(tk.pair) ? 'var(--accent-yellow)' : 'var(--text-secondary)', marginRight: 6 }}
                  >
                    ★
                  </span>
                  {tk.pair}
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
