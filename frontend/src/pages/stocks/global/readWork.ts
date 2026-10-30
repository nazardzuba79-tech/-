import type { Candle } from './types';

export type StockSourceGap = { time: number; reason: string };
export type StockHistoryAdmission = {
  candles: Candle[]; gaps: StockSourceGap[]; ownSource: boolean;
  range?: { from: number; to: number }; error?: string;
};
const SOURCE_SCHEMA = 'voltex.solana-ohlcv.v1';
const SOURCE_STEPS: Record<string, number> = { '1m': 60, '5m': 300, '1h': 3600 };
const SOURCE_GATES = ['programIdentity', 'poolState', 'mintChronology', 'feeChronology', 'completeness', 'executionBinding'];
const key = (v: unknown) => typeof v === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v);
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const candleValid = (c: Candle) => c && Number.isSafeInteger(c.time) && c.time >= 0
  && [c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite)
  && c.low > 0 && c.high >= Math.max(c.open, c.close, c.low)
  && c.low <= Math.min(c.open, c.close) && c.volume > 0;

// Only the existing CEX path may omit provenance. Own-source pages are a
// separate, versioned read contract; labels alone can never admit prices.
// intervalComplete certifies every emitted candle, not every bucket: gaps
// explicitly account for the rest of the requested range, including no trades.
export function admitStockHistory(page: any, instrumentId: string, interval: string): StockHistoryAdmission {
  const ownSource = page?.provenance !== undefined || page?.schema === SOURCE_SCHEMA || instrumentId.startsWith('SOLANA:');
  const reject = (): StockHistoryAdmission => ({ candles: [], gaps: [], ownSource, error: 'SOURCE_UNAVAILABLE' });
  if (!page || !Array.isArray(page.candles) || page.candles.length > 1500) return reject();
  if (!ownSource) return { candles: page.candles, gaps: [], ownSource: false };
  const p = page.provenance, source = p?.source, step = SOURCE_STEPS[interval], range = page.range;
  if (page.schema !== SOURCE_SCHEMA || page.instrumentId !== instrumentId || page.interval !== interval
    || page.priceKind !== 'raw-token' || page.quoteCurrency !== 'USDC' || !step
    || source?.network !== 'solana-mainnet-beta'
    || source?.program !== 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK'
    || source?.quoteMint !== 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    || !key(source?.mint) || !key(source?.pool)
    || instrumentId !== `SOLANA:${source.mint}:${source.pool}`
    || !Number.isSafeInteger(range?.from) || !Number.isSafeInteger(range?.to)
    || range.from < 0 || range.to <= range.from || range.from % step || range.to % step
    || (range.to - range.from) / step > 1500 || !Array.isArray(page.gaps)) return reject();
  const occupied = new Set<number>();
  const inRange = (time: number) => Number.isSafeInteger(time) && time >= range.from && time < range.to
    && time % step === 0 && !occupied.has(time);
  const gaps: StockSourceGap[] = [];
  for (const gap of page.gaps) {
    if (!inRange(gap?.time) || !['NO_TRADES', 'UNKNOWN', 'OUTSIDE_RETENTION'].includes(gap.reason)) return reject();
    occupied.add(gap.time); gaps.push({ time: gap.time, reason: gap.reason });
  }
  // A valid UNKNOWN envelope communicates gaps but must contain no numbers.
  if (p.status === 'UNKNOWN') {
    if (page.candles.length || p.intervalComplete !== false || p.acceptedTradeCount !== 0
      || occupied.size !== (range.to - range.from) / step) return reject();
    return { candles: [], gaps, ownSource, range, error: 'SOURCE_UNAVAILABLE' };
  }
  if (p.status !== 'ACCEPTED' || p.intervalComplete !== true || p.finality !== 'finalized' || p.synthetic !== false
    || !hash(p.receiptsHash) || !SOURCE_GATES.every(g => p.gates?.[g] === true)
    || !Number.isSafeInteger(p.acceptedTradeCount) || p.acceptedTradeCount < 0) return reject();
  let count = 0;
  for (const c of page.candles) {
    if (!candleValid(c) || !inRange(c.time) || !Number.isSafeInteger(c.tradeCount) || c.tradeCount <= 0
      || !hash(c.proofDigest)) return reject();
    occupied.add(c.time); count += c.tradeCount;
  }
  if (count !== p.acceptedTradeCount || occupied.size !== (range.to - range.from) / step) return reject();
  return { candles: page.candles, gaps, ownSource, range };
}

// A corrected source range replaces earlier admission, so a revoked candle
// cannot survive in the paging cache. Gaps and values have the same bound.
export function mergeAdmittedStockHistory(old: Candle[], page: StockHistoryAdmission): Candle[] {
  if (!page.ownSource) return mergeStockCandles(old, page.candles);
  if (!page.range) return [];
  return mergeStockCandles(old.filter(c => c.time < page.range!.from || c.time >= page.range!.to), page.candles);
}

export function mergeStockSourceGaps(old: StockSourceGap[], page: StockHistoryAdmission): StockSourceGap[] {
  const next = page.range ? [...old.filter(g => g.time < page.range!.from || g.time >= page.range!.to), ...page.gaps]
    .sort((a, b) => a.time - b.time).slice(-1500) : page.gaps;
  return old.length === next.length && old.every((gap, i) => gap.time === next[i].time && gap.reason === next[i].reason) ? old : next;
}

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
