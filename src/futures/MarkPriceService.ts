import BigNumber from 'bignumber.js';
import { KrakenMarketDataService } from '../services/KrakenMarketDataService';

// How much weight each new basis sample gets in the EMA — small alpha means
// the mark price moves smoothly rather than jumping on every single trade,
// which is the entire point of having a mark price separate from last
// price: a manipulator can't move it with one trade against thin liquidity.
const BASIS_EMA_ALPHA = 0.2;

// A single futures mark/index read must never wait on an unbounded upstream
// network request. The live best bid/ask endpoint normally returns well below
// this ceiling; if it does not, callers get an honest null/502 and can retry
// instead of leaving the terminal spinning indefinitely.
const INDEX_SOURCE_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`market data timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Mark price = index price (real Kraken spot best-bid/best-ask midpoint) + a
 * smoothed basis (how far our own internal futures book's last trade sits
 * from that index). Using the single-pair order book avoids coupling a BTC
 * mark-price request to a refresh of the entire spot ticker universe.
 *
 * PnL and liquidation are computed off THIS, never off the last futures trade
 * price directly — otherwise anyone could wick a thin internal order book to
 * trigger other users' liquidations.
 *
 * Until this contract has actually traded, there's no basis to speak of, so
 * mark price is simply the index price — an honest "no data yet" default
 * rather than a fabricated basis.
 */
export class MarkPriceService {
  private basisEma = new Map<string, BigNumber>();
  private lastIndexPrice = new Map<string, BigNumber>();

  constructor(private marketData: KrakenMarketDataService) {}

  /** Called by FuturesPositionService whenever the internal futures book
   * actually trades, so the basis reflects real activity. */
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
    // Production KrakenMarketDataService exposes getOrderBook. Some unit-test
    // doubles pre-date it and only expose getTicker, so retain that bounded
    // fallback for compatibility without putting production back on the slow
    // full-universe ticker path.
    const marketData = this.marketData as KrakenMarketDataService & {
      getOrderBook?: (pair: string, limit?: number) => Promise<{
        bids?: Array<{ price: string }>;
        asks?: Array<{ price: string }>;
      }>;
    };

    try {
      let price: BigNumber | null = null;

      if (typeof marketData.getOrderBook === 'function') {
        const book = await withTimeout(marketData.getOrderBook(symbol, 1), INDEX_SOURCE_TIMEOUT_MS);
        const bid = new BigNumber(book.bids?.[0]?.price ?? Number.NaN);
        const ask = new BigNumber(book.asks?.[0]?.price ?? Number.NaN);
        if (
          bid.isFinite() &&
          ask.isFinite() &&
          bid.isGreaterThan(0) &&
          ask.isGreaterThan(0) &&
          ask.isGreaterThanOrEqualTo(bid)
        ) {
          price = bid.plus(ask).dividedBy(2);
        }
      } else {
        const ticker = await withTimeout(this.marketData.getTicker(symbol), INDEX_SOURCE_TIMEOUT_MS);
        if (ticker) price = new BigNumber(ticker.lastPrice);
      }

      if (!price || !price.isFinite() || price.isLessThanOrEqualTo(0)) return null;
      this.lastIndexPrice.set(symbol, price);
      return price;
    } catch (err) {
      // This is called from background schedulers as well as HTTP routes. An
      // upstream outage/timeout must degrade to null rather than crash the
      // process or leave an HTTP request open indefinitely.
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
