/**
 * TEST ASSETS — simulated markets that exist only to exercise the trading
 * terminal and the chart engine.
 *
 * Public display prices come from one deterministic simulation, never a
 * venue. VTA retains its private sale-only account. NRX uses ordinary Spot
 * balances/orders by explicit owner choice, but display depth is not liquidity.
 * Shared restrictions still exclude these assets from other financial paths.
 */

import { NEURIX } from './neurix';
import { managedListingAssets } from '../listings/managedSnapshot';
import type { SimulationProfile } from './simulationRealism';

export interface TestAssetConfig {
  /** Base asset ticker, e.g. VTA. */
  symbol: string;
  /** Display name, e.g. VOLTORA. */
  name: string;
  quote: 'USDT';
  /** The pair as the rest of VOLTEX spells it: `VTA/USDT`. */
  pair: string;
  isTestAsset: true;
  isTradable: boolean;
  /** Operational gate. False holds the asset before its listing: no countdown, candles or automatic listing. */
  listingArmed: boolean;
  /** First simulated tick, epoch ms. Used only after listingArmed is true. */
  listingAt: number;
  /** The simulated listing price, in quote units. */
  initialPrice: number;
  /** Changing the seed changes the whole history; the same seed always gives the same candles. */
  seed: string;
  /**
   * How candles look inside each hour (simulationRealism.ts). Never moves an
   * hour anchor or the final price. Absent: the original intra-hour path.
   */
  simulationProfile?: SimulationProfile;
  /** Re-rolls the realism layer's look without touching the anchors. Default 0. */
  realismSeedOffset?: number;
}

export const VOLTORA: TestAssetConfig = {
  symbol: 'VTA',
  name: 'VOLTORA',
  quote: 'USDT',
  pair: 'VTA/USDT',
  isTestAsset: true,
  isTradable: false,
  // Armed on the owner's request (2026-09-26): the countdown runs to
  // `listingAt`. TEST_MARKET_LISTING_ARMED=0 on the server holds it again
  // (no countdown, no candles) without a code change.
  listingArmed: process.env.TEST_MARKET_LISTING_ARMED !== '0',
  // Owner postponed the original countdown by one hour on 2026-09-28.
  listingAt: Date.parse('2026-09-28T15:00:00Z'),
  initialPrice: 0.01,
  seed: 'voltora-2026-09-27',
  // Candle character only (owner, 2026-09-29): impulses, breakouts out of
  // consolidation, pullbacks and long wicks. Every hour anchor, P48 and the
  // listing schedule are unchanged; see simulationRealism.ts.
  simulationProfile: 'IMPULSE_TREND',
};

// Render's existing public listing. NRX metadata is owned exclusively by the edge.
export const TEST_ASSETS: readonly TestAssetConfig[] = [VOLTORA];

/** The single sentence every refused trading action shows. */
export const TEST_ASSET_NOT_TRADABLE_MESSAGE = 'VOLTORA is a test asset and is not available for trading.';

function normalizePair(pair: string): string {
  return pair.trim().toUpperCase().replace(/[-_]/g, '/').replace(/^([A-Z0-9]+)(USDT)$/, '$1/$2');
}

/** The test asset behind a pair (`VTA/USDT`, `VTAUSDT`, `vta-usdt`), if any. */
export function testAssetForPair(pair: string | null | undefined): TestAssetConfig | null {
  if (!pair) return null;
  const normalized = normalizePair(pair);
  return [NEURIX, ...TEST_ASSETS, ...managedListingAssets()].find((asset) => asset.pair === normalized) ?? null;
}

/** The test asset behind a bare symbol (`VTA`), if any. */
export function testAssetForSymbol(symbol: string | null | undefined): TestAssetConfig | null {
  if (!symbol) return null;
  const normalized = symbol.trim().toUpperCase();
  return [NEURIX, ...TEST_ASSETS, ...managedListingAssets()].find((asset) => asset.symbol === normalized) ?? null;
}

/** Restricted-asset guard (VTA, NRX and every published managed listing). Only ordinary Spot admits listed NRX and tradable managed listings. */
export function isTestAssetPairOrSymbol(value: string | null | undefined): boolean {
  return testAssetForPair(value) !== null || testAssetForSymbol(value) !== null;
}
