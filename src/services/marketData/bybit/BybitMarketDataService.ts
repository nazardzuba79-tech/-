import { ProviderCache, type CachedValue } from '../ProviderCache';
import {
  HttpProviderClient,
  ProviderHealth,
  logCircuitTransition,
  providerHealthRegistry,
} from '../ProviderHealth';
import type {
  InstrumentFilters,
  InstrumentStatus,
  MarketType,
  NormalizedInstrument,
  NormalizedTicker,
} from './types';

export class BybitMarketDataError extends Error {}

/** Bybit's documented public host. Overridable for tests only. */
const DEFAULT_BASE_URL = 'https://api.bybit.com';

/**
 * TTLs.
 *
 * The instrument universe changes when a listing changes — days, not
 * seconds — so it is cached for 15 minutes with a long stale budget. The
 * stale budget is the point: if Bybit becomes unreachable, the exchange
 * keeps the universe it already had rather than emptying.
 *
 * Tickers are a different question and get seconds, because they are a
 * price.
 */
const INSTRUMENTS_TTL_MS = 15 * 60_000;
const INSTRUMENTS_STALE_MS = 24 * 60 * 60_000;
const TICKERS_TTL_MS = 5_000;
const TICKERS_STALE_MS = 120_000;

/**
 * Cursor pagination bounds.
 *
 * `limit=1000` is Bybit's documented maximum for instruments-info, so the
 * linear universe costs single-digit requests rather than dozens. The page
 * ceiling and the seen-cursor set are not paranoia: a cursor that repeats,
 * or one that never empties, is an infinite loop against a live upstream,
 * and this process must not be the thing that hammers a venue.
 */
const PAGE_LIMIT = 1000;
const MAX_PAGES = 40;

/** Bybit `category` values this adapter reads. */
export type BybitCategory = 'spot' | 'linear';

interface BybitEnvelope {
  time?: unknown;
  retCode?: unknown;
  retMsg?: unknown;
  result?: { list?: unknown; nextPageCursor?: unknown } | null;
}

/** A finite number, or null. Never 0 as a stand-in for "absent". */
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/** A non-empty trimmed string, or null. */
function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Epoch ms, treating Bybit's "0" placeholder as absent. A perpetual has
 *  no delivery time; reporting one of 1970-01-01 would be a fabrication. */
function epoch(value: unknown): number | null {
  const parsed = num(value);
  return parsed === null || parsed <= 0 ? null : parsed;
}

/** Decimal places implied by a step like "0.001" -> 3. Null when the venue
 *  published no step, because guessing a precision is guessing a rounding
 *  rule that an order would then be validated against. */
function precisionOf(step: number | null): number | null {
  if (step === null || !Number.isFinite(step) || step <= 0) return null;
  const text = step.toFixed(12).replace(/0+$/, '');
  const dot = text.indexOf('.');
  if (dot === -1) return 0;
  return text.length - dot - 1;
}

const STATUSES: InstrumentStatus[] = ['Trading', 'PreLaunch', 'Delivering', 'Closed', 'Settling'];

function statusOf(value: unknown): InstrumentStatus {
  const text = str(value);
  return (STATUSES as string[]).includes(text ?? '') ? (text as InstrumentStatus) : 'Unknown';
}

/**
 * Contract type -> VOLTEX market type.
 *
 * A table, not a `.includes('Perpetual')` test. `LinearFutures` is a DATED
 * contract that expires and delivers; reading it as a perpetual because
 * its name starts with "Linear" is precisely the mistake that would put an
 * expiring instrument into a perpetual engine.
 */
const CONTRACT_TYPE: Record<string, MarketType> = {
  LinearPerpetual: 'linear_perpetual',
  LinearFutures: 'linear_futures',
  InversePerpetual: 'inverse',
  InverseFutures: 'inverse',
};

export interface BybitMarketDataOptions {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Injected in tests so retry backoff does not sleep. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Read-only mirror of Bybit's PUBLIC V5 market endpoints.
 *
 * No API key: every endpoint used here is documented public market data.
 * This never places, cancels or influences an order anywhere.
 *
 * ── Geo-restriction, stated plainly ──────────────────────────────────
 *
 * Bybit refuses public traffic from some server regions, and the current
 * production backend runs in a region where that is a live possibility.
 * This adapter does nothing to work around it — no proxy, no alternate
 * host, no spoofed origin. A refusal is a provider failure like any other:
 * the circuit opens, the cached universe keeps serving inside its stale
 * budget, and `available: false` reaches the caller. Nothing is fabricated
 * and nothing is hardcoded about any particular region, so moving the
 * backend needs no change here.
 */
export class BybitMarketDataService {
  private readonly http: HttpProviderClient;
  private readonly health: ProviderHealth;
  private readonly baseUrl: string;
  private readonly instrumentsCache: ProviderCache<NormalizedInstrument[]>;
  private readonly tickersCache: ProviderCache<NormalizedTicker[]>;
  /** Upstream HTTP requests this process has made. Used by the tests that
   *  prove the universe is not built one-request-per-instrument. */
  private requestCount = 0;

  constructor(options: BybitMarketDataOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.health = providerHealthRegistry.register(
      new ProviderHealth('bybit', { onStateChange: logCircuitTransition, now: options.now })
    );
    this.http = new HttpProviderClient('bybit', {
      health: this.health,
      fetchFn: async (url, init) => {
        this.requestCount += 1;
        return (options.fetchFn ?? fetch)(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(10_000) });
      },
      now: options.now,
      sleep: options.sleep,
      wrapError: (message) => new BybitMarketDataError(message),
    });
    this.instrumentsCache = new ProviderCache<NormalizedInstrument[]>({
      ttlMs: INSTRUMENTS_TTL_MS,
      maxStaleMs: INSTRUMENTS_STALE_MS,
      maxEntries: 8,
      now: options.now,
    });
    this.tickersCache = new ProviderCache<NormalizedTicker[]>({
      ttlMs: TICKERS_TTL_MS,
      maxStaleMs: TICKERS_STALE_MS,
      maxEntries: 8,
      now: options.now,
    });
  }

  get upstreamRequestCount(): number {
    return this.requestCount;
  }

  get healthSnapshot() {
    return this.health.snapshot();
  }

  /**
   * Unwraps Bybit's envelope.
   *
   * Bybit answers HTTP 200 with `retCode !== 0` for real failures, so the
   * transport layer alone cannot tell success from failure — the same trap
   * OKX sets. Treating a non-zero retCode as success would turn an error
   * body into an empty instrument list, which is the "outage becomes an
   * empty exchange" failure this whole file is built to prevent.
   */
  private async call(path: string): Promise<{ list: unknown[]; nextPageCursor: string | null; eventAt: number | null }> {
    const body = (await this.http.getJson(`${this.baseUrl}${path}`)) as BybitEnvelope | null;
    if (!body || typeof body !== 'object') {
      throw new BybitMarketDataError('Bybit returned a malformed response');
    }
    const code = num(body.retCode);
    if (code !== 0) {
      throw new BybitMarketDataError(`Bybit returned retCode ${String(body.retCode)}: ${String(body.retMsg ?? '')}`);
    }
    const list = body.result?.list;
    if (!Array.isArray(list)) {
      throw new BybitMarketDataError('Bybit response carried no instrument list');
    }
    return { list, nextPageCursor: str(body.result?.nextPageCursor), eventAt: epoch(body.time) };
  }

  private normalizeInstrument(raw: unknown, category: BybitCategory): NormalizedInstrument | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;

    // Provider metadata is the source of truth. An instrument that does not
    // publish its own base and quote is rejected rather than reconstructed
    // by slicing the symbol string.
    const providerSymbol = str(row.symbol);
    const baseAsset = str(row.baseCoin)?.toUpperCase() ?? null;
    const quoteAsset = str(row.quoteCoin)?.toUpperCase() ?? null;
    if (!providerSymbol || !baseAsset || !quoteAsset) return null;

    let marketType: MarketType;
    if (category === 'spot') {
      marketType = 'spot';
    } else {
      const mapped = CONTRACT_TYPE[str(row.contractType) ?? ''];
      // An unrecognised contract type is not assumed to be a perpetual.
      if (!mapped) return null;
      marketType = mapped;
    }

    const priceFilter = (row.priceFilter ?? {}) as Record<string, unknown>;
    const lotFilter = (row.lotSizeFilter ?? {}) as Record<string, unknown>;
    const leverageFilter = (row.leverageFilter ?? {}) as Record<string, unknown>;

    // Spot and derivatives name the same concepts differently; both are
    // read explicitly rather than merged behind one guessed key.
    const tickSize = num(priceFilter.tickSize);
    const qtyStep = num(lotFilter.qtyStep) ?? num(lotFilter.basePrecision);
    const filters: InstrumentFilters = {
      tickSize,
      qtyStep,
      minOrderQty: num(lotFilter.minOrderQty),
      maxOrderQty: num(lotFilter.maxOrderQty),
      minNotional: num(lotFilter.minNotionalValue) ?? num(lotFilter.minOrderAmt),
      maxNotional: num(lotFilter.maxOrderAmt),
      pricePrecision: precisionOf(tickSize),
      qtyPrecision: precisionOf(qtyStep),
    };

    return {
      symbol: `${baseAsset}/${quoteAsset}`,
      providerSymbol,
      provider: 'bybit',
      marketType,
      baseAsset,
      quoteAsset,
      settleAsset: category === 'spot' ? null : (str(row.settleCoin)?.toUpperCase() ?? null),
      status: statusOf(row.status),
      launchTime: epoch(row.launchTime),
      deliveryTime: epoch(row.deliveryTime),
      filters,
      providerMaxLeverage: num(leverageFilter.maxLeverage),
      fundingIntervalMinutes: num(row.fundingInterval),
    };
  }

  /**
   * Deterministic de-duplication.
   *
   * Two rows can normalize to the same canonical symbol — most obviously a
   * perpetual and a dated future on the same pair. They are distinct
   * instruments, so the key includes the market type; only a genuine
   * duplicate collapses, and the FIRST occurrence wins so repeated calls
   * over identical input produce identical output.
   */
  private dedupe(instruments: NormalizedInstrument[]): NormalizedInstrument[] {
    const seen = new Map<string, NormalizedInstrument>();
    for (const instrument of instruments) {
      const key = `${instrument.marketType}:${instrument.symbol}:${instrument.providerSymbol}`;
      if (!seen.has(key)) seen.set(key, instrument);
    }
    return [...seen.values()];
  }

  /**
   * Spot instruments. ONE request.
   *
   * Bybit's spot instruments-info does not support cursor pagination, so
   * asking for a second page would either loop on the same data or invent
   * one. It is deliberately not run through the paginator.
   */
  async listSpotInstruments(): Promise<CachedValue<NormalizedInstrument[]>> {
    return this.instrumentsCache.fetch('instruments:spot', async () => {
      const { list } = await this.call('/v5/market/instruments-info?category=spot');
      const normalized = list
        .map((row) => this.normalizeInstrument(row, 'spot'))
        .filter((x): x is NormalizedInstrument => x !== null);
      return this.dedupe(normalized);
    });
  }

  /**
   * Linear instruments, fully paginated.
   *
   * Bybit's linear category holds well over 500 contracts and one response
   * is NOT the universe. This follows `nextPageCursor` to exhaustion, with
   * three independent stops so a misbehaving upstream cannot spin:
   *
   *   - no cursor, or an empty page      -> done, normally
   *   - a cursor already seen            -> stop; the upstream is looping
   *   - MAX_PAGES reached                -> stop; something is wrong
   *
   * The last two are treated as errors rather than as a short universe,
   * because silently returning half the exchange is worse than failing and
   * keeping the previous good set.
   */
  async listLinearInstruments(): Promise<CachedValue<NormalizedInstrument[]>> {
    return this.instrumentsCache.fetch('instruments:linear', async () => {
      const collected: NormalizedInstrument[] = [];
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      let pages = 0;

      for (;;) {
        const query = `category=linear&limit=${PAGE_LIMIT}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const page: { list: unknown[]; nextPageCursor: string | null } =
          await this.call(`/v5/market/instruments-info?${query}`);
        pages += 1;

        for (const row of page.list) {
          const instrument = this.normalizeInstrument(row, 'linear');
          if (instrument) collected.push(instrument);
        }

        const next = page.nextPageCursor;
        if (!next || page.list.length === 0) break;
        if (seenCursors.has(next)) {
          throw new BybitMarketDataError('Bybit returned a repeating pagination cursor');
        }
        seenCursors.add(next);
        if (pages >= MAX_PAGES) {
          throw new BybitMarketDataError(`Bybit pagination exceeded ${MAX_PAGES} pages`);
        }
        cursor = next;
      }

      return this.dedupe(collected);
    });
  }

  private normalizeTicker(raw: unknown, category: BybitCategory): NormalizedTicker | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as Record<string, unknown>;
    const providerSymbol = str(row.symbol);
    if (!providerSymbol) return null;

    // Bybit publishes a FRACTION (0.021 = +2.1%); VOLTEX carries a
    // percentage everywhere. Converted once, here.
    const fraction = num(row.price24hPcnt);

    return {
      symbol: providerSymbol,
      providerSymbol,
      marketType: category === 'spot' ? 'spot' : 'linear_perpetual',
      lastPrice: num(row.lastPrice),
      bidPrice: num(row.bid1Price),
      askPrice: num(row.ask1Price),
      high24h: num(row.highPrice24h),
      low24h: num(row.lowPrice24h),
      volume24h: num(row.volume24h),
      quoteVolume24h: num(row.turnover24h),
      changePercent24h: fraction === null ? null : fraction * 100,
      indexPrice: num(row.indexPrice),
      markPrice: num(row.markPrice),
      fundingRate: num(row.fundingRate),
      openInterest: num(row.openInterest),
      openInterestValue: num(row.openInterestValue),
      fundingIntervalMinutes: num(row.fundingIntervalHour) === null ? null : num(row.fundingIntervalHour)! * 60,
    };
  }

  /**
   * Every ticker in a category, in ONE request.
   *
   * Bybit's tickers endpoint returns the whole category when no symbol is
   * given. Nothing here fans out per instrument, and the cache's in-flight
   * coalescing means concurrent readers share that single request.
   */
  async getTickers(category: BybitCategory): Promise<CachedValue<NormalizedTicker[]>> {
    return this.tickersCache.fetch(`tickers:${category}`, async () => {
      const { list, eventAt } = await this.call(`/v5/market/tickers?category=${category}`);
      return list
        .map((row) => this.normalizeTicker(row, category))
        .filter((x): x is NormalizedTicker => x !== null)
        .map(row => ({ ...row, providerEventAt: eventAt }));
    });
  }
}
