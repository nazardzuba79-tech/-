import type { PriceSource } from '../OrderService';
import { NEURIX } from './neurix';
import { simulationFor } from './testMarketSimulation';
import { isSimulationSettled, isTestAssetPairOrSymbol, SIMULATION_QUOTE, testAssetForPair, TEST_ASSET_NOT_TRADABLE_MESSAGE } from './testAssetConfig';
import { managedListingAssets } from '../listings/managedSnapshot';
import { managedListingRegistry, type ManagedListingRegistry } from '../listings/registry';
import { HISTORICAL_DEMO_MESSAGE, isHistoricalDemoAsset } from '../listings/simulationContour';
import { isAith } from '../../shared/aithPublication';

export const managedListingForPair = (pair: string) => {
  const asset = testAssetForPair(pair);
  return asset && managedListingAssets().includes(asset) ? asset : null;
};

/**
 * NRX and tradable managed listings use ordinary Spot accounts/orders; display
 * depth is NEVER executable liquidity. Before its listing time a listed pair
 * refuses orders; a non-tradable one refuses them always.
 *
 * A History20 private test market (`privateTest`, quoted exactly in SIMUSDT)
 * is the one narrow exception to "non-tradable": it admits a caller the
 * database verified as a participant while the mode is on
 * (privateTest.privateTestAdmitted, passed in as `privateAdmitted`), and
 * refuses everyone else like any non-tradable listing.
 */
export function assertSpotListing(pair: string, now = Date.now(), privateAdmitted = false): void {
  if (isAith(pair.replace(/[_-]/g, '/').replace(/^AITHUSDT$/i, 'AITH/USDT'))) throw new Error('Aitheron AI is not available for trading.');
  if (pair === NEURIX.pair) {
    if (!NEURIX.listingArmed || now < NEURIX.listingAt) throw new Error('Trading has not started yet');
    return;
  }
  const managed = managedListingForPair(pair);
  if (managed) {
    if (isHistoricalDemoAsset(managed)) throw new Error(HISTORICAL_DEMO_MESSAGE);
    if (managed.privateTest && managed.quote === SIMULATION_QUOTE && pair === managed.pair) {
      if (!privateAdmitted) throw new Error(`${managed.name} is not available for trading.`);
      if (now < managed.listingAt) throw new Error('Trading has not started yet');
      return;
    }
    // SIMUSDT and a reserved private ticker never trade as an ordinary managed listing, whatever the registry says.
    if (isSimulationSettled(pair)) throw new Error(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    if (!managed.isTradable) throw new Error(`${managed.name} is not available for trading.`);
    // Unarmed = the pre-listing timer is not running (staged or paused): the market never opens by itself.
    if (!managed.listingArmed || now < managed.listingAt) throw new Error('Trading has not started yet');
    return;
  }
  if (isTestAssetPairOrSymbol(pair)) throw new Error(TEST_ASSET_NOT_TRADABLE_MESSAGE);
}

/** Refusal while Render cannot tell whether a pair is a managed listing; customers see a localized «temporarily unavailable». */
export const SPOT_PAIR_UNRESOLVED_MESSAGE = 'Операция временно недоступна';

/**
 * The same gate after making sure Render knows the current published
 * listings (bounded wait). While it does not (cold start, failed or slow
 * reads, a stale snapshot), default deny: a pair that is not NRX, not a known
 * listing or test asset and has no venue price may be a Worker-only managed
 * listing, and is never traded as an ordinary pair. Venue-priced pairs
 * (BTC/USDT…) are unaffected.
 */
export async function assertSpotListingReady(pair: string, venue: PriceSource, now?: number,
  registry: Pick<ManagedListingRegistry, 'ensureFresh' | 'resolved'> = managedListingRegistry, privateAdmitted = false): Promise<void> {
  await registry.ensureFresh();
  assertSpotListing(pair, now, privateAdmitted);
  if (registry.resolved() || pair === NEURIX.pair || managedListingForPair(pair)) return;
  const ticker = await venue.getTicker(pair).catch(() => null);
  if (!ticker) throw new Error(SPOT_PAIR_UNRESOLVED_MESSAGE);
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
    // A private-test pair the registry does not know (cold, stale) has no price: never the venue's.
    if (!managed) return isSimulationSettled(pair) ? null : source.getTicker(pair);
    // A historical model price never triggers a real conditional order.
    // A listing closed to new public orders (tradable:false) keeps its model
    // price for already-resting conditional orders: bot training relies on it.
    if (isHistoricalDemoAsset(managed) || !managed.listingArmed) return null;
    const last = simulationFor(managed).priceAt(clock());
    return last === null ? null : { lastPrice: String(last) };
  } };
}
