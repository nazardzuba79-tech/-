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
    // 'change' sorts by each pair's own live 24h% (gainers/losers), driven
    // by the same real Kraken-mirrored figure the visible column shows —
    // no CoinGecko dependency needed since every TickerRow already carries
    // changePercent24h. Defaults to 'volume' (most-traded first), the
    // existing behavior.
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
      let comparison: number;
      if (opts.sortField === 'symbol') {
        comparison = a.pair.localeCompare(b.pair);
      } else if (opts.sortField === 'price') {
        comparison = parseFloat(a.lastPrice || '0') - parseFloat(b.lastPrice || '0');
      } else if (opts.sortField === 'change') {
        comparison = parseChangePercent(a.changePercent24h, a.pair) - parseChangePercent(b.changePercent24h, b.pair);
      } else {
        // Most-traded pairs first by default — the API's raw alphabetical
        // order otherwise puts obscure, barely-liquid tickers first.
        comparison = parseFloat(a.quoteVolume24h || '0') - parseFloat(b.quoteVolume24h || '0');
      }
      return comparison * sortDir;
    });
}
