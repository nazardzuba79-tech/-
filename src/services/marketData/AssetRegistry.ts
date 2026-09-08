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
