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
  private cache: { reading: FearGreedReading; expiresAt: number } | null = null;

  constructor(
    private readonly baseUrl = 'https://api.alternative.me',
    private readonly fetchFn: typeof fetch = fetch
  ) {}

  /** Latest published reading. Serves the last good snapshot on a failed
   * refresh (the index only moves once a day, so a stale one is still the
   * correct number far more often than not); only a first-ever call
   * throws. */
  async getIndex(): Promise<FearGreedReading> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.reading;

    let payload: FearGreedResponse;
    try {
      const res = await this.fetchFn(`${this.baseUrl}/fng/?limit=1`);
      if (!res.ok) throw new FearGreedError(`Fear & Greed API responded with HTTP ${res.status}`);
      payload = (await res.json()) as FearGreedResponse;
    } catch (err: any) {
      if (this.cache) return this.cache.reading;
      if (err instanceof FearGreedError) throw err;
      throw new FearGreedError(`Failed to reach the Fear & Greed API: ${err.message}`);
    }

    const row = payload?.data?.[0];
    const value = Number(row?.value);
    // The API reports the value as a string; anything outside 0-100 means
    // the shape changed under us and is not worth rendering as an index.
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      if (this.cache) return this.cache.reading;
      throw new FearGreedError('Fear & Greed API returned no usable value');
    }

    const timestamp = Number(row?.timestamp);
    const reading: FearGreedReading = {
      value,
      classification: row?.value_classification || 'Neutral',
      updatedAt: Number.isFinite(timestamp) ? timestamp : Math.floor(Date.now() / 1000),
    };
    this.cache = { reading, expiresAt: Date.now() + TTL_MS };
    return reading;
  }
}
