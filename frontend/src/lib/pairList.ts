// Pair-browsing helpers (favorites/quote-filter/liquidity-sort) shared by
// whatever component browses the Kraken ticker mirror — currently just
// PairListSidebar, the persistent panel on the trade page.

import { parseChangePercent } from './priceChange';

export interface TickerRow {
  pair: string;
  lastPrice: string;
  changePercent24h: string;
  quoteVolume24h: string;
}

export type CoinCategory = 'DEFI' | 'LAYER_1' | 'MEME' | 'STABLECOIN' | 'AI' | 'GAMING' | 'RWA';

export interface CoinRanking {
  symbol: string;
  rank: number;
  name: string;
  image: string;
  categories: CoinCategory[];
  // Real market-wide figures (not our own exchange's turnover) — see
  // CoinGeckoService's doc comment on the backend for why.
  price: number;
  changePercent24h: number | null;
  changePercent7d: number | null;
  changePercent30d: number | null;
  volume24h: number;
  marketCap: number | null;
  sparkline: number[];
}

export const CATEGORIES: CoinCategory[] = ['DEFI', 'LAYER_1', 'MEME', 'STABLECOIN', 'AI', 'GAMING', 'RWA'];

const FAVORITES_KEY = 'exchange_favorite_pairs';
// Preferred order for the quote-asset filter chips — whichever of these
// actually appear in the live ticker list are shown, most-traded first.
export const QUOTE_PRIORITY = ['USDT', 'USD', 'USDC', 'EUR', 'BTC', 'ETH'];

export function loadFavorites(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

export function saveFavorites(favs: Set<string>) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favs)));
  } catch {
    // best-effort — favorites just won't persist across reloads
  }
  // localStorage is the store, but writing to it fires no event in the tab
  // that did the writing, so every other component holding a copy of the
  // set used to keep showing the old one until a full reload. Notifying
  // here is what makes the terminal, Markets, Futures and the homepage
  // agree about a starred pair the moment it is starred.
  notifyFavorites(favs);
}

type FavoritesListener = (favs: Set<string>) => void;
const favoritesListeners = new Set<FavoritesListener>();

function notifyFavorites(favs: Set<string>) {
  for (const listener of favoritesListeners) listener(new Set(favs));
}

/**
 * Subscribe to favourite-pair changes. Fires on a local saveFavorites and
 * on another tab's write to the same key (the browser's own `storage`
 * event, which only ever reaches *other* tabs — hence the explicit
 * notification above for this one). Returns an unsubscribe function.
 */
export function subscribeFavorites(listener: FavoritesListener): () => void {
  favoritesListeners.add(listener);
  if (favoritesListeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  return () => {
    favoritesListeners.delete(listener);
    if (favoritesListeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

function onStorage(e: StorageEvent) {
  if (e.key !== null && e.key !== FAVORITES_KEY) return;
  notifyFavorites(loadFavorites());
}

export function filterAndSortPairs(
  tickers: TickerRow[],
  opts: {
    search: string;
    quoteFilter: string | null;
    favoritesOnly: boolean;
    favorites: Set<string>;
    categoryFilter?: CoinCategory | null;
    rankByBase?: Map<string, CoinRanking>;
    sortByRank?: boolean;
    // 'price' and 'change' sort by each pair's own live figures (the exact
    // values the Цена/24Ч% columns show) and 'symbol' alphabetically by
    // pair name, direction set by sortDir.
    //
    // 'volume' (the default) sorts on quoteVolume24h — the ticker feed's
    // own 24h turnover in the quote asset, which the backend derives from
    // Kraken's real base volume times its real 24h VWAP (see
    // KrakenMarketDataService.getTickersMap). It is the field to sort on
    // for "most actively traded": base volume alone is not comparable
    // across pairs, since 1 BTC and 1 DOGE are not the same amount of
    // trading. Nothing is fabricated and no pair is pinned — BTC and ETH
    // appear at the top only when their real turnover puts them there.
    sortField?: 'volume' | 'change' | 'price' | 'symbol';
    sortDir?: 1 | -1;
  }
): TickerRow[] {
  const rankByBase = opts.rankByBase;
  const sortDir = opts.sortDir ?? -1;
  const search = opts.search.trim().toLowerCase();
  // A non-empty search overrides the quote-asset tab (USDT/BTC/ETH/…)
  // rather than being ANDed with it. Without this, typing a real, listed
  // symbol quietly returned zero rows whenever that coin's pair happened
  // to be quoted in something other than the currently selected tab (e.g.
  // searching "pepe" while the USDT tab is active, when PEPE only trades
  // against USD) — indistinguishable from search being broken. Favorites
  // stays a real AND: unlike the quote tab, checking it is a deliberate
  // "only my favorites" choice a search should still respect.
  const quoteFilter = search ? null : opts.quoteFilter;
  return tickers
    .filter((tk) => !search || tk.pair.toLowerCase().replace('/', '').includes(search.replace('/', '')))
    .filter((tk) => !quoteFilter || tk.pair.split('/')[1] === quoteFilter)
    .filter((tk) => !opts.favoritesOnly || opts.favorites.has(tk.pair))
    .filter((tk) => {
      if (!opts.categoryFilter) return true;
      const ranking = rankByBase?.get(tk.pair.split('/')[0]);
      return ranking?.categories.includes(opts.categoryFilter) ?? false;
    })
    .sort((a, b) => {
      // Market-cap-rank sort only ever applies when the caller has real
      // CoinGecko data loaded (opts.sortByRank + rankByBase) — otherwise
      // this silently falls back to the existing volume sort rather than
      // ranking everything without data last, which would look broken.
      if (opts.sortByRank && rankByBase) {
        const rankA = rankByBase.get(a.pair.split('/')[0])?.rank ?? Infinity;
        const rankB = rankByBase.get(b.pair.split('/')[0])?.rank ?? Infinity;
        if (rankA !== rankB) return rankA - rankB;
      }
      if (opts.sortField === 'change') {
        const changeA = parseChangePercent(a.changePercent24h, a.pair);
        const changeB = parseChangePercent(b.changePercent24h, b.pair);
        return (changeA - changeB) * sortDir;
      }
      if (opts.sortField === 'price') {
        return (parseFloat(a.lastPrice || '0') - parseFloat(b.lastPrice || '0')) * sortDir;
      }
      if (opts.sortField === 'symbol') {
        return a.pair.localeCompare(b.pair) * sortDir;
      }
      // Most-traded pairs first — sorting alphabetically (the API's raw
      // order) put obscure, barely-liquid tickers at the top just because
      // their symbol starts early in the alphabet.
      return (parseFloat(b.quoteVolume24h || '0') - parseFloat(a.quoteVolume24h || '0')) * (sortDir === -1 ? 1 : -1);
    });
}
