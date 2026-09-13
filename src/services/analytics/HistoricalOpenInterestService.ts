import { ProviderCache } from '../marketData/ProviderCache';
import {
  HttpProviderClient,
  ProviderHealth,
  logCircuitTransition,
  providerHealthRegistry,
  type ProviderRequestPolicy,
} from '../marketData/ProviderHealth';
import { available, unavailable, type Availability } from '../marketData/types';
import { numeric } from '../marketData/derivatives/types';

const DEFAULT_BASE_URL = 'https://fapi.binance.com';
const CACHE_TTL_MS = 5 * 60_000;
const MAX_STALE_MS = 30 * 60_000;
const PERIOD = '1h';
const LIMIT = 168;

const CONTRACT: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  XRP: 'XRPUSDT',
};

export interface OpenInterestHistoryPoint {
  observedAt: number;
  openInterestBase: number;
  openInterestUsd: number | null;
}

export interface OpenInterestHistoryValue {
  baseAsset: string;
  contract: string;
  period: '1h';
  lookbackHours: 168;
  points: OpenInterestHistoryPoint[];
}

/**
 * Real historical USDⓈ-M open interest for the four Analytics assets.
 *
 * Binance publishes `/futures/data/openInterestHist` as public market data.
 * The endpoint returns both base-unit OI and `sumOpenInterestValue`, so the
 * historical USD series is never reconstructed with a different venue's
 * price. No account key, signature or trading permission is used here.
 */
export class HistoricalOpenInterestService {
  readonly health: ProviderHealth;
  private readonly http: HttpProviderClient;
  private readonly cache: ProviderCache<OpenInterestHistoryValue>;

  constructor(
    private readonly baseUrl = DEFAULT_BASE_URL,
    options: { fetchFn?: typeof fetch; policy?: ProviderRequestPolicy; now?: () => number } = {}
  ) {
    this.health = providerHealthRegistry.register(
      new ProviderHealth('binance-oi-history', { onStateChange: logCircuitTransition, now: options.now })
    );
    this.http = new HttpProviderClient('Binance OI History', {
      health: this.health,
      fetchFn: options.fetchFn,
      now: options.now,
      retries: options.policy?.retries,
      baseDelayMs: options.policy?.baseDelayMs,
      maxDelayMs: options.policy?.maxDelayMs,
      sleep: options.policy?.sleep,
    });
    this.cache = new ProviderCache({
      ttlMs: CACHE_TTL_MS,
      maxStaleMs: MAX_STALE_MS,
      maxEntries: 4,
      now: options.now,
    });
  }

  async getHistory(baseAsset: string): Promise<Availability<OpenInterestHistoryValue>> {
    const asset = baseAsset.toUpperCase();
    const contract = CONTRACT[asset];
    if (!contract) return unavailable('unsupported_metric', `Open-interest history is not available for ${asset}.`);
    try {
      const cached = await this.cache.fetch(asset, () => this.fetchHistory(asset, contract));
      return available({
        value: cached.value,
        source: 'binance',
        fetchedAt: cached.fetchedAt,
        stale: cached.stale,
      });
    } catch {
      return unavailable('provider_unavailable', 'Historical open interest could not be read.');
    }
  }

  private async fetchHistory(baseAsset: string, contract: string): Promise<OpenInterestHistoryValue> {
    const url = `${this.baseUrl}/futures/data/openInterestHist?symbol=${encodeURIComponent(contract)}&period=${PERIOD}&limit=${LIMIT}`;
    const body = (await this.http.getJson(url)) as unknown;
    if (!Array.isArray(body)) throw new Error('Historical open-interest response is not an array');

    const points = body
      .map((raw) => {
        if (!raw || typeof raw !== 'object') return null;
        const row = raw as Record<string, unknown>;
        const observedAt = numeric(row.timestamp);
        const openInterestBase = numeric(row.sumOpenInterest);
        const openInterestUsd = numeric(row.sumOpenInterestValue);
        if (observedAt === null || observedAt <= 0 || openInterestBase === null || openInterestBase < 0) return null;
        return { observedAt, openInterestBase, openInterestUsd } satisfies OpenInterestHistoryPoint;
      })
      .filter((point): point is OpenInterestHistoryPoint => point !== null)
      .sort((a, b) => a.observedAt - b.observedAt);

    if (points.length < 2) throw new Error('Historical open-interest response has too few valid points');
    return { baseAsset, contract, period: PERIOD, lookbackHours: LIMIT, points };
  }
}
