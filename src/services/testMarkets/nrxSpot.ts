import type { PriceSource } from '../OrderService';
import { NEURIX } from './neurix';
import { simulationFor } from './testMarketSimulation';
import { isTestAssetPairOrSymbol, TEST_ASSET_NOT_TRADABLE_MESSAGE } from './testAssetConfig';

/** NRX uses ordinary Spot accounts/orders; display depth is NEVER executable liquidity. */
export function assertSpotListing(pair: string, now = Date.now()): void {
  if (pair === NEURIX.pair) {
    if (!NEURIX.listingArmed || now < NEURIX.listingAt) throw new Error('Trading has not started yet');
    return;
  }
  if (isTestAssetPairOrSymbol(pair)) throw new Error(TEST_ASSET_NOT_TRADABLE_MESSAGE);
}

/** Same canonical price as Cloudflare, used for conditional Spot validation/triggering. */
export function spotPriceSource(source: PriceSource, clock = Date.now): PriceSource {
  return { getTicker: async (pair) => {
    if (pair !== NEURIX.pair) return source.getTicker(pair);
    const last = NEURIX.listingArmed ? simulationFor(NEURIX).priceAt(clock()) : null;
    return last === null ? null : { lastPrice: String(last) };
  } };
}
