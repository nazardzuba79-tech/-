// Pair-browsing helpers (favorites/quote-filter/liquidity-sort) shared by
// whatever component browses the Kraken ticker mirror — currently just
// PairListSidebar, the persistent panel on the trade page.

export interface TickerRow {
  pair: string;
  lastPrice: string;
  changePercent24h: string;
  quoteVolume24h: string;
}

export type CoinCategory = 'DEFI' | 'LAYER_1' | 'MEME' | 'STABLECOIN';

export interface CoinRanking {
  symbol: string;
  rank: number;
  name: string;
  image: string;
  categories: CoinCategory[];
}

export const CATEGORIES: CoinCategory[] = ['DEFI', 'LAYER_1', 'MEME', 'STABLECOIN'];

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
  }
): TickerRow[] {
  const rankByBase = opts.rankByBase;
  return tickers
    .filter((tk) => tk.pair.toLowerCase().includes(opts.search.toLowerCase()))
    .filter((tk) => !opts.quoteFilter || tk.pair.split('/')[1] === opts.quoteFilter)
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
      // Most-traded pairs first — sorting alphabetically (the API's raw
      // order) put obscure, barely-liquid tickers at the top just because
      // their symbol starts early in the alphabet.
      return parseFloat(b.quoteVolume24h || '0') - parseFloat(a.quoteVolume24h || '0');
    });
}
