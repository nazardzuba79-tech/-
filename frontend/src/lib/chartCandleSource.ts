/**
 * One place every chart surface gets candles from (2026-10-13).
 *
 * Wraps a market's own candle loader (lib/futuresCandles, lib/spotPublicMarket,
 * the test-market loader) with three things the workspace needs and the
 * loaders themselves do not have:
 *
 *   1. Derived timeframes. An interval the source cannot serve is built
 *      from its largest native divisor (lib/chartTimeframes): the base bars
 *      are kept per `market|pair|base` and merged across pages, so a bucket
 *      that straddles two history pages is still built from all its bars.
 *   2. One base-bar request per (series, window) at a time. Two derived
 *      consumers asking for the same base bars share one request and, for
 *      a few seconds, one answer. Native intervals go straight to the
 *      market's loader, exactly as the chart always asked.
 *   3. A native request that fails for an interval with a derived plan
 *      falls back to that plan (the market edge may not carry every code),
 *      so the chart shows real aggregated bars rather than an error.
 *
 * Abort is honoured: a caller's signal cancels its own wait; the shared
 * request itself is aborted only when every waiter has left.
 */
import type { Candle } from './indicators';
import type { ChartCandleLoader } from './chartTrading';
import {
  aggregateCandles, derivedRawLimit, isChartTimeframe, timeframePlan, type CandleSourceKind, type ChartTimeframe, type TimeframePlan,
} from './chartTimeframes';

export interface CandleRequest {
  market: 'spot' | 'futures';
  pair: string;
  timeframe: ChartTimeframe;
  limit: number;
  signal?: AbortSignal;
  /** Epoch milliseconds: bars at or before this instant (history paging). */
  endTime?: number;
}

export interface CandleAnswer {
  candles: Candle[];
  plan: TimeframePlan;
  /** The newest bar is a derived bucket still forming. */
  partialLast: boolean;
}

/** Base-bar pages younger than this are reused by a second caller (a compare line and a pane asking for the same bars). */
export const CANDLE_SHARE_MS = 2500;
/** Raw base bars kept per series for derived timeframes. */
export const RAW_STORE_CAP = 20000;

const abortError = () => (typeof DOMException === 'function' ? new DOMException('Aborted', 'AbortError') : Object.assign(new Error('Aborted'), { name: 'AbortError' }));
const isAbort = (error: unknown) => (error as { name?: string } | null)?.name === 'AbortError';

type Shared = { promise: Promise<{ candles: Candle[] }>; controller: AbortController; waiters: number; at: number };
const inflight = new Map<string, Shared>();
const recent = new Map<string, { at: number; value: { candles: Candle[] } }>();
const rawStore = new Map<string, Candle[]>();

const mergeRows = (previous: Candle[], incoming: Candle[], cap: number): Candle[] => {
  const byTime = new Map(previous.map(row => [row.time, row]));
  for (const row of incoming) byTime.set(row.time, row);
  return [...byTime.values()].sort((a, b) => a.time - b.time).slice(-cap);
};

/** Wait for a shared promise, leaving it on the caller's own abort. */
function awaitShared(shared: Shared, signal?: AbortSignal): Promise<{ candles: Candle[] }> {
  if (!signal) return shared.promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      shared.waiters -= 1;
      if (shared.waiters <= 0) shared.controller.abort();
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    shared.promise.then(value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      error => { signal.removeEventListener('abort', onAbort); reject(error); });
  });
}

/** One request per key; callers joining mid-flight share it. */
function fetchShared(key: string, run: (signal: AbortSignal) => Promise<{ candles: Candle[] }>, signal?: AbortSignal): Promise<{ candles: Candle[] }> {
  const cached = recent.get(key);
  if (cached && Date.now() - cached.at < CANDLE_SHARE_MS) return signal?.aborted ? Promise.reject(abortError()) : Promise.resolve(cached.value);
  let shared = inflight.get(key);
  if (!shared) {
    const controller = new AbortController();
    const created: Shared = { controller, waiters: 0, at: Date.now(), promise: run(controller.signal).then(value => {
      recent.set(key, { at: Date.now(), value });
      if (recent.size > 64) recent.delete(recent.keys().next().value!);
      return value;
    }).finally(() => { if (inflight.get(key) === created) inflight.delete(key); }) };
    shared = created;
    inflight.set(key, shared);
  }
  shared.waiters += 1;
  return awaitShared(shared, signal);
}

/**
 * Candles for a request, served natively or derived. `loader` is the market's
 * own loader; `source` says what it can do natively.
 */
export async function loadChartCandles(loader: ChartCandleLoader, source: CandleSourceKind, request: CandleRequest): Promise<CandleAnswer> {
  const { market, pair, timeframe, limit, signal, endTime } = request;
  if (!isChartTimeframe(timeframe)) throw new RangeError(`Unknown timeframe ${String(timeframe)}`);
  const plan = timeframePlan(source, timeframe);
  if (plan.kind === 'unavailable') throw new RangeError(`timeframe_unavailable:${timeframe}`);
  if (plan.kind === 'native') {
    // As the chart always asked: straight to the market's loader with the
    // caller's own signal (the loaders keep their own caches and streams).
    try {
      const res = await loader(pair, timeframe, limit, signal, endTime);
      return { candles: res.candles, plan, partialLast: false };
    } catch (error) {
      if (isAbort(error) || signal?.aborted) throw error;
      // The source refused a native interval it should carry (an edge
      // fallback with a shorter list): build the bars instead, when possible.
      const fallback = timeframePlan(source === 'futures-public' ? 'spot-public' : 'legacy', timeframe);
      if (fallback.kind !== 'derived') throw error;
      return loadDerived(loader, source, request, fallback);
    }
  }
  return loadDerived(loader, source, request, plan);
}

async function loadDerived(loader: ChartCandleLoader, source: CandleSourceKind, request: CandleRequest, plan: { base: ChartTimeframe; factor: number }): Promise<CandleAnswer> {
  const { market, pair, timeframe, limit, signal, endTime } = request;
  const rawLimit = derivedRawLimit(plan, timeframe, limit, source);
  const key = `${market}|${pair}|${plan.base}|${rawLimit}|${endTime ?? 'latest'}`;
  const page = await fetchShared(key, inner => loader(pair, plan.base, rawLimit, inner, endTime), signal);
  const storeKey = `${market}|${pair}|${plan.base}`;
  const merged = mergeRows(rawStore.get(storeKey) ?? [], page.candles, RAW_STORE_CAP);
  rawStore.set(storeKey, merged);
  const built = aggregateCandles(merged, plan.base, timeframe);
  let candles = built.candles;
  if (endTime !== undefined) {
    // A history page: only bars that end at or before the asked instant,
    // so the chart's own merge sees the same window it asked for.
    const endSeconds = endTime / 1000;
    candles = candles.filter(row => row.time < endSeconds);
  }
  return { candles: candles.slice(-limit), plan: { kind: 'derived', base: plan.base, factor: plan.factor }, partialLast: built.partialLast && endTime === undefined };
}

/** A loader with the same contract as the market's own, serving every catalogue timeframe it can. */
export function workspaceCandleLoader(loader: ChartCandleLoader, source: CandleSourceKind, market: 'spot' | 'futures'): ChartCandleLoader {
  return async (pair, interval, limit, signal, endTime) => {
    if (!isChartTimeframe(interval)) return loader(pair, interval, limit, signal, endTime);
    const answer = await loadChartCandles(loader, source, { market, pair, timeframe: interval, limit, signal, endTime });
    return { candles: answer.candles };
  };
}

/** For tests and a workspace reset: forget every shared answer and raw bar. */
export function resetChartCandleSource(): void {
  for (const shared of inflight.values()) shared.controller.abort();
  inflight.clear();
  recent.clear();
  rawStore.clear();
}

/** How many raw base bars are kept for a series (diagnostics and tests). */
export const rawStoreSize = (market: 'spot' | 'futures', pair: string, base: ChartTimeframe): number => rawStore.get(`${market}|${pair}|${base}`)?.length ?? 0;
