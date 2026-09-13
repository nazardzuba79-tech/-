import { ProviderCache, type CachedValue } from '../marketData/ProviderCache';
import {
  HttpProviderClient,
  ProviderHealth,
  type ProviderRequestPolicy,
  logCircuitTransition,
  providerHealthRegistry,
} from '../marketData/ProviderHealth';
import { available, unavailable, type Availability } from '../marketData/types';

const CACHE_TTL_MS = 30_000;
const MAX_STALE_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365.25 * DAY_MS;
const SUPPORTED = new Set(['BTC', 'ETH']);

export interface ImpliedVolatilityValue {
  baseAsset: string;
  current: number;
  open24h: number | null;
  high24h: number | null;
  low24h: number | null;
  change24hPercent: number | null;
  resolutionSeconds: number;
  points: number;
}

export interface FuturesCurvePoint {
  instrument: string;
  expiryAt: number;
  markPrice: number;
  referencePrice: number;
  basisPercent: number;
  annualizedBasisPercent: number;
  openInterest: number | null;
}

export interface FuturesTermStructureValue {
  baseAsset: string;
  referencePrice: number;
  points: FuturesCurvePoint[];
}

interface DeribitRpc<T> {
  jsonrpc?: string;
  result?: T;
  error?: { code?: number; message?: string; data?: unknown };
}

interface DeribitFutureInstrument {
  instrument_name: string;
  kind: string;
  is_active: boolean;
  settlement_period?: string;
  expiration_timestamp: number;
}

interface DeribitBookSummary {
  instrument_name: string;
  mark_price: number | null;
  open_interest?: number | null;
  estimated_delivery_price?: number | null;
  underlying_price?: number | null;
}

export class DeribitAnalyticsService {
  readonly health: ProviderHealth;
  private readonly http: HttpProviderClient;
  private readonly ivCache: ProviderCache<ImpliedVolatilityValue>;
  private readonly curveCache: ProviderCache<FuturesTermStructureValue>;

  constructor(
    private readonly baseUrl = 'https://www.deribit.com/api/v2',
    fetchFn: typeof fetch = fetch,
    policy: ProviderRequestPolicy = {}
  ) {
    this.health = providerHealthRegistry.register(
      new ProviderHealth('deribit', { onStateChange: logCircuitTransition })
    );
    this.http = new HttpProviderClient('Deribit', {
      ...policy,
      fetchFn,
      health: this.health,
    });
    const onStaleServe = (key: string, ageMs: number) =>
      console.warn(`[marketData] deribit serving stale ${key} (${Math.round(ageMs / 1000)}s old)`);
    this.ivCache = new ProviderCache({
      ttlMs: CACHE_TTL_MS,
      maxStaleMs: MAX_STALE_MS,
      maxEntries: 4,
      onStaleServe,
    });
    this.curveCache = new ProviderCache({
      ttlMs: CACHE_TTL_MS,
      maxStaleMs: MAX_STALE_MS,
      maxEntries: 4,
      onStaleServe,
    });
  }

  async getImpliedVolatility(baseAsset: string): Promise<Availability<ImpliedVolatilityValue>> {
    const asset = baseAsset.toUpperCase();
    if (!SUPPORTED.has(asset)) {
      return unavailable('unsupported_metric', `Deribit volatility index is not available for ${asset}.`);
    }
    try {
      const cached = await this.ivCache.fetch(asset, () => this.fetchImpliedVolatility(asset));
      return available({ value: cached.value, source: 'deribit', fetchedAt: cached.fetchedAt, stale: cached.stale });
    } catch (error) {
      return unavailable('provider_unavailable', safeMessage(error));
    }
  }

  async getFuturesTermStructure(baseAsset: string): Promise<Availability<FuturesTermStructureValue>> {
    const asset = baseAsset.toUpperCase();
    if (!SUPPORTED.has(asset)) {
      return unavailable('unsupported_metric', `Deribit dated futures are not available for ${asset}.`);
    }
    try {
      const cached = await this.curveCache.fetch(asset, () => this.fetchFuturesTermStructure(asset));
      return available({ value: cached.value, source: 'deribit', fetchedAt: cached.fetchedAt, stale: cached.stale });
    } catch (error) {
      return unavailable('provider_unavailable', safeMessage(error));
    }
  }

  private async fetchImpliedVolatility(asset: string): Promise<ImpliedVolatilityValue> {
    const end = Date.now();
    const start = end - DAY_MS;
    const body = await this.request<{ data: [number, number, number, number, number][]; continuation?: number | null }>(
      '/public/get_volatility_index_data',
      {
        currency: asset,
        start_timestamp: start,
        end_timestamp: end,
        resolution: '3600',
      }
    );
    const rows = Array.isArray(body.data) ? body.data.filter(validVolatilityRow) : [];
    if (rows.length === 0) throw new Error(`Deribit returned no volatility index data for ${asset}`);

    const first = rows[0];
    const last = rows[rows.length - 1];
    const highs = rows.map((r) => r[2]).filter(finitePositive);
    const lows = rows.map((r) => r[3]).filter(finitePositive);
    const open24h = finitePositive(first[1]) ? first[1] : null;
    const current = last[4];
    if (!finitePositive(current)) throw new Error(`Deribit returned an invalid volatility index for ${asset}`);
    const change24hPercent = open24h && open24h !== 0 ? ((current - open24h) / open24h) * 100 : null;

    return {
      baseAsset: asset,
      current,
      open24h,
      high24h: highs.length ? Math.max(...highs) : null,
      low24h: lows.length ? Math.min(...lows) : null,
      change24hPercent: Number.isFinite(change24hPercent as number) ? change24hPercent : null,
      resolutionSeconds: 3600,
      points: rows.length,
    };
  }

  private async fetchFuturesTermStructure(asset: string): Promise<FuturesTermStructureValue> {
    const [instruments, summaries] = await Promise.all([
      this.request<DeribitFutureInstrument[]>('/public/get_instruments', {
        currency: asset,
        kind: 'future',
        expired: false,
      }),
      this.request<DeribitBookSummary[]>('/public/get_book_summary_by_currency', {
        currency: asset,
        kind: 'future',
      }),
    ]);

    const summaryByName = new Map(summaries.map((row) => [row.instrument_name, row]));
    const perpetual = summaries.find((row) => row.instrument_name === `${asset}-PERPETUAL`);
    const referencePrice = firstPositive(perpetual?.estimated_delivery_price, perpetual?.underlying_price);
    if (referencePrice === null) throw new Error(`Deribit returned no reference price for ${asset}`);

    const now = Date.now();
    const points: FuturesCurvePoint[] = instruments
      .filter((i) => i.kind === 'future' && i.is_active && i.settlement_period !== 'perpetual' && i.expiration_timestamp > now)
      .map((instrument) => {
        const summary = summaryByName.get(instrument.instrument_name);
        const markPrice = firstPositive(summary?.mark_price);
        const localReference = firstPositive(summary?.estimated_delivery_price, summary?.underlying_price, referencePrice);
        if (markPrice === null || localReference === null) return null;
        const timeToExpiryMs = instrument.expiration_timestamp - now;
        if (timeToExpiryMs <= 0) return null;
        const basisPercent = ((markPrice - localReference) / localReference) * 100;
        const annualizedBasisPercent = basisPercent * (YEAR_MS / timeToExpiryMs);
        if (!Number.isFinite(basisPercent) || !Number.isFinite(annualizedBasisPercent)) return null;
        return {
          instrument: instrument.instrument_name,
          expiryAt: instrument.expiration_timestamp,
          markPrice,
          referencePrice: localReference,
          basisPercent,
          annualizedBasisPercent,
          openInterest: finiteNonNegative(summary?.open_interest) ? Number(summary!.open_interest) : null,
        } satisfies FuturesCurvePoint;
      })
      .filter((p): p is FuturesCurvePoint => p !== null)
      .sort((a, b) => a.expiryAt - b.expiryAt);

    if (points.length === 0) throw new Error(`Deribit returned no active dated futures for ${asset}`);
    return { baseAsset: asset, referencePrice, points };
  }

  private async request<T>(path: string, params: Record<string, string | number | boolean>): Promise<T> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) query.set(key, String(value));
    const raw = (await this.http.getJson(`${this.baseUrl}${path}?${query}`)) as DeribitRpc<T>;
    if (raw.error) {
      throw new Error(`Deribit error${raw.error.code ? ` ${raw.error.code}` : ''}: ${raw.error.message ?? 'unknown error'}`);
    }
    if (raw.result === undefined) throw new Error('Deribit response has no result');
    return raw.result;
  }
}

function validVolatilityRow(row: unknown): row is [number, number, number, number, number] {
  return Array.isArray(row) && row.length >= 5 && row.slice(0, 5).every((v) => Number.isFinite(Number(v)));
}

function finitePositive(value: unknown): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function finiteNonNegative(value: unknown): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

function firstPositive(...values: unknown[]): number | null {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
}
