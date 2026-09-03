/**
 * The real Crypto Fear & Greed Index, mirrored from alternative.me's free
 * public API (no key, no signup — https://api.alternative.me/fng/).
 *
 * This is the number every other exchange and tracker displays under
 * "Fear & Greed", which is why it has to come from the same place rather
 * than being derived locally: the index is a weighted composite of price
 * volatility, market momentum/volume, social-media sentiment, BTC
 * dominance and search trends. Our own tickers can measure exactly one of
 * those inputs (momentum), so a locally-computed "share of pairs currently
 * green" number is a genuinely different metric that lands tens of points
 * away from the published index — real data, wrong label. That breakdown
 * is still shown next to this reading on the Markets page, under its own
 * honest label (Растут/Падают).
 *
 * The index is republished once a day (00:00 UTC), so the cache TTL below
 * is about keeping our own traffic polite, not freshness.
 *
 * NOT verified against the live API from this environment (this sandbox's
 * outbound proxy blocks third-party market hosts — same restriction
 * CoinGeckoService and the Kraken mirror carry); verify in production.
 */

import { ProviderCache } from './marketData/ProviderCache';
import {
  HttpProviderClient,
  ProviderHealth,
  ProviderRequestPolicy,
  ProviderUnavailableError,
  logCircuitTransition,
  providerHealthRegistry,
} from './marketData/ProviderHealth';

export class FearGreedError extends Error {}

export interface FearGreedReading {
  /** 0-100. 0 = extreme fear, 100 = extreme greed. */
  value: number;
  /** alternative.me's own bucket label: Extreme Fear | Fear | Neutral | Greed | Extreme Greed. */
  classification: string;
  /** Unix seconds, as published. */
  updatedAt: number;
}

const TTL_MS = 15 * 60_000;

interface FearGreedResponse {
  data?: { value?: string; value_classification?: string; timestamp?: string }[];
}

export class FearGreedService {
  // The index is republished once a day, so a reading that is hours past
  // its TTL is still very often the current published number — hence the
  // generous stale window. It is descriptive sentiment, never a price.
  private readonly cache = new ProviderCache<FearGreedReading>({
    ttlMs: TTL_MS,
    maxStaleMs: 24 * 60 * 60_000,
    maxEntries: 2,
    onStaleServe: (key, ageMs) =>
      console.warn(`[marketData] alternative.me serving stale ${key} (${Math.round(ageMs / 60_000)}m old)`),
  });
  private readonly http: HttpProviderClient;
  readonly health: ProviderHealth;

  constructor(
    private readonly baseUrl = 'https://api.alternative.me',
    private readonly fetchFn: typeof fetch = fetch,
    policy: ProviderRequestPolicy = {}
  ) {
    this.health = providerHealthRegistry.register(
      new ProviderHealth('alternative.me', { onStateChange: logCircuitTransition })
    );
    this.http = new HttpProviderClient('Fear & Greed API', {
      ...policy,
      fetchFn: this.fetchFn,
      health: this.health,
      wrapError: (message) => new FearGreedError(message),
    });
  }

  /** Latest published reading. Serves the last good snapshot on a failed
   * refresh (the index only moves once a day, so a stale one is still the
   * correct number far more often than not); only a first-ever call
   * throws. */
  async getIndex(): Promise<FearGreedReading> {
    const cached = await this.cache.fetch('latest', () => this.fetchIndex());
    return cached.value;
  }

  private async fetchIndex(): Promise<FearGreedReading> {
    let payload: FearGreedResponse;
    try {
      payload = (await this.http.getJson(`${this.baseUrl}/fng/?limit=1`)) as FearGreedResponse;
    } catch (err) {
      if (err instanceof ProviderUnavailableError) {
        throw new FearGreedError('The Fear & Greed API is temporarily unavailable');
      }
      throw err;
    }

    const row = payload?.data?.[0];
    const value = Number(row?.value);
    // The API reports the value as a string; anything outside 0-100 means
    // the shape changed under us and is not worth rendering as an index.
    // Throwing (rather than returning a made-up neutral 50) is what lets
    // the cache fall back to the last genuinely published reading.
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new FearGreedError('Fear & Greed API returned no usable value');
    }

    const timestamp = Number(row?.timestamp);
    return {
      value,
      classification: row?.value_classification || 'Neutral',
      updatedAt: Number.isFinite(timestamp) ? timestamp : Math.floor(Date.now() / 1000),
    };
  }
}
