import type { PriceSource } from '../OrderService';
import { NEURIX } from './neurix';
import { simulationFor } from './testMarketSimulation';
import { isTestAssetPairOrSymbol, testAssetForPair, TEST_ASSET_NOT_TRADABLE_MESSAGE } from './testAssetConfig';
import { managedListingAssets } from '../listings/managedSnapshot';
import { managedListingRegistry } from '../listings/registry';
import { HISTORICAL_DEMO_MESSAGE, isHistoricalDemoAsset } from '../listings/simulationContour';
import { isAith } from '../../shared/aithPublication';
import { canUsePrivateTestListing } from '../listings/privateTestAccess';

export const managedListingForPair = (pair: string) => {
  const asset = testAssetForPair(pair);
  return asset && managedListingAssets().includes(asset) ? asset : null;
};

/**
 * NRX and tradable managed listings use ordinary Spot accounts/orders; display
 * depth is NEVER executable liquidity. Before its listing time a listed pair
 * refuses orders; a non-tradable one refuses them always.
 *
 * A History20 private test listing (quoted in SIMUSDT) is the one narrow
 * exception to "non-tradable": while the mode is on it admits the verified
 * owner and the allowlisted testers (canUsePrivateTestListing) and nobody
 * else, any ADMIN included. Without a user it is refused like any
 * non-tradable listing.
 */
export function assertSpotListing(pair: string, now = Date.now(), userId?: string): void {
  if (isAith(pair.replace(/[_-]/g, '/').replace(/^AITHUSDT$/i, 'AITH/USDT'))) throw new Error('Aitheron AI is not available for trading.');
  if (pair === NEURIX.pair) {
    if (!NEURIX.listingArmed || now < NEURIX.listingAt) throw new Error('Trading has not started yet');
    return;
  }
  const managed = managedListingForPair(pair);
  if (managed) {
    if (isHistoricalDemoAsset(managed)) throw new Error(HISTORICAL_DEMO_MESSAGE);
    if (managed.privateTest) {
      if (!canUsePrivateTestListing(userId)) throw new Error(`${managed.name} is not available for trading.`);
      if (now < managed.listingAt) throw new Error('Trading has not started yet');
      return;
    }
    if (!managed.isTradable) throw new Error(`${managed.name} is not available for trading.`);
    if (now < managed.listingAt) throw new Error('Trading has not started yet');
    return;
  }
  if (isTestAssetPairOrSymbol(pair)) throw new Error(TEST_ASSET_NOT_TRADABLE_MESSAGE);
}

/** The same gate after making sure Render knows the current published listings (bounded wait). */
export async function assertSpotListingReady(pair: string, now?: number, userId?: string): Promise<void> {
  await managedListingRegistry.ensureFresh();
  assertSpotListing(pair, now, userId);
}

/** Same canonical price as Cloudflare, used for conditional Spot validation/triggering. */
export function spotPriceSource(source: PriceSource, clock = Date.now): PriceSource {
  return { getTicker: async (pair) => {
    if (pair === NEURIX.pair) {
      const last = NEURIX.listingArmed ? simulationFor(NEURIX).priceAt(clock()) : null;
      return last === null ? null : { lastPrice: String(last) };
    }
    const managed = managedListingForPair(pair);
    if (isAith(pair) && !managed) return null;
    if (!managed) return source.getTicker(pair);
    // A historical model price never triggers a real conditional order.
    if (isHistoricalDemoAsset(managed)) return null;
    const last = simulationFor(managed).priceAt(clock());
    return last === null ? null : { lastPrice: String(last) };
  } };
}
