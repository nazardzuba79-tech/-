import type { PriceSource } from '../OrderService';
import { isRetiredNrx, NRX_RETIRED_MESSAGE } from '../../shared/nrxRetirement';
import { simulationFor } from './testMarketSimulation';
import { isTestAssetPairOrSymbol, testAssetForPair, TEST_ASSET_NOT_TRADABLE_MESSAGE } from './testAssetConfig';
import { managedListingAssets } from '../listings/managedSnapshot';
import { managedListingRegistry } from '../listings/registry';
import { isAith } from '../../shared/aithPublication';

const managedListingForPair = (pair: string) => {
  const asset = testAssetForPair(pair);
  return asset && managedListingAssets().includes(asset) ? asset : null;
};

/**
 * Tradable managed listings use ordinary Spot accounts/orders; NRX is retired; display
 * depth is NEVER executable liquidity. Before its listing time a listed pair
 * refuses orders; a non-tradable one refuses them always.
 */
export function assertSpotListing(pair: string, now = Date.now()): void {
  if (isAith(pair.replace(/[_-]/g, '/').replace(/^AITHUSDT$/i, 'AITH/USDT'))) throw new Error('Aitheron AI is not available for trading.');
  if (isRetiredNrx(pair)) throw new Error(NRX_RETIRED_MESSAGE);
  const managed = managedListingForPair(pair);
  if (managed) {
    if (!managed.isTradable) throw new Error(`${managed.name} is not available for trading.`);
    if (!managed.listingArmed || now < managed.listingAt) throw new Error('Trading has not started yet');
    return;
  }
  if (isTestAssetPairOrSymbol(pair)) throw new Error(TEST_ASSET_NOT_TRADABLE_MESSAGE);
}

/** The same gate after making sure Render knows the current published listings (bounded wait). */
export async function assertSpotListingReady(pair: string, now?: number): Promise<void> {
  if (isRetiredNrx(pair)) throw new Error(NRX_RETIRED_MESSAGE);
  await managedListingRegistry.ensureFresh();
  assertSpotListing(pair, now);
}

/** Same canonical price as Cloudflare, used for conditional Spot validation/triggering. */
export function spotPriceSource(source: PriceSource, clock = Date.now): PriceSource {
  return { getTicker: async (pair) => {
    if (isRetiredNrx(pair)) return null;
    const managed = managedListingForPair(pair);
    if (isAith(pair) && !managed) return null;
    if (!managed) return source.getTicker(pair);
    // Unarmed managed listings cannot supply a model price for order triggers.
    if (!managed.listingArmed) return null;
    const last = simulationFor(managed).priceAt(clock());
    return last === null ? null : { lastPrice: String(last) };
  } };
}
