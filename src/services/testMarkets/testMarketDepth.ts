import BigNumber from 'bignumber.js';
import { seededRandom, TICK_MS, type TestMarketSimulation } from './testMarketSimulation';

/** Display depth only. Execution continues to use VtaDemoSales and its server price. */
export function testMarketDepth(simulation: TestMarketSimulation, now: number) {
  const { asset } = simulation;
  const empty = { source: 'simulation', pair: asset.pair, isTestAsset: true, available: false,
    bids: [] as { price: string; quantity: string }[], asks: [] as { price: string; quantity: string }[], timestamp: now };
  const current = simulation.priceAt(now);
  if (current === null) return empty;
  const bucket = Math.floor((now - asset.listingAt) / TICK_MS);
  // Same down-to-10-decimals rule as the existing authoritative MARKET SELL.
  const bid = new BigNumber(current).decimalPlaces(10, BigNumber.ROUND_DOWN);
  const quantum = new BigNumber('0.0000000001');
  const step = BigNumber.maximum(quantum, bid.times('0.0002').decimalPlaces(10, BigNumber.ROUND_UP));
  const spread = step.times(2);
  const sides = (side: 'bid' | 'ask') => Array.from({ length: 25 }, (_, level) => {
    const random = seededRandom(asset.seed, 'display-depth', bucket, side, level);
    const price = side === 'bid' ? bid.minus(step.times(level)) : bid.plus(spread).plus(step.times(level));
    // Independent bounded variation, with larger quote size generally deeper in the book.
    const quoteSize = (80 + level * 28) * (0.8 + random() * 0.4);
    return { price: BigNumber.maximum(quantum, price).toFixed(10),
      quantity: new BigNumber(quoteSize).div(price).decimalPlaces(8, BigNumber.ROUND_DOWN).toFixed(8) };
  });
  return { ...empty, available: true, bids: sides('bid'), asks: sides('ask'), timestamp: asset.listingAt + bucket * TICK_MS };
}
