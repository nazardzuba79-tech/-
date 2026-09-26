/**
 * TEST ASSETS — simulated markets that exist only to exercise the trading
 * terminal and the chart engine.
 *
 * A test asset is listed like any Spot market (Markets, Search, Favorites,
 * the Spot terminal) but it is never tradable: it has no order book, no
 * matching, no balances, no deposits and no withdrawals. Its prices come
 * from a deterministic, seeded simulation on the server
 * (`testMarketSimulation.ts`) — never from a venue and never from trades.
 */

export interface TestAssetConfig {
  /** Base asset ticker, e.g. VTA. */
  symbol: string;
  /** Display name, e.g. VOLTORA. */
  name: string;
  quote: 'USDT';
  /** The pair as the rest of VOLTEX spells it: `VTA/USDT`. */
  pair: string;
  isTestAsset: true;
  isTradable: false;
  /** Operational gate. False keeps the asset visible in preview forever: no countdown, candles or automatic listing. */
  listingArmed: boolean;
  /** First simulated tick, epoch ms. Used only after listingArmed is true. */
  listingAt: number;
  /** The simulated listing price, in quote units. */
  initialPrice: number;
  /** Changing the seed changes the whole history; the same seed always gives the same candles. */
  seed: string;
}

export const VOLTORA: TestAssetConfig = {
  symbol: 'VTA',
  name: 'VOLTORA',
  quote: 'USDT',
  pair: 'VTA/USDT',
  isTestAsset: true,
  isTradable: false,
  // Production stays frozen until the owner explicitly asks to start the listing.
  // Jest uses NODE_ENV=test so the existing deterministic simulation suites keep exercising live phases.
  listingArmed: process.env.NODE_ENV === 'test' || process.env.TEST_MARKET_LISTING_ARMED === '1',
  listingAt: Date.parse('2026-09-27T16:00:00Z'),
  initialPrice: 0.01,
  seed: 'voltora-2026-09-27',
};

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
  return TEST_ASSETS.find((asset) => asset.pair === normalized) ?? null;
}

/** The test asset behind a bare symbol (`VTA`), if any. */
export function testAssetForSymbol(symbol: string | null | undefined): TestAssetConfig | null {
  if (!symbol) return null;
  const normalized = symbol.trim().toUpperCase();
  return TEST_ASSETS.find((asset) => asset.symbol === normalized) ?? null;
}

/** True when the pair or symbol names a test asset — the one check every trading path uses. */
export function isTestAssetPairOrSymbol(value: string | null | undefined): boolean {
  return testAssetForPair(value) !== null || testAssetForSymbol(value) !== null;
}
