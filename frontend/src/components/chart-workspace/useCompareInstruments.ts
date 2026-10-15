import { useEffect, useMemo, useState } from 'react';
import { marketDataStore } from '../../lib/marketDataStore';
import { futuresConfigStore, useFuturesConfig } from '../../lib/futuresConfigStore';
import { TEST_MARKET_LIST_INTERVAL_MS, useTestMarkets } from '../../lib/testMarketStore';
import { CFD_SYMBOLS } from '../../lib/cfdAssetIdentity';
import type { ChartMarket } from '../../lib/chartCapabilities';

/**
 * The instruments a chart can compare with or open in a second pane
 * (2026-10-13): Spot reads the shared market snapshot the pair list already
 * polls (no second poll of its own — it only reads what the store holds and
 * subscribes at the slowest cadence); Futures reads the shared /futures/config
 * listing. Spot also lists the live test markets (VTA, NRX, the managed
 * listings) the test-market stores already hold at their list cadence, so a
 * second pane or a compare line can hold a listing beside a venue pair
 * (2026-10-14). CFD lists its own catalogue (lib/cfdAssetIdentity, in
 * catalogue order: metals, energy, FX). Nothing here opens a connection of
 * its own.
 */
export function useCompareInstruments(market: ChartMarket, exclude: string[] = []): string[] {
  const [spotPairs, setSpotPairs] = useState<string[]>(() => (market === 'spot' ? [...marketDataStore.getState().tickers.keys()] : []));
  const futures = useFuturesConfig();
  const tests = useTestMarkets(TEST_MARKET_LIST_INTERVAL_MS, market === 'spot');
  useEffect(() => {
    if (market !== 'spot') return;
    // 60 s: the sidebar's own 4 s poll is what actually drives the store on the trade page.
    return marketDataStore.subscribe(state => setSpotPairs([...state.tickers.keys()]), 60000);
  }, [market]);
  useEffect(() => { if (market === 'futures') void futuresConfigStore; }, [market]);
  const liveTests = market === 'spot' ? tests.assets.filter(asset => asset.state.phase === 'live').map(asset => asset.pair) : [];
  return useMemo(() => {
    if (market === 'cfd') {
      const skip = new Set(exclude.map(p => p.toUpperCase()));
      return CFD_SYMBOLS.filter(symbol => !skip.has(symbol));
    }
    const list = market === 'spot' ? [...spotPairs, ...liveTests] : (futures.config?.symbols ?? ['BTC/USDT', 'ETH/USDT', 'SOL/USDT']);
    const skip = new Set(exclude.map(p => p.toUpperCase()));
    return [...new Set(list.map(p => p.toUpperCase()))].filter(p => /^[A-Z0-9]{1,32}\/[A-Z0-9]{2,12}$/.test(p) && !skip.has(p)).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, spotPairs, futures.config, exclude.join('|'), liveTests.join('|')]);
}
