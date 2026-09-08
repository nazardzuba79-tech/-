import { useEffect, useState } from 'react';
import { marketDataStore, type MarketState } from './marketDataStore';
import type { MarketTicker } from './api';

/**
 * React bindings over the shared market-data store.
 *
 * Every component that needs prices should use one of these instead of its
 * own `useEffect` + `setInterval` + `api.getExternalTickers()`. The store
 * behind them runs ONE timer and ONE in-flight request per tab regardless
 * of how many components subscribe, so adding a ticker strip to a page no
 * longer adds a polling loop.
 *
 * `intervalMs` is a request, not a guarantee of slowness: the store polls
 * at the fastest cadence any live subscriber asked for, and everyone is
 * served that same snapshot. A component asking for 15s next to the
 * terminal's 3s simply gets fresher data than it asked for.
 */
export function useMarketData(intervalMs?: number): MarketState {
  const [state, setState] = useState<MarketState>(() => marketDataStore.getState());
  useEffect(() => marketDataStore.subscribe(setState, intervalMs), [intervalMs]);
  return state;
}

export interface TickerView {
  ticker: MarketTicker | null;
  /** True while the first poll is still outstanding. Distinct from
   *  `ticker === null` after loading, which means the pair genuinely has
   *  no data — a view must render those differently. */
  loading: boolean;
  /** The last poll failed. The previous ticker (if any) is still shown. */
  error: boolean;
  /** Data was served from the provider cache past its TTL because a
   *  refresh failed. Real, but not live. */
  stale: boolean;
}

/**
 * One pair out of the shared snapshot.
 *
 * Note what this deliberately does NOT do: it never substitutes a zero, a
 * previous pair's price, or a default. An absent pair is `ticker: null`
 * and the caller renders a dash.
 */
export function useMarketTicker(pair: string, intervalMs?: number): TickerView {
  const state = useMarketData(intervalMs);
  return {
    ticker: state.tickers.get(pair.toUpperCase()) ?? null,
    loading: !state.loaded,
    error: state.status === 'error',
    stale: state.tickersMeta?.stale ?? false,
  };
}

/** Every ticker in the shared snapshot, as a Map for O(1) row lookup. */
export function useMarketTickers(intervalMs?: number): {
  tickers: Map<string, MarketTicker>;
  loading: boolean;
  error: boolean;
  stale: boolean;
  refresh: () => void;
} {
  const state = useMarketData(intervalMs);
  return {
    tickers: state.tickers,
    loading: !state.loaded,
    error: state.status === 'error',
    stale: state.tickersMeta?.stale ?? false,
    refresh: () => void marketDataStore.refresh(),
  };
}
