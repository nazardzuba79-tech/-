import type { Candle } from './types';

// One request per key in this mounted account view. No response/account cache.
export class VisibleStockReads {
  private pending = new Map<string, Promise<unknown>>();
  constructor(private readonly hidden: () => boolean) {}
  run<T>(key: string, work: () => Promise<T>): Promise<T> | undefined {
    if (this.hidden()) return undefined;
    const current = this.pending.get(key);
    if (current) return current as Promise<T>;
    // Capture the account/session synchronously in work(), before a login can
    // change in another event; only the asynchronous response is coalesced.
    const promise = (async () => work())().finally(() => {
      if (this.pending.get(key) === promise) this.pending.delete(key);
    });
    this.pending.set(key, promise);
    return promise;
  }
  reset() { this.pending.clear(); }
}

export function startVisibleStockPolling(run: () => void, ms: number) {
  let timer: ReturnType<typeof setInterval> | undefined;
  const visible = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    if (!document.hidden) { run(); timer = setInterval(run, ms); }
  };
  document.addEventListener('visibilitychange', visible);
  visible();
  return () => { if (timer !== undefined) clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
}

const equalCandle = (a: Candle, b: Candle) => a.time === b.time && a.open === b.open && a.high === b.high
  && a.low === b.low && a.close === b.close && a.volume === b.volume;

// Source values win exactly as before; stable pages do not rebuild chart series
// or indicators. A corrected historical candle is never treated as immutable.
export function mergeStockCandles(old: Candle[], incoming: Candle[]): Candle[] {
  const byTime = new Map(old.map(c => [c.time, c]));
  let changed = false;
  for (const candle of incoming) {
    const previous = byTime.get(candle.time);
    if (!previous || !equalCandle(previous, candle)) { byTime.set(candle.time, candle); changed = true; }
  }
  if (!changed) return old;
  return [...byTime.values()].sort((a, b) => a.time - b.time).slice(-1500);
}
