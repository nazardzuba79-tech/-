import type { MarketCandle } from '../KrakenMarketDataService';
import { ProviderCache } from './ProviderCache';

const INTERVAL_SECONDS = 15 * 60;
const DAY_SECONDS = 86400;
export const SPOT_REFERENCE_BATCH_LIMIT = 6;
type CandleReader = { getCandles(pair: string, interval: string, limit: number): Promise<MarketCandle[]> };
export type SpotPeriodReference = { price: number; time: number };
export type SpotPairReferences = { pair: string; day: SpotPeriodReference | null; week: SpotPeriodReference | null };

/** Last completed close at/before the rolling boundary; never a candle high,
 * low, UTC open, interpolated price, or a reference from a different quote.
 * Fifteen-minute candles cover both boundaries in the provider's 720 rows.
 * The explicit timestamp exposes the <15-minute historical resolution. */
export function completedPeriodReference(candles: readonly MarketCandle[], cutoff: number): SpotPeriodReference | null {
  let reference: SpotPeriodReference | null = null;
  for (const candle of candles) {
    const time = candle.time + INTERVAL_SECONDS;
    if (!Number.isFinite(time) || !Number.isFinite(candle.close) || candle.close <= 0 || time > cutoff) continue;
    if (!reference || time > reference.time) reference = { price: candle.close, time };
  }
  return reference && cutoff - reference.time < INTERVAL_SECONDS ? reference : null;
}

/** Read-only cached history enrichment. Global concurrency/queue bounds and
 * same-bucket in-flight dedupe prevent each visitor multiplying OHLC work. */
export class SpotPeriodReferenceService {
  private readonly cache: ProviderCache<SpotPairReferences>;
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly market: CandleReader, private readonly now = () => Date.now()) {
    this.cache = new ProviderCache({ ttlMs: 15 * 60_000, maxEntries: 1200, now });
  }
  private async limited<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= 3) {
      if (this.queue.length >= 60) throw new Error('Market history capacity reached');
      await new Promise<void>(resolve => this.queue.push(resolve));
    } else this.active += 1;
    try { return await work(); }
    finally {
      const next = this.queue.shift();
      if (next) next(); else this.active -= 1;
    }
  }
  async references(pairs: readonly string[]): Promise<{ asOf: number; resolutionSeconds: number; references: SpotPairReferences[] }> {
    const asOf = this.now();
    const seconds = asOf / 1000;
    const bucket = Math.floor(seconds / INTERVAL_SECONDS);
    const references = await Promise.all(pairs.map(async pair => {
      try {
        return (await this.cache.fetch(`${pair}:${bucket}`, () => this.limited(async () => {
          const candles = await this.market.getCandles(pair, '15m', 720);
          return { pair, day: completedPeriodReference(candles, seconds - DAY_SECONDS), week: completedPeriodReference(candles, seconds - 7 * DAY_SECONDS) };
        }))).value;
      } catch { return { pair, day: null, week: null }; }
    }));
    return { asOf, resolutionSeconds: INTERVAL_SECONDS, references };
  }
}

export function parseSpotReferencePairs(query: Record<string, unknown>): string[] | null {
  const raw = query.pairs;
  if (Object.keys(query).some(key => key !== 'pairs') || typeof raw !== 'string' || raw.length > 260) return null;
  const pairs = [...new Set(raw.split(','))];
  return pairs.length > 0 && pairs.length <= SPOT_REFERENCE_BATCH_LIMIT && pairs.every(pair => /^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}$/.test(pair)) ? pairs : null;
}
