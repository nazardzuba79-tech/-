import { ProviderCache } from './ProviderCache';
import type { DataSource, Envelope } from './types';
import type { CoinGeckoService, CoinRanking } from '../CoinGeckoService';
import type { KrakenMarketDataService, MarketSymbol } from '../KrakenMarketDataService';

/**
 * Canonical identity for a crypto asset, and the join between "what the
 * world calls this coin" and "what VOLTEX can actually trade".
 *
 * The problem this replaces: identity was the ticker string. `CryptoIcon`
 * built a CDN URL out of it, `avatarColor` hashed it, CoinGecko lookups
 * matched on it, and Kraken pairs were split on it. That works until two
 * different coins share a ticker — which is not hypothetical, CoinGecko's
 * own top-500 contains collisions today, and the previous code resolved
 * them by silently keeping whichever it saw first and discarding the rest.
 * A ticker is a label. It is not an identity.
 *
 * So every asset here has a canonical `id`:
 *
 *   - `cg:bitcoin` when CoinGecko knows the coin — its slug is stable
 *     across renames and re-listings, which is exactly what an id has to
 *     be.
 *   - `kraken:XYZ` for an asset VOLTEX lists but CoinGecko's top-N does
 *     not cover. Deliberately a different namespace: it says "this
 *     identity came from the venue, not the catalogue", so nothing can
 *     mistake it for a global identifier.
 *
 * ─────────────────────────────────────────────────────────────────────
 * CATALOGUE IS NOT THE SAME THING AS A TRADABLE MARKET.
 * ─────────────────────────────────────────────────────────────────────
 *
 * `catalogue` is ~500 assets of market-wide reference metadata: name,
 * logo, rank, market cap. Displaying one costs nothing and commits VOLTEX
 * to nothing.
 *
 * `tradingPairs` is the executable set, and it comes from ONE place —
 * Kraken's real tradable pair list, the same list the spot terminal and
 * the matching engine already work from. An asset with `tradable: false`
 * has no route to an order form, and nothing in this file can invent one.
 * Growing the catalogue to 500 assets must never grow the executable
 * market set by a single pair.
 */

/** How an asset's descriptive metadata was obtained. */
export type AssetMetadataSource = Extract<DataSource, 'coingecko' | 'kraken'>;

export interface AssetProviderMappings {
  /** CoinGecko's stable slug, when the coin is in the tracked catalogue. */
  coingecko?: string;
  /** The base-asset code Kraken uses, when VOLTEX lists it. */
  kraken?: string;
}

/**
 * Market-wide reference figures for a catalogue asset.
 *
 * Every field is nullable and NOTHING here is coerced: a provider that did
 * not report a market cap yields `null`, which renders as a dash. A
 * genuine zero arrives as `0`. This is the whole reason the registry reads
 * `CoinRanking.market` rather than the legacy zero-defaulted fields beside
 * it.
 *
 * These are MARKET-WIDE figures (CoinGecko), not VOLTEX execution prices.
 * A tradable asset's terminal price comes from the Kraken reference path
 * the trading surfaces already use — see §14 of
 * docs/MARKET_DATA_ARCHITECTURE.md. The two are never mixed.
 */
export interface AssetMarketSnapshot {
  priceUsd: number | null;
  changePercent24h: number | null;
  marketCapUsd: number | null;
  volume24hUsd: number | null;
  circulatingSupply: number | null;
}

/*
 * Deliberately ABSENT from the catalogue: the 7-day sparkline.
 *
 * CoinGecko does supply it in the same rows, so it is free to FETCH — but
 * it is ~168 floats per asset, and at catalogue scale that is roughly a
 * megabyte held in the server cache and shipped to every browser that
 * opens Markets, to draw 750 charts nobody has scrolled to. The brief's
 * own rule applies: use a bulk sparkline only if it is cheap, otherwise
 * omit it. At 750 rows it is not cheap.
 *
 * The existing /market/external/rankings endpoint still carries sparklines
 * for the small curated summary lists that actually render them.
 */

export interface CanonicalAsset {
  /** Namespaced, globally unique, stable. Never a bare ticker. */
  id: string;
  /** Display ticker. NOT unique — see `ambiguous`. */
  symbol: string;
  name: string;
  /** Catalogue logo when one exists. `null` means the icon pipeline falls
   *  through to its next tier — never a broken URL and never a guess. */
  logoUrl: string | null;
  providers: AssetProviderMappings;
  /** VOLTEX-executable pairs for this asset. Empty means not tradable. */
  tradingPairs: string[];
  tradable: boolean;
  metadataSource: AssetMetadataSource;
  /** Market-cap rank when the catalogue supplies one. */
  rank: number | null;
  /**
   * True when another catalogue entry reports the same ticker. The UI can
   * keep showing the symbol — but anything resolving by symbol alone is
   * now on notice that it is guessing, and `id` is the safe key.
   */
  ambiguous: boolean;
  /** Ids of the other coins that reported this ticker. */
  collidingIds: string[];
  /** Market-wide reference figures. `null` for an asset the catalogue does
   *  not cover — a venue-only listing has a tradable market but no
   *  market-wide metadata, and inventing figures for it is exactly what
   *  this must not do. */
  market: AssetMarketSnapshot | null;
}

export interface AssetCatalogue {
  assets: CanonicalAsset[];
  /** Total catalogue size, including assets VOLTEX cannot trade. */
  total: number;
  /** How many of those have at least one executable VOLTEX pair. */
  tradableCount: number;
  /** Tickers claimed by more than one catalogue entry. */
  collisions: string[];
  /** False when CoinGecko was unavailable and the catalogue was built from
   *  the venue's own pair list alone — fewer assets, no logos, no ranks,
   *  but real and honestly labelled rather than empty. */
  metadataComplete: boolean;
}

/**
 * Quote-asset preference when an asset has more than one VOLTEX pair.
 *
 * The catalogue's "Trade" action needs ONE destination, and picking it must
 * be deterministic rather than an assumption: several assets list against
 * both USDT and USD here, and blindly appending "/USDT" would produce a
 * link to a market that may not exist. This ordering mirrors
 * `frontend/src/lib/pairList.ts`'s QUOTE_PRIORITY, which is what the spot
 * terminal's own pair list already sorts by.
 *
 * A pair whose quote is not in this list is still selectable — it simply
 * sorts after the known ones, alphabetically. Nothing is ever fabricated:
 * the choice is only ever made among pairs the venue actually lists.
 */
export const QUOTE_PRIORITY = ['USDT', 'USD', 'USDC', 'EUR', 'BTC', 'ETH'];

/** The pair a "Trade" action should open for this asset, or `null` when the
 *  asset has no executable VOLTEX market at all. */
export function defaultTradingPair(tradingPairs: string[]): string | null {
  if (tradingPairs.length === 0) return null;
  return [...tradingPairs].sort((a, b) => {
    const qa = QUOTE_PRIORITY.indexOf(a.split('/')[1] ?? '');
    const qb = QUOTE_PRIORITY.indexOf(b.split('/')[1] ?? '');
    const ra = qa === -1 ? QUOTE_PRIORITY.length : qa;
    const rb = qb === -1 ? QUOTE_PRIORITY.length : qb;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  })[0];
}

/** Fields the catalogue can be ordered by. */
export type AssetSortKey = 'rank' | 'marketCap' | 'volume24h' | 'price' | 'change24h' | 'symbol' | 'name';

export interface AssetQuery {
  search?: string;
  tradableOnly?: boolean;
  sort?: AssetSortKey;
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface AssetQueryResult {
  assets: CanonicalAsset[];
  /** Rows matching the filter, before pagination. */
  matched: number;
  /** The whole catalogue, regardless of filter — so a UI can say
   *  "12 of 517" rather than pretending the catalogue is 12 assets. */
  catalogueTotal: number;
  tradableCount: number;
  collisions: string[];
  metadataComplete: boolean;
  limit: number;
  offset: number;
}

/**
 * The catalogue changes on the timescale of listings, not prices, so this
 * is deliberately slow-moving. The two upstream reads it composes
 * (CoinGecko rankings, Kraken symbols) have their own caches with their
 * own TTLs; this one exists so the *join* — which is the expensive part at
 * 500 assets — is not recomputed per request.
 */
const CATALOGUE_TTL_MS = 10 * 60_000;
/** A listing barely changes. An hour-old catalogue beats an empty one. */
const CATALOGUE_MAX_STALE_MS = 6 * 60 * 60_000;

export class AssetRegistry {
  private readonly cache: ProviderCache<AssetCatalogue>;

  constructor(
    private readonly coinGecko: Pick<CoinGeckoService, 'getRankings'>,
    private readonly kraken: Pick<KrakenMarketDataService, 'listSymbols'>,
    options: { ttlMs?: number; maxStaleMs?: number; now?: () => number } = {}
  ) {
    this.cache = new ProviderCache<AssetCatalogue>({
      ttlMs: options.ttlMs ?? CATALOGUE_TTL_MS,
      maxStaleMs: options.maxStaleMs ?? CATALOGUE_MAX_STALE_MS,
      // One key ("catalogue"). Bounded anyway, on principle.
      maxEntries: 4,
      now: options.now,
      onStaleServe: (key, ageMs) =>
        console.warn(`[marketData] assetRegistry serving stale ${key} (${Math.round(ageMs / 1000)}s old)`),
    });
  }

  /**
   * The whole catalogue, joined and cached. Concurrent callers collapse
   * into one build via ProviderCache — 100 page loads asking for asset
   * metadata at once do the join once.
   */
  async getCatalogue(): Promise<Envelope<AssetCatalogue>> {
    const cached = await this.cache.fetch('catalogue', () => this.build());
    return {
      value: cached.value,
      // The join's provenance is the richer of its two inputs. When
      // CoinGecko is down the catalogue is venue-only and says so both
      // here and in `metadataComplete`.
      source: cached.value.metadataComplete ? 'coingecko' : 'kraken',
      fetchedAt: cached.fetchedAt,
      stale: cached.stale,
    };
  }

  /**
   * Search, sort and paginate the catalogue.
   *
   * Runs over the ALREADY-CACHED join — it issues no provider request of
   * its own, so paging through 500 assets or typing in the search box
   * costs nothing upstream. `matched` and `catalogueTotal` are both
   * reported so a filtered view can state what it is a subset of.
   *
   * Sorting puts missing values last in BOTH directions. A coin with no
   * market cap is not the smallest market cap; treating `null` as 0 would
   * float unranked assets to the top of an ascending sort, which is the
   * same fake-zero mistake in a different costume.
   */
  async query(options: AssetQuery = {}): Promise<Envelope<AssetQueryResult>> {
    const envelope = await this.getCatalogue();
    const { assets, total, tradableCount, collisions, metadataComplete } = envelope.value;

    // Ceiling raised to 1000 so the Markets page can pull the WHOLE
    // catalogue in one request and then search/sort/page it client-side
    // with no further round trips (see the frontend catalogue store). The
    // default stays 100 for every other caller.
    const limit = clamp(options.limit ?? 100, 1, 1000);
    const offset = Math.max(0, options.offset ?? 0);
    const direction = options.direction === 'asc' ? 1 : -1;
    const sort = options.sort ?? 'rank';

    const needle = options.search?.trim().toLowerCase() ?? '';
    let matched = assets;
    if (options.tradableOnly) matched = matched.filter((a) => a.tradable);
    if (needle) {
      // Symbol AND name, so both "BTC" and "Bitcoin" find Bitcoin.
      matched = matched.filter(
        (a) => a.symbol.toLowerCase().includes(needle) || a.name.toLowerCase().includes(needle)
      );
    }

    const sorted = [...matched].sort((a, b) => compareAssets(a, b, sort, direction));

    return {
      ...envelope,
      value: {
        assets: sorted.slice(offset, offset + limit),
        matched: sorted.length,
        catalogueTotal: total,
        tradableCount,
        collisions,
        metadataComplete,
        limit,
        offset,
      },
    };
  }

  /** One asset by canonical id. `null`, never a fabricated placeholder. */
  async getById(id: string): Promise<CanonicalAsset | null> {
    const { value } = await this.getCatalogue();
    return value.assets.find((a) => a.id === id) ?? null;
  }

  /**
   * Best-effort lookup by ticker, for the many existing call sites that
   * only have a symbol. Prefers a tradable asset, then the better rank —
   * so "BTC" resolves to Bitcoin and not to some rank-900 impostor — and
   * the result carries `ambiguous` so a caller can tell it was a guess.
   */
  async resolveSymbol(symbol: string): Promise<CanonicalAsset | null> {
    const { value } = await this.getCatalogue();
    const upper = symbol.toUpperCase();
    const matches = value.assets.filter((a) => a.symbol === upper);
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0];
    return [...matches].sort((a, b) => {
      if (a.tradable !== b.tradable) return a.tradable ? -1 : 1;
      return (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
    })[0];
  }

  /**
   * Symbol → icon metadata for a batch of tickers, in ONE pass over the
   * cached catalogue.
   *
   * This is what stops the icon pipeline from becoming 500 metadata
   * lookups: the frontend asks once for the symbols actually on screen and
   * gets a plain map back. Unknown symbols are simply absent from the
   * result — the client's own deterministic fallback handles them, which
   * is why there is no placeholder entry here.
   */
  async iconMetadata(symbols: string[]): Promise<Record<string, { id: string; name: string; logoUrl: string | null }>> {
    const { value } = await this.getCatalogue();
    const wanted = new Set(symbols.map((s) => s.toUpperCase()));
    const out: Record<string, { id: string; name: string; logoUrl: string | null }> = {};
    for (const asset of value.assets) {
      if (!wanted.has(asset.symbol) || out[asset.symbol]) continue;
      out[asset.symbol] = { id: asset.id, name: asset.name, logoUrl: asset.logoUrl };
    }
    return out;
  }

  private async build(): Promise<AssetCatalogue> {
    // Independent: a CoinGecko outage must cost logos and ranks, not the
    // ability to say what VOLTEX trades. Kraken failing is different — it
    // is the tradable list, and without it there is no catalogue worth
    // publishing, so that rejection propagates to the cache's stale path.
    const [rankingsResult, symbols] = await Promise.all([
      this.coinGecko
        .getRankings()
        .then((r) => ({ ok: true as const, rankings: r }))
        .catch(() => ({ ok: false as const, rankings: [] as CoinRanking[] })),
      this.kraken.listSymbols(),
    ]);

    const pairsByBase = new Map<string, string[]>();
    for (const s of symbols as MarketSymbol[]) {
      const list = pairsByBase.get(s.baseAsset) ?? [];
      list.push(s.pair);
      pairsByBase.set(s.baseAsset, list);
    }

    const assets: CanonicalAsset[] = [];
    const claimedSymbols = new Map<string, number>();

    for (const coin of rankingsResult.rankings) {
      const pairs = pairsByBase.get(coin.symbol) ?? [];
      assets.push({
        id: `cg:${coin.id}`,
        symbol: coin.symbol,
        name: coin.name,
        logoUrl: coin.image || null,
        market: {
          // Read from the honest nullable half of CoinRanking, never the
          // legacy zero-coerced fields.
          priceUsd: coin.market.priceUsd,
          changePercent24h: coin.market.changePercent24h,
          marketCapUsd: coin.market.marketCapUsd,
          volume24hUsd: coin.market.volume24hUsd,
          circulatingSupply: coin.market.circulatingSupply,
        },
        providers: {
          coingecko: coin.id,
          // Only claim a Kraken mapping when the venue actually lists it.
          ...(pairs.length > 0 ? { kraken: coin.symbol } : {}),
        },
        tradingPairs: pairs,
        tradable: pairs.length > 0,
        metadataSource: 'coingecko',
        rank: coin.rank,
        // Filled in below, once every claim is counted.
        ambiguous: false,
        collidingIds: coin.collidingIds.map((c) => `cg:${c}`),
      });
      claimedSymbols.set(coin.symbol, (claimedSymbols.get(coin.symbol) ?? 0) + 1);
    }

    // Anything VOLTEX lists that the catalogue did not cover. These are
    // real tradable markets — omitting them would mean the pair list and
    // the catalogue disagreed about what the exchange offers.
    const catalogued = new Set(assets.map((a) => a.symbol));
    for (const [baseAsset, pairs] of pairsByBase) {
      if (catalogued.has(baseAsset)) continue;
      assets.push({
        id: `kraken:${baseAsset}`,
        symbol: baseAsset,
        // No catalogue entry means no display name to show. The ticker is
        // the honest answer, not an invented expansion of it.
        name: baseAsset,
        logoUrl: null,
        providers: { kraken: baseAsset },
        tradingPairs: pairs,
        tradable: true,
        metadataSource: 'kraken',
        rank: null,
        ambiguous: false,
        collidingIds: [],
        // Tradable here, but the catalogue has no market-wide figures for
        // it. Null, not zeros.
        market: null,
      });
      claimedSymbols.set(baseAsset, (claimedSymbols.get(baseAsset) ?? 0) + 1);
    }

    const collisions: string[] = [];
    for (const [symbol, count] of claimedSymbols) {
      if (count > 1) collisions.push(symbol);
    }
    const collided = new Set(collisions);
    for (const asset of assets) {
      // Ambiguous if two catalogue entries claim the ticker, or if
      // CoinGecko itself reported a same-ticker coin it ranked lower.
      if (collided.has(asset.symbol) || asset.collidingIds.length > 0) asset.ambiguous = true;
    }

    assets.sort((a, b) => {
      const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
      const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
      if (ra !== rb) return ra - rb;
      return a.symbol.localeCompare(b.symbol);
    });

    return {
      assets,
      total: assets.length,
      tradableCount: assets.filter((a) => a.tradable).length,
      collisions: collisions.sort(),
      metadataComplete: rankingsResult.ok,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Nulls sort last in both directions — see `query`'s doc comment. */
function nullsLast(a: number | null | undefined, b: number | null | undefined, direction: number): number {
  const av = a ?? null;
  const bv = b ?? null;
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return (av - bv) * direction;
}

function compareAssets(a: CanonicalAsset, b: CanonicalAsset, sort: AssetSortKey, direction: number): number {
  switch (sort) {
    case 'marketCap':
      return nullsLast(a.market?.marketCapUsd, b.market?.marketCapUsd, direction) || a.symbol.localeCompare(b.symbol);
    case 'volume24h':
      return nullsLast(a.market?.volume24hUsd, b.market?.volume24hUsd, direction) || a.symbol.localeCompare(b.symbol);
    case 'price':
      return nullsLast(a.market?.priceUsd, b.market?.priceUsd, direction) || a.symbol.localeCompare(b.symbol);
    case 'change24h':
      return nullsLast(a.market?.changePercent24h, b.market?.changePercent24h, direction) || a.symbol.localeCompare(b.symbol);
    case 'symbol':
      return a.symbol.localeCompare(b.symbol) * direction;
    case 'name':
      return a.name.localeCompare(b.name) * direction;
    case 'rank':
    default:
      // Rank ascends naturally (rank 1 is the biggest), so the default
      // 'desc' direction still has to mean "best first". Inverted here so
      // the API's default produces the ordering a market table expects.
      return nullsLast(a.rank, b.rank, -direction) || a.symbol.localeCompare(b.symbol);
  }
}
