import type { PriceSource } from '../OrderService';
import { NEURIX } from './neurix';
import { simulationFor } from './testMarketSimulation';
import { isTestAssetPairOrSymbol, testAssetForPair, TEST_ASSET_NOT_TRADABLE_MESSAGE } from './testAssetConfig';
import { managedListingAssets } from '../listings/managedSnapshot';
import { managedListingRegistry } from '../listings/registry';

const managedListingForPair = (pair: string) => {
  const asset = testAssetForPair(pair);
  return asset && managedListingAssets().includes(asset) ? asset : null;
};

/**
 * NRX and tradable managed listings use ordinary Spot accounts/orders; display
 * depth is NEVER executable liquidity. Before its listing time a listed pair
 * refuses orders; a non-tradable one refuses them always.
 */
export function assertSpotListing(pair: string, now = Date.now()): void {
  if (pair === NEURIX.pair) {
    if (!NEURIX.listingArmed || now < NEURIX.listingAt) throw new Error('Trading has not started yet');
    return;
  }
  const managed = managedListingForPair(pair);
  if (managed) {
    if (!managed.isTradable) throw new Error(`${managed.name} is not available for trading.`);
    if (now < managed.listingAt) throw new Error('Trading has not started yet');
    return;
  }
  if (isTestAssetPairOrSymbol(pair)) throw new Error(TEST_ASSET_NOT_TRADABLE_MESSAGE);
}

/** The same gate after making sure Render knows the current published listings (bounded wait). */
export async function assertSpotListingReady(pair: string, now?: number): Promise<void> {
  await managedListingRegistry.ensureFresh();
  assertSpotListing(pair, now);
}

/** Same canonical price as Cloudflare, used for conditional Spot validation/triggering. */
export function spotPriceSource(source: PriceSource, clock = Date.now): PriceSource {
  return { getTicker: async (pair) => {
    if (pair === NEURIX.pair) {
      const last = NEURIX.listingArmed ? simulationFor(NEURIX).priceAt(clock()) : null;
      return last === null ? null : { lastPrice: String(last) };
    }
    const managed = managedListingForPair(pair);
    if (!managed) return source.getTicker(pair);
    const last = simulationFor(managed).priceAt(clock());
    return last === null ? null : { lastPrice: String(last) };
  } };
}
