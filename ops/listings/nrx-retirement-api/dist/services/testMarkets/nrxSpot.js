"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertSpotListing = assertSpotListing;
exports.assertSpotListingReady = assertSpotListingReady;
exports.spotPriceSource = spotPriceSource;
const nrxRetirement_1 = require("../../shared/nrxRetirement");
const testMarketSimulation_1 = require("./testMarketSimulation");
const testAssetConfig_1 = require("./testAssetConfig");
const managedSnapshot_1 = require("../listings/managedSnapshot");
const registry_1 = require("../listings/registry");
const aithPublication_1 = require("../../shared/aithPublication");
const managedListingForPair = (pair) => {
    const asset = (0, testAssetConfig_1.testAssetForPair)(pair);
    return asset && (0, managedSnapshot_1.managedListingAssets)().includes(asset) ? asset : null;
};
/**
 * Tradable managed listings use ordinary Spot accounts/orders; NRX is retired; display
 * depth is NEVER executable liquidity. Before its listing time a listed pair
 * refuses orders; a non-tradable one refuses them always.
 */
function assertSpotListing(pair, now = Date.now()) {
    if ((0, aithPublication_1.isAith)(pair.replace(/[_-]/g, '/').replace(/^AITHUSDT$/i, 'AITH/USDT')))
        throw new Error('Aitheron AI is not available for trading.');
    if ((0, nrxRetirement_1.isRetiredNrx)(pair))
        throw new Error(nrxRetirement_1.NRX_RETIRED_MESSAGE);
    const managed = managedListingForPair(pair);
    if (managed) {
        if (!managed.isTradable)
            throw new Error(`${managed.name} is not available for trading.`);
        if (!managed.listingArmed || now < managed.listingAt)
            throw new Error('Trading has not started yet');
        return;
    }
    if ((0, testAssetConfig_1.isTestAssetPairOrSymbol)(pair))
        throw new Error(testAssetConfig_1.TEST_ASSET_NOT_TRADABLE_MESSAGE);
}
/** The same gate after making sure Render knows the current published listings (bounded wait). */
async function assertSpotListingReady(pair, now) {
    if ((0, nrxRetirement_1.isRetiredNrx)(pair))
        throw new Error(nrxRetirement_1.NRX_RETIRED_MESSAGE);
    await registry_1.managedListingRegistry.ensureFresh();
    assertSpotListing(pair, now);
}
/** Same canonical price as Cloudflare, used for conditional Spot validation/triggering. */
function spotPriceSource(source, clock = Date.now) {
    return { getTicker: async (pair) => {
            if ((0, nrxRetirement_1.isRetiredNrx)(pair))
                return null;
            const managed = managedListingForPair(pair);
            if ((0, aithPublication_1.isAith)(pair) && !managed)
                return null;
            if (!managed)
                return source.getTicker(pair);
            // Unarmed managed listings cannot supply a model price for order triggers.
            if (!managed.listingArmed)
                return null;
            const last = (0, testMarketSimulation_1.simulationFor)(managed).priceAt(clock());
            return last === null ? null : { lastPrice: String(last) };
        } };
}
//# sourceMappingURL=nrxSpot.js.map