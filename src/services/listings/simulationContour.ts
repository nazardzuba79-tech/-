/**
 * The historical demo contour (PR #518): a managed listing whose price,
 * after its planned growth and final fall, repeats imported historical
 * hourly moves. Such a market is a model, not an asset. It has no identity
 * in the real ledger:
 *
 * - every real-money path already treats it as a restricted test asset
 *   (Spot orders, deposits, withdrawals, balance adjustments, futures
 *   collateral, demo orders — testAssetConfig.isTestAssetPairOrSymbol);
 * - in addition its MODEL PRICE is never read by a real-money path: no Spot
 *   order or simulation sale, no conditional-order trigger, no wallet or
 *   card valuation;
 * - it never holds real inventory: no owner allocation, ever.
 *
 * Publication itself stays refused (HISTORICAL_RIGHTS_UNVERIFIED in
 * checkPublishable). These refusals do not depend on that gate: they hold
 * even if a historical listing ever reaches the published catalogue.
 * Pure: no IO, no clock.
 *
 * A History20 growth window (`growth: 'historical-window'`) is NOT in this
 * contour: it is only the price path of an ordinary scenario listing, priced,
 * charted and traded by the existing Spot mechanism under the rules every
 * scenario listing has. Its publication is refused separately by
 * checkPublishable (HISTORICAL_RIGHTS_UNVERIFIED) until the rights are cleared.
 */
import type { TestAssetConfig } from '../testMarkets/testAssetConfig';
import type { ListingConfig } from './listingConfig';

export const HISTORICAL_DEMO_NO_LEDGER = 'HISTORICAL_DEMO_NO_LEDGER';
export const HISTORICAL_DEMO_MESSAGE = 'This market is a historical simulation: it has no balances, orders or valuation.';

/** A listing configuration in the historical demo contour. */
export function isHistoricalDemoConfig(config: Pick<ListingConfig, 'simulationProgram'>): boolean {
  const program = config.simulationProgram;
  return program?.kind === 'scenario-controls-v2' && program.afterGrowth === 'historical';
}

/** The same test for the simulation input Render keeps (listingSimulationConfig). */
export function isHistoricalDemoAsset(asset: TestAssetConfig | null | undefined): boolean {
  const scenario = asset?.scheduledScenario;
  return scenario?.mode === 'scenario-controls-v2' && scenario.controls.afterGrowth === 'historical';
}
