import BigNumber from 'bignumber.js';
import { NativeDemoService } from '../native/service';
import { NativeAccount, NativeRepository, revisionPayload, commandHash } from '../native/store';
import { emptyDemoState, registerDemoInstrument, markDemoAccount, placeDemoOrder, fillDemoOrder, closeDemoPosition, settleDemoFunding,
  evaluateDemoRiskAndProtection, protectDemoPosition, demoAccount, DemoInstrument, DemoState } from '../native/engine';
import { accountLedger } from '../native/ledger';
import { assertNativeInvariants } from '../native/invariants';
import type { OwnerSession } from '../serviceTypes';
import { PrivateTradingError } from '../serviceTypes';
import type { PrivateTradingMarketData, PrivateInstrument, PrivateFreshQuote, PrivateHistoryRequest } from '../marketData';

/**
 * AN ISOLATED POSITION CAN LOSE ITS POST, AND NOT ONE UNIT MORE.
 *
 * The scenario the owner asked to have proven or disproven: an isolated
 * position is open with its margin posted; the next observed market gaps
 * past the position's bankruptcy level; the trader sends a manual MARKET
 * CLOSE before any refresh cycle has evaluated risk on that market.
 *
 * On the base engine the CLOSE consumed the gapped book FIRST and the live
 * risk pass ran AFTER it, so the close settled at the gapped price, the
 * loss beyond the post was debited to the shared wallet, and the post was
 * then "returned" — Cross collateral paid for an Isolated loss. These tests
 * pin the accounting on every settlement path: manual close, TP/SL at a
 * gapped last, funding larger than the post, and the service ordering.
 */
const M = 60_000, H = 3_600_000;
const H0 = Date.UTC(2026, 8, 15, 0, 0, 0);
const T = 1_728_000_000_000; // an 8h funding boundary
const actor: OwnerSession = { userId: 'owner', sessionId: 's', expiresAt: Number.MAX_SAFE_INTEGER };
const bn = (v: string) => new BigNumber(v);

// ---------------------------------------------------------------- engine level
const FEE = '0.00055';
const inst = (symbol = 'BTCUSDT'): DemoInstrument => ({
  rules: { symbol, tickSize: '0.1', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '1000', minNotionalValue: '5', minLeverage: '1', maxLeverage: '100', leverageStep: '1' },
  profile: { pricingModelVersion: 'fixture', feeModelVersion: 'fixture', riskModelVersion: 'fixture', takerFeeRate: FEE, makerFeeRate: FEE, liquidationFeeRate: '0', slippageBps: '0',
    riskTiers: [{ maxNotional: '1000000000', maintenanceRate: '0.005', deduction: '0', maxLeverage: '100' }], assumptions: [] },
});
function isolatedLong(deposit = '10000', at = T - M): { s: DemoState; posted: string; walletAfterOpen: string } {
  const s = emptyDemoState(deposit, at);
  registerDemoInstrument(s, inst());
  markDemoAccount(s, { BTCUSDT: { mark: '50000', last: '50000' } }, at);
  // 1 BTC at 50 000, 10x: 5 000 posted; bankruptcy for a long = 50 000 - 5 000 / 1 = 45 000.
  placeDemoOrder(s, { id: 'iso', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', marginType: 'ISOLATED' }, at);
  fillDemoOrder(s, 'iso', '1', '50000', at, 'SELECTED_POINT');
  return { s, posted: s.positions[0].isolatedMargin, walletAfterOpen: s.walletBalance };
}
/** What the SHARED wallet lost on the position, beyond the fees it was charged. */
const walletLoss = (walletBefore: string, s: DemoState) => bn(walletBefore).minus(s.walletBalance);
const feesOf = (s: DemoState) => s.events.reduce((v, e) => v.plus(e.fee), bn('0'));

describe('engine: every isolated settlement is bounded by the post', () => {
  test('a manual close settled at a price past bankruptcy costs the account the post, not the gap', () => {
    const { s, posted, walletAfterOpen } = isolatedLong();
    expect(posted).toBe('5000');
    // The book gapped to 40 000; the position is worth -10 000 there.
    closeDemoPosition(s, 'iso', undefined, '40000', s.time + 1, 'OBSERVED_BOOK');
    const p = s.positions[0];
    expect(p.status).toBe('CLOSED');
    // The wallet: post consumed (it left at open and does not come back) — and NOTHING more than the closing fee.
    const lost = walletLoss(walletAfterOpen, s);
    const closingFee = bn(s.events.at(-1)!.fee);
    expect(lost.minus(closingFee).toFixed()).toBe('0');
    // The close was settled AT the bankruptcy price, and says so.
    expect(s.events.at(-1)).toMatchObject({ kind: 'CLOSE', price: '45000' });
    expect(p.realizedGross).toBe('-5000');
    expect(accountLedger(s).reconciled).toBe(true);
  });

  test('a partial close past bankruptcy is bounded pro rata, and the remainder still stands on what is left of the post', () => {
    const { s, walletAfterOpen } = isolatedLong();
    closeDemoPosition(s, 'iso', '0.4', '40000', s.time + 1, 'OBSERVED_BOOK');
    const p = s.positions[0];
    expect(p.status).toBe('OPEN');
    expect(p.quantity).toBe('0.6');
    // 0.4 of the post (2 000) is what that slice could lose: settled at 45 000, gross -2 000.
    expect(s.events.at(-1)).toMatchObject({ kind: 'CLOSE', quantity: '0.4', price: '45000' });
    expect(p.realizedGross).toBe('-2000');
    expect(p.isolatedMargin).toBe('3000');
    expect(walletLoss(walletAfterOpen, s).minus(s.events.at(-1)!.fee).toFixed()).toBe('0');
  });

  test('a stop-loss that fires at a gapped last price is bounded the same way', () => {
    const { s, walletAfterOpen } = isolatedLong();
    protectDemoPosition(s, 'iso', { stopLoss: '48000', triggerBy: 'LAST' }, s.time + 1);
    // Mark still above bankruptcy (no liquidation), last gapped straight through the stop AND bankruptcy.
    markDemoAccount(s, { BTCUSDT: { mark: '46000', last: '40000' } }, s.time + 2);
    evaluateDemoRiskAndProtection(s, s.time + 2);
    const p = s.positions[0];
    expect(p.status).toBe('CLOSED');
    expect(s.events.at(-1)).toMatchObject({ kind: 'STOP_LOSS', price: '45000' });
    expect(walletLoss(walletAfterOpen, s).minus(s.events.at(-1)!.fee).toFixed()).toBe('0');
  });

  test('a short is bounded above its bankruptcy price', () => {
    const s = emptyDemoState('10000', T - M);
    registerDemoInstrument(s, inst());
    markDemoAccount(s, { BTCUSDT: { mark: '50000', last: '50000' } }, T - M);
    placeDemoOrder(s, { id: 'iso', symbol: 'BTCUSDT', side: 'SHORT', type: 'MARKET', quantity: '1', leverage: '10', marginType: 'ISOLATED' }, T - M);
    fillDemoOrder(s, 'iso', '1', '50000', T - M, 'SELECTED_POINT');
    const walletAfterOpen = s.walletBalance;
    closeDemoPosition(s, 'iso', undefined, '60000', s.time + 1, 'OBSERVED_BOOK'); // bankruptcy = 55 000
    expect(s.events.at(-1)).toMatchObject({ kind: 'CLOSE', price: '55000' });
    expect(s.positions[0].realizedGross).toBe('-5000');
    expect(walletLoss(walletAfterOpen, s).minus(s.events.at(-1)!.fee).toFixed()).toBe('0');
  });

  test('a price INSIDE the post settles where it actually is: the bound never improves an ordinary loss or profit', () => {
    const { s } = isolatedLong();
    closeDemoPosition(s, 'iso', undefined, '47000', s.time + 1, 'OBSERVED_BOOK');
    expect(s.events.at(-1)).toMatchObject({ price: '47000' });
    expect(s.positions[0].realizedGross).toBe('-3000');
    const { s: t } = isolatedLong();
    closeDemoPosition(t, 'iso', undefined, '52000', t.time + 1, 'OBSERVED_BOOK');
    expect(t.events.at(-1)).toMatchObject({ price: '52000' });
    expect(t.positions[0].realizedGross).toBe('2000');
  });

  test('funding larger than what is posted is charged to the post only, never to the shared wallet', () => {
    // A tiny post: 1 BTC at 50 000 with 100x leverage posts 500.
    const s = emptyDemoState('10000', T - M);
    registerDemoInstrument(s, inst());
    markDemoAccount(s, { BTCUSDT: { mark: '50000', last: '50000' } }, T - M);
    placeDemoOrder(s, { id: 'iso', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '1', leverage: '100', marginType: 'ISOLATED' }, T - M);
    fillDemoOrder(s, 'iso', '1', '50000', T - M, 'SELECTED_POINT');
    const walletAfterOpen = s.walletBalance;
    // The model charges a long -0.001 of position value per boundary: at a mark of 600 000 that is -600, more than the 500 posted.
    markDemoAccount(s, { BTCUSDT: { mark: '600000', last: '600000' } }, T);
    settleDemoFunding(s, T);
    const funding = s.events.find(e => e.kind === 'FUNDING')!;
    expect(funding.cashflow).toBe('-500');
    expect(s.positions[0].isolatedMargin).toBe('0');
    expect(s.positions[0].fundingNet).toBe('-500');
    expect(s.walletBalance).toBe(walletAfterOpen);
  });

  test('the shared account is square after an isolated liquidation past bankruptcy', () => {
    const { s, walletAfterOpen } = isolatedLong();
    markDemoAccount(s, { BTCUSDT: { mark: '30000', last: '30000' } }, s.time + 1);
    evaluateDemoRiskAndProtection(s, s.time + 1);
    expect(s.positions[0].status).toBe('LIQUIDATED');
    expect(s.events.at(-1)).toMatchObject({ kind: 'LIQUIDATION', price: '45000' });
    expect(walletLoss(walletAfterOpen, s).minus(s.events.at(-1)!.fee).toFixed()).toBe('0');
    expect(demoAccount(s).deficit).toBe('0');
  });
});

// --------------------------------------------------------------- service level
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
    const prior = await this.prior(_a, key, hash); if (prior) return prior;
    if (this.row?.revision !== expected) throw new PrivateTradingError('account_changed', 'changed', 409);
    assertNativeInvariants(next.snapshot, undefined, `commit ${expected + 1}`);
    const row = structuredClone({ ...next, revision: expected + 1 }); this.row = row;
    this.revisions.set(row.revision, revisionPayload(row)); this.keys.set(key, { hash, row: revisionPayload(row) }); return structuredClone(row);
  }
}
const instrument = (symbol: string): PrivateInstrument => ({ provider: 'bybit', symbol, baseAsset: symbol.replace(/USDT$/, ''), quoteAsset: 'USDT', settleAsset: 'USDT', contractType: 'LinearPerpetual', status: 'Trading', launchTime: Date.UTC(2020, 0, 1), fetchedAt: H0, fundingIntervalMinutes: 480,
  filters: { tickSize: '0.1', minPrice: '0.1', maxPrice: '10000000', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '1000', minNotionalValue: '5' }, leverage: { min: '1', max: '100', step: '1' },
  riskTiers: [{ riskLimitValue: '1000000000', maintenanceMarginRate: '0.005', initialMarginRate: '0.01', maintenanceDeduction: '0', maxLeverage: '100' }], parameterModel: 'CURRENT_INSTRUMENT_PARAMETERS', parameterVersion: 'TEST_FIXTURE' });
class FakeMarket {
  price = '50000';
  constructor(private clock: Clock) {}
  async instrument(symbol: string) { return instrument(symbol); }
  async freshQuote(symbol: string): Promise<PrivateFreshQuote> {
    const t = this.clock.now(), p = bn(this.price);
    return { provider: 'bybit', symbol, bids: [{ price: p.minus('0.1').toFixed(), quantity: '10' }], asks: [{ price: p.plus('0.1').toFixed(), quantity: '10' }],
      markPrice: this.price, lastPrice: this.price, fundingRate: '0.0001', nextFundingTime: t + H, providerTimestamp: t, bookGeneratedAt: t, markProviderTimestamp: t, fetchedAt: t };
  }
  async history(r: PrivateHistoryRequest) {
    const step = (r.intervalMinutes ?? 1) * M, candles = [];
    for (let t = r.startTime; t < r.endTime; t += step) candles.push({ timestamp: t, open: this.price, high: this.price, low: this.price, close: this.price });
    return { symbol: r.symbol, tradeCandles: candles, markCandles: structuredClone(candles), fundingEvents: [], expectedFundingTimestamps: [], intervalMs: step, complete: true, issues: [], fetchedAt: this.clock.now(), fundingScheduleModel: 'NATIVE_DEMO_FIXED_FUNDING_V1' as const, instrument: instrument(r.symbol) };
  }
  async resolveCandle(): Promise<never> { throw new Error('not used'); }
}
function service(deposit = '10000') {
  const clock = new Clock(H0 + 5 * H + 30_000), repo = new MemoryRepository(clock, deposit), market = new FakeMarket(clock);
  return { clock, repo, market, service: new NativeDemoService(repo, market as unknown as PrivateTradingMarketData, clock.now) };
}
let seq = 0; const key = () => `gap-${++seq}`;

describe('service: a manual MARKET CLOSE sent into a gap past bankruptcy, before any refresh', () => {
  async function opened() {
    const f = service('10000'); await f.service.initialize(actor, 'gap-init');
    const v = await f.service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', marginType: 'ISOLATED', idempotencyKey: key() });
    const p = v.positions[0];
    // Filled at the ask (50 000.1): 5 000.01 posted, bankruptcy at 50 000.1 - 5 000.01 = 45 000.09.
    expect(p).toMatchObject({ marginMode: 'ISOLATED', isolatedMargin: '5000.01', entryPrice: '50000.1' });
    const bankruptcy = bn(p.entryPrice).minus(bn(p.isolatedMargin).div(p.quantity)).toFixed();
    return { f, id: p.id, bankruptcy, walletAfterOpen: f.repo.row!.snapshot.walletBalance };
  }

  test('the observed gap is evaluated BEFORE the close consumes the book: the position is liquidated at bankruptcy and the account loses the post, not the gap', async () => {
    const { f, id, walletAfterOpen, bankruptcy } = await opened();
    // The next observation of THIS market is 40 000 — through the 45 000.09 bankruptcy level. No refresh has run.
    f.clock.t += 2_000; f.market.price = '40000';
    const v = await f.service.command(actor, { kind: 'CLOSE', positionId: id, idempotencyKey: key() });
    expect(v.positions).toHaveLength(0);
    const closed = v.history.find(p => p.id === id)!;
    expect(closed.status).toBe('LIQUIDATED');
    const settlement = v.events.filter(e => e.positionId === id && ['CLOSE', 'LIQUIDATION'].includes(e.kind));
    expect(settlement).toHaveLength(1);
    expect(settlement[0]).toMatchObject({ kind: 'LIQUIDATION', price: bankruptcy, quantity: '1' });
    // The shared wallet: the post is gone, the fee is charged, and not one unit of the 5 000 beyond the post.
    const wallet = bn(f.repo.row!.snapshot.walletBalance);
    expect(bn(walletAfterOpen).minus(wallet).minus(settlement[0].fee).toFixed()).toBe('0');
    expect(v.ledger!.reconciled).toBe(true);
    expect(v.account!.liquidatable).toBe(false);
  });

  test('a gap that stays inside the post is an ordinary close at the observed book', async () => {
    const { f, id } = await opened();
    f.clock.t += 2_000; f.market.price = '47000';
    const v = await f.service.command(actor, { kind: 'CLOSE', positionId: id, idempotencyKey: key() });
    const closed = v.history.find(p => p.id === id)!;
    expect(closed.status).toBe('CLOSED');
    expect(v.events.at(-1)).toMatchObject({ kind: 'CLOSE', price: '46999.9', pricing: 'OBSERVED_BOOK' });
  });

  test('the same ordering protects a CROSS account: a gap past maintenance liquidates before the close can execute at the gap', async () => {
    const f = service('5200'); await f.service.initialize(actor, 'gap-init-cross');
    const v = await f.service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '2', leverage: '20', idempotencyKey: key() });
    const id = v.positions[0].id;
    f.clock.t += 2_000; f.market.price = '30000'; // far below the account's boundary (~47 600)
    const after = await f.service.command(actor, { kind: 'CLOSE', positionId: id, idempotencyKey: key() });
    expect(after.history.find(p => p.id === id)!.status).toBe('LIQUIDATED');
    expect(after.events.filter(e => e.kind === 'LIQUIDATION')).toHaveLength(1);
  });
});
