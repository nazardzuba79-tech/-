import { useEffect, useState } from 'react';
import { api } from './api';
import { createVisibleRead } from './visibleRead';

type Mark = { markPrice: number | null; indexPrice: number | null };
const EMPTY: Mark = { markPrice: null, indexPrice: null };
const entries = new Map<string, { value: Mark; listeners: Set<(mark: Mark) => void>; stop: () => void }>();
/** Header and sizing form share one genuine server mark/index read per symbol.
 * No session data, no risk decisions; final subscriber departure drops the cache.
 */
export function subscribeFuturesMark(symbol: string, listener: (mark: Mark) => void) {
  let entry = entries.get(symbol);
  if (!entry) {
    const next = { value: EMPTY, listeners: new Set<(mark: Mark) => void>(), stop: () => {} };
    const reader = createVisibleRead(async () => {
      const result = await api.getFuturesMarkPrice(symbol);
      if (entries.get(symbol) !== next) return;
      const number = (value: string) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; };
      next.value = { markPrice: number(result.markPrice), indexPrice: number(result.indexPrice) };
      next.listeners.forEach(notify => notify(next.value));
    }, 30_000, true);
    next.stop = reader.stop; entries.set(symbol, next); entry = next;
  }
  entry.listeners.add(listener); listener(entry.value);
  const current = entry;
  return () => {
    current.listeners.delete(listener);
    if (!current.listeners.size) { current.stop(); entries.delete(symbol); }
  };
}

export function useFuturesMark(symbol: string): Mark {
  const [snapshot, setSnapshot] = useState<{ symbol: string; value: Mark } | null>(null);
  useEffect(() => subscribeFuturesMark(symbol, value => setSnapshot({ symbol, value })), [symbol]);
  return snapshot?.symbol === symbol ? snapshot.value : EMPTY;
}
