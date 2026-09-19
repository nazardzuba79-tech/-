import BigNumber from 'bignumber.js';
import { NativeDemoService, NATIVE_QUOTE_REUSE_MS } from '../native/service';
import { NativeAccount, NativeRepository, revisionPayload, commandHash } from '../native/store';
import { emptyDemoState } from '../native/engine';
import type { OwnerSession } from '../serviceTypes';
import { PrivateTradingError } from '../serviceTypes';
import type { PrivateTradingMarketData, PrivateInstrument, PrivateFreshQuote, PrivateHistoryRequest, PrivateMark } from '../marketData';

/**
 * THE MARKET-DATA CALL GRAPH OF EVERY COMMAND KIND, AT 1 / 10 / 20 / 30 CONTRACTS.
 *
 * Counted on the service's market source (the same interface production
 * wires to the collector), with every quote older than the reuse window so
 * nothing is served from the service's own snapshot: the numbers are the
 * worst case per command. Two sources are compared: one WITHOUT the live
 * frame (`marks` absent: every contract is quoted itself — the path before
 * this block) and one WITH it. The formulas asserted here are the ones the
 * call-graph note quotes. Nothing here is a latency claim.
 */
const M = 60_000, H = 3_600_000;
const H0 = Date.UTC(2026, 8, 15, 0, 0, 0);
const actor: OwnerSession = { userId: 'graph', sessionId: 's', expiresAt: Number.MAX_SAFE_INTEGER };
class Clock { constructor(public t: number) {} now = () => this.t; }
class MemoryRepository implements NativeRepository {
  row: NativeAccount | null = null; revisions = new Map<number, NativeAccount>(); keys = new Map<string, { hash: string; row: NativeAccount }>();
  wallet: { asset: string; available: string; locked: string }[] = [];
  constructor(private clock: Clock) {}
  async read() { return this.row ? structuredClone(this.row) : null; }
  async available() { return this.row ? null : '100000000'; }
  async holdings() { return this.wallet; }
  async revision(_a: OwnerSession, r: number) { const v = this.revisions.get(r); return v ? structuredClone(v) : null; }
  async prior(_a: OwnerSession, key: string, hash: string) { const v = this.keys.get(key); if (!v) return null; if (v.hash !== hash) throw new PrivateTradingError('idempotency_conflict', 'conflict', 409); return structuredClone(v.row); }
  async initialize(_a: OwnerSession, key: string) {
    if (this.row) return structuredClone(this.row); const t = this.clock.now();
    this.row = { revision: 1, deposit: '100000000', commands: [], snapshot: emptyDemoState('100000000', t), createdAt: t, source: 'DEMO_BALANCE' };
    this.revisions.set(1, revisionPayload(this.row)); this.keys.set(key, { hash: commandHash({ kind: 'INITIALIZE' }), row: revisionPayload(this.row) }); return structuredClone(this.row);
  }
  async commit(_a: OwnerSession, expected: number, next: NativeAccount, key: string, hash: string) {
    const known = this.keys.get(key); if (known) return structuredClone(known.row);
    if (this.row?.revision !== expected) throw new PrivateTradingError('account_changed', 'changed', 409);
    const row = structuredClone({ ...next, revision: expected + 1 }); this.row = row;
    this.revisions.set(row.revision, revisionPayload(row)); this.keys.set(key, { hash, row: revisionPayload(row) }); return structuredClone(row);
  }
}
const instrument = (symbol: string): PrivateInstrument => ({ provider: 'bybit', symbol, baseAsset: symbol.replace(/USDT$/, ''), quoteAsset: 'USDT', settleAsset: 'USDT', contractType: 'LinearPerpetual', status: 'Trading', launchTime: Date.UTC(2020, 0, 1), fetchedAt: H0, fundingIntervalMinutes: 480,
  filters: { tickSize: '0.1', minPrice: '0.1', maxPrice: '10000000', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '1000', minNotionalValue: '5' }, leverage: { min: '1', max: '100', step: '1' },
  riskTiers: [{ riskLimitValue: '1000000000', maintenanceMarginRate: '0.005', initialMarginRate: '0.01', maintenanceDeduction: '0', maxLeverage: '100' }], parameterModel: 'CURRENT_INSTRUMENT_PARAMETERS', parameterVersion: 'GRAPH_FIXTURE' });
type Counts = { instrument: number; freshQuote: number; marksCalls: number; marksSymbols: number; history: number };
const zero = (): Counts => ({ instrument: 0, freshQuote: 0, marksCalls: 0, marksSymbols: 0, history: 0 });
class CountingMarket {
  calls = zero();
  // The source WITHOUT a live frame has no `marks` at all (an own undefined shadows the prototype method).
  constructor(private clock: Clock, withFrame: boolean) { if (!withFrame) Object.defineProperty(this, 'marks', { value: undefined, writable: true, configurable: true }); }
  async instrument(symbol: string) { this.calls.instrument++; return instrument(symbol); }
  async freshQuote(symbol: string): Promise<PrivateFreshQuote> {
    this.calls.freshQuote++; const t = this.clock.now();
    return { provider: 'bybit', symbol, bids: [{ price: '999.9', quantity: '1000' }], asks: [{ price: '1000.1', quantity: '1000' }], markPrice: '1000', lastPrice: '1000', fundingRate: '0.0001', nextFundingTime: t + H, providerTimestamp: t, bookGeneratedAt: t, markProviderTimestamp: t, fetchedAt: t };
  }
  async marks(symbols: string[]): Promise<Map<string, PrivateMark>> {
    this.calls.marksCalls++; this.calls.marksSymbols += symbols.length; const t = this.clock.now();
    return new Map(symbols.map(symbol => [symbol, { symbol, markPrice: '1000', lastPrice: '1000', markProviderTimestamp: t, receivedAt: t, fetchedAt: t }]));
  }
  async history(r: PrivateHistoryRequest) {
    this.calls.history++; const step = (r.intervalMinutes ?? 1) * M, candles = [];
    for (let t = r.startTime; t < r.endTime; t += step) candles.push({ timestamp: t, open: '1000', high: '1000', low: '1000', close: '1000' });
    return { symbol: r.symbol, tradeCandles: candles, markCandles: structuredClone(candles), fundingEvents: [], expectedFundingTimestamps: [], intervalMs: step, complete: true, issues: [], fetchedAt: this.clock.now(), fundingScheduleModel: 'NATIVE_DEMO_FIXED_FUNDING_V1' as const, instrument: instrument(r.symbol) };
  }
  async resolveCandle(): Promise<never> { throw new Error('not used'); }
}
const symbolAt = (i: number) => `S${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}USDT`;
let seq = 0; const key = () => `graph-${++seq}`;

describe.each([1, 10, 20, 30])('market-data calls per command with %i open contracts', (N) => {
  jest.setTimeout(60_000);
  const capBefore = process.env.NATIVE_MAX_CONCURRENT_CONTRACTS;
  beforeAll(() => { process.env.NATIVE_MAX_CONCURRENT_CONTRACTS = '40'; });
  afterAll(() => { if (capBefore === undefined) delete process.env.NATIVE_MAX_CONCURRENT_CONTRACTS; else process.env.NATIVE_MAX_CONCURRENT_CONTRACTS = capBefore; });

  /** N cross longs on N contracts; then every command kind is measured with the whole quote snapshot expired. */
  async function scenario(withFrame: boolean) {
    const clock = new Clock(H0 + 5 * H + 30_000), repo = new MemoryRepository(clock), market = new CountingMarket(clock, withFrame);
    const service = new NativeDemoService(repo, market as unknown as PrivateTradingMarketData, clock.now);
    await service.initialize(actor, key());
    for (let i = 0; i < N; i++) { clock.t += 10; await service.command(actor, { kind: 'OPEN', symbol: symbolAt(i), side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() }); }
    const measure = async (label: string, run: () => Promise<unknown>) => {
      clock.t += NATIVE_QUOTE_REUSE_MS + 1;              // the whole snapshot is older than the reuse window: nothing is served from it
      market.calls = zero(); await run(); return { label, ...market.calls };
    };
    const positions = () => repo.row!.snapshot.positions.filter(p => p.status === 'OPEN');
    const out: Record<string, Counts & { label: string }> = {};
    out.openNew = await measure('OPEN new contract', () => service.command(actor, { kind: 'OPEN', symbol: symbolAt(N), side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() }));
    // Back to N contracts: close the extra one (not measured).
    clock.t += NATIVE_QUOTE_REUSE_MS + 1; await service.command(actor, { kind: 'CLOSE', positionId: positions().find(p => p.symbol === symbolAt(N))!.id, idempotencyKey: key() });
    out.openAdd = await measure('OPEN accumulate', () => service.command(actor, { kind: 'OPEN', symbol: symbolAt(0), side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() }));
    out.closePartial = await measure('CLOSE partial', () => service.command(actor, { kind: 'CLOSE', positionId: positions().find(p => p.symbol === symbolAt(0))!.id, quantity: '0.5', idempotencyKey: key() }));
    out.reduceLimit = await measure('reduce-only LIMIT (rests)', () => service.command(actor, { kind: 'OPEN', symbol: symbolAt(0), side: 'SHORT', type: 'LIMIT', price: '2000', quantity: '0.5', leverage: '10', reduceOnly: true, positionId: positions().find(p => p.symbol === symbolAt(0))!.id, idempotencyKey: key() }));
    out.closeFull = await measure('CLOSE full', () => service.command(actor, { kind: 'CLOSE', positionId: positions().find(p => p.symbol === symbolAt(0))!.id, idempotencyKey: key() }));
    // Restore the N-th contract so REFRESH values N contracts again (not measured).
    clock.t += NATIVE_QUOTE_REUSE_MS + 1; await service.command(actor, { kind: 'OPEN', symbol: symbolAt(0), side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() });
    out.refresh = await measure('REFRESH (same minute)', () => service.command(actor, { kind: 'REFRESH', idempotencyKey: key() }));
    clock.t = Math.floor(clock.t / M) * M + M;             // a minute closed since the checkpoint: one history window per contract
    out.refreshMinute = await measure('REFRESH (a minute closed)', () => service.command(actor, { kind: 'REFRESH', idempotencyKey: key() }));
    out.read = await measure('plain read', () => service.state(actor));
    expect(positions()).toHaveLength(N);
    return out;
  }

  test('every contract is quoted itself when the live frame is not available (the path before this block)', async () => {
    const c = await scenario(false);
    // One instrument per opening order; the executed contract is quoted fresh and that quote serves its own valuation.
    expect(c.openNew).toMatchObject({ instrument: 1, freshQuote: N + 1, marksCalls: 0, history: 0 });
    expect(c.openAdd).toMatchObject({ instrument: 1, freshQuote: N, marksCalls: 0, history: 0 });
    expect(c.closePartial).toMatchObject({ instrument: 0, freshQuote: N, marksCalls: 0, history: 0 });
    expect(c.reduceLimit).toMatchObject({ instrument: 1, freshQuote: N, marksCalls: 0, history: 0 });
    expect(c.closeFull).toMatchObject({ instrument: 0, freshQuote: N, marksCalls: 0, history: 0 });
    expect(c.refresh).toMatchObject({ instrument: 0, freshQuote: N, marksCalls: 0, history: 0 });
    // One history window per contract exposed OR traded inside the replayed window: the extra contract opened and
    // closed earlier in this minute still needs its bar path for that instruction, hence N + 1.
    expect(c.refreshMinute).toMatchObject({ instrument: 0, freshQuote: N, marksCalls: 0, history: N + 1 });
    expect(c.read).toMatchObject({ instrument: 0, freshQuote: 0, marksCalls: 0, history: 0 });
  });
  test('with the live frame, a command quotes only the contract it executes on and reads the frame once for the rest', async () => {
    const c = await scenario(true);
    expect(c.openNew).toMatchObject({ instrument: 1, freshQuote: 1, marksCalls: 1, marksSymbols: N, history: 0 });
    expect(c.openAdd).toMatchObject({ instrument: 1, freshQuote: 1, marksCalls: N > 1 ? 1 : 0, marksSymbols: N - 1, history: 0 });
    expect(c.closePartial).toMatchObject({ instrument: 0, freshQuote: 1, marksCalls: N > 1 ? 1 : 0, marksSymbols: N - 1, history: 0 });
    expect(c.reduceLimit).toMatchObject({ instrument: 1, freshQuote: 1, marksCalls: N > 1 ? 1 : 0, marksSymbols: N - 1, history: 0 });
    expect(c.closeFull).toMatchObject({ instrument: 0, freshQuote: 1, marksCalls: N > 1 ? 1 : 0, marksSymbols: N - 1, history: 0 });
    expect(c.refresh).toMatchObject({ instrument: 0, freshQuote: 0, marksCalls: 1, marksSymbols: N, history: 0 });
    expect(c.refreshMinute).toMatchObject({ instrument: 0, freshQuote: 0, marksCalls: 1, marksSymbols: N, history: N + 1 });
    expect(c.read).toMatchObject({ instrument: 0, freshQuote: 0, marksCalls: 0, history: 0 });
  });
  test('a frame mark that would be older than the engine window when applied is replaced by a fresh quote, never used', async () => {
    const clock = new Clock(H0 + 5 * H + 30_000), repo = new MemoryRepository(clock), market = new CountingMarket(clock, true);
    const service = new NativeDemoService(repo, market as unknown as PrivateTradingMarketData, clock.now);
    await service.initialize(actor, key());
    await service.command(actor, { kind: 'OPEN', symbol: 'AAAUSDT', side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() });
    clock.t += NATIVE_QUOTE_REUSE_MS + 1;
    // The frame answers with a mark 4.5 s old: inside the collector's own window, outside the margin the service keeps.
    market.marks = async (symbols) => { market.calls.marksCalls++; const t = clock.now() - 4500; return new Map(symbols.map(s => [s, { symbol: s, markPrice: '1', lastPrice: '1', markProviderTimestamp: t, receivedAt: t, fetchedAt: clock.now() }])); };
    market.calls = zero();
    const v = await service.command(actor, { kind: 'REFRESH', idempotencyKey: key() });
    expect(market.calls).toMatchObject({ marksCalls: 1, freshQuote: 1 });
    expect(new BigNumber(v.positions[0].markPrice).toFixed()).toBe('1000');   // valued on the fresh quote, not on the old frame mark of 1
  });
  test('a frame that fails or holds nothing costs nothing and changes nothing: every contract is quoted itself', async () => {
    const clock = new Clock(H0 + 5 * H + 30_000), repo = new MemoryRepository(clock), market = new CountingMarket(clock, true);
    const service = new NativeDemoService(repo, market as unknown as PrivateTradingMarketData, clock.now);
    await service.initialize(actor, key());
    for (let i = 0; i < 3; i++) { clock.t += 10; await service.command(actor, { kind: 'OPEN', symbol: symbolAt(i), side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() }); }
    clock.t += NATIVE_QUOTE_REUSE_MS + 1; market.marks = async () => { throw new Error('collector down'); }; market.calls = zero();
    await service.command(actor, { kind: 'REFRESH', idempotencyKey: key() });
    expect(market.calls.freshQuote).toBe(3);
    clock.t += NATIVE_QUOTE_REUSE_MS + 1; market.marks = async () => new Map(); market.calls = zero();
    await service.command(actor, { kind: 'REFRESH', idempotencyKey: key() });
    expect(market.calls.freshQuote).toBe(3);
  });
});
