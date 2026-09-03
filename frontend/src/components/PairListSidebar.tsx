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
import { ChevronDown, ChevronUp, GripVertical, PanelLeftClose, Star } from 'lucide-react';

export interface PairListHandle {
  focusSearch: () => void;
}

type PairSortField = 'volume' | 'price' | 'change' | 'symbol';

const REFERENCE_QUOTE_FILTERS = ['USDT', 'USD', 'USDC', 'EUR'];

/**
 * The reference's `.pairs-section`: header/collapse, search, the quote tabs
 * actually present in the live USDT/USD/USDC/EUR ticker set, real sorting,
 * resizable width, and rows with favourite, asset, price and signed-change
 * data. CryptoIcon remains the application's shared real icon system.
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
  }
>(
  function PairListSidebar({ pair, onChange, onCollapse, onResizeStart }, ref) {
    const { t } = useLanguage();
    const [tickers, setTickers] = useState<TickerRow[]>([]);
    const [loadError, setLoadError] = useState(false);
    const [search, setSearch] = useState('');
    const [quoteFilter, setQuoteFilter] = useState<string | null>('USDT');
    const [favoritesOnly, setFavoritesOnly] = useState(false);
    const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);
    const [sortField, setSortField] = useState<PairSortField>('volume');
    const [sortDir, setSortDir] = useState<1 | -1>(-1);
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
      sortField,
      sortDir,
    });
    // filterAndSortPairs ignores quoteFilter once a search is typed (a real
    // coin quoted outside the active tab must still be findable); the tab
    // row mirrors that here so it never shows "USDT" highlighted while the
    // results on screen actually span every quote asset.
    const isSearching = search.trim().length > 0;
    const effectiveQuoteFilter = isSearching ? null : quoteFilter;

    function chooseSort(nextField: PairSortField) {
      if (sortField === nextField) {
        setSortDir((current) => (current === 1 ? -1 : 1));
        return;
      }
      setSortField(nextField);
      setSortDir(nextField === 'symbol' ? 1 : -1);
    }

    function sortIcon(field: PairSortField) {
      if (sortField !== field) return null;
      return sortDir === 1 ? <ChevronUp size={11} /> : <ChevronDown size={11} />;
    }

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
          <button type="button" onClick={() => chooseSort('volume')}>{t('trade.volume24h')} {sortIcon('volume')}</button>
          <button type="button" onClick={() => chooseSort('price')}>{t('trade.price')} {sortIcon('price')}</button>
          <button type="button" onClick={() => chooseSort('change')}>24ч % {sortIcon('change')}</button>
          <button type="button" onClick={() => chooseSort('symbol')} title="Символ A–Z">A–Z {sortIcon('symbol')}</button>
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
                <span
                  className={`pair-favorite ${favorites.has(tk.pair) ? 'starred' : ''}`}
                  onClick={(e) => toggleFavorite(tk.pair, e)}
                  title={t('trade.favorites')}
                >
                  <Star size={12} fill={favorites.has(tk.pair) ? 'currentColor' : 'none'} />
                </span>
                <span className="p-icon"><CryptoIcon symbol={tk.pair.split('/')[0]} size={18} /></span>
                <strong className="p-name">{tk.pair}</strong>
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

        {onResizeStart && (
          <div className="pairs-resize-handle" onPointerDown={onResizeStart} aria-hidden="true">
            <GripVertical size={14} />
          </div>
        )}
      </div>
    );
  }
);
