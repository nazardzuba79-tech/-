// Pair-browsing helpers (favorites/quote-filter/liquidity-sort) shared by
// whatever component browses the Kraken ticker mirror — currently just
// PairListSidebar, the persistent panel on the trade page.

import { parseChangePercent } from './priceChange';

export interface TickerRow {
  pair: string;
  lastPrice: string;
  changePercent24h: string;
  quoteVolume24h: string;
  // Optional: present on the live ticker feed (api.getExternalTickers)
  // but not every caller populates them, so sorting by these falls back
  // gracefully rather than throwing when they're absent.
  high24h?: string;
  low24h?: string;
}

/** A coin's high/low over the last 7 days, derived from CoinGecko's own
 * 7-day sparkline (already fetched for other reasons — see
 * PairListSidebar's useCoinIconMap) rather than a separate API call. */
export interface SevenDayRange {
  high7d: number;
  low7d: number;
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
    // Only needed for the 'high7d'/'low7d' sort fields — 24h high/low
    // comes straight off each TickerRow, but a 7-day range has to be
    // derived from CoinGecko's sparkline, which lives in this side map
    // rather than on the ticker itself.
    sevenDayBySymbol?: Map<string, SevenDayRange>;
    // 'change' sorts by each pair's own live 24h% (gainers/losers), driven
    // by the same real Kraken-mirrored figure the visible column shows —
    // no CoinGecko dependency needed since every TickerRow already carries
    // changePercent24h. 'high24h'/'low24h' sort by the ticker's own 24h
    // range (biggest high first, smallest low first — the natural reading
    // of each, not configurable via sortDir). 'high7d'/'low7d' do the same
    // over 7 days via sevenDayBySymbol; a pair missing from that map sorts
    // to the end rather than looking broken. Defaults to 'volume'
    // (most-traded first), the existing behavior.
    sortField?: 'volume' | 'change' | 'high24h' | 'low24h' | 'high7d' | 'low7d';
    sortDir?: 1 | -1;
  }
): TickerRow[] {
  const rankByBase = opts.rankByBase;
  const sevenDayBySymbol = opts.sevenDayBySymbol;
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
      if (opts.sortField === 'high24h' || opts.sortField === 'low24h') {
        const isHigh = opts.sortField === 'high24h';
        const rawA = isHigh ? a.high24h : a.low24h;
        const rawB = isHigh ? b.high24h : b.low24h;
        // Missing data sinks to the end regardless of direction, rather
        // than a blank field sorting to the very top of "biggest highs".
        const valA = rawA ? parseFloat(rawA) : isHigh ? -Infinity : Infinity;
        const valB = rawB ? parseFloat(rawB) : isHigh ? -Infinity : Infinity;
        return isHigh ? valB - valA : valA - valB;
      }
      if (opts.sortField === 'high7d' || opts.sortField === 'low7d') {
        const isHigh = opts.sortField === 'high7d';
        const base = (pair: string) => sevenDayBySymbol?.get(pair.split('/')[0]);
        const valA = isHigh ? base(a.pair)?.high7d ?? -Infinity : base(a.pair)?.low7d ?? Infinity;
        const valB = isHigh ? base(b.pair)?.high7d ?? -Infinity : base(b.pair)?.low7d ?? Infinity;
        return isHigh ? valB - valA : valA - valB;
      }
      // Most-traded pairs first — sorting alphabetically (the API's raw
      // order) put obscure, barely-liquid tickers at the top just because
      // their symbol starts early in the alphabet.
      return (parseFloat(b.quoteVolume24h || '0') - parseFloat(a.quoteVolume24h || '0')) * (sortDir === -1 ? 1 : -1);
    });
}
