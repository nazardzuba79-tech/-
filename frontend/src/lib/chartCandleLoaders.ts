/**
 * The product's candle loaders by source, for lib/chartCapabilities: Futures
 * (Bybit linear via the API or the market edge), Spot (Kraken or the edge), and
 * the test-market simulation (VTA on the API host, NRX and the managed listings
 * on the edge). The one place the chart surfaces take them from.
 */
import type { CandleLoaderTable } from './chartCapabilities';
import { getFuturesCandles } from './futuresCandles';
import { getSpotPublicCandles } from './spotPublicMarket';
import { testMarketCandleLoader } from './testMarketCandles';
import { isTestMarketPair } from './testMarkets';
import { testMarketListingAt } from './testMarketStore';

export const CHART_CANDLE_LOADERS: CandleLoaderTable = Object.freeze({
  futures: getFuturesCandles,
  spot: getSpotPublicCandles,
  testMarket: testMarketCandleLoader,
});

/** Where an instrument's history starts (epoch seconds), when the product knows it: a test market's listing. Venue pairs: unknown. */
export function candleHistoryStart(market: 'spot' | 'futures', pair: string): number | undefined {
  if (market !== 'spot' || !isTestMarketPair(pair)) return undefined;
  const at = testMarketListingAt(pair);
  return at === null ? undefined : Math.floor(at / 1000);
}
