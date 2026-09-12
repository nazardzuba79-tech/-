import type { CachedValue } from '../ProviderCache';
import type { LiveTicker, NormalizedInstrument, NormalizedTicker } from './types';
import type { BybitCategory } from './BybitMarketDataService';
import { finite } from '../numbers';
export { finite } from '../numbers';

export const instrumentKey = (i: Pick<NormalizedInstrument, 'marketType' | 'providerSymbol'>) => `${i.marketType}:${i.providerSymbol}`;
export const categoryOf = (i: Pick<NormalizedInstrument, 'marketType'>): BybitCategory => i.marketType === 'spot' ? 'spot' : i.marketType.startsWith('inverse') ? 'inverse' : 'linear';
const fields = {
  lastPrice: 'lastPrice', bid1Price: 'bidPrice', ask1Price: 'askPrice', highPrice24h: 'high24h',
  lowPrice24h: 'low24h', volume24h: 'volume24h', turnover24h: 'quoteVolume24h', price24hPcnt: 'changePercent24h',
  indexPrice: 'indexPrice', markPrice: 'markPrice', fundingRate: 'fundingRate',
  openInterest: 'openInterest', openInterestValue: 'openInterestValue', fundingIntervalHour: 'fundingIntervalMinutes',
} as const;

export class BybitTickerBook {
  readonly rows = new Map<string, LiveTicker>();
  readonly instruments = new Map<string, NormalizedInstrument>();
  private dirty = new Set<string>();
  private spotRestAt = new Map<string, number>();
  rejected = 0;
  rejectedTimestamp = 0;
  rejectedSequence = 0;
  constructor(private now = Date.now) {}
  setUniverse(instruments: NormalizedInstrument[]): void {
    this.instruments.clear();
    for (const i of instruments) if (i.status === 'Trading') this.instruments.set(`${categoryOf(i)}:${i.providerSymbol}`, i);
    const valid = new Set([...this.instruments.values()].map(instrumentKey));
    for (const id of this.rows.keys()) if (!valid.has(id)) { this.rows.delete(id); this.dirty.delete(id); this.spotRestAt.delete(id); }
  }
  bootstrap(category: BybitCategory, data: CachedValue<NormalizedTicker[]>): void {
    for (const ticker of data.value) {
      const i = this.instruments.get(`${category}:${ticker.providerSymbol}`);
      if (!i) continue;
      const id = instrumentKey(i), old = this.rows.get(id);
      // A cached REST bootstrap cannot rewind a newer WS quote.
      const eventAt = ticker.providerEventAt ?? null;
      const restAt = eventAt ?? data.fetchedAt;
      if (old && restAt <= (old.providerEventAt ?? old.fetchedAt)) {
        // A WS tick can arrive while REST is in flight. Spot bid/ask are
        // REST-only, so update them independently without rolling back the
        // newer WS price, timestamp, sequence or freshness. Cached/older REST
        // must not rewind these fields either.
        if (category === 'spot' && !data.stale && restAt > (this.spotRestAt.get(id) ?? 0)) {
          this.rows.set(id, { ...old, bidPrice: ticker.bidPrice, askPrice: ticker.askPrice });
          this.spotRestAt.set(id, restAt); this.dirty.add(id);
        }
        continue;
      }
      if (category === 'spot') this.spotRestAt.set(id, restAt);
      this.rows.set(id, { ...ticker, id, symbol: i.symbol, pair: i.symbol, provider: 'bybit', marketType: i.marketType,
        baseAsset: i.baseAsset, quoteAsset: i.quoteAsset, settleAsset: i.settleAsset,
        openInterestValue: ticker.openInterestValue ?? null,
        fundingIntervalMinutes: ticker.fundingIntervalMinutes ?? i.fundingIntervalMinutes,
        providerEventAt: eventAt, sequence: null, receivedAt: data.fetchedAt, fetchedAt: data.fetchedAt, stale: data.stale });
      this.dirty.add(id);
    }
  }
  apply(category: BybitCategory, message: unknown): boolean {
    if (!message || typeof message !== 'object') return false;
    const m = message as Record<string, any>;
    if (typeof m.topic !== 'string' || !m.topic.startsWith('tickers.') || !['snapshot', 'delta'].includes(m.type)) return false;
    const raw = m.data;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const symbol = m.topic.slice(8);
    if (raw.symbol !== undefined && raw.symbol !== symbol) return false;
    const i = this.instruments.get(`${category}:${symbol}`);
    if (!i) return false;
    const id = instrumentKey(i), old = this.rows.get(id);
    if (!old) return false; // REST must establish the instrument first.
    const eventAt = finite(m.ts), sequence = finite(m.cs);
    if (eventAt !== null && old.providerEventAt !== null && eventAt < old.providerEventAt) {
      this.rejected++; this.rejectedTimestamp++; return false;
    }
    // Equal cross sequence is not necessarily an old quote: a newer
    // timestamp can carry updated funding/OI without a new trade sequence.
    if (sequence !== null && old.sequence !== null && (sequence < old.sequence ||
        (sequence === old.sequence && (eventAt === null || (old.providerEventAt !== null && eventAt <= old.providerEventAt))))) {
      this.rejected++; this.rejectedSequence++; return false;
    }
    const next = { ...old };
    for (const [rawKey, key] of Object.entries(fields)) {
      if (!Object.prototype.hasOwnProperty.call(raw, rawKey)) continue;
      const n = finite(raw[rawKey]);
      (next as any)[key] = n === null ? null : rawKey === 'price24hPcnt' ? n * 100 : rawKey === 'fundingIntervalHour' ? n * 60 : n;
    }
    // Spot snapshots do not publish bid/ask today. REST's last supplied
    // values are retained; fields never supplied anywhere remain null.
    next.providerEventAt = eventAt ?? old.providerEventAt;
    next.sequence = sequence ?? old.sequence;
    next.receivedAt = this.now(); next.fetchedAt = this.now(); next.stale = false;
    this.rows.set(id, next); this.dirty.add(id); return true;
  }
  stale(ids?: Set<string>, ageMs = 30_000): void {
    for (const [id, row] of this.rows) if (!row.stale && (ids ? ids.has(id) : this.now() - row.receivedAt > ageMs)) {
      this.rows.set(id, { ...row, stale: true }); this.dirty.add(id);
    }
  }
  drain(): LiveTicker[] {
    const rows = [...this.dirty].flatMap(id => this.rows.has(id) ? [this.rows.get(id)!] : []);
    this.dirty.clear(); return rows;
  }
}
