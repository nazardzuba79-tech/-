/**
 * Read-only mirror of CoinGecko's public top-200-by-market-cap data (no API
 * key needed — these are public endpoints): rank, category tags, and each
 * coin's own market-wide price/24h change/volume/market cap/7d sparkline.
 * This NEVER backs an actual trading pair by itself: Kraken
 * (KrakenMarketDataService) remains the only source of real tradable
 * price/candle/order-book data, since that's what our matching engine and
 * price watchers can actually act on. CoinGeckoService's price/volume
 * figures are used only where showing real market-wide data is the point
 * (e.g. the Wallet page's full coin browser, which lists every top-200
 * coin whether or not the account holds any and whether or not it's even
 * tradable here) — never to invent a pair Kraken can't back.
 *
 * NOT tested against the live API from this environment (this sandbox's
 * outbound proxy blocks it, confirmed via a direct curl returning a 403 on
 * the CONNECT tunnel — same class of restriction as Kraken elsewhere in
 * this codebase) — verify against the real API before depending on this
 * in production, same caveat the deposit verifiers carry.
 */

export class ExternalRankingError extends Error {}

export type CoinCategory = 'DEFI' | 'LAYER_1' | 'MEME' | 'STABLECOIN';

export interface CoinRanking {
  symbol: string; // e.g. "BTC" — matches our internal asset codes
  rank: number;
  name: string;
  image: string;
  categories: CoinCategory[];
  // Real market-wide figures from the same CoinGecko response as the rank
  // above (not our own Kraken-mirrored turnover, which only reflects
  // liquidity on Kraken specifically) — used by the Wallet page's asset
  // browser so every top-200 coin shows real data even with a $0 balance.
  price: number;
  changePercent24h: number | null;
  volume24h: number;
  marketCap: number | null;
  // Hourly closes over the last 7 days (CoinGecko's own sparkline_in_7d),
  // ~168 points — real history, not synthesized.
  sparkline: number[];
}

const RANKINGS_TTL_MS = 5 * 60_000; // short enough that price/volume/marketCap stay reasonably fresh, long enough to stay well under CoinGecko's free-tier rate limit
const TOP_N = 200;

// CoinGecko's own category slugs for the four groupings the UI filters by.
const CATEGORY_SLUGS: Record<CoinCategory, string> = {
  DEFI: 'decentralized-finance-defi',
  LAYER_1: 'layer-1',
  MEME: 'meme-token',
  STABLECOIN: 'stablecoins',
};

// Hand-maintained fallback for well-known coins, merged into whatever the
// per-category API calls above return. Not a replacement for the live
// data — it's a safety net: CoinGecko's free/anonymous API tier is prone
// to rate-limiting a burst of 4 back-to-back category requests (the first
// one, market-cap rankings, tends to go through since it fires first; the
// next 4 sharing the same rate-limit window often don't), which previously
// left EVERY coin's `categories` empty and made every category filter chip
// show "nothing found" even though rankings had loaded fine. Covers the
// major, unambiguous coins so the filters stay usable even when every
// category endpoint above fails outright — the API is still the primary
// source for anything beyond this list.
const LOCAL_CATEGORY_FALLBACK: Record<string, CoinCategory[]> = {
  // DeFi
  UNI: ['DEFI'], AAVE: ['DEFI'], MKR: ['DEFI'], CRV: ['DEFI'], LDO: ['DEFI'],
  SNX: ['DEFI'], COMP: ['DEFI'], SUSHI: ['DEFI'], CAKE: ['DEFI'], DYDX: ['DEFI'],
  GMX: ['DEFI'], RUNE: ['DEFI'], BAL: ['DEFI'], YFI: ['DEFI'], '1INCH': ['DEFI'],
  // Layer 1
  BTC: ['LAYER_1'], ETH: ['LAYER_1'], SOL: ['LAYER_1'], ADA: ['LAYER_1'], AVAX: ['LAYER_1'],
  DOT: ['LAYER_1'], NEAR: ['LAYER_1'], ATOM: ['LAYER_1'], BNB: ['LAYER_1'], TRX: ['LAYER_1'],
  TON: ['LAYER_1'], XLM: ['LAYER_1'], ALGO: ['LAYER_1'], FTM: ['LAYER_1'], ICP: ['LAYER_1'],
  APT: ['LAYER_1'], SUI: ['LAYER_1'], SEI: ['LAYER_1'], INJ: ['LAYER_1'], HBAR: ['LAYER_1'],
  EGLD: ['LAYER_1'], KAS: ['LAYER_1'], ETC: ['LAYER_1'], XRP: ['LAYER_1'], LTC: ['LAYER_1'],
  // Meme coins
  DOGE: ['MEME'], SHIB: ['MEME'], PEPE: ['MEME'], WIF: ['MEME'], BONK: ['MEME'],
  FLOKI: ['MEME'], TRUMP: ['MEME'], MELANIA: ['MEME'], BRETT: ['MEME'], POPCAT: ['MEME'],
  // Stablecoins
  USDT: ['STABLECOIN'], USDC: ['STABLECOIN'], DAI: ['STABLECOIN'], TUSD: ['STABLECOIN'],
  USDG: ['STABLECOIN'], FDUSD: ['STABLECOIN'], USDP: ['STABLECOIN'], PYUSD: ['STABLECOIN'],
  GUSD: ['STABLECOIN'],
};

interface CoinGeckoMarketRow {
  symbol: string;
  name: string;
  image: string;
  market_cap_rank: number | null;
  current_price: number | null;
  price_change_percentage_24h: number | null;
  total_volume: number | null;
  market_cap: number | null;
  sparkline_in_7d?: { price: number[] };
}

export class CoinGeckoService {
  private cache: { rankings: CoinRanking[]; expiresAt: number } | null = null;

  constructor(
    private readonly baseUrl = 'https://api.coingecko.com/api/v3',
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  /** Top ~200 coins by market cap, each tagged with whichever of the four
   * tracked categories it belongs to. Sorted ascending by rank.
   *
   * On a refresh failure (CoinGecko's free/anonymous tier rate-limits
   * fairly readily), this serves the last successful snapshot instead of
   * throwing, however stale — every caller (ticker turnover/market-cap
   * stats, the Wallet page's coin browser, category filters) would
   * otherwise intermittently go blank/"—" for everyone on the exact
   * request that happens to land during a rate-limited window, then
   * silently recover on the next one. A five-minutes-stale market cap is
   * far less confusing than a flickering dash. Only a genuinely first-ever
   * call (nothing cached yet) still throws. */
  async getRankings(): Promise<CoinRanking[]> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.rankings;

    let markets: CoinGeckoMarketRow[];
    try {
      markets = (await this.request(
        `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${TOP_N}&page=1&sparkline=true`
      )) as CoinGeckoMarketRow[];
    } catch (err) {
      if (this.cache) return this.cache.rankings;
      throw err;
    }

    const bySymbol = new Map<string, CoinRanking>();
    for (const m of markets) {
      const symbol = m.symbol.toUpperCase();
      // CoinGecko occasionally lists two different coins sharing a ticker
      // (e.g. wrapped variants) — keep whichever we see first, which is
      // the higher-ranked one since the response is already rank-sorted.
      if (bySymbol.has(symbol)) continue;
      bySymbol.set(symbol, {
        symbol,
        rank: m.market_cap_rank ?? TOP_N + 1,
        name: m.name,
        image: m.image,
        categories: [],
        price: m.current_price ?? 0,
        changePercent24h: m.price_change_percentage_24h ?? null,
        volume24h: m.total_volume ?? 0,
        marketCap: m.market_cap ?? null,
        sparkline: m.sparkline_in_7d?.price ?? [],
      });
    }

    // One call per category, matching returned coins against the top-N set
    // built above — real API-sourced category membership, not a hardcoded
    // per-coin list that would silently go stale as coins launch/delist.
    for (const [key, slug] of Object.entries(CATEGORY_SLUGS) as [CoinCategory, string][]) {
      try {
        const coins = (await this.request(
          `/coins/markets?vs_currency=usd&category=${slug}&order=market_cap_desc&per_page=250&page=1&sparkline=false`
        )) as CoinGeckoMarketRow[];
        for (const c of coins) {
          const entry = bySymbol.get(c.symbol.toUpperCase());
          if (entry) entry.categories.push(key);
        }
      } catch {
        // One category endpoint failing shouldn't blank out the whole
        // ranking list — that coin just won't get a category tag this cycle.
      }
    }

    // Merge in the local fallback (see LOCAL_CATEGORY_FALLBACK above) so
    // well-known coins still end up correctly categorized even when every
    // per-category call above failed — deduped via Set since a coin can
    // legitimately land in >1 category from the two sources combined.
    for (const entry of bySymbol.values()) {
      const fallback = LOCAL_CATEGORY_FALLBACK[entry.symbol];
      if (fallback) entry.categories = Array.from(new Set([...entry.categories, ...fallback]));
    }

    const rankings = Array.from(bySymbol.values()).sort((a, b) => a.rank - b.rank);
    this.cache = { rankings, expiresAt: Date.now() + RANKINGS_TTL_MS };
    return rankings;
  }

  private async request(path: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`);
    } catch (err: any) {
      throw new ExternalRankingError(`Failed to reach CoinGecko: ${err.message}`);
    }
    if (!res.ok) {
      throw new ExternalRankingError(`CoinGecko responded with HTTP ${res.status}`);
    }
    return res.json();
  }
}
