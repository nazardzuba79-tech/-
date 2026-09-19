import BigNumber from 'bignumber.js';
import { NativeDemoService, NATIVE_QUOTE_REUSE_MS } from '../native/service';
import { NativeAccount, NativeRepository, revisionPayload, commandHash } from '../native/store';
import { emptyDemoState } from '../native/engine';
import { assertNativeInvariants } from '../native/invariants';
import type { OwnerSession } from '../serviceTypes';
import { PrivateTradingError } from '../serviceTypes';
import type { PrivateTradingMarketData, PrivateInstrument, PrivateFreshQuote, PrivateHistoryRequest } from '../marketData';

/**
 * A LIVE LIMIT ORDER FILLS ON AN OBSERVED BOOK, INSIDE THE MINUTE.
 *
 * Before this block a resting live limit order filled only on the replayed
 * OHLC path — after its minute had closed, for its whole remaining size,
 * because the bar's last had crossed its price. A price proves no volume.
 * Now the order rests until a command observes a fresh book whose opposite
 * side has depth at prices no worse than the order's; it fills for that
 * depth, at its own price as maker; the remainder keeps resting; the same
 * provider snapshot presented again brings nothing more. The clock never
 * leaves the minute the order was placed in, and no history window is
 * loaded: nothing here is the path. The explicitly historical mode (an
 * order placed with a `candle`) keeps the path; it is covered in
 * `nativeDemoService.test.ts`.
 */
const M = 60_000, H = 3_600_000;
const H0 = Date.UTC(2026, 8, 15, 0, 0, 0);
const TAKER = '0.00055', MAKER = '0.0002';
const actor: OwnerSession = { userId: 'live', sessionId: 's', expiresAt: Number.MAX_SAFE_INTEGER };
const bn = (v: string | number | BigNumber) => new BigNumber(v);
type Level = { price: string; quantity: string };

class Clock { constructor(public t: number) {} now = () => this.t; }
class MemoryRepository implements NativeRepository {
  row: NativeAccount | null = null; revisions = new Map<number, NativeAccount>(); keys = new Map<string, { hash: string; row: NativeAccount }>();
  wallet: { asset: string; available: string; locked: string }[] = [];
  constructor(private clock: Clock, private deposit: string) {}
  async read() { return this.row ? structuredClone(this.row) : null; }
  async available() { return this.row ? null : this.deposit; }
  async holdings() { return this.wallet; }
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
    const row = structuredClone({ ...next, revision: expected + 1 }); this.row = row;
    this.revisions.set(row.revision, revisionPayload(row)); this.keys.set(key, { hash, row: revisionPayload(row) }); return structuredClone(row);
  }
}
const instrument = (symbol: string): PrivateInstrument => ({ provider: 'bybit', symbol, baseAsset: symbol.replace(/USDT$/, ''), quoteAsset: 'USDT', settleAsset: 'USDT', contractType: 'LinearPerpetual', status: 'Trading', launchTime: Date.UTC(2020, 0, 1), fetchedAt: H0, fundingIntervalMinutes: 480,
  filters: { tickSize: '0.1', minPrice: '0.1', maxPrice: '10000000', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '1000', minNotionalValue: '5' }, leverage: { min: '1', max: '100', step: '1' },
  riskTiers: [{ riskLimitValue: '1000000000', maintenanceMarginRate: '0.005', initialMarginRate: '0.01', maintenanceDeduction: '0', maxLeverage: '100' }], parameterModel: 'CURRENT_INSTRUMENT_PARAMETERS', parameterVersion: 'LIVE_LIMIT_FIXTURE' });
class FakeMarket {
  price = '50000';
  /** The book the next quotes carry; null = one level of 10 per side at ±0.1. */
  bids: Level[] | null = null; asks: Level[] | null = null;
  served: { time: number; bids: Level[]; asks: Level[] }[] = [];
  calls = { quote: 0, history: 0 };
  constructor(private clock: Clock) {}
  async instrument(symbol: string) { return instrument(symbol); }
  async freshQuote(symbol: string): Promise<PrivateFreshQuote> {
    this.calls.quote++;
    const t = this.clock.now(), p = bn(this.price);
    const bids = this.bids ?? [{ price: p.minus('0.1').toFixed(), quantity: '10' }], asks = this.asks ?? [{ price: p.plus('0.1').toFixed(), quantity: '10' }];
    this.served.push({ time: t, bids, asks });
    return { provider: 'bybit', symbol, bids, asks, markPrice: this.price, lastPrice: this.price, fundingRate: '0.0001', nextFundingTime: t + H, providerTimestamp: t, bookGeneratedAt: t, markProviderTimestamp: t, fetchedAt: t };
  }
  async history(r: PrivateHistoryRequest) {
    this.calls.history++;
    const step = (r.intervalMinutes ?? 1) * M, candles = [];
    for (let t = r.startTime; t < r.endTime; t += step) candles.push({ timestamp: t, open: this.price, high: this.price, low: this.price, close: this.price });
    return { symbol: r.symbol, tradeCandles: candles, markCandles: structuredClone(candles), fundingEvents: [], expectedFundingTimestamps: [], intervalMs: step, complete: true, issues: [], fetchedAt: this.clock.now(), fundingScheduleModel: 'NATIVE_DEMO_FIXED_FUNDING_V1' as const, instrument: instrument(r.symbol) };
  }
  async resolveCandle(): Promise<never> { throw new Error('not used'); }
}
let seq = 0; const key = () => `live-${++seq}`;
function setup(deposit = '100000') {
  // 00:05:30 — every step of a test stays inside this minute.
  const clock = new Clock(H0 + 5 * H + 5 * M + 30_000), repo = new MemoryRepository(clock, deposit), market = new FakeMarket(clock);
  const service = new NativeDemoService(repo, market as unknown as PrivateTradingMarketData, clock.now);
  const minute = Math.floor(clock.t / M);
  const step = () => { clock.t += NATIVE_QUOTE_REUSE_MS + 1; expect(Math.floor(clock.t / M)).toBe(minute); };
  const journal = () => repo.row!.commands;
  return { clock, repo, market, service, step, journal, minute };
}
const refresh = (f: ReturnType<typeof setup>) => f.service.command(actor, { kind: 'REFRESH', idempotencyKey: key() });

describe('an opening LIMIT on an account that holds nothing else', () => {
  test('rests, fills only for the depth a fresh book has at its price, never twice from one snapshot, and completes on the next snapshot — all inside one minute, with no history loaded', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    // 1. Buy 1 @ 48 000 while the market is 50 000: nothing is marketable, the order rests with its reserve.
    let v = await f.service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'LIMIT', price: '48000', quantity: '1', leverage: '10', idempotencyKey: key() });
    const order = v.orders[0];
    expect(order).toMatchObject({ status: 'OPEN', remaining: '1', filled: '0' });
    expect(bn(order.reserved).gt(0)).toBe(true);
    expect(v.positions).toHaveLength(0);
    const historyAfterPlacement = f.market.calls.history;
    // 2. The market comes down but not through the price: the order is watched (this is the only exposure), nothing fills.
    f.step(); f.market.price = '49000';
    v = await refresh(f);
    expect(v.orders[0]).toMatchObject({ status: 'OPEN', remaining: '1' });
    expect(f.journal().some(c => c.kind === 'BOOK')).toBe(false);
    // 3. The last crosses the price, and the book has 0.3 at 47 500.1 — then a level ABOVE the limit that cannot fill a buy at 48 000.
    f.step(); f.market.price = '47500'; f.market.asks = [{ price: '47500.1', quantity: '0.3' }, { price: '49000', quantity: '5' }];
    v = await refresh(f);
    expect(v.orders[0]).toMatchObject({ status: 'PARTIALLY_FILLED', filled: '0.3', remaining: '0.7', averagePrice: '48000' });
    expect(v.positions).toHaveLength(1);
    expect(v.positions[0]).toMatchObject({ quantity: '0.3', entryPrice: '48000' });
    const fill = v.events.find(e => e.kind === 'OPEN')!;
    expect(fill).toMatchObject({ price: '48000', quantity: '0.3', pricing: 'MAKER_MODEL', sourcePrice: '47500.1' });     // the order's OWN price, as maker
    expect(bn(fill.fee).toFixed()).toBe(bn('0.3').times(48000).times(MAKER).toFixed());
    const book = f.journal().find(c => c.kind === 'BOOK')!;
    expect(book.kind === 'BOOK' && book.book).toEqual({ bids: [], asks: [{ price: '47500.1', quantity: '0.3' }], timestamp: f.clock.t });   // cut to what the order could take
    expect(f.market.calls.history).toBe(historyAfterPlacement);                                    // no bar was consulted
    // 4. The same snapshot again (no time has passed, the quote is the cached one): nothing more.
    const quotesBefore = f.market.calls.quote;
    v = await refresh(f);
    expect(v.orders[0]).toMatchObject({ filled: '0.3', remaining: '0.7' });
    expect(f.journal().filter(c => c.kind === 'BOOK')).toHaveLength(1);
    expect(f.market.calls.quote).toBe(quotesBefore);
    // 5. A new snapshot with depth: the remainder fills, at 48 000, and the order is done.
    f.step(); f.market.asks = [{ price: '47500.1', quantity: '5' }];
    v = await refresh(f);
    expect(v.orders[0]).toMatchObject({ status: 'FILLED', filled: '1', remaining: '0', averagePrice: '48000' });
    expect(v.positions[0]).toMatchObject({ quantity: '1', entryPrice: '48000' });
    expect(f.journal().filter(c => c.kind === 'BOOK')).toHaveLength(2);
    expect(v.events.filter(e => e.kind === 'OPEN').map(e => [e.price, e.quantity])).toEqual([['48000', '0.3'], ['48000', '0.7']]);
    expect(f.market.calls.history).toBe(historyAfterPlacement);
    expect(v.ledger!.reconciled).toBe(true);
    // 6. The journal is the whole story: a second service on the same rows replays to the same account.
    const again = new NativeDemoService(f.repo, f.market as unknown as PrivateTradingMarketData, f.clock.now);
    const replayed = await again.state(actor);
    expect(replayed.positions).toEqual(v.positions); expect(replayed.orders).toEqual(v.orders); expect(replayed.events).toEqual(v.events);
  });

  test('a last that crossed the price with no depth at or better than it fills nothing and journals nothing', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    await f.service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'LIMIT', price: '48000', quantity: '1', leverage: '10', idempotencyKey: key() });
    f.step(); f.market.price = '47000'; f.market.asks = [{ price: '48500', quantity: '10' }];         // last 47 000, but the offer is 48 500
    const v = await refresh(f);
    expect(v.orders[0]).toMatchObject({ status: 'OPEN', remaining: '1' });
    expect(v.positions).toHaveLength(0);
    expect(f.journal().some(c => c.kind === 'BOOK')).toBe(false);
  });
});

describe('an exact reduce-only LIMIT on a position', () => {
  test('rests without reserve, fills for the observed depth at its own price, keeps the remainder, and closes on the next snapshot', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    let v = await f.service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() });
    const p = v.positions[0];
    expect(p).toMatchObject({ quantity: '1', entryPrice: '50000.1' });
    f.step();
    v = await f.service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'SHORT', type: 'LIMIT', price: '55000', quantity: '1', leverage: '10', reduceOnly: true, positionId: p.id, idempotencyKey: key() });
    const order = v.orders.find(o => o.reduceOnly)!;
    expect(order).toMatchObject({ status: 'OPEN', reserved: '0', positionId: p.id });
    // The market trades up through 55 000, and the bid side has 0.4 at 55 999.9.
    f.step(); f.market.price = '56000'; f.market.bids = [{ price: '55999.9', quantity: '0.4' }];
    v = await refresh(f);
    expect(v.orders.find(o => o.id === order.id)).toMatchObject({ status: 'PARTIALLY_FILLED', filled: '0.4', remaining: '0.6', averagePrice: '55000' });
    expect(v.positions[0]).toMatchObject({ id: p.id, quantity: '0.6', entryPrice: '50000.1' });
    const fill = v.events.find(e => e.kind === 'CLOSE')!;
    expect(fill).toMatchObject({ price: '55000', quantity: '0.4', orderId: order.id, pricing: 'MAKER_MODEL', sourcePrice: '55999.9' });
    expect(bn(fill.fee).toFixed()).toBe(bn('0.4').times(55000).times(MAKER).toFixed());
    expect(bn(fill.cashflow).plus(fill.fee).toFixed()).toBe(bn('0.4').times(bn(55000).minus('50000.1')).toFixed());
    // Same snapshot: nothing more.
    v = await refresh(f);
    expect(v.orders.find(o => o.id === order.id)).toMatchObject({ remaining: '0.6' });
    expect(f.journal().filter(c => c.kind === 'BOOK')).toHaveLength(1);
    // A new snapshot with depth: the rest fills, the position is closed, the order is done.
    f.step(); f.market.bids = [{ price: '55999.9', quantity: '10' }];
    v = await refresh(f);
    expect(v.orders.find(o => o.id === order.id)).toMatchObject({ status: 'FILLED', averagePrice: '55000' });
    expect(v.positions).toHaveLength(0);
    expect(v.history.find(x => x.id === p.id)).toMatchObject({ status: 'CLOSED', realizedGross: bn(1).times(bn(55000).minus('50000.1')).toFixed() });
    expect(v.ledger!.reconciled).toBe(true);
    expect(f.market.calls.history).toBe(0);
  });

  test('the executed contract of the SAME command serves the book: a CLOSE of another position on that contract fills the resting order from its own fresh quote, once', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    let v = await f.service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() });
    const long = v.positions[0];
    f.step();
    v = await f.service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'SHORT', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() });   // a hedge, its own position
    const short = v.positions.find(x => x.side === 'SHORT')!;
    f.step();
    v = await f.service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'SHORT', type: 'LIMIT', price: '55000', quantity: '1', leverage: '10', reduceOnly: true, positionId: long.id, idempotencyKey: key() });
    const order = v.orders.find(o => o.reduceOnly)!;
    // The market is at 56 000 with 10 on the bid; the trader closes the hedge at MARKET. That command's fresh
    // quote is the book the resting close of the long fills from — one observation, both consumers.
    f.step(); f.market.price = '56000';
    const quotesBefore = f.market.calls.quote;
    v = await f.service.command(actor, { kind: 'CLOSE', positionId: short.id, idempotencyKey: key() });
    expect(f.market.calls.quote).toBe(quotesBefore + 1);
    expect(v.orders.find(o => o.id === order.id)).toMatchObject({ status: 'FILLED', averagePrice: '55000' });
    expect(v.positions).toHaveLength(0);
    // The hedge's market close took 1 of the 10 bids at 55 999.9; the resting order took 1 more from the same snapshot.
    const bookIds = f.journal().filter(c => c.kind === 'BOOK');
    expect(bookIds).toHaveLength(1);
    expect(v.ledger!.reconciled).toBe(true);
  });
});

/**
 * R10 — THE PASS READS EVERY ORDER AGAIN AT EVERY STEP, AND THE LEDGER
 * RECORDS WHAT WAS FILLED.
 *
 * On the reviewed head the pass over resting orders iterated a list taken
 * once: a full close cancels the position's other orders, the next
 * iteration then filled a CANCELLED order, ORDER_NOT_OPEN left the whole
 * command uncommitted — the correct close before it included. And a
 * reduce-only fill recorded the quantity it ASKED the book for, not the
 * quantity the position could still give. Both, on a Cross and on an
 * Isolated position, at prices that trigger no liquidation and no TP/SL.
 */
describe.each(['CROSS', 'ISOLATED'] as const)('R10 on a %s position', (marginType) => {
  const openLong = (f: ReturnType<typeof setup>, symbol: string, quantity: string) =>
    f.service.command(actor, { kind: 'OPEN', symbol, side: 'LONG', type: 'MARKET', quantity, leverage: '10', marginType, idempotencyKey: key() });
  const reduceLimit = (f: ReturnType<typeof setup>, positionId: string, quantity: string, price: string) =>
    f.service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'SHORT', type: 'LIMIT', price, quantity, leverage: '10', reduceOnly: true, positionId, marginType, idempotencyKey: key() });
  const consumption = (f: ReturnType<typeof setup>, level: string) => Object.values(f.repo.row!.snapshot.bookConsumption).find(c => c.seen?.bids[level] !== undefined)!;

  test('A: two exact reduce-only limits of the whole size and liquidity for both — the first closes the position, the second is cancelled, the command commits, the other position is untouched', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    let v = await openLong(f, 'BTCUSDT', '1'); const p = v.positions[0];
    f.step(); v = await openLong(f, 'ETHUSDT', '1'); const other = v.positions.find(x => x.symbol === 'ETHUSDT')!;
    f.step(); v = await reduceLimit(f, p.id, '1', '55000'); const first = v.orders.find(o => o.reduceOnly)!;
    f.step(); v = await reduceLimit(f, p.id, '1', '55000'); const second = v.orders.find(o => o.reduceOnly && o.id !== first.id)!;
    expect(v.orders.filter(o => o.reduceOnly && o.status === 'OPEN')).toHaveLength(2);
    f.step(); f.market.price = '56000'; f.market.bids = [{ price: '55999.9', quantity: '2' }];
    const revision = v.revision;
    v = await refresh(f);
    expect(v.revision).toBe(revision + 1);                                                         // committed, not thrown away
    expect(v.orders.find(o => o.id === first.id)).toMatchObject({ status: 'FILLED', filled: '1', averagePrice: '55000' });
    expect(v.orders.find(o => o.id === second.id)).toMatchObject({ status: 'CANCELLED', filled: '0' });
    expect(v.events.filter(e => e.kind === 'CLOSE')).toHaveLength(1);                            // one close, never two
    expect(v.events.filter(e => e.kind === 'CANCEL').map(e => e.orderId)).toEqual([second.id]);
    expect(v.history.find(x => x.id === p.id)).toMatchObject({ status: 'CLOSED', marginMode: marginType });
    expect(v.positions).toHaveLength(1);
    expect(v.positions[0]).toMatchObject({ id: other.id, quantity: '1', entryPrice: other.entryPrice, marginMode: marginType, status: 'OPEN' });
    expect(consumption(f, '55999.9').bids['55999.9']).toBe('1');                                   // 1 of the 2 on the bid, not 2
    expect(f.journal().filter(c => c.kind === 'BOOK')).toHaveLength(1);
    expect(v.ledger!.reconciled).toBe(true);
    expect(f.market.calls.history).toBe(0);
  });

  test('B: the limit still names 1 after another action left 0.4 of the position; a level of 0.5 closes and consumes exactly 0.4, a further level is untouched, the same snapshot again does nothing', async () => {
    const f = setup(); await f.service.initialize(actor, key());
    let v = await openLong(f, 'BTCUSDT', '1'); const p = v.positions[0];
    f.step(); v = await reduceLimit(f, p.id, '1', '55000'); const order = v.orders.find(o => o.reduceOnly)!;
    f.step(); v = await f.service.command(actor, { kind: 'CLOSE', positionId: p.id, quantity: '0.6', idempotencyKey: key() });
    expect(v.positions[0]).toMatchObject({ id: p.id, quantity: '0.4' });
    expect(v.orders.find(o => o.id === order.id)).toMatchObject({ status: 'OPEN', remaining: '1' });
    f.step(); f.market.price = '56000'; f.market.bids = [{ price: '55999.9', quantity: '0.5' }, { price: '55999.8', quantity: '5' }];
    v = await refresh(f);
    const fills = v.events.filter(e => e.kind === 'CLOSE' && e.orderId === order.id);
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({ quantity: '0.4', price: '55000', pricing: 'MAKER_MODEL', sourcePrice: '55999.9' });
    expect(v.orders.find(o => o.id === order.id)).toMatchObject({ status: 'CANCELLED', filled: '0.4', remaining: '0.6' });
    expect(v.positions).toHaveLength(0);
    expect(v.history.find(x => x.id === p.id)).toMatchObject({ status: 'CLOSED', marginMode: marginType });
    const ledger = consumption(f, '55999.9');
    expect(ledger.seen!.bids['55999.9']).toBe('0.5');
    expect(ledger.bids['55999.9']).toBe('0.4');                                                  // exactly the remainder, 0.1 left unused
    expect(ledger.bids['55999.8']).toBeUndefined();                                                // the second level was never touched
    const events = v.events.length, books = f.journal().filter(c => c.kind === 'BOOK').length;
    v = await refresh(f);                                                                          // the same snapshot again
    expect(v.events).toHaveLength(events);
    expect(f.journal().filter(c => c.kind === 'BOOK')).toHaveLength(books);
    expect(v.ledger!.reconciled).toBe(true);
    expect(f.market.calls.history).toBe(0);
  });
});
