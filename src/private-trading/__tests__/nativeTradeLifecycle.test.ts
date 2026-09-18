import BigNumber from 'bignumber.js';
import { NativeDemoService, NATIVE_QUOTE_REUSE_MS } from '../native/service';
import { NativeAccount, NativeRepository, revisionPayload, commandHash } from '../native/store';
import { emptyDemoState, demoAccount } from '../native/engine';
import { assertNativeInvariants } from '../native/invariants';
import type { OwnerSession } from '../serviceTypes';
import { PrivateTradingError } from '../serviceTypes';
import type { PrivateTradingMarketData, PrivateInstrument, PrivateFreshQuote, PrivateHistoryRequest } from '../marketData';

/**
 * AN ORDINARY TRADE, STEP BY STEP, IN BOTH BUCKETS.
 *
 * Enough funds → MARKET OPEN → partial MARKET CLOSE at a better price →
 * add at a worse price → an exact reduce-only LIMIT CLOSE that rests and
 * fills as maker → full MARKET CLOSE. After every step the wallet, the
 * margin (initial margin for Cross, the post for Isolated), every fill's
 * price and quantity against the book the fixture actually served, the
 * fees, the realized P&L, the entry and the ledger are checked against
 * arithmetic written out here — and the whole state against the
 * independent invariants oracle. The fixture book is one level of 10 per
 * side at ±0.1 around `price`, so a fill has exactly one right price.
 */
const M = 60_000, H = 3_600_000;
const H0 = Date.UTC(2026, 8, 15, 0, 0, 0);
const TAKER = '0.00055', MAKER = '0.0002';
const actor: OwnerSession = { userId: 'life', sessionId: 's', expiresAt: Number.MAX_SAFE_INTEGER };
const bn = (v: string | number | BigNumber) => new BigNumber(v);
const fx = (v: BigNumber) => v.toFixed();

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
    const row = structuredClone({ ...next, revision: expected + 1 }); this.row = row;
    this.revisions.set(row.revision, revisionPayload(row)); this.keys.set(key, { hash, row: revisionPayload(row) }); return structuredClone(row);
  }
}
const instrument = (symbol: string): PrivateInstrument => ({ provider: 'bybit', symbol, baseAsset: symbol.replace(/USDT$/, ''), quoteAsset: 'USDT', settleAsset: 'USDT', contractType: 'LinearPerpetual', status: 'Trading', launchTime: Date.UTC(2020, 0, 1), fetchedAt: H0, fundingIntervalMinutes: 480,
  filters: { tickSize: '0.1', minPrice: '0.1', maxPrice: '10000000', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '1000', minNotionalValue: '5' }, leverage: { min: '1', max: '100', step: '1' },
  riskTiers: [{ riskLimitValue: '1000000000', maintenanceMarginRate: '0.005', initialMarginRate: '0.01', maintenanceDeduction: '0', maxLeverage: '100' }], parameterModel: 'CURRENT_INSTRUMENT_PARAMETERS', parameterVersion: 'LIFECYCLE_FIXTURE' });
class FakeMarket {
  price = '50000';
  /** Every book the fixture served, so a fill can be checked against the level it came from. */
  served: { time: number; bid: string; ask: string }[] = [];
  constructor(private clock: Clock) {}
  bid() { return bn(this.price).minus('0.1').toFixed(); }
  ask() { return bn(this.price).plus('0.1').toFixed(); }
  async instrument(symbol: string) { return instrument(symbol); }
  async freshQuote(symbol: string): Promise<PrivateFreshQuote> {
    const t = this.clock.now(); this.served.push({ time: t, bid: this.bid(), ask: this.ask() });
    return { provider: 'bybit', symbol, bids: [{ price: this.bid(), quantity: '10' }], asks: [{ price: this.ask(), quantity: '10' }],
      markPrice: this.price, lastPrice: this.price, fundingRate: '0.0001', nextFundingTime: t + H, providerTimestamp: t, bookGeneratedAt: t, markProviderTimestamp: t, fetchedAt: t };
  }
  async history(r: PrivateHistoryRequest) {
    const step = (r.intervalMinutes ?? 1) * M, candles = [];
    for (let t = r.startTime; t < r.endTime; t += step) candles.push({ timestamp: t, open: this.price, high: this.price, low: this.price, close: this.price });
    return { symbol: r.symbol, tradeCandles: candles, markCandles: structuredClone(candles), fundingEvents: [], expectedFundingTimestamps: [], intervalMs: step, complete: true, issues: [], fetchedAt: this.clock.now(), fundingScheduleModel: 'NATIVE_DEMO_FIXED_FUNDING_V1' as const, instrument: instrument(r.symbol) };
  }
  async resolveCandle(): Promise<never> { throw new Error('not used'); }
}
let seq = 0; const key = () => `life-${++seq}`;

describe.each(['CROSS', 'ISOLATED'] as const)('an ordinary %s trade: open, partial close, add, limit close, full close', (bucket) => {
  const DEPOSIT = '100000';
  const clock = new Clock(H0 + 5 * H + 30_000), repo = new MemoryRepository(clock, DEPOSIT), market = new FakeMarket(clock);
  const service = new NativeDemoService(repo, market as unknown as PrivateTradingMarketData, clock.now);
  const isolated = bucket === 'ISOLATED';
  /** The ledger of this test's own arithmetic, carried step to step. */
  const book = { wallet: bn(DEPOSIT), post: bn(0), fees: bn(0), gross: bn(0), qty: bn(0), entry: bn(0) };
  const fee = (qty: string | BigNumber, price: string, rate = TAKER) => bn(qty).times(price).times(rate);
  const run = async (request: Parameters<NativeDemoService['command']>[1]) => {
    clock.t += NATIVE_QUOTE_REUSE_MS + 1;
    const v = await service.command(actor, request);
    const s = repo.row!.snapshot;
    assertNativeInvariants(s, undefined, request.kind);
    expect(v.ledger!.reconciled).toBe(true);
    return { v, s, position: s.positions.find(p => p.symbol === 'BTCUSDT') };
  };
  /** The wallet, the margin, the fees and the realized P&L, against this test's own book. */
  const check = (s: ReturnType<typeof emptyDemoState>, v: { account: { settleBalance: string; initialMargin: string; usedMargin?: string } | null }) => {
    expect(bn(s.walletBalance).toFixed()).toBe(fx(book.wallet));
    const p = s.positions.find(p => p.symbol === 'BTCUSDT')!;
    expect(bn(p.closingFees).plus(p.openingFees).toFixed()).toBe(fx(book.fees));
    expect(bn(p.realizedGross).toFixed()).toBe(fx(book.gross));
    expect(bn(p.quantity).toFixed()).toBe(fx(book.qty));
    if (book.qty.gt(0)) expect(bn(p.entryPrice).toFixed()).toBe(fx(book.entry));
    const account = demoAccount(s);
    // Cross initial margin is the engine's own rule: quantity × MARK × (1 / leverage + the taker fee to close).
    const crossIm = book.qty.times(market.price).times(bn(1).div(10).plus(TAKER));
    if (isolated) { expect(bn(p.isolatedMargin).toFixed()).toBe(fx(book.post)); expect(bn(account.isolatedMargin).toFixed()).toBe(fx(book.post)); }
    else expect(bn(account.usedMargin).toFixed()).toBe(fx(crossIm));
    // The response account is the engine account: settle balance = wallet + posts, initial margin includes the post.
    expect(bn(v.account!.settleBalance).toFixed()).toBe(fx(book.wallet.plus(book.post)));
    expect(bn(v.account!.initialMargin).toFixed()).toBe(fx(isolated ? book.post : crossIm));
    // Available = equity − initial margin − reserve, at the fixture's current mark.
    const upl = book.qty.times(bn(market.price).minus(book.entry));
    const reserve = bn(account.orderReserve);
    expect(bn(account.available).toFixed()).toBe(fx(BigNumber.maximum(0, book.wallet.plus(isolated ? 0 : upl).minus(isolated ? 0 : crossIm).minus(reserve))));
  };
  const lastFill = (s: ReturnType<typeof emptyDemoState>, kind = 'CLOSE') => [...s.events].reverse().find(e => e.kind === kind)!;

  test('1. MARKET OPEN 2 at the ask: fee on the fill, margin from the wallet', async () => {
    await service.initialize(actor, key());
    const { v, s } = await run({ kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '2', leverage: '10', ...(isolated ? { marginType: 'ISOLATED' as const } : {}), idempotencyKey: key() });
    const ask = market.served.at(-1)!.ask;                       // 50000.1: the level the book actually had
    expect(lastFill(s, 'OPEN')).toMatchObject({ price: ask, quantity: '2', pricing: 'OBSERVED_BOOK' });
    book.fees = fee('2', ask); book.qty = bn(2); book.entry = bn(ask);
    book.wallet = book.wallet.minus(book.fees);
    if (isolated) { book.post = bn(2).times(ask).div(10); book.wallet = book.wallet.minus(book.post); }
    expect(fx(book.fees)).toBe('55.00011');
    check(s, v);
  });

  test('2. partial MARKET CLOSE 0.5 at a higher bid: realized on 0.5, entry unchanged', async () => {
    market.price = '52000';
    const before = repo.row!.snapshot.positions[0];
    const { v, s } = await run({ kind: 'CLOSE', positionId: before.id, quantity: '0.5', idempotencyKey: key() });
    const bid = market.served.at(-1)!.bid;                       // 51999.9
    expect(lastFill(s)).toMatchObject({ price: bid, quantity: '0.5', pricing: 'OBSERVED_BOOK' });
    const gross = bn('0.5').times(bn(bid).minus(book.entry)), f = fee('0.5', bid);
    expect(fx(gross)).toBe('999.9');
    book.gross = book.gross.plus(gross); book.fees = book.fees.plus(f); book.qty = bn('1.5');
    if (isolated) { const released = book.post.times('0.5').div(2); book.post = book.post.minus(released); book.wallet = book.wallet.plus(gross.minus(f).plus(released)); }
    else book.wallet = book.wallet.plus(gross).minus(f);
    check(s, v);
  });

  test('3. add 1 at a lower ask: the remaining 1.5 and the new 1 average to one entry', async () => {
    market.price = '48000';
    const { v, s } = await run({ kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', ...(isolated ? { marginType: 'ISOLATED' as const } : {}), idempotencyKey: key() });
    const ask = market.served.at(-1)!.ask;                       // 48000.1
    expect(lastFill(s, 'OPEN')).toMatchObject({ price: ask, quantity: '1' });
    expect(s.positions).toHaveLength(1);                         // same bucket, same side: ONE position
    const f = fee('1', ask);
    book.entry = book.qty.times(book.entry).plus(bn(ask)).div(book.qty.plus(1)); book.qty = bn('2.5');
    expect(fx(book.entry)).toBe('49200.1');                      // (1.5 × 50000.1 + 1 × 48000.1) / 2.5
    book.fees = book.fees.plus(f); book.wallet = book.wallet.minus(f);
    if (isolated) { const posted = bn(ask).div(10); book.post = book.post.plus(posted); book.wallet = book.wallet.minus(posted); }
    check(s, v);
  });

  test('4. an exact reduce-only LIMIT CLOSE of 1 rests with no reserve, then fills at its own price as maker', async () => {
    const p = repo.row!.snapshot.positions[0];
    const rested = await run({ kind: 'OPEN', symbol: 'BTCUSDT', side: 'SHORT', type: 'LIMIT', price: '55000', quantity: '1', leverage: '10', reduceOnly: true, positionId: p.id, ...(isolated ? { marginType: 'ISOLATED' as const } : {}), idempotencyKey: key() });
    const order = rested.v.orders.find(o => o.reduceOnly && o.status === 'OPEN')!;
    expect(order).toMatchObject({ positionId: p.id, reserved: '0', price: '55000', quantity: '1' });
    check(rested.s, rested.v);                                   // nothing moved: no fill, no reserve
    // The market trades through the limit; the next closed minute fills it as maker at the LIMIT price.
    market.price = '56000';
    clock.t = Math.floor(clock.t / M) * M + 2 * M;
    const { v, s } = await run({ kind: 'REFRESH', idempotencyKey: key() });
    expect(v.orders.find(o => o.id === order.id)).toMatchObject({ status: 'FILLED', averagePrice: '55000' });
    expect(lastFill(s)).toMatchObject({ price: '55000', quantity: '1', orderId: order.id });
    const gross = bn(1).times(bn('55000').minus(book.entry)), f = fee('1', '55000', MAKER);
    expect(fx(gross)).toBe('5799.9'); expect(fx(f)).toBe('11');
    book.gross = book.gross.plus(gross); book.fees = book.fees.plus(f);
    if (isolated) { const released = book.post.times(1).div(book.qty); book.post = book.post.minus(released); book.wallet = book.wallet.plus(gross.minus(f).plus(released)); }
    else book.wallet = book.wallet.plus(gross).minus(f);
    book.qty = bn('1.5');
    check(s, v);
  });

  test('5. full MARKET CLOSE at the bid: the position is closed, the post is home, the wallet is the arithmetic', async () => {
    const p = repo.row!.snapshot.positions[0];
    const { v, s } = await run({ kind: 'CLOSE', positionId: p.id, idempotencyKey: key() });
    const bid = market.served.at(-1)!.bid;                       // 55999.9
    expect(lastFill(s)).toMatchObject({ price: bid, quantity: '1.5', pricing: 'OBSERVED_BOOK' });
    const gross = bn('1.5').times(bn(bid).minus(book.entry)), f = fee('1.5', bid);
    expect(fx(gross)).toBe('10199.7');
    book.gross = book.gross.plus(gross); book.fees = book.fees.plus(f);
    if (isolated) { book.wallet = book.wallet.plus(gross.minus(f).plus(book.post)); book.post = bn(0); }
    else book.wallet = book.wallet.plus(gross).minus(f);
    book.qty = bn(0);
    expect(s.positions[0].status).toBe('CLOSED');
    expect(v.positions).toHaveLength(0);
    check(s, v);
    // Both buckets end at the same wallet: deposit + gross − fees, to the unit.
    expect(bn(s.walletBalance).toFixed()).toBe('116846.599945');
    expect(fx(book.gross)).toBe('16999.5'); expect(fx(book.fees)).toBe('152.900055');
    expect(v.ledger!.totals).toMatchObject({ realizedPnl: '16999.5', fees: '152.900055', shortfallCovered: '0' });
    expect(s.events.filter(e => e.kind === 'SHORTFALL')).toHaveLength(0);
    // Every fill in the journal is a level the fixture actually served, at the time it served it.
    for (const e of s.events.filter(e => e.pricing === 'OBSERVED_BOOK')) {
      const served = market.served.find(b => b.time === e.time)!;
      expect([served.bid, served.ask]).toContain(e.price);
    }
  });
});
