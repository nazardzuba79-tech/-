import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { useMarketTickers } from '../lib/useMarketData';
import { useLanguage, Key } from '../lib/i18n';
import { CryptoIcon } from './CryptoIcon';
import { parseChangePercent } from '../lib/priceChange';
import { formatPrice } from '../lib/formatNumber';
import { useFavorites } from '../lib/useFavorites';
import { useWindowedRows } from '../lib/useWindowedRows';

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

type SortField = 'volume' | 'price' | 'change' | 'symbol';

// Same seven modes and the same volume-descending default the spot pair
// list uses, so the two panels sort identically. Open interest is not among
// them: nothing in this exchange records it (see FuturesTickerBar's note),
// and a sort key with no data behind it would just be a dead control.
const SORT_MODES: { id: string; field: SortField; dir: 1 | -1; labelKey: Key }[] = [
  { id: 'volume_desc', field: 'volume', dir: -1, labelKey: 'trade.sortVolumeDesc' },
  { id: 'volume_asc', field: 'volume', dir: 1, labelKey: 'trade.sortVolumeAsc' },
  { id: 'change_desc', field: 'change', dir: -1, labelKey: 'trade.sortChangeDesc' },
  { id: 'change_asc', field: 'change', dir: 1, labelKey: 'trade.sortChangeAsc' },
  { id: 'price_desc', field: 'price', dir: -1, labelKey: 'trade.sortPriceDesc' },
  { id: 'price_asc', field: 'price', dir: 1, labelKey: 'trade.sortPriceAsc' },
  { id: 'symbol_asc', field: 'symbol', dir: 1, labelKey: 'trade.sortSymbolAsc' },
];

/**
 * The futures market list, on the spot terminal's own `.pair-row` grid so
 * both panels read as one system: star slot, logo, symbol, price, 24h %,
 * with the two numeric columns at fixed widths and tabular figures so live
 * updates cannot move them.
 *
 * Scoped to FUTURES_SYMBOLS — the only markets a position can actually be
 * opened on (config/futuresConfig.ts on the backend rejects anything else).
 * Prices and 24h figures come from the same live ticker feed the rest of
 * the app uses; nothing is ordered by a hardcoded list.
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
  const [tickers, setTickers] = useState<Record<string, { lastPrice: string; changePercent24h: string; quoteVolume24h: string }>>({});
  const [search, setSearch] = useState('');
  const [sortId, setSortId] = useState('volume_desc');
  // Shared store — see lib/useFavorites; the spot terminal, Markets and
  // the homepage table all read the same set, live.
  const { favorites, toggle: toggleFavoritePair } = useFavorites();
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({ focusSearch: () => searchRef.current?.focus() }), []);

  function toggleFavorite(pair: string, e: React.MouseEvent) {
    e.stopPropagation();
    toggleFavoritePair(pair);
  }

  const sortMode = SORT_MODES.find((m) => m.id === sortId) ?? SORT_MODES[0];
  const { field: sortField, dir: sortDir } = sortMode;

  function toggleSort(field: SortField) {
    const wantDir: 1 | -1 = sortField === field && sortDir === -1 ? 1 : -1;
    const next = SORT_MODES.find((m) => m.field === field && m.dir === wantDir);
    if (next) setSortId(next.id);
  }

  // 4s, this list's original cadence, now served from the shared snapshot
  // instead of its own poll. Note this is REFERENCE spot price data for
  // display only — every VOLTEX financial value on the futures side (mark
  // price, funding, open interest, position state) is unchanged and still
  // comes from the futures services.
  const { tickers: tickerMap } = useMarketTickers(4000);

  useEffect(() => {
    // Empty means the store has nothing yet; keep the previous rows rather
    // than resetting every price to a zero placeholder.
    if (tickerMap.size === 0) return;
    const bySymbol: Record<string, { lastPrice: string; changePercent24h: string; quoteVolume24h: string }> = {};
    for (const symbol of symbols) {
      const tk = tickerMap.get(symbol);
      if (tk) bySymbol[symbol] = tk;
    }
    setTickers(bySymbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerMap, symbols.join(',')]);

  // Asset artwork now resolves inside CryptoIcon from the gateway's asset
  // registry (one batched /market/assets/icons request for the symbols on
  // screen), replacing a full 500-coin rankings download — sparklines and
  // all — that existed only to build a symbol->image map.

  const rows: Row[] = useMemo(() => {
    const built = symbols
      .filter((s) => s.toLowerCase().replace('/', '').includes(search.trim().toLowerCase().replace('/', '')))
      .filter((s) => !favoritesOnly || favorites.has(s))
      .map((s) => {
        const tk = tickers[s];
        const price = tk ? parseFloat(tk.lastPrice) : NaN;
        const volume = tk ? parseFloat(tk.quoteVolume24h) : NaN;
        return {
          symbol: s,
          lastPrice: Number.isFinite(price) ? price : null,
          change: tk ? Number(parseChangePercent(tk.changePercent24h, s).toFixed(2)) : null,
          quoteVolume24h: Number.isFinite(volume) ? volume : null,
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
      if (sortField === 'symbol') return a.symbol.localeCompare(b.symbol) * sortDir;
      if (sortField === 'price') return by(a.lastPrice, b.lastPrice);
      if (sortField === 'change') return by(a.change, b.change);
      return by(a.quoteVolume24h, b.quoteVolume24h);
    });
  }, [symbols, tickers, search, sortField, sortDir, favoritesOnly, favorites]);

  const windowed = useWindowedRows(rows.length);

  return (
    <>
      <div className="pairs-search">
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('trade.searchPair')}
          aria-label={t('trade.searchPair')}
        />
      </div>

      <div className="pairs-tabs">
        <button
          type="button"
          className={`pairs-tab ${favoritesOnly ? 'active' : ''}`}
          onClick={() => setFavoritesOnly((v) => !v)}
        >
          <Star size={12} fill={favoritesOnly ? 'currentColor' : 'none'} /> {t('trade.favorites')}
        </button>
      </div>

      <div className="pairs-col-headers">
        <select
          className={`pch-mode ${sortField === 'volume' || sortField === 'symbol' ? 'active' : ''}`}
          value={sortId}
          onChange={(e) => setSortId(e.target.value)}
          aria-label={t('trade.sortBy')}
        >
          {SORT_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {t(m.labelKey)}
            </option>
          ))}
        </select>
        <button className={`pch-sort ${sortField === 'price' ? 'active' : ''}`} onClick={() => toggleSort('price')}>
          {t('trade.price')}
          <SortArrow active={sortField === 'price'} dir={sortDir} />
        </button>
        <button className={`pch-sort ${sortField === 'change' ? 'active' : ''}`} onClick={() => toggleSort('change')}>
          {t('markets.change24h')}
          <SortArrow active={sortField === 'change'} dir={sortDir} />
        </button>
      </div>

      {/* Windowed: the market universe is data-driven now and routinely
          runs to hundreds of contracts, so only the rows the panel can
          actually show are in the DOM. Spacers preserve the real scroll
          height, so the scrollbar and keyboard scrolling behave exactly as
          they would with every row mounted. */}
      <div className="pairs-list" ref={windowed.ref}>
        {rows.length === 0 && <div className="empty-state">{t('trade.nothingFound')}</div>}
        {windowed.padTop > 0 && <div style={{ height: windowed.padTop }} aria-hidden />}
        {rows.slice(windowed.start, windowed.end).map((r) => {
          const up = (r.change ?? 0) >= 0;
          const base = r.symbol.split('/')[0];
          return (
            <button
              key={r.symbol}
              data-row
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
                  <span className="p-quote">/{r.symbol.split('/')[1]}</span>
                </span>
              <span className="p-price">{r.lastPrice !== null ? formatPrice(r.lastPrice) : '—'}</span>
              <span className={`p-change ${up ? 'up' : 'down'}`}>
                {r.change !== null ? `${up ? '▲' : '▼'} ${up ? '+' : ''}${r.change.toFixed(2)}%` : '—'}
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
