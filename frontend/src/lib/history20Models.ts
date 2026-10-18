/**
 * HISTORY20 MODEL CONTRACTS IN THE EXISTING FUTURES TERMINAL.
 *
 * A server-pinned History20 window is a private model contract of the
 * native Futures TEST account (`VHXTSIM/USDT`): its prices are a model of a
 * historical trajectory, never a venue's market. The terminal stays the
 * same; only where such a contract's price comes from changes:
 *   - the list of served contracts and their current model price come from
 *     `/private-trading/native/models` (empty unless the server pins one);
 *   - the chart reads the private candle route under the model's own label,
 *     and refuses a page that carries any other label;
 *   - no venue feed (book, tape, ticker, mark, derivatives) is asked about it.
 */
import { useEffect, useState } from 'react';
import { nativeDemoApi, type NativeHistory20Model } from './nativeDemoApi';
import { privateTradingApi } from './privateTradingApi';
import { pairToNativeSymbol } from './nativeFuturesAdapter';
import { createVisibleRead } from './visibleRead';
import { registerFuturesMarkSource } from './useFuturesMark';
import type { ChartCandleLoader } from './chartTrading';

export const HISTORY20_SOURCE = 'VOLTEX_HISTORY20_MODEL';
/** A History20 model contract (`VHXTSIM/USDT`, `VHXTSIMUSDT`): a listing ticker, then the suffix the server gives every one of them. */
export const isHistory20Pair = (pair: string) => { const symbol = pairToNativeSymbol(pair); return symbol.length > 7 && symbol.endsWith('SIMUSDT'); };

/** The chart's loader for a model contract: the private candle route, and only under the model's label. */
export const history20CandleLoader: ChartCandleLoader = async (pair, interval, limit, signal, endTime) => {
  const page = await privateTradingApi.candles(pair, interval, limit, signal, endTime, HISTORY20_SOURCE);
  if (page.source !== HISTORY20_SOURCE || page.symbol !== pairToNativeSymbol(pair) || page.interval !== interval) throw new Error('history20_chart_mismatch');
  return { candles: page.candles };
};

type Snapshot = { loaded: boolean; models: NativeHistory20Model[] };
const EMPTY: Snapshot = { loaded: false, models: [] };
let shared: { value: Snapshot; listeners: Set<(value: Snapshot) => void>; stop: () => void } | null = null;
/** One shared read per tab (picker, chart badge and mark), every 10 s while visible; the last subscriber stops it. */
export function subscribeHistory20Models(listener: (value: Snapshot) => void, read: () => Promise<{ models: NativeHistory20Model[] }> = nativeDemoApi.models) {
  if (!shared) {
    const entry = { value: EMPTY, listeners: new Set<(value: Snapshot) => void>(), stop: () => {} };
    const reader = createVisibleRead(async () => {
      const value = await read().then(r => ({ loaded: true, models: r.models }), () => ({ loaded: true, models: [] as NativeHistory20Model[] }));
      if (shared !== entry) return;
      entry.value = value;
      entry.listeners.forEach(notify => notify(value));
    }, 10_000, true);
    entry.stop = reader.stop;
    shared = entry;
  }
  const entry = shared;
  entry.listeners.add(listener); listener(entry.value);
  return () => {
    entry.listeners.delete(listener);
    if (!entry.listeners.size) { entry.stop(); if (shared === entry) shared = null; }
  };
}
/** The served model contracts; nothing is read until `enabled` (a native Futures TEST account). */
export function useHistory20Models(enabled: boolean): Snapshot {
  const [value, setValue] = useState<Snapshot>(EMPTY);
  useEffect(() => (enabled ? subscribeHistory20Models(setValue) : (setValue(EMPTY), undefined)), [enabled]);
  return value;
}
/** The current model price of one model contract, or null while unknown. */
export function history20MarkOf(models: NativeHistory20Model[], pair: string): number | null {
  const mark = models.find(m => m.symbol === pairToNativeSymbol(pair))?.mark;
  const value = mark ? Number(mark.markPrice) : NaN;
  return Number.isFinite(value) && value > 0 ? value : null;
}

// The shared Futures mark of a model contract is its model price (no index); the venue mark route is never asked.
registerFuturesMarkSource({
  owns: isHistory20Pair,
  subscribe: (pair, listener) => subscribeHistory20Models(({ models }) => listener({ markPrice: history20MarkOf(models, pair), indexPrice: null })),
});
