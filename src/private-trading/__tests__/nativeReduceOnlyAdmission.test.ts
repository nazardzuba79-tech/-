import BigNumber from 'bignumber.js';
import { emptyDemoState, registerDemoInstrument, markDemoAccount, placeDemoOrder, fillDemoOrder, DemoState, DemoEngineError } from '../native/engine';
import { validateContractOrder, ContractRuleError } from '../math';
import { NativeDemoService, NATIVE_QUOTE_REUSE_MS } from '../native/service';
import { NativeAccount, NativeRepository, revisionPayload, commandHash } from '../native/store';
import { assertNativeInvariants } from '../native/invariants';
import type { OwnerSession } from '../serviceTypes';
import { PrivateTradingError } from '../serviceTypes';
import type { PrivateTradingMarketData, PrivateInstrument, PrivateFreshQuote, PrivateHistoryRequest } from '../marketData';

/**
 * A REDUCING ORDER IS NEVER REFUSED BY THE TIER IT HAS GROWN INTO.
 *
 * `validateContractOrder` ends with the risk-tier leverage cap. It ran for
 * every order, including reduce-only ones, BEFORE the engine's own
 * "a reducing order is never refused by a tier" exemption — so a position
 * opened at an allowed leverage that the market carried up the ladder
 * (higher notional, lower maximum leverage) could not be closed with an
 * exact reduce-only LIMIT: TIER_LEVERAGE_EXCEEDED for a close. The tier
 * cap admits NEW exposure; every other contract rule still applies to a
 * reducing order, and so do its own checks.
 */
const M = 60_000, H = 3_600_000;
const H0 = Date.UTC(2026, 8, 15, 0, 0, 0);
const T = H0 + 5 * H;
const bn = (v: string | number) => new BigNumber(v);
// A ladder whose second tier allows less leverage than the first: 50x is fine on 50 000, not on 150 000.
const LADDER = [
  { riskLimitValue: '100000', maintenanceMarginRate: '0.005', initialMarginRate: '0.01', maintenanceDeduction: '0', maxLeverage: '100' },
  { riskLimitValue: '200000', maintenanceMarginRate: '0.01', initialMarginRate: '0.02', maintenanceDeduction: '500', maxLeverage: '25' },
  { riskLimitValue: '1000000000', maintenanceMarginRate: '0.015', initialMarginRate: '0.03', maintenanceDeduction: '1500', maxLeverage: '10' },
];
const rules = { symbol: 'LADDERUSDT', tickSize: '0.1', minPrice: '0.1', maxPrice: '10000000', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '1000', minNotionalValue: '5', minLeverage: '1', maxLeverage: '100', leverageStep: '1' };
// The engine's own tier shape (what `simulationProfile` derives from the provider ladder above).
const profile = { pricingModelVersion: 'fixture', feeModelVersion: 'fixture', riskModelVersion: 'fixture', takerFeeRate: '0.00055', makerFeeRate: '0.0002', liquidationFeeRate: '0', slippageBps: '0',
  riskTiers: LADDER.map(t => ({ maxNotional: t.riskLimitValue, maintenanceRate: t.maintenanceMarginRate, deduction: t.maintenanceDeduction, maxLeverage: t.maxLeverage })), assumptions: [] as string[] };
const inst = () => ({ symbol: 'LADDERUSDT', rules, profile });

function grown(marginType: 'CROSS' | 'ISOLATED' = 'CROSS'): DemoState {
  const s = emptyDemoState('1000000', T - M);
  registerDemoInstrument(s, inst());
  markDemoAccount(s, { LADDERUSDT: { mark: '1000', last: '1000' } }, T - M);
  // 50 × 1000 = 50 000 in tier 1 (max 100x): 50x is admitted.
  placeDemoOrder(s, { id: 'o1', symbol: 'LADDERUSDT', side: 'LONG', type: 'MARKET', quantity: '50', leverage: '50', marginType }, T - M);
  fillDemoOrder(s, 'o1', '50', '1000', T - M, 'SELECTED_POINT');
  // The market triples: 150 000 of notional is tier 2, whose maximum leverage is 25x — below the position's 50x.
  markDemoAccount(s, { LADDERUSDT: { mark: '3000', last: '3000' } }, T);
  return s;
}

describe('math: the tier leverage cap applies to new exposure only', () => {
  const base = { rules, profile, quantity: '50', price: '3000', leverage: '50', market: false };
  test('the same order is refused as new exposure and admitted as a reduction', () => {
    expect(() => validateContractOrder(base)).toThrow(ContractRuleError);
    expect(() => validateContractOrder(base)).toThrow('TIER_LEVERAGE_EXCEEDED');
    expect(() => validateContractOrder({ ...base, reduceOnly: true })).not.toThrow();
  });
  test('every other contract rule still binds a reducing order', () => {
    expect(() => validateContractOrder({ ...base, reduceOnly: true, quantity: '50.0005' })).toThrow('INVALID_QUANTITY_STEP');
    expect(() => validateContractOrder({ ...base, reduceOnly: true, price: '3000.05' })).toThrow('INVALID_PRICE_STEP');
    expect(() => validateContractOrder({ ...base, reduceOnly: true, quantity: '1001' })).toThrow('INVALID_ORDER_SIZE');
    expect(() => validateContractOrder({ ...base, reduceOnly: true, quantity: '0.001', price: '1' })).toThrow('INVALID_ORDER_SIZE');
    expect(() => validateContractOrder({ ...base, reduceOnly: true, leverage: '101' })).toThrow('INVALID_LEVERAGE');
  });
});

describe('engine: an exact reduce-only LIMIT on a position that outgrew its tier', () => {
  test('is accepted, reserves nothing, and names the position; new exposure at that leverage is still refused', () => {
    const s = grown();
    const o = placeDemoOrder(s, { id: 'r1', symbol: 'LADDERUSDT', side: 'SHORT', type: 'LIMIT', price: '3000', quantity: '50', leverage: '50', reduceOnly: true, positionId: 'o1' }, T);
    expect(o).toMatchObject({ status: 'OPEN', reserved: '0', reduceOnly: true, positionId: 'o1' });
    expect(() => placeDemoOrder(s, { id: 'n1', symbol: 'LADDERUSDT', side: 'LONG', type: 'LIMIT', price: '3000', quantity: '50', leverage: '50' }, T)).toThrow('TIER_LEVERAGE_EXCEEDED');
    assertNativeInvariants(s);
  });
  test('the reduction still fails its own checks: name, side, bucket, size and step', () => {
    const s = grown();
    const reduce = (extra: object) => () => placeDemoOrder(s, { id: `x-${Math.random()}`, symbol: 'LADDERUSDT', side: 'SHORT', type: 'LIMIT', price: '3000', quantity: '50', leverage: '50', reduceOnly: true, positionId: 'o1', ...extra }, T);
    expect(reduce({ positionId: undefined })).toThrow('POSITION_ID_REQUIRED');
    expect(reduce({ positionId: 'nope' })).toThrow(DemoEngineError);
    expect(reduce({ side: 'LONG' })).toThrow('INVALID_REDUCE_SIDE');
    expect(reduce({ marginType: 'ISOLATED' })).toThrow('MARGIN_TYPE_MISMATCH');
    expect(reduce({ quantity: '50.001' })).toThrow('CLOSE_EXCEEDS_POSITION');
    expect(reduce({ quantity: '10.0005' })).toThrow('INVALID_QUANTITY_STEP');
    expect(reduce({ price: '3000.05' })).toThrow('INVALID_PRICE_STEP');
    expect(s.orders).toHaveLength(1);
  });
  test('the same holds for an isolated position, in its own bucket', () => {
    const s = grown('ISOLATED');
    const o = placeDemoOrder(s, { id: 'r2', symbol: 'LADDERUSDT', side: 'SHORT', type: 'LIMIT', price: '3000', quantity: '50', leverage: '50', reduceOnly: true, positionId: 'o1', marginType: 'ISOLATED' }, T);
    expect(o).toMatchObject({ status: 'OPEN', reserved: '0', marginType: 'ISOLATED' });
    assertNativeInvariants(s);
  });
});

/* ---- through the service: the row-based target check, the instrument, the quote and the replay ---- */
class Clock { constructor(public t: number) {} now = () => this.t; }
class MemoryRepository implements NativeRepository {
  row: NativeAccount | null = null; revisions = new Map<number, NativeAccount>(); keys = new Map<string, { hash: string; row: NativeAccount }>();
  wallet: { asset: string; available: string; locked: string }[] = [];
  constructor(private clock: Clock) {}
  async read() { return this.row ? structuredClone(this.row) : null; }
  async available() { return this.row ? null : '1000000'; }
  async holdings() { return this.wallet; }
  async revision(_a: OwnerSession, r: number) { const v = this.revisions.get(r); return v ? structuredClone(v) : null; }
  async prior(_a: OwnerSession, key: string, hash: string) { const v = this.keys.get(key); if (!v) return null; if (v.hash !== hash) throw new PrivateTradingError('idempotency_conflict', 'conflict', 409); return structuredClone(v.row); }
  async initialize(_a: OwnerSession, key: string) {
    if (this.row) return structuredClone(this.row); const t = this.clock.now();
    this.row = { revision: 1, deposit: '1000000', commands: [], snapshot: emptyDemoState('1000000', t), createdAt: t, source: 'DEMO_BALANCE' };
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
  riskTiers: LADDER, parameterModel: 'CURRENT_INSTRUMENT_PARAMETERS', parameterVersion: 'LADDER_FIXTURE' });
class FakeMarket {
  price = '1000';
  constructor(private clock: Clock) {}
  async instrument(symbol: string) { return instrument(symbol); }
  async freshQuote(symbol: string): Promise<PrivateFreshQuote> {
    const t = this.clock.now(), p = bn(this.price);
    return { provider: 'bybit', symbol, bids: [{ price: p.minus('0.1').toFixed(), quantity: '100' }], asks: [{ price: p.plus('0.1').toFixed(), quantity: '100' }],
      markPrice: this.price, lastPrice: this.price, fundingRate: '0.0001', nextFundingTime: t + H, providerTimestamp: t, bookGeneratedAt: t, markProviderTimestamp: t, fetchedAt: t };
  }
  async history(r: PrivateHistoryRequest) {
    const step = (r.intervalMinutes ?? 1) * M, candles = [];
    for (let t = r.startTime; t < r.endTime; t += step) candles.push({ timestamp: t, open: this.price, high: this.price, low: this.price, close: this.price });
    return { symbol: r.symbol, tradeCandles: candles, markCandles: structuredClone(candles), fundingEvents: [], expectedFundingTimestamps: [], intervalMs: step, complete: true, issues: [], fetchedAt: this.clock.now(), fundingScheduleModel: 'NATIVE_DEMO_FIXED_FUNDING_V1' as const, instrument: instrument(r.symbol) };
  }
  async resolveCandle(): Promise<never> { throw new Error('not used'); }
}
const actor: OwnerSession = { userId: 'ladder', sessionId: 's', expiresAt: Number.MAX_SAFE_INTEGER };
let seq = 0; const key = () => `ladder-${++seq}`;

describe('service: a position carried up the ladder is closable with an exact reduce-only LIMIT', () => {
  test('the order is admitted, rests with no reserve, fills at its price as maker, and the account is square', async () => {
    const clock = new Clock(H0 + 5 * H + 30_000), repo = new MemoryRepository(clock), market = new FakeMarket(clock);
    const service = new NativeDemoService(repo, market as unknown as PrivateTradingMarketData, clock.now);
    await service.initialize(actor, key());
    let v = await service.command(actor, { kind: 'OPEN', symbol: 'LADDERUSDT', side: 'LONG', type: 'MARKET', quantity: '50', leverage: '50', idempotencyKey: key() });
    const p = v.positions[0];
    expect(p).toMatchObject({ leverage: '50', quantity: '50' });
    // Tripled: the position's notional is now in the 25x tier.
    market.price = '3000'; clock.t += NATIVE_QUOTE_REUSE_MS + 1;
    v = await service.command(actor, { kind: 'REFRESH', idempotencyKey: key() });
    expect(v.positions[0].markPrice).toBe('3000');
    // New exposure at 50x is refused there …
    clock.t += NATIVE_QUOTE_REUSE_MS + 1;
    await expect(service.command(actor, { kind: 'OPEN', symbol: 'LADDERUSDT', side: 'LONG', type: 'LIMIT', price: '3000', quantity: '50', leverage: '50', idempotencyKey: key() })).rejects.toThrow(/TIER_LEVERAGE_EXCEEDED/);
    // … and the exact close of the position is not.
    clock.t += NATIVE_QUOTE_REUSE_MS + 1;
    v = await service.command(actor, { kind: 'OPEN', symbol: 'LADDERUSDT', side: 'SHORT', type: 'LIMIT', price: '3100', quantity: '50', leverage: '50', reduceOnly: true, positionId: p.id, idempotencyKey: key() });
    const order = v.orders.find(o => o.reduceOnly && o.status === 'OPEN')!;
    expect(order).toMatchObject({ positionId: p.id, reserved: '0', price: '3100' });
    expect(v.account!.orderReserve).toBe('0');
    market.price = '3200'; clock.t += NATIVE_QUOTE_REUSE_MS + 1;      // the observed book has 100 on the bid at 3 199.9
    v = await service.command(actor, { kind: 'REFRESH', idempotencyKey: key() });
    expect(v.orders.find(o => o.id === order.id)).toMatchObject({ status: 'FILLED', averagePrice: '3100' });
    expect(v.positions).toHaveLength(0);
    const fill = v.events.find(e => e.orderId === order.id && e.kind === 'CLOSE')!;
    expect(fill).toMatchObject({ price: '3100', quantity: '50' });
    expect(bn(fill.fee).toFixed()).toBe(bn(50).times(3100).times('0.0002').toFixed());   // maker
    expect(v.ledger!.reconciled).toBe(true);
  });
});
