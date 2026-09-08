import {
  AssetRegistry,
  defaultTradingPair,
  type AssetCatalogue,
  type AssetQuery,
  type AssetQueryResult,
  type CanonicalAsset,
} from './AssetRegistry';
import { providerHealthRegistry, ProviderUnavailableError, type ProviderHealthSnapshot } from './ProviderHealth';
import {
  CapabilityUnsupportedError,
  available,
  unavailable,
  type Availability,
  type DataSource,
  type Envelope,
  type MarketDataCapability,
} from './types';
import type {
  KrakenMarketDataService,
  MarketCandle,
  MarketOrderBookSnapshot,
  MarketSymbol,
  MarketTicker,
  MarketTrade,
} from '../KrakenMarketDataService';
import type { CoinGeckoService, GlobalMarketData } from '../CoinGeckoService';
import type { FearGreedService } from '../FearGreedService';
import type { CfdMarketDataService, CfdTicker } from '../CfdMarketDataService';

/**
 * The VOLTEX Market Data Gateway.
 *
 * One façade over every reference-market source this exchange reads. It is
 * an orchestration layer, not a fourth cache and not a re-implementation
 * of the provider services: `KrakenMarketDataService`,
 * `CoinGeckoService`, `FearGreedService` and `CfdMarketDataService` keep
 * doing their own normalization and keep owning their own
 * `ProviderCache`/`ProviderHealth`. What was missing — and what this adds —
 * is a single place that:
 *
 *   1. Decides WHICH provider answers a question, so a caller asks for
 *      "candles for BTC/USDT" instead of naming a venue. When a second
 *      provider is added, the routing changes here and nowhere else.
 *
 *   2. Attaches provenance and freshness to every answer. The provider
 *      services already track `fetchedAt`/`stale` inside their caches;
 *      until now that stopped at the service boundary and a two-minute-old
 *      stale-served price reached the browser looking exactly like a live
 *      one. Now it travels with the value, all the way to the client.
 *
 *   3. Turns a provider failure into an explicit `available: false`
 *      instead of a thrown error that a caller might paper over with a
 *      zero. This is the single most important thing in the file: there is
 *      no code path here that converts "the provider is down" into a
 *      number.
 *
 *   4. Declares capabilities, so asking Twelve Data for an order book is a
 *      refusal in one place rather than a surprise 404 in six.
 *
 * ── What this file is NOT ────────────────────────────────────────────
 *
 * It is not a source of VOLTEX financial truth. Mark price, funding
 * settlement, open interest, positions, margin and liquidation are
 * VOLTEX's own, computed by the futures services against VOLTEX's own
 * book, and nothing here participates in any of them. The gateway serves
 * REFERENCE market data — what the outside world's prices are — and the
 * boundary between the two is deliberate. An external venue's open
 * interest is a fact about that venue, and `DataSource` exists so it can
 * never quietly stand in for ours.
 */

/** Which provider currently answers each capability. Data, not prose, so
 *  the provider table in the docs and the routing cannot drift apart. */
export interface CapabilityBinding {
  capability: MarketDataCapability;
  provider: DataSource;
  transport: 'REST' | 'WS';
  requiresKey: boolean;
}

export interface MarketOverview {
  global: GlobalMarketData;
}

export interface SentimentReading {
  value: number;
  classification: string;
  updatedAt: number;
}

/** The one snapshot the frontend polls, instead of six components each
 *  polling their own endpoint. See `docs/MARKET_DATA_ARCHITECTURE.md`. */
export interface MarketSnapshot {
  tickers: Availability<MarketTicker[]>;
  overview: Availability<GlobalMarketData>;
  sentiment: Availability<SentimentReading>;
}

export interface GatewayStatus {
  providers: ProviderHealthSnapshot[];
  capabilities: CapabilityBinding[];
  catalogue: {
    total: number;
    tradable: number;
    metadataComplete: boolean;
    collisions: number;
    fetchedAt: number;
    stale: boolean;
  } | null;
}

/**
 * Static capability routing. Every entry is a provider this repository
 * actually calls; nothing aspirational is listed, because the docs render
 * this table and a listed-but-unimplemented provider would be a lie.
 */
const CAPABILITY_BINDINGS: CapabilityBinding[] = [
  { capability: 'asset_catalogue', provider: 'coingecko', transport: 'REST', requiresKey: false },
  { capability: 'tradable_markets', provider: 'kraken', transport: 'REST', requiresKey: false },
  { capability: 'ticker', provider: 'kraken', transport: 'REST', requiresKey: false },
  { capability: 'tickers', provider: 'kraken', transport: 'REST', requiresKey: false },
  { capability: 'candles', provider: 'kraken', transport: 'REST', requiresKey: false },
  { capability: 'order_book', provider: 'kraken', transport: 'REST', requiresKey: false },
  { capability: 'recent_trades', provider: 'kraken', transport: 'REST', requiresKey: false },
  { capability: 'market_overview', provider: 'coingecko', transport: 'REST', requiresKey: false },
  { capability: 'sentiment', provider: 'alternative.me', transport: 'REST', requiresKey: false },
  { capability: 'cfd_quotes', provider: 'twelvedata', transport: 'REST', requiresKey: true },
];

/** Providers this gateway reads. Narrower than `DataSource`, which also
 *  covers arbitrage venues and VOLTEX itself. */
type GatewayProvider = Extract<DataSource, 'kraken' | 'coingecko' | 'alternative.me' | 'twelvedata'>;

export class MarketDataGateway {
  private readonly registry: AssetRegistry;

  constructor(
    private readonly kraken: KrakenMarketDataService,
    private readonly coinGecko: CoinGeckoService,
    private readonly fearGreed: FearGreedService,
    private readonly cfd: CfdMarketDataService | null,
    registry?: AssetRegistry
  ) {
    this.registry = registry ?? new AssetRegistry(coinGecko, kraken);
  }

  /** The routing table, for the status endpoint and the documentation. */
  capabilities(): CapabilityBinding[] {
    return CAPABILITY_BINDINGS.map((c) => ({ ...c }));
  }

  supports(capability: MarketDataCapability): boolean {
    if (capability === 'cfd_quotes') return this.cfd !== null && this.cfd.isConfigured();
    return CAPABILITY_BINDINGS.some((c) => c.capability === capability);
  }

  /** Explicit refusal for a capability nothing can answer — a programming
   *  error surfaced in one place instead of six runtime 404s. */
  private requireCapability(capability: MarketDataCapability): void {
    if (!CAPABILITY_BINDINGS.some((c) => c.capability === capability)) {
      throw new CapabilityUnsupportedError(capability);
    }
  }

  // ── Asset catalogue ──────────────────────────────────────────────────

  async getAssetCatalogue(): Promise<Availability<AssetCatalogue>> {
    this.requireCapability('asset_catalogue');
    return this.guard('coingecko', () => this.registry.getCatalogue());
  }

  /**
   * Search / sort / paginate the catalogue.
   *
   * Served entirely from the cached join, so a 500-asset table paging and
   * filtering costs zero upstream requests. See AssetRegistry.query.
   */
  async queryAssets(options: AssetQuery = {}): Promise<Availability<AssetQueryResult>> {
    this.requireCapability('asset_catalogue');
    return this.guard('coingecko', () => this.registry.query(options));
  }

  /**
   * The pair a catalogue "Trade" action should open, or `null` when the
   * asset has no executable VOLTEX market.
   *
   * Deliberately derived from the asset's REAL `tradingPairs` under a
   * documented quote priority, never by appending "/USDT" to a ticker —
   * that would link to a market that may not exist.
   */
  tradingPairFor(asset: Pick<CanonicalAsset, 'tradingPairs'>): string | null {
    return defaultTradingPair(asset.tradingPairs);
  }

  async resolveAsset(symbol: string): Promise<CanonicalAsset | null> {
    try {
      return await this.registry.resolveSymbol(symbol);
    } catch {
      // Identity metadata is a nice-to-have for a price row; a catalogue
      // outage must never take a price with it.
      return null;
    }
  }

  async iconMetadata(symbols: string[]): Promise<Record<string, { id: string; name: string; logoUrl: string | null }>> {
    try {
      return await this.registry.iconMetadata(symbols);
    } catch {
      // Same reasoning: the client's deterministic letter fallback covers
      // an empty map perfectly well.
      return {};
    }
  }

  // ── Tradable markets ─────────────────────────────────────────────────

  /**
   * The executable market set. Deliberately sourced from the venue's own
   * pair list rather than from the catalogue: a listing is a fact about
   * VOLTEX, and no amount of catalogue metadata may add one.
   */
  async getTradableMarkets(): Promise<Availability<MarketSymbol[]>> {
    this.requireCapability('tradable_markets');
    return this.guard('kraken', () => this.kraken.listSymbolsWithMeta().then((c) => this.env(c, 'kraken')));
  }

  // ── Prices ───────────────────────────────────────────────────────────

  async getTickers(): Promise<Availability<MarketTicker[]>> {
    this.requireCapability('tickers');
    return this.guard('kraken', () => this.kraken.getTickersWithMeta().then((c) => this.env(c, 'kraken')));
  }

  /**
   * One pair. Note the two distinct "no value" outcomes, which a caller
   * must be able to tell apart: an unknown pair is `no_data` (the request
   * was answered, the pair does not exist), while a provider outage is
   * `provider_unavailable`. Neither is a zero.
   */
  async getTicker(pair: string): Promise<Availability<MarketTicker>> {
    this.requireCapability('ticker');
    const result = await this.guard('kraken', () =>
      this.kraken.getTickerWithMeta(pair).then((c) => this.env(c, 'kraken'))
    );
    if (!result.available) return result;
    if (result.value === null) return unavailable('no_data', `No ticker for ${pair.toUpperCase()}.`);
    return available({ ...result, value: result.value });
  }

  /**
   * Candles for ONE instrument and ONE timeframe — never a bulk operation,
   * deliberately. A 500-asset catalogue page needs 500 rows of ticker data
   * and zero candle histories; only the selected chart pays for OHLC. The
   * underlying series cache is shared per pair+interval and tops up from
   * the last closed candle rather than re-downloading, so revisiting a
   * pair is a tail request. See KrakenMarketDataService.getCandles.
   */
  async getCandles(pair: string, interval: string, limit = 300): Promise<Availability<MarketCandle[]>> {
    this.requireCapability('candles');
    return this.guard('kraken', () =>
      this.kraken.getCandlesWithMeta(pair, interval, limit).then((c) => this.env(c, 'kraken'))
    );
  }

  async getOrderBook(pair: string, limit = 50): Promise<Availability<MarketOrderBookSnapshot>> {
    this.requireCapability('order_book');
    return this.guard('kraken', () =>
      this.kraken.getOrderBookWithMeta(pair, limit).then((c) => this.env(c, 'kraken'))
    );
  }

  async getRecentTrades(pair: string, limit = 60): Promise<Availability<MarketTrade[]>> {
    this.requireCapability('recent_trades');
    return this.guard('kraken', () =>
      this.kraken.getRecentTradesWithMeta(pair, limit).then((c) => this.env(c, 'kraken'))
    );
  }

  // ── Market-wide reference ────────────────────────────────────────────

  async getMarketOverview(): Promise<Availability<GlobalMarketData>> {
    this.requireCapability('market_overview');
    return this.guard('coingecko', async () => {
      const value = await this.coinGecko.getGlobalMarket();
      // CoinGeckoService owns this cache internally and does not expose
      // its fetch time; the value is at most GLOBAL_TTL_MS old by
      // construction. Reporting `now` here would overstate freshness, so
      // this is the one place a value is marked with the read time and
      // never with `stale: true` — the service's own serve-stale-on-
      // failure path is invisible from out here. Recorded as a known
      // limitation in docs/MARKET_DATA_ARCHITECTURE.md.
      return { value, source: 'coingecko' as const, fetchedAt: Date.now(), stale: false };
    });
  }

  async getSentiment(): Promise<Availability<SentimentReading>> {
    this.requireCapability('sentiment');
    return this.guard('alternative.me', async () => {
      const reading = await this.fearGreed.getIndex();
      return {
        value: { value: reading.value, classification: reading.classification, updatedAt: reading.updatedAt },
        source: 'alternative.me' as const,
        fetchedAt: Date.now(),
        stale: false,
      };
    });
  }

  // ── CFD ──────────────────────────────────────────────────────────────

  /**
   * CFD reference quotes. Distinct from every other capability in that it
   * needs a key, so "not configured" is a first-class answer rather than a
   * failure — the difference between "we have not set this up" and "the
   * provider is down", which the UI shows differently.
   */
  async getCfdQuotes(): Promise<Availability<CfdTicker[]>> {
    if (!this.cfd) {
      return unavailable('provider_not_configured', 'No CFD market-data provider is wired up.');
    }
    if (!this.cfd.isConfigured()) {
      return unavailable('provider_not_configured', 'TWELVE_DATA_API_KEY is not set.');
    }
    return this.guard('twelvedata', () => this.cfd!.getTickersWithMeta().then((c) => this.env(c, 'twelvedata')));
  }

  // ── Composite ────────────────────────────────────────────────────────

  /**
   * Everything a page header needs, in one request.
   *
   * The point is not convenience — it is that the homepage ticker, the top
   * ticker strip, the pair list and the markets table used to run four
   * independent polling loops for overlapping data. One snapshot request
   * collapses that into one, and because each section is gathered
   * independently, one provider being down degrades one section instead of
   * failing the response.
   */
  async getSnapshot(): Promise<MarketSnapshot> {
    const [tickers, overview, sentiment] = await Promise.all([
      this.getTickers(),
      this.getMarketOverview(),
      this.getSentiment(),
    ]);
    return { tickers, overview, sentiment };
  }

  async getStatus(): Promise<GatewayStatus> {
    let catalogue: GatewayStatus['catalogue'] = null;
    try {
      const env = await this.registry.getCatalogue();
      catalogue = {
        total: env.value.total,
        tradable: env.value.tradableCount,
        metadataComplete: env.value.metadataComplete,
        collisions: env.value.collisions.length,
        fetchedAt: env.fetchedAt,
        stale: env.stale,
      };
    } catch {
      // A status endpoint that 500s when a provider is down is useless
      // precisely when it is needed. `null` says "could not build it".
    }
    return {
      providers: providerHealthRegistry.snapshot(),
      capabilities: this.capabilities(),
      catalogue,
    };
  }

  // ── Internals ────────────────────────────────────────────────────────

  private env<T>(cached: { value: T; fetchedAt: number; stale: boolean }, source: DataSource): Envelope<T> {
    return { value: cached.value, source, fetchedAt: cached.fetchedAt, stale: cached.stale };
  }

  /**
   * The one place a provider failure becomes an availability answer.
   *
   * Everything routed through here either returns real data — possibly
   * stale, always labelled — or an `available: false` object with no
   * value-carrying fields at all. There is deliberately no `?? 0`, no
   * `|| []` and no default value anywhere in this class: a caller cannot
   * accidentally render an outage as a number because there is no number
   * to render.
   */
  private async guard<T>(provider: GatewayProvider, load: () => Promise<Envelope<T>>): Promise<Availability<T>> {
    try {
      return available(await load());
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        return unavailable('provider_unavailable', `${provider} is in a cooldown after repeated failures.`);
      }
      // The message is ours (the provider services wrap their errors in
      // their own types), never a raw upstream body — nothing here can
      // leak a URL, a key or a provider payload into a client response.
      return unavailable('provider_unavailable', `${provider} data is unavailable right now.`);
    }
  }
}
