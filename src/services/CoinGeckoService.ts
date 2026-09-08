/**
 * Read-only mirror of CoinGecko's public top-500-by-market-cap data (no API
 * key needed — these are public endpoints): rank, category tags, and each
 * coin's own market-wide price/24h change/volume/market cap/7d sparkline.
 * This NEVER backs an actual trading pair by itself: Kraken
 * (KrakenMarketDataService) remains the only source of real tradable
 * price/candle/order-book data, since that's what our matching engine and
 * price watchers can actually act on. CoinGeckoService's price/volume
 * figures are used only where showing real market-wide data is the point
 * (e.g. the Wallet page's full coin browser, which lists every top-500
 * coin whether or not the account holds any and whether or not it's even
 * tradable here) — never to invent a pair Kraken can't back.
 *
 * NOT tested against the live API from this environment (this sandbox's
 * outbound proxy blocks it, confirmed via a direct curl returning a 403 on
 * the CONNECT tunnel — same class of restriction as Kraken elsewhere in
 * this codebase) — verify against the real API before depending on this
 * in production, same caveat the deposit verifiers carry.
 */

import { ProviderCache, type CachedValue } from './marketData/ProviderCache';
import {
  HttpProviderClient,
  ProviderHealth,
  ProviderRequestPolicy,
  ProviderUnavailableError,
  logCircuitTransition,
  providerHealthRegistry,
} from './marketData/ProviderHealth';

export class ExternalRankingError extends Error {}

export type CoinCategory = 'DEFI' | 'LAYER_1' | 'MEME' | 'STABLECOIN' | 'AI' | 'GAMING' | 'RWA';

export interface CoinRanking {
  /** CoinGecko's stable coin id ("bitcoin"). Additive: every existing
   *  consumer keys on `symbol` and is unaffected. The asset registry uses
   *  this as canonical identity because two different coins can and do
   *  share a ticker. */
  id: string;
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
  // Real 7d/30d change straight from CoinGecko's own price_change_percentage
  // fields (not derived from the 7d sparkline below, which is hourly closes
  // and would need extra math to reproduce the same number) — powers the
  // Markets page's 7d/30d gainers/losers sort.
  changePercent7d: number | null;
  changePercent30d: number | null;
  volume24h: number;
  marketCap: number | null;
  // Hourly closes over the last 7 days (CoinGecko's own sparkline_in_7d),
  // ~168 points — real history, not synthesized.
  sparkline: number[];
  /** Circulating supply, when CoinGecko reports one. Free: it rides along
   *  in the same `/coins/markets` rows already being fetched, so it costs
   *  no extra call. `null` when absent — never 0. */
  circulatingSupply: number | null;
  /**
   * The same market figures WITHOUT the legacy zero-coercion above.
   *
   * `price` and `volume24h` default a missing value to `0`, which several
   * shipped consumers rely on and which is why they are left alone. But a
   * catalogue must not present "CoinGecko did not report a price" as a
   * price of zero dollars, so the asset registry reads these instead:
   * every field is `null` when the provider omitted it, and a genuine
   * zero still arrives as `0`.
   */
  market: {
    priceUsd: number | null;
    changePercent24h: number | null;
    marketCapUsd: number | null;
    volume24hUsd: number | null;
    circulatingSupply: number | null;
  };
  /** Other CoinGecko ids that reported this same ticker and lost the
   *  higher-rank tie-break below. Previously these were dropped silently,
   *  which made a ticker collision invisible; the registry needs to be
   *  able to say "XYZ is ambiguous" rather than quietly pick one. Empty
   *  for the overwhelming majority of coins. */
  collidingIds: string[];
}

// Refreshed at most once an hour — this data doesn't need to be
// second-fresh, and each refresh costs 6 CoinGecko calls (2 markets pages
// to cover TOP_N=500 + 4 category), so hourly keeps monthly usage
// comfortably inside the free Demo plan's 10,000-call cap even under
// sustained traffic (worst case ~6 * 24 * 31 ≈ 4,464/month, versus 10,000
// available).
// The catalogue is two different kinds of data arriving from two different
// endpoint families, and giving them one TTL meant the slower half dictated
// the faster one.
//
//   MARKET SNAPSHOT — price, 24h change, market cap, 24h volume, sparkline.
//     Moves constantly. Cached 20 minutes: fresh enough for a catalogue
//     (a market cap or a rank does not move meaningfully faster) and cheap
//     enough to fit the budget below. Tradable rows are not priced off
//     this — the terminals use the live Kraken path, see §14 of
//     docs/MARKET_DATA_ARCHITECTURE.md.
//
//   CATEGORY TAGS — which coins are DeFi, L1, meme, …
//     Effectively static, and by far the more expensive half: SEVEN calls
//     per refresh against the market walk's two. Cached 6 hours.
//
// Budget, under CONTINUOUS traffic (ProviderCache is lazy, so an idle
// exchange spends nothing): 3 calls / 20 min = 6,480/month, plus 7 calls /
// 6 h = 840/month. ~7,300 against the free Demo plan's 10,000 — real
// headroom, 50% more assets than before, and 3x fresher prices than the
// single hourly cache this replaces.
//
// This is the honest limit of the free tier: a materially shorter TTL, or a
// materially larger catalogue, needs a paid plan. Nothing here works around
// that — see docs/MARKET_DATA_ARCHITECTURE.md §12.
const CATALOGUE_MARKET_TTL_MS = 20 * 60_000;
const CATALOGUE_CATEGORY_TTL_MS = 6 * 60 * 60_000;
// Market-wide totals (see getGlobalMarket) are a single, cheap call and are
// the headline figure on the Markets page, so they refresh far more often
// than the hourly rankings above — 5 minutes still costs at most ~9,000
// calls/month, comfortably inside the free Demo plan's 10,000 cap even
// before the shared cache below dedupes concurrent visitors.
const GLOBAL_TTL_MS = 5 * 60_000;
// CoinGecko caps per_page at 250 for this endpoint, so reaching TOP_N above
// that means paging — see the loop in getRankings() below. Pulling more
// than the bare top-200/250 matters because that's where most of the
// longer-tail DeFi/meme coins actually rank (the very top skews L1/majors),
// so the category filter chips — and any Kraken pair whose base sits
// outside the top ~250 — have real rank/category data instead of nothing.
const CG_MAX_PER_PAGE = 250;
// 750, not 500.
//
// The product target is "500+ assets in the catalogue", and 500 was exactly
// the wrong number to fetch for it: ticker collisions and the occasional
// malformed row mean a 500-coin walk yields slightly UNDER 500 canonical
// assets. 750 clears the target with real headroom, exercises a third page
// so the pagination path is not a two-page special case, and leaves room to
// grow without another architectural change.
//
// CoinGecko caps per_page at 250, so this is ceil(750/250) = 3 requests.
// Three. Not 750 — the call count is a function of page size, never of
// asset count, which is the whole reason the catalogue can scale.
const TOP_N = 750;

// CoinGecko's own category slugs for the four groupings the UI filters by.
const CATEGORY_SLUGS: Record<CoinCategory, string> = {
  DEFI: 'decentralized-finance-defi',
  LAYER_1: 'layer-1',
  MEME: 'meme-token',
  STABLECOIN: 'stablecoins',
  AI: 'artificial-intelligence',
  GAMING: 'gaming',
  RWA: 'real-world-assets-rwa',
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
  ENA: ['DEFI'], JUP: ['DEFI'], ONDO: ['DEFI', 'RWA'], RAY: ['DEFI'], PENDLE: ['DEFI'],
  FXS: ['DEFI'], KAVA: ['DEFI'], MORPHO: ['DEFI'], JTO: ['DEFI'], PYTH: ['DEFI'],
  ZRO: ['DEFI'], EIGEN: ['DEFI'], OSMO: ['DEFI'], SPELL: ['DEFI'], ENS: ['DEFI'],
  // Layer 1
  BTC: ['LAYER_1'], ETH: ['LAYER_1'], SOL: ['LAYER_1'], ADA: ['LAYER_1'], AVAX: ['LAYER_1'],
  DOT: ['LAYER_1'], NEAR: ['LAYER_1'], ATOM: ['LAYER_1'], BNB: ['LAYER_1'], TRX: ['LAYER_1'],
  TON: ['LAYER_1'], XLM: ['LAYER_1'], ALGO: ['LAYER_1'], FTM: ['LAYER_1'], ICP: ['LAYER_1'],
  APT: ['LAYER_1'], SUI: ['LAYER_1'], SEI: ['LAYER_1'], INJ: ['LAYER_1'], HBAR: ['LAYER_1'],
  EGLD: ['LAYER_1'], KAS: ['LAYER_1'], ETC: ['LAYER_1'], XRP: ['LAYER_1'], LTC: ['LAYER_1'],
  // Meme coins
  DOGE: ['MEME'], SHIB: ['MEME'], PEPE: ['MEME'], WIF: ['MEME'], BONK: ['MEME'],
  FLOKI: ['MEME'], TRUMP: ['MEME'], MELANIA: ['MEME'], BRETT: ['MEME'], POPCAT: ['MEME'],
  PNUT: ['MEME'], GOAT: ['MEME'], MOODENG: ['MEME'], FARTCOIN: ['MEME'], PENGU: ['MEME'],
  MEW: ['MEME'], NEIRO: ['MEME'], ACT: ['MEME'], TURBO: ['MEME'], MOG: ['MEME'],
  BOME: ['MEME'], WEN: ['MEME'],
  // Stablecoins
  USDT: ['STABLECOIN'], USDC: ['STABLECOIN'], DAI: ['STABLECOIN'], TUSD: ['STABLECOIN'],
  USDG: ['STABLECOIN'], FDUSD: ['STABLECOIN'], USDP: ['STABLECOIN'], PYUSD: ['STABLECOIN'],
  GUSD: ['STABLECOIN'],
  // AI
  FET: ['AI'], RENDER: ['AI'], TAO: ['AI'], AGIX: ['AI'], OCEAN: ['AI'],
  AKT: ['AI'], WLD: ['AI'], GRT: ['AI'], NMR: ['AI'], RLC: ['AI'],
  // Gaming
  AXS: ['GAMING'], SAND: ['GAMING'], GALA: ['GAMING'], ENJ: ['GAMING'], ILV: ['GAMING'],
  IMX: ['GAMING'], BEAM: ['GAMING'], YGG: ['GAMING'], GODS: ['GAMING'], MAGIC: ['GAMING'],
  // RWA (real-world assets — tokenized gold, treasuries, on-chain funds)
  XAUT: ['RWA'], PAXG: ['RWA'], POLYX: ['RWA'], CFG: ['RWA'],
  TRU: ['RWA'], RIO: ['RWA'], OM: ['RWA'],
};

interface CoinGeckoMarketRow {
  /** CoinGecko's own stable slug ("bitcoin", "ethereum"). The only
   *  identifier in this response that is guaranteed unique — `symbol` is
   *  not, which is exactly why the asset registry keys on this. */
  id: string;
  symbol: string;
  name: string;
  image: string;
  market_cap_rank: number | null;
  current_price: number | null;
  price_change_percentage_24h: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  price_change_percentage_30d_in_currency?: number | null;
  total_volume: number | null;
  market_cap: number | null;
  circulating_supply?: number | null;
  sparkline_in_7d?: { price: number[] };
}

/**
 * Market-WIDE totals across every exchange and every coin CoinGecko
 * tracks — deliberately not this exchange's own turnover, and not a sum of
 * our Kraken-mirrored pairs either. This is the "$76B 24h volume" figure
 * every major exchange shows on its markets page; summing our own tracked
 * pairs instead produced a number one to two orders of magnitude smaller,
 * because it only ever covered the handful of pairs listed here.
 */
export interface GlobalMarketData {
  totalVolume24hUsd: number;
  totalMarketCapUsd: number;
  /** BTC's share of total market cap, in percent. */
  btcDominancePercent: number | null;
  /** Same CoinGecko /global response, same market_cap_percentage object —
   * no extra request. */
  ethDominancePercent: number | null;
  marketCapChangePercent24h: number | null;
}

interface CoinGeckoGlobalResponse {
  data?: {
    total_volume?: Record<string, number>;
    total_market_cap?: Record<string, number>;
    market_cap_percentage?: Record<string, number>;
    market_cap_change_percentage_24h_usd?: number;
  };
}

export class CoinGeckoService {
  // Both caches are ProviderCache now: same TTLs as before, same
  // serve-stale-on-failure policy the doc comments below already promised,
  // plus the in-flight deduplication they lacked — three visitors landing
  // on a cold rankings cache in the same second previously triggered three
  // full paged walks (6 CoinGecko calls each) against a 10k/month budget.
  //
  // maxStaleMs is deliberately huge for both: this data is descriptive
  // (ranks, categories, market-wide totals), never something a trade is
  // priced off, and the alternative to an hour-old market cap is a dash
  // where a number should be.
  /** The paged /coins/markets walk: identity AND the market snapshot. */
  private readonly marketsCache = new ProviderCache<CoinGeckoMarketRow[]>({
    ttlMs: CATALOGUE_MARKET_TTL_MS,
    maxStaleMs: 24 * 60 * 60_000,
    maxEntries: 2,
    onStaleServe: (key, ageMs) => console.warn(`[marketData] coingecko serving stale ${key} (${Math.round(ageMs / 60_000)}m old)`),
  });
  /** Category membership, per slug. Separately cached because it is the
   *  expensive half and the one that never changes. */
  private readonly categoriesCache = new ProviderCache<Map<string, CoinCategory[]>>({
    ttlMs: CATALOGUE_CATEGORY_TTL_MS,
    maxStaleMs: 24 * 60 * 60_000,
    maxEntries: 2,
    onStaleServe: (key, ageMs) => console.warn(`[marketData] coingecko serving stale ${key} (${Math.round(ageMs / 60_000)}m old)`),
  });
  /** The merged result. TTL matches the faster input so a refreshed market
   *  snapshot is actually served; the merge itself is cheap and does no
   *  I/O of its own. */
  private readonly rankingsCache = new ProviderCache<CoinRanking[]>({
    ttlMs: CATALOGUE_MARKET_TTL_MS,
    maxStaleMs: 24 * 60 * 60_000,
    maxEntries: 2,
    onStaleServe: (key, ageMs) => console.warn(`[marketData] coingecko serving stale ${key} (${Math.round(ageMs / 60_000)}m old)`),
  });
  private readonly globalMarketCache = new ProviderCache<GlobalMarketData>({
    ttlMs: GLOBAL_TTL_MS,
    maxStaleMs: 6 * 60 * 60_000,
    maxEntries: 2,
    onStaleServe: (key, ageMs) => console.warn(`[marketData] coingecko serving stale ${key} (${Math.round(ageMs / 60_000)}m old)`),
  });
  private readonly http: HttpProviderClient;
  readonly health: ProviderHealth;

  constructor(
    private readonly baseUrl = 'https://api.coingecko.com/api/v3',
    private readonly fetchFn: typeof fetch = fetch,
    // Free "Demo" plan key (see COINGECKO_API_KEY in .env.example) — moves
    // every request from the public anonymous rate-limit pool (shared with
    // everyone else calling CoinGecko without a key, prone to throttling
    // under real traffic) onto this app's own dedicated 100-calls/min,
    // 10,000-calls/month quota. Optional: falls back to the anonymous tier
    // when unset, same "gracefully absent" pattern as everywhere else.
    private readonly apiKey?: string,
    policy: ProviderRequestPolicy = {}
  ) {
    this.health = providerHealthRegistry.register(
      new ProviderHealth('coingecko', { onStateChange: logCircuitTransition })
    );
    this.http = new HttpProviderClient('CoinGecko', {
      ...policy,
      fetchFn: this.fetchFn,
      health: this.health,
      wrapError: (message) => new ExternalRankingError(message),
    });
  }

  /** Top ~500 coins by market cap, each tagged with whichever of the four
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
    return (await this.getRankingsWithMeta()).value;
  }

  /** Same data, keeping the `fetchedAt`/`stale` the cache already computed.
   *  The asset registry uses this so the catalogue can report its own
   *  freshness instead of stamping the read time. */
  async getRankingsWithMeta(): Promise<CachedValue<CoinRanking[]>> {
    return this.rankingsCache.fetch('top500', () => this.fetchRankings());
  }

  /**
   * The paged /coins/markets walk — identity AND the market snapshot in one
   * response. TOP_N coins at CG_MAX_PER_PAGE per page, so the call count is
   * ceil(TOP_N / 250) regardless of how many assets come back: 500 assets
   * cost TWO requests, not 500.
   *
   * Sequential, not Promise.all: CoinGecko's free tier rate-limits a burst
   * of concurrent requests more readily than the same requests spaced out.
   * Only page 1 failing is fatal (no data at all to serve); a later page
   * failing means fewer long-tail ranks this cycle rather than losing
   * everything.
   */
  private async fetchMarketRows(): Promise<CoinGeckoMarketRow[]> {
    const rowsOut: CoinGeckoMarketRow[] = [];
    const pageCount = Math.ceil(TOP_N / CG_MAX_PER_PAGE);
    for (let page = 1; page <= pageCount; page++) {
      let rows: CoinGeckoMarketRow[];
      try {
        rows = (await this.request(
          `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${CG_MAX_PER_PAGE}&page=${page}&sparkline=true&price_change_percentage=7d,30d`
        )) as CoinGeckoMarketRow[];
      } catch (err) {
        if (page === 1) throw err;
        break;
      }
      rowsOut.push(...rows);
    }
    return rowsOut;
  }

  /**
   * Category membership, keyed by uppercase ticker.
   *
   * One call per category — SEVEN, against the market walk's two, which is
   * why this has its own much slower cache (see CATALOGUE_CATEGORY_TTL_MS).
   * Which coins are "DeFi" or "Layer 1" is effectively static; their prices
   * are not, and tying the two to one TTL meant paying for the expensive
   * half every time the cheap half went stale.
   *
   * One failing category endpoint costs that one tag, never the catalogue.
   */
  private async fetchCategoryMap(): Promise<Map<string, CoinCategory[]>> {
    const bySymbol = new Map<string, CoinCategory[]>();
    for (const [key, slug] of Object.entries(CATEGORY_SLUGS) as [CoinCategory, string][]) {
      try {
        const coins = (await this.request(
          `/coins/markets?vs_currency=usd&category=${slug}&order=market_cap_desc&per_page=250&page=1&sparkline=false`
        )) as CoinGeckoMarketRow[];
        for (const c of coins) {
          const symbol = c.symbol?.toUpperCase();
          if (!symbol) continue;
          const held = bySymbol.get(symbol) ?? [];
          held.push(key);
          bySymbol.set(symbol, held);
        }
      } catch {
        // One category endpoint failing shouldn't blank out the whole
        // ranking list — that coin just won't get a category tag this cycle.
      }
    }
    return bySymbol;
  }

  /**
   * Merge the two cached halves into the public `CoinRanking[]`.
   *
   * Does no I/O of its own: both inputs come from their own ProviderCache,
   * so a 15-minute market refresh does not re-pay for the 6-hour category
   * walk, and concurrent callers collapse onto each cache independently.
   */
  private async fetchRankings(): Promise<CoinRanking[]> {
    const [markets, categoryMap] = await Promise.all([
      this.marketsCache.fetch('top500', () => this.fetchMarketRows()).then((c) => c.value),
      // Categories are a nice-to-have: a failure here costs tags, not the
      // catalogue. The market walk's failure is the one that propagates.
      this.categoriesCache
        .fetch('categories', () => this.fetchCategoryMap())
        .then((c) => c.value)
        .catch(() => new Map<string, CoinCategory[]>()),
    ]);

    const bySymbol = new Map<string, CoinRanking>();
    for (const m of markets) {
      const symbol = m.symbol.toUpperCase();
      // CoinGecko occasionally lists two different coins sharing a ticker
      // (e.g. wrapped variants) — keep whichever we see first, which is
      // the higher-ranked one since the response is already rank-sorted.
      // A row without an id would be a malformed response; fall back to a
      // deterministic derived id rather than propagating `undefined` into
      // something whose whole job is to be a stable identifier.
      const id = typeof m.id === 'string' && m.id.length > 0 ? m.id : `symbol:${symbol.toLowerCase()}`;
      const seen = bySymbol.get(symbol);
      if (seen) {
        // Unchanged behaviour: the first (highest-ranked) row still wins.
        // The loser is recorded rather than vanishing, so the asset
        // registry can represent the collision honestly.
        if (id !== seen.id && !seen.collidingIds.includes(id)) seen.collidingIds.push(id);
        continue;
      }
      bySymbol.set(symbol, {
        id,
        symbol,
        rank: m.market_cap_rank ?? TOP_N + 1,
        name: m.name,
        image: m.image,
        categories: [...(categoryMap.get(symbol) ?? [])],
        price: m.current_price ?? 0,
        changePercent24h: m.price_change_percentage_24h ?? null,
        changePercent7d: m.price_change_percentage_7d_in_currency ?? null,
        changePercent30d: m.price_change_percentage_30d_in_currency ?? null,
        volume24h: m.total_volume ?? 0,
        marketCap: m.market_cap ?? null,
        sparkline: m.sparkline_in_7d?.price ?? [],
        circulatingSupply: typeof m.circulating_supply === 'number' ? m.circulating_supply : null,
        market: {
          priceUsd: typeof m.current_price === 'number' ? m.current_price : null,
          changePercent24h: typeof m.price_change_percentage_24h === 'number' ? m.price_change_percentage_24h : null,
          marketCapUsd: typeof m.market_cap === 'number' ? m.market_cap : null,
          volume24hUsd: typeof m.total_volume === 'number' ? m.total_volume : null,
          circulatingSupply: typeof m.circulating_supply === 'number' ? m.circulating_supply : null,
        },
        collidingIds: [],
      });
    }

    // Merge in the local fallback (see LOCAL_CATEGORY_FALLBACK above) so
    // well-known coins still end up correctly categorized even when every
    // per-category call above failed — deduped via Set since a coin can
    // legitimately land in >1 category from the two sources combined.
    for (const entry of bySymbol.values()) {
      const fallback = LOCAL_CATEGORY_FALLBACK[entry.symbol];
      if (fallback) entry.categories = Array.from(new Set([...entry.categories, ...fallback]));
    }

    return Array.from(bySymbol.values()).sort((a, b) => a.rank - b.rank);
  }

  /** Market-wide 24h volume, total market cap and BTC dominance from
   * CoinGecko's /global endpoint. Same serve-stale-on-failure policy as
   * getRankings above: a rate-limited refresh returns the last good
   * snapshot rather than blanking the headline figure, and only a
   * genuinely first-ever call throws. */
  async getGlobalMarket(): Promise<GlobalMarketData> {
    const cached = await this.globalMarketCache.fetch('global', () => this.fetchGlobalMarket());
    return cached.value;
  }

  private async fetchGlobalMarket(): Promise<GlobalMarketData> {
    const payload = (await this.request('/global')) as CoinGeckoGlobalResponse;

    const totalVolume24hUsd = Number(payload?.data?.total_volume?.usd);
    const totalMarketCapUsd = Number(payload?.data?.total_market_cap?.usd);
    // A response we can't read is a failure, not a zero — throwing here is
    // what lets ProviderCache fall back to the last good snapshot.
    if (!Number.isFinite(totalVolume24hUsd) || !Number.isFinite(totalMarketCapUsd)) {
      throw new ExternalRankingError('CoinGecko /global returned no usable USD totals');
    }

    const btcDominance = Number(payload?.data?.market_cap_percentage?.btc);
    const ethDominance = Number(payload?.data?.market_cap_percentage?.eth);
    const capChange = Number(payload?.data?.market_cap_change_percentage_24h_usd);
    return {
      totalVolume24hUsd,
      totalMarketCapUsd,
      btcDominancePercent: Number.isFinite(btcDominance) ? btcDominance : null,
      ethDominancePercent: Number.isFinite(ethDominance) ? ethDominance : null,
      marketCapChangePercent24h: Number.isFinite(capChange) ? capChange : null,
    };
  }

  /** Shared outbound policy: bounded jittered retries, Retry-After respect
   *  (CoinGecko's free tier sends one), 429 accounting and a circuit that
   *  stops a rate-limited window from turning into a request storm. The
   *  Demo API key, when present, only ever travels in this request header —
   *  never into a log line or a response body. */
  private async request(path: string): Promise<unknown> {
    try {
      return await this.http.getJson(`${this.baseUrl}${path}`, {
        headers: this.apiKey ? { 'x-cg-demo-api-key': this.apiKey } : undefined,
      });
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        throw new ExternalRankingError('CoinGecko is temporarily unavailable');
      }
      throw err;
    }
  }
}
