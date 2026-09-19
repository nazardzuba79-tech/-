import BigNumber from 'bignumber.js';
import { NativeDemoService, NATIVE_QUOTE_REUSE_MS } from '../service';
import { NativeAccount, NativeRepository, revisionPayload, commandHash } from '../store';
import { DemoState, emptyDemoState } from '../engine';
import { assertNativeInvariants } from '../invariants';
import { replayNativeDemoAsync, BarRequest, ReplayBar } from '../replay';
import type { OwnerSession } from '../../serviceTypes';
import { PrivateTradingError } from '../../serviceTypes';
import type { PrivateTradingMarketData, PrivateInstrument, PrivateFreshQuote, PrivateHistoryRequest, PrivateMark } from '../../marketData';

/**
 * THE LIVE FIXTURE the review-round suites share: an in-memory repository
 * that holds every persisted mutation to the account invariants, a market
 * whose price, book and live-frame marks a test moves by hand and whose
 * history is flat at the price current when each minute was open, and a
 * clock that never advances on its own. Nothing here is a test; the suites
 * under `__tests__` are.
 */
export const M = 60_000, H = 3_600_000;
export const H0 = Date.UTC(2026, 8, 15, 0, 0, 0);
export const TAKER = '0.00055', MAKER = '0.0002';
export const actor: OwnerSession = { userId: 'live', sessionId: 's', expiresAt: Number.MAX_SAFE_INTEGER };
export const bn = (v: string | number | BigNumber) => new BigNumber(v);
export type Level = { price: string; quantity: string };

export class Clock { constructor(public t: number) {} now = () => this.t; }
export class MemoryRepository implements NativeRepository {
  row: NativeAccount | null = null; revisions = new Map<number, NativeAccount>(); keys = new Map<string, { hash: string; row: NativeAccount }>();
  wallet: { asset: string; available: string; locked: string }[] = [];
  commits = 0;
  constructor(private clock: Clock, private deposit: string) {}
  async read() { return this.row ? structuredClone(this.row) : null; }
  async available() { return this.row ? null : this.deposit; }
  async holdings() { return this.wallet; }
  async accounts() { return this.row ? [actor.userId] : []; }
  async revision(_a: OwnerSession, r: number) { const v = this.revisions.get(r); return v ? structuredClone(v) : null; }
  async prior(_a: OwnerSession, key: string, hash: string) { const v = this.keys.get(key); if (!v) return null; if (v.hash !== hash) throw new PrivateTradingError('idempotency_conflict', 'conflict', 409); return structuredClone(v.row); }
  async initialize(_a: OwnerSession, key: string) {
    if (this.row) return structuredClone(this.row); const t = this.clock.now();
    this.row = { revision: 1, deposit: this.deposit, commands: [], snapshot: emptyDemoState(this.deposit, t), createdAt: t, source: 'DEMO_BALANCE' };
    this.revisions.set(1, revisionPayload(this.row)); this.keys.set(key, { hash: commandHash({ kind: 'INITIALIZE' }), row: revisionPayload(this.row) }); return structuredClone(this.row);
  }
  async commit(_a: OwnerSession, expected: number, next: NativeAccount, key: string, hash: string) {
    const known = this.keys.get(key); if (known) return structuredClone(known.row);
    if (this.row?.revision !== expected) throw new PrivateTradingError('account_changed', 'changed', 409);
    assertNativeInvariants(next.snapshot, undefined, `commit ${expected + 1}`);
    const row = structuredClone({ ...next, revision: expected + 1 }); this.row = row; this.commits += 1;
    this.revisions.set(row.revision, revisionPayload(row)); this.keys.set(key, { hash, row: revisionPayload(row) }); return structuredClone(row);
  }
}
export const instrument = (symbol: string): PrivateInstrument => ({ provider: 'bybit', symbol, baseAsset: symbol.replace(/USDT$/, ''), quoteAsset: 'USDT', settleAsset: 'USDT', contractType: 'LinearPerpetual', status: 'Trading', launchTime: Date.UTC(2020, 0, 1), fetchedAt: H0, fundingIntervalMinutes: 480,
  filters: { tickSize: '0.1', minPrice: '0.1', maxPrice: '10000000', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '1000', minNotionalValue: '5' }, leverage: { min: '1', max: '100', step: '1' },
  riskTiers: [{ riskLimitValue: '1000000000', maintenanceMarginRate: '0.005', initialMarginRate: '0.01', maintenanceDeduction: '0', maxLeverage: '100' }], parameterModel: 'CURRENT_INSTRUMENT_PARAMETERS', parameterVersion: 'LIVE_FIXTURE' });
export class FakeMarket {
  /** The current price; every minute remembers the price it opened at, so history is what was current then. */
  private timeline: { from: number; price: string }[];
  /** The book the next quotes carry; null = one level of 10 per side at ±0.1. */
  bids: Level[] | null = null; asks: Level[] | null = null;
  served: { time: number; bids: Level[]; asks: Level[] }[] = [];
  calls = { quote: 0, history: 0, marks: 0 };
  /** The live frame: which symbols the collector holds as current. null = every symbol at the current price. */
  frame: string[] | null = null;
  /** When false the market source has no `marks` method at all (an older collector). */
  hasMarks = true;
  constructor(private clock: Clock, price = '50000') { this.timeline = [{ from: 0, price }]; }
  get price() { return this.timeline[this.timeline.length - 1].price; }
  set price(value: string) { this.timeline.push({ from: this.clock.now(), price: value }); }
  priceAt(t: number) { let p = this.timeline[0].price; for (const x of this.timeline) if (x.from <= t) p = x.price; return p; }
  async instrument(symbol: string) { return instrument(symbol); }
  quoteNow(symbol: string): PrivateFreshQuote {
    const t = this.clock.now(), p = bn(this.price);
    const bids = this.bids ?? [{ price: p.minus('0.1').toFixed(), quantity: '10' }], asks = this.asks ?? [{ price: p.plus('0.1').toFixed(), quantity: '10' }];
    return { provider: 'bybit', symbol, bids, asks, markPrice: this.price, lastPrice: this.price, fundingRate: '0.0001', nextFundingTime: t + H, providerTimestamp: t, bookGeneratedAt: t, markProviderTimestamp: t, fetchedAt: t };
  }
  async freshQuote(symbol: string): Promise<PrivateFreshQuote> {
    this.calls.quote++; const q = this.quoteNow(symbol); this.served.push({ time: q.bookGeneratedAt, bids: q.bids, asks: q.asks }); return q;
  }
  async marks(symbols: string[]): Promise<Map<string, PrivateMark>> {
    if (!this.hasMarks) throw new Error('marks unsupported');
    this.calls.marks++; const t = this.clock.now(), out = new Map<string, PrivateMark>();
    for (const symbol of symbols) if (this.frame === null || this.frame.includes(symbol)) out.set(symbol, { symbol, markPrice: this.price, lastPrice: this.price, markProviderTimestamp: t, receivedAt: t, fetchedAt: t });
    return out;
  }
  async history(r: PrivateHistoryRequest) {
    this.calls.history++;
    const step = (r.intervalMinutes ?? 1) * M, candles = [];
    for (let t = r.startTime; t < r.endTime; t += step) { const p = this.priceAt(t); candles.push({ timestamp: t, open: p, high: p, low: p, close: p }); }
    return { symbol: r.symbol, tradeCandles: candles, markCandles: structuredClone(candles), fundingEvents: [], expectedFundingTimestamps: [], intervalMs: step, complete: true, issues: [], fetchedAt: this.clock.now(), fundingScheduleModel: 'NATIVE_DEMO_FIXED_FUNDING_V1' as const, instrument: instrument(r.symbol) };
  }
  async resolveCandle(): Promise<never> { throw new Error('not used'); }
}
let seq = 0; export const key = () => `live-${++seq}`;
export function setup(options: { deposit?: string; price?: string; at?: number } = {}) {
  // 00:05:30 by default — a test's steps stay inside this minute unless it moves the clock itself.
  const clock = new Clock(options.at ?? H0 + 5 * H + 5 * M + 30_000), repo = new MemoryRepository(clock, options.deposit ?? '100000'), market = new FakeMarket(clock, options.price);
  const service = new NativeDemoService(repo, market as unknown as PrivateTradingMarketData, clock.now);
  /** Past the quote-reuse window, inside the same minute. */
  const step = () => { const minute = Math.floor(clock.t / M); clock.t += NATIVE_QUOTE_REUSE_MS + 1; if (Math.floor(clock.t / M) !== minute) throw new Error('step left the minute'); };
  const journal = () => repo.row!.commands;
  const refresh = () => service.command(actor, { kind: 'REFRESH', idempotencyKey: key() });
  const bars = (request: BarRequest): Promise<ReplayBar[]> => (service as unknown as { bars(r: BarRequest): Promise<ReplayBar[]> }).bars(request);
  /** The stored row replayed from its journal alone (no checkpoint) or from its stored checkpoint, as another instance would. */
  const replay = async (mode: 'FULL' | 'CHECKPOINT') => {
    const row = repo.row!;
    return (await replayNativeDemoAsync({ deposit: row.deposit, instructions: row.commands, asOf: clock.now(), ...(mode === 'CHECKPOINT' ? { checkpoint: row.checkpoint } : {}) }, bars)).snapshot;
  };
  return { clock, repo, market, service, step, journal, refresh, replay };
}
/** What a replay has to reproduce of a persisted snapshot: every event, order, position, the wallet and the liquidity ledger. */
export function outcome(s: DemoState) {
  return {
    events: s.events.map(e => ({ id: e.id, kind: e.kind, time: e.time, positionId: e.positionId, orderId: e.orderId, quantity: e.quantity, price: e.price, fee: e.fee, cashflow: e.cashflow, pricing: e.pricing, actionId: e.actionId ?? null, sourcePrice: e.sourcePrice ?? null })),
    orders: s.orders.map(o => ({ id: o.id, status: o.status, filled: o.filled, remaining: o.remaining, averagePrice: o.averagePrice, reserved: o.reserved })),
    positions: s.positions.map(p => ({ id: p.id, status: p.status, quantity: p.quantity, entryPrice: p.entryPrice, isolatedMargin: p.isolatedMargin, realizedGross: p.realizedGross, closingFees: p.closingFees, protection: p.protection, pendingClose: p.pendingClose ?? null })),
    walletBalance: s.walletBalance, collateral: s.collateral ?? null, bookConsumption: s.bookConsumption,
  };
}
