import BigNumber from 'bignumber.js';
import { KrakenMarketDataService } from '../services/KrakenMarketDataService';

const BASIS_EMA_ALPHA = 0.2;
const INDEX_READ_TIMEOUT_MS = 5_000;

export class MarkPriceService {
  private basisEma = new Map<string, BigNumber>();
  private lastIndexPrice = new Map<string, BigNumber>();
  /** Concurrent readers of one symbol share the same fresh upstream read. No value is cached here. */
  private indexReads = new Map<string, Promise<BigNumber | null>>();

  constructor(private marketData: KrakenMarketDataService) {}

  recordFuturesTrade(symbol: string, tradePrice: BigNumber) {
    const index = this.lastIndexPrice.get(symbol);
    if (!index || index.isZero()) return;
    const basis = tradePrice.minus(index);
    const prevEma = this.basisEma.get(symbol);
    const nextEma = prevEma
      ? prevEma.times(1 - BASIS_EMA_ALPHA).plus(basis.times(BASIS_EMA_ALPHA))
      : basis;
    this.basisEma.set(symbol, nextEma);
  }

  async getIndexPrice(symbol: string): Promise<BigNumber | null> {
    const existing = this.indexReads.get(symbol);
    if (existing) return existing;
    const read = this.readIndexPrice(symbol);
    this.indexReads.set(symbol, read);
    try { return await read; }
    finally { if (this.indexReads.get(symbol) === read) this.indexReads.delete(symbol); }
  }

  private async readIndexPrice(symbol: string): Promise<BigNumber | null> {
    try {
      // A mark/index read is a single-market operation. Reading best bid/ask
      // avoids coupling it to the full Kraken ticker-universe refresh, which
      // can be slow on a cold cache. Midpoint is a real market observation;
      // if the book is unavailable we return no value rather than inventing one.
      const bookReader = (this.marketData as KrakenMarketDataService & {
        getOrderBook?: (pair: string, limit?: number) => Promise<{ bids?: { price: string }[]; asks?: { price: string }[] }>;
      }).getOrderBook;

      if (typeof bookReader === 'function') {
        const book = await withTimeout(bookReader.call(this.marketData, symbol, 1), INDEX_READ_TIMEOUT_MS);
        const bid = new BigNumber(book?.bids?.[0]?.price ?? NaN);
        const ask = new BigNumber(book?.asks?.[0]?.price ?? NaN);
        if (bid.isFinite() && ask.isFinite() && bid.isGreaterThan(0) && ask.isGreaterThan(0)) {
          const midpoint = bid.plus(ask).dividedBy(2);
          if (midpoint.isFinite() && midpoint.isGreaterThan(0)) {
            this.lastIndexPrice.set(symbol, midpoint);
            return midpoint;
          }
        }
      }

      // Compatibility fallback for tests/older adapters that only expose a
      // ticker read. It is bounded by the same timeout and never produces a
      // synthetic fallback value.
      const ticker = await withTimeout(this.marketData.getTicker(symbol), INDEX_READ_TIMEOUT_MS);
      if (!ticker) return null;
      const price = new BigNumber(ticker.lastPrice);
      if (!price.isFinite() || price.isLessThanOrEqualTo(0)) return null;
      this.lastIndexPrice.set(symbol, price);
      return price;
    } catch (err) {
      console.error(`[MarkPriceService] Failed to fetch index price for ${symbol}:`, err);
      return null;
    }
  }

  async getMarkPrice(symbol: string): Promise<BigNumber | null> {
    const index = await this.getIndexPrice(symbol);
    if (!index) return null;
    const basis = this.basisEma.get(symbol) ?? new BigNumber(0);
    return index.plus(basis);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Market data read timed out after ${timeoutMs}ms`)), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
