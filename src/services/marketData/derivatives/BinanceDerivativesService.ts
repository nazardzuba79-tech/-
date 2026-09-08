import { ProviderCache } from '../ProviderCache';
import {
  HttpProviderClient,
  ProviderHealth,
  logCircuitTransition,
  providerHealthRegistry,
  type ProviderRequestPolicy,
} from '../ProviderHealth';
import {
  numeric,
  type LongShortRatio,
  type LongShortRatioKind,
  type VenueBasis,
  type VenueFunding,
  type VenueOpenInterest,
  type VenueTurnover,
} from './types';

/**
 * Binance USDⓈ-M Futures public market data.
 *
 * Every endpoint used here is public and requires NO API key and NO
 * signature. Nothing in this file reads an environment variable, and there
 * is no authenticated code path to accidentally reach — this is reference
 * data about Binance's venue, not an account integration.
 *
 * Endpoint families (documented, official, unauthenticated):
 *
  *   GET /fapi/v1/ticker/24hr       — the rolling 24h window, including a
 *                                    REAL quote-currency turnover.
 *   GET /fapi/v1/openInterest      — a contract's current open interest.
 *   GET /fapi/v1/premiumIndex      — mark price, index price, the current
 *                                    funding rate and the next funding time.
 *   GET /futures/data/globalLongShortAccountRatio
 *   GET /futures/data/topLongShortAccountRatio
 *   GET /futures/data/topLongShortPositionRatio
 *
 * ── Deliberately NOT used ───────────────────────────────────────────
 *
 * `GET /fapi/v1/allForceOrders`, the public liquidation history endpoint,
 * is no longer maintained and no longer accepts requests. Binance's
 * remaining public liquidation feed is the `!forceOrder@arr` WebSocket
 * stream, and this backend has no server-side WebSocket infrastructure to
 * consume it with (see `docs/MARKET_DATA_ARCHITECTURE.md` §9). Rather than
 * ship a module that would report a provider error forever, liquidations
 * stay explicitly unavailable.
 *
 * ── Transport ───────────────────────────────────────────────────────
 *
 * Shared primitives only: `HttpProviderClient` (bounded retries, full
 * jitter, Retry-After), one `ProviderHealth` circuit for the venue, and
 * `ProviderCache` for TTL + in-flight deduplication + stale-last-good.
 * No new networking or caching machinery.
 *
 * NOT verified against the live API from this sandbox: the egress proxy
 * returns a 403 policy denial for CONNECT to fapi.binance.com. Response
 * shapes below follow the published contract and are covered by
 * deterministic mocked tests; see the production-verification list in the
 * architecture doc.
 */

export class BinanceDerivativesError extends Error {}

/** Binance's own host for USDⓈ-M futures. Overridable for tests only. */
const DEFAULT_BASE_URL = 'https://fapi.binance.com';

/**
 * TTLs. Open interest is republished continuously but a trader reading an
 * analytics page does not need sub-15s resolution, and the point of the
 * cache is that 100 readers cost one request. Funding and positioning move
 * far more slowly still — funding settles on an 8h boundary and the
 * ratio endpoints aggregate in 5-minute buckets, so polling faster than
 * the bucket cannot return anything new.
 */
const OPEN_INTEREST_TTL_MS = 15_000;
const OPEN_INTEREST_STALE_MS = 120_000;
const PREMIUM_TTL_MS = 30_000;
const PREMIUM_STALE_MS = 300_000;
const RATIO_TTL_MS = 60_000;
/**
 * A rolling 24h window barely moves second to second, and the Futures
 * header polls it. 30s is far below the resolution of the figure and
 * still collapses a burst of readers into one request.
 */
const TICKER_TTL_MS = 30_000;
const TICKER_STALE_MS = 300_000;
const RATIO_STALE_MS = 600_000;

/** The sampling bucket asked of the ratio endpoints. Named in the payload
 *  so the UI can state the window rather than implying "now". */
export const RATIO_PERIOD = '5m';

const RATIO_PATH: Record<LongShortRatioKind, string> = {
  global_account: '/futures/data/globalLongShortAccountRatio',
  top_account: '/futures/data/topLongShortAccountRatio',
  top_position: '/futures/data/topLongShortPositionRatio',
};

/** Base asset -> Binance USDⓈ-M perpetual symbol. An explicit map, not a
 *  string concatenation: `${base}USDT` would happily invent a contract
 *  that Binance does not list. */
const CONTRACT: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  XRP: 'XRPUSDT',
  BNB: 'BNBUSDT',
  DOGE: 'DOGEUSDT',
  ADA: 'ADAUSDT',
  AVAX: 'AVAXUSDT',
  LINK: 'LINKUSDT',
  LTC: 'LTCUSDT',
};

export function binanceContractFor(baseAsset: string): string | null {
  return CONTRACT[baseAsset.toUpperCase()] ?? null;
}

interface PremiumIndexRow {
  markPrice: number | null;
  indexPrice: number | null;
  lastFundingRate: number | null;
  nextFundingTime: number | null;
}

export class BinanceDerivativesService {
  private readonly http: HttpProviderClient;
  private readonly health: ProviderHealth;
  private readonly openInterestCache: ProviderCache<number | null>;
  private readonly premiumCache: ProviderCache<PremiumIndexRow>;
  private readonly ratioCache: ProviderCache<Omit<LongShortRatio, 'fetchedAt' | 'stale'>>;
  private readonly tickerCache: ProviderCache<number | null>;

  constructor(
    private readonly baseUrl: string = DEFAULT_BASE_URL,
    options: { fetchFn?: typeof fetch; policy?: ProviderRequestPolicy; now?: () => number } = {}
  ) {
    // A circuit of its own, named apart from the `binance` circuit
    // ArbitrageService owns: the two read different endpoint families, and
    // spot arbitrage rate-limiting must not blind the derivatives page.
    this.health = providerHealthRegistry.register(
      new ProviderHealth('binance-derivatives', { onStateChange: logCircuitTransition, now: options.now })
    );
    this.http = new HttpProviderClient('Binance Derivatives', {
      health: this.health,
      fetchFn: options.fetchFn,
      now: options.now,
      retries: options.policy?.retries,
      baseDelayMs: options.policy?.baseDelayMs,
      maxDelayMs: options.policy?.maxDelayMs,
      sleep: options.policy?.sleep,
      wrapError: (message) => new BinanceDerivativesError(message),
    });
    const cache = { now: options.now, maxEntries: 60 };
    this.openInterestCache = new ProviderCache({ ttlMs: OPEN_INTEREST_TTL_MS, maxStaleMs: OPEN_INTEREST_STALE_MS, ...cache });
    this.premiumCache = new ProviderCache({ ttlMs: PREMIUM_TTL_MS, maxStaleMs: PREMIUM_STALE_MS, ...cache });
    this.ratioCache = new ProviderCache({ ttlMs: RATIO_TTL_MS, maxStaleMs: RATIO_STALE_MS, ...cache });
    this.tickerCache = new ProviderCache({ ttlMs: TICKER_TTL_MS, maxStaleMs: TICKER_STALE_MS, ...cache });
  }

  /** Open interest in BASE units. Binance does not return a USD notional
   *  on this endpoint, so `openInterestUsd` is filled by the aggregator
   *  from this venue's own mark price — never from another venue's. */
  async getOpenInterest(baseAsset: string): Promise<VenueOpenInterest | null> {
    const contract = binanceContractFor(baseAsset);
    if (contract === null) return null;

    const [oi, premium] = await Promise.all([
      this.openInterestCache.fetch(contract, async () => {
        const body = (await this.http.getJson(
          `${this.baseUrl}/fapi/v1/openInterest?symbol=${encodeURIComponent(contract)}`
        )) as { openInterest?: unknown };
        return numeric(body?.openInterest);
      }),
      // Priced with Binance's OWN mark price, so a Binance notional is a
      // Binance figure end to end.
      this.premium(contract).catch(() => null),
    ]);

    const base = oi.value;
    const mark = premium?.value.markPrice ?? null;
    return {
      venue: 'binance',
      contract,
      baseAsset: baseAsset.toUpperCase(),
      openInterestBase: base,
      openInterestUsd: base !== null && mark !== null ? base * mark : null,
      fetchedAt: oi.fetchedAt,
      stale: oi.stale,
    };
  }

  /**
   * 24h turnover in quote currency, straight from Binance's own field.
   *
   * `quoteVolume` on `/fapi/v1/ticker/24hr` IS the quote-currency
   * turnover for the contract — so it is used verbatim. It is deliberately
   * NOT reconstructed as `lastPrice x volume`: that product is an
   * approximation of a number the venue already reports exactly, and the
   * two disagree whenever price moved during the window.
   *
   * A real 0 (a contract that genuinely did not trade) stays 0. Anything
   * unparseable becomes null, which the aggregate treats as "this venue
   * did not tell us" rather than as zero turnover.
   */
  async getTurnover24h(baseAsset: string): Promise<VenueTurnover | null> {
    const contract = binanceContractFor(baseAsset);
    if (contract === null) return null;
    const cached = await this.tickerCache.fetch(contract, async () => {
      const body = (await this.http.getJson(
        `${this.baseUrl}/fapi/v1/ticker/24hr?symbol=${encodeURIComponent(contract)}`
      )) as Record<string, unknown> | Record<string, unknown>[];
      const row = (Array.isArray(body) ? body[0] : body) ?? {};
      if (typeof row !== 'object') throw new BinanceDerivativesError('Binance Derivatives returned a malformed 24h ticker');
      return numeric((row as Record<string, unknown>).quoteVolume);
    });
    return {
      venue: 'binance',
      contract,
      baseAsset: baseAsset.toUpperCase(),
      turnover24hUsd: cached.value,
      fetchedAt: cached.fetchedAt,
      stale: cached.stale,
    };
  }

  async getFunding(baseAsset: string): Promise<VenueFunding | null> {
    const contract = binanceContractFor(baseAsset);
    if (contract === null) return null;
    const row = await this.premium(contract);
    return {
      venue: 'binance',
      contract,
      fundingRate: row.value.lastFundingRate,
      nextFundingTime: row.value.nextFundingTime,
      // Binance USDⓈ-M perpetuals settle on a fixed 8h cadence. Left null
      // rather than asserted, because this endpoint does not state it and
      // guessing a convention is how a wrong number gets published.
      intervalHours: null,
      fetchedAt: row.fetchedAt,
      stale: row.stale,
    };
  }

  async getBasis(baseAsset: string): Promise<VenueBasis | null> {
    const contract = binanceContractFor(baseAsset);
    if (contract === null) return null;
    const row = await this.premium(contract);
    const { markPrice, indexPrice } = row.value;
    return {
      venue: 'binance',
      contract,
      markPrice,
      indexPrice,
      basisPercent:
        markPrice !== null && indexPrice !== null && indexPrice !== 0
          ? ((markPrice - indexPrice) / indexPrice) * 100
          : null,
      fetchedAt: row.fetchedAt,
      stale: row.stale,
    };
  }

  /**
   * One positioning ratio. The three kinds are separate endpoints with
   * separate meanings and are never merged — see `LongShortRatioKind`.
   *
   * A row whose proportions are not numbers is rejected outright rather
   * than defaulted: there is no 50/50 fallback anywhere in this file,
   * because "we do not know" and "the market is balanced" are different
   * statements.
   */
  async getLongShortRatio(baseAsset: string, kind: LongShortRatioKind): Promise<LongShortRatio | null> {
    const contract = binanceContractFor(baseAsset);
    if (contract === null) return null;
    const key = `${kind}:${contract}`;
    const cached = await this.ratioCache.fetch(key, async () => {
      const url = `${this.baseUrl}${RATIO_PATH[kind]}?symbol=${encodeURIComponent(contract)}&period=${RATIO_PERIOD}&limit=1`;
      const body = (await this.http.getJson(url)) as unknown;
      if (!Array.isArray(body) || body.length === 0) {
        throw new BinanceDerivativesError('Binance Derivatives returned no positioning rows');
      }
      // Newest last when a range is returned; with limit=1 there is one.
      const row = body[body.length - 1] as Record<string, unknown>;
      const longAccount = numeric(row.longAccount);
      const shortAccount = numeric(row.shortAccount);
      const longShortRatio = numeric(row.longShortRatio);
      if (longAccount === null && shortAccount === null && longShortRatio === null) {
        throw new BinanceDerivativesError('Binance Derivatives positioning row carried no usable proportions');
      }
      return {
        venue: 'binance' as const,
        contract,
        kind,
        longAccount,
        shortAccount,
        longShortRatio,
        period: RATIO_PERIOD,
        observedAt: numeric(row.timestamp),
      };
    });
    return { ...cached.value, fetchedAt: cached.fetchedAt, stale: cached.stale };
  }

  /** Mark, index, current funding rate and next funding time in ONE call —
   *  premiumIndex carries all four, so basis and funding for the same
   *  contract cost one request between them, not two. */
  private premium(contract: string) {
    return this.premiumCache.fetch(contract, async () => {
      const body = (await this.http.getJson(
        `${this.baseUrl}/fapi/v1/premiumIndex?symbol=${encodeURIComponent(contract)}`
      )) as Record<string, unknown> | Record<string, unknown>[];
      // The endpoint answers an object for a single symbol; tolerate the
      // array form rather than crashing on it.
      const row = (Array.isArray(body) ? body[0] : body) ?? {};
      if (typeof row !== 'object') throw new BinanceDerivativesError('Binance Derivatives returned a malformed premium index');
      const r = row as Record<string, unknown>;
      return {
        markPrice: numeric(r.markPrice),
        indexPrice: numeric(r.indexPrice),
        lastFundingRate: numeric(r.lastFundingRate),
        nextFundingTime: numeric(r.nextFundingTime),
      };
    });
  }
}
