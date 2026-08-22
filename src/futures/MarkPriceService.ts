import BigNumber from 'bignumber.js';
import { KrakenMarketDataService } from '../services/KrakenMarketDataService';

// How much weight each new basis sample gets in the EMA — small alpha means
// the mark price moves smoothly rather than jumping on every single trade,
// which is the entire point of having a mark price separate from last
// price: a manipulator can't move it with one trade against thin liquidity.
const BASIS_EMA_ALPHA = 0.2;

/**
 * Mark price = index price (real spot, from Kraken) + a smoothed basis
 * (how far our own internal futures book's last trade sits from that
 * index). PnL and liquidation are computed off THIS, never off the last
 * futures trade price directly — otherwise anyone could wick a thin
 * internal order book to trigger other users' liquidations.
 *
 * Until this contract has actually traded, there's no basis to speak of,
 * so mark price is simply the index price — an honest "no data yet"
 * default rather than a fabricated basis.
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
    const ticker = await this.marketData.getTicker(symbol);
    if (!ticker) return null;
    const price = new BigNumber(ticker.lastPrice);
    if (!price.isFinite() || price.isLessThanOrEqualTo(0)) return null;
    this.lastIndexPrice.set(symbol, price);
    return price;
  }

  async getMarkPrice(symbol: string): Promise<BigNumber | null> {
    const index = await this.getIndexPrice(symbol);
    if (!index) return null;
    const basis = this.basisEma.get(symbol) ?? new BigNumber(0);
    return index.plus(basis);
  }
}
