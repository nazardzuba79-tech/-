import { useEffect, useMemo, useState } from 'react';
import { marketDataStore } from '../../lib/marketDataStore';
import { futuresConfigStore, useFuturesConfig } from '../../lib/futuresConfigStore';

/**
 * The instruments a chart can compare with or open in a second pane
 * (2026-10-13): Spot reads the shared market snapshot the pair list already
 * polls (no second poll of its own — it only reads what the store holds and
 * subscribes at the slowest cadence); Futures reads the shared /futures/config
 * listing. Nothing here opens a connection of its own.
 */
export function useCompareInstruments(market: 'spot' | 'futures', exclude: string[] = []): string[] {
  const [spotPairs, setSpotPairs] = useState<string[]>(() => (market === 'spot' ? [...marketDataStore.getState().tickers.keys()] : []));
  const futures = useFuturesConfig();
  useEffect(() => {
    if (market !== 'spot') return;
    // 60 s: the sidebar's own 4 s poll is what actually drives the store on the trade page.
    return marketDataStore.subscribe(state => setSpotPairs([...state.tickers.keys()]), 60000);
  }, [market]);
  useEffect(() => { if (market === 'futures') void futuresConfigStore; }, [market]);
  return useMemo(() => {
    const list = market === 'spot' ? spotPairs : (futures.config?.symbols ?? ['BTC/USDT', 'ETH/USDT', 'SOL/USDT']);
    const skip = new Set(exclude.map(p => p.toUpperCase()));
    return [...new Set(list.map(p => p.toUpperCase()))].filter(p => /^[A-Z0-9]{1,32}\/[A-Z0-9]{2,12}$/.test(p) && !skip.has(p)).sort();
  }, [market, spotPairs, futures.config, exclude.join('|')]);
}
