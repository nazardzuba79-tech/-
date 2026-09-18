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
 * AN ISOLATED POSITION CAN LOSE ITS POST, AND NOT ONE UNIT MORE — AND THE
 * JOURNAL STILL SAYS WHAT THE BOOK DID.
 *
 * The scenario the owner asked to have proven or disproven: an isolated
 * position is open with its margin posted; the next observed market gaps
 * past the position's bankruptcy level; the trader sends a manual MARKET
 * CLOSE before any refresh cycle has evaluated risk on that market.
 *
 * On the base engine the CLOSE consumed the gapped book FIRST and the live
 * risk pass ran AFTER it, so the close settled at the gapped price, the
 * loss beyond the post was debited to the shared wallet, and the post was
 * then "returned" — Cross collateral paid for an Isolated loss.
 *
 * The model these tests pin: a settlement is booked at the price it
 * actually happened at (the observed level, the trigger price, or the
 * bankruptcy price for a liquidation — the venue's takeover price, never a
 * fill) with its real fee and real realized P&L; the slice's settlement
 * (gross − fee + its share of the post) is credited to the shared wallet
 * when positive and NEVER debited; what the post cannot cover is a separate
 * SHORTFALL line paid by the simulation's insurance model. Every fill is
 * checked against the book the fixture actually served.
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
/** What the SHARED wallet lost on the position since the post left it. Zero means: the post, and not one unit more. */
const walletLoss = (walletBefore: string, s: DemoState) => bn(walletBefore).minus(s.walletBalance);
const feesOf = (s: DemoState) => s.events.reduce((v, e) => v.plus(e.fee), bn('0'));
const shortfalls = (s: DemoState) => s.events.filter(e => e.kind === 'SHORTFALL');
/** The settlement a slice leaves uncovered: −(gross − fee + released post), or 0. */
const uncovered = (gross: string, fee: string, released: string) => BigNumber.maximum(0, bn(gross).minus(fee).plus(released).negated()).toFixed();

describe('engine: every isolated settlement is booked at its actual price, and the post is all the wallet can lose', () => {
  test('a manual close past bankruptcy: the real price, the real loss, the real fee — and a SHORTFALL line for what the post could not cover', () => {
    const { s, posted, walletAfterOpen } = isolatedLong();
    expect(posted).toBe('5000');
    // The book gapped to 40 000; the position is worth -10 000 there.
    closeDemoPosition(s, 'iso', undefined, '40000', s.time + 1, 'OBSERVED_BOOK');
    const p = s.positions[0];
    expect(p.status).toBe('CLOSED');
    const fill = s.events.find(e => e.kind === 'CLOSE')!;
    // The fill IS the book: 40 000, for 1, and it says so.
    expect(fill).toMatchObject({ kind: 'CLOSE', price: '40000', quantity: '1', pricing: 'OBSERVED_BOOK', fee: '22' });   // 40 000 × 0.00055
    expect(p.realizedGross).toBe('-10000');
    // The slice's settlement: -10 000 - 22 + 5 000 = -5 022. The wallet is not debited; the line says who paid.
    const [cover] = shortfalls(s);
    expect(cover).toMatchObject({ kind: 'SHORTFALL', quantity: '1', price: '45000', cashflow: '5022', fee: '0', pricing: 'MARK_SETTLEMENT' });
    expect(cover.actionId).toBe(fill.actionId);
    expect(p.shortfallCovered).toBe('5022');
    expect(walletLoss(walletAfterOpen, s).toFixed()).toBe('0');
    const ledger = accountLedger(s);
    expect(ledger.reconciled).toBe(true);
    expect(ledger.totals).toMatchObject({ realizedPnl: '-10000', fees: bn('22').plus(s.events[0].fee).toFixed(), shortfallCovered: '5022' });
    expect(ledger.entries.map(e => e.source)).toEqual(['INITIAL_COLLATERAL', 'OPENING_FEE', 'REALIZED_PNL', 'CLOSING_FEE', 'SHORTFALL_COVER']);
    assertNativeInvariants(s);
  });

  test('a partial close past bankruptcy: pro rata post, its own shortfall; the remainder is then liquidated at bankruptcy, and the wallet never moved', () => {
    const { s, walletAfterOpen } = isolatedLong();
    markDemoAccount(s, { BTCUSDT: { mark: '40000', last: '40000' } }, s.time + 1);
    closeDemoPosition(s, 'iso', '0.4', '40000', s.time + 1, 'OBSERVED_BOOK');
    const p = s.positions[0];
    expect(p.status).toBe('OPEN');
    expect(p.quantity).toBe('0.6');
    const fill = s.events.find(e => e.kind === 'CLOSE')!;
    expect(fill).toMatchObject({ kind: 'CLOSE', quantity: '0.4', price: '40000', fee: '8.8' });
    expect(p.realizedGross).toBe('-4000');
    // 0.4 of the post (2 000) came home with the slice: -4 000 - 8.8 + 2 000 = -2 008.8 uncovered.
    expect(shortfalls(s).map(e => bn(e.cashflow).toFixed())).toEqual([uncovered('-4000', '8.8', '2000')]);
    expect(uncovered('-4000', '8.8', '2000')).toBe('2008.8');
    expect(p.isolatedMargin).toBe('3000');
    expect(p.shortfallCovered).toBe('2008.8');
    expect(walletLoss(walletAfterOpen, s).toFixed()).toBe('0');
    // The risk pass on the same mark takes the remaining 0.6 over at bankruptcy (45 000): gross -3 000 against the
    // 3 000 still posted, its fee 14.85 is the shortfall of that slice, and the wallet has still not moved.
    evaluateDemoRiskAndProtection(s, s.time + 1);
    expect(p.status).toBe('LIQUIDATED');
    expect(s.events.find(e => e.kind === 'LIQUIDATION')).toMatchObject({ quantity: '0.6', price: '45000', fee: '14.85' });
    expect(shortfalls(s).map(e => bn(e.cashflow).toFixed())).toEqual(['2008.8', '14.85']);
    expect(p.realizedGross).toBe('-7000'); expect(p.isolatedMargin).toBe('0'); expect(p.shortfallCovered).toBe('2023.65');
    expect(walletLoss(walletAfterOpen, s).toFixed()).toBe('0');
    expect(accountLedger(s).reconciled).toBe(true);
    assertNativeInvariants(s);
  });

  test('a stop-loss that fires at a gapped last price is booked at that price, shortfall covered the same way', () => {
    const { s, walletAfterOpen } = isolatedLong();
    protectDemoPosition(s, 'iso', { stopLoss: '48000', triggerBy: 'LAST' }, s.time + 1);
    // Mark still above bankruptcy (no liquidation), last gapped straight through the stop AND bankruptcy.
    markDemoAccount(s, { BTCUSDT: { mark: '46000', last: '40000' } }, s.time + 2);
    evaluateDemoRiskAndProtection(s, s.time + 2);
    const p = s.positions[0];
    expect(p.status).toBe('CLOSED');
    expect(s.events.find(e => e.kind === 'STOP_LOSS')).toMatchObject({ price: '40000', quantity: '1', fee: '22' });
    expect(shortfalls(s).map(e => e.cashflow)).toEqual(['5022']);
    expect(walletLoss(walletAfterOpen, s).toFixed()).toBe('0');
    assertNativeInvariants(s);
  });

  test('a short past its bankruptcy price: the same, on the other side', () => {
    const s = emptyDemoState('10000', T - M);
    registerDemoInstrument(s, inst());
    markDemoAccount(s, { BTCUSDT: { mark: '50000', last: '50000' } }, T - M);
    placeDemoOrder(s, { id: 'iso', symbol: 'BTCUSDT', side: 'SHORT', type: 'MARKET', quantity: '1', leverage: '10', marginType: 'ISOLATED' }, T - M);
    fillDemoOrder(s, 'iso', '1', '50000', T - M, 'SELECTED_POINT');
    const walletAfterOpen = s.walletBalance;
    closeDemoPosition(s, 'iso', undefined, '60000', s.time + 1, 'OBSERVED_BOOK'); // bankruptcy = 55 000
    expect(s.events.find(e => e.kind === 'CLOSE')).toMatchObject({ price: '60000', fee: '33' });
    expect(s.positions[0].realizedGross).toBe('-10000');
    expect(shortfalls(s)[0]).toMatchObject({ price: '55000', cashflow: '5033' });
    expect(walletLoss(walletAfterOpen, s).toFixed()).toBe('0');
    assertNativeInvariants(s);
  });

  test('a price INSIDE the post settles where it actually is, pays its fee from the post, and leaves no shortfall line', () => {
    const { s, walletAfterOpen } = isolatedLong();
    closeDemoPosition(s, 'iso', undefined, '47000', s.time + 1, 'OBSERVED_BOOK');
    expect(s.events.at(-1)).toMatchObject({ kind: 'CLOSE', price: '47000', fee: '25.85' });
    expect(s.positions[0].realizedGross).toBe('-3000');
    expect(shortfalls(s)).toHaveLength(0);
    // The wallet gets the slice's settlement: -3 000 - 25.85 + 5 000 = 1 974.15 back of the 5 000 it posted.
    expect(bn(s.walletBalance).minus(walletAfterOpen).toFixed()).toBe('1974.15');
    const { s: t, walletAfterOpen: w2 } = isolatedLong();
    closeDemoPosition(t, 'iso', undefined, '52000', t.time + 1, 'OBSERVED_BOOK');
    expect(t.events.at(-1)).toMatchObject({ price: '52000', fee: '28.6' });
    expect(t.positions[0].realizedGross).toBe('2000');
    expect(bn(t.walletBalance).minus(w2).toFixed()).toBe('6971.4');
    assertNativeInvariants(s); assertNativeInvariants(t);
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
    assertNativeInvariants(s);
  });

  test('a liquidation settles at the bankruptcy price (the takeover price, not a fill): the post is gone, its fee is the shortfall, the account is square', () => {
    const { s, walletAfterOpen } = isolatedLong();
    markDemoAccount(s, { BTCUSDT: { mark: '30000', last: '30000' } }, s.time + 1);
    evaluateDemoRiskAndProtection(s, s.time + 1);
    expect(s.positions[0].status).toBe('LIQUIDATED');
    const liq = s.events.find(e => e.kind === 'LIQUIDATION')!;
    expect(liq).toMatchObject({ price: '45000', quantity: '1', fee: '24.75', pricing: 'OHLC_PATH_MODEL' });
    expect(s.positions[0].realizedGross).toBe('-5000');
    expect(shortfalls(s).map(e => e.cashflow)).toEqual(['24.75']);
    expect(walletLoss(walletAfterOpen, s).toFixed()).toBe('0');
    expect(demoAccount(s).deficit).toBe('0');
    expect(feesOf(s).toFixed()).toBe(bn(liq.fee).plus(s.events[0].fee).toFixed());
    assertNativeInvariants(s);
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
  /** When set, the bid side of the next books served (a thin top level, a gap, a deep level below). */
  bids: { price: string; quantity: string }[] | null = null;
  served: { time: number; bids: { price: string; quantity: string }[] }[] = [];
  constructor(private clock: Clock) {}
  async instrument(symbol: string) { return instrument(symbol); }
  async freshQuote(symbol: string): Promise<PrivateFreshQuote> {
    const t = this.clock.now(), p = bn(this.price);
    const bids = this.bids ?? [{ price: p.minus('0.1').toFixed(), quantity: '10' }];
    this.served.push({ time: t, bids });
    return { provider: 'bybit', symbol, bids, asks: [{ price: p.plus('0.1').toFixed(), quantity: '10' }],
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

  test('the observed gap is evaluated BEFORE the close consumes the book: the position is liquidated at bankruptcy, the account loses the post and not one unit more', async () => {
    const { f, id, walletAfterOpen, bankruptcy } = await opened();
    // The next observation of THIS market is 40 000 — through the 45 000.09 bankruptcy level. No refresh has run.
    f.clock.t += 2_000; f.market.price = '40000';
    const v = await f.service.command(actor, { kind: 'CLOSE', positionId: id, idempotencyKey: key() });
    expect(v.positions).toHaveLength(0);
    const closed = v.history.find(p => p.id === id)!;
    expect(closed.status).toBe('LIQUIDATED');
    const settlement = v.events.filter(e => e.positionId === id && ['CLOSE', 'LIQUIDATION'].includes(e.kind));
    expect(settlement).toHaveLength(1);
    // The venue's takeover price, at the venue's pricing — never a book level presented as a fill.
    expect(settlement[0]).toMatchObject({ kind: 'LIQUIDATION', price: bankruptcy, quantity: '1', pricing: 'LIVE_QUOTE_MODEL' });
    expect(bn(settlement[0].fee).toFixed()).toBe(bn(bankruptcy).times('0.00055').toFixed());
    // The fee is what the post cannot cover: it is the SHORTFALL line, and the wallet does not move.
    const cover = v.events.filter(e => e.positionId === id && e.kind === 'SHORTFALL');
    expect(cover.map(e => e.cashflow)).toEqual([settlement[0].fee]);
    expect(bn(f.repo.row!.snapshot.walletBalance).minus(walletAfterOpen).toFixed()).toBe('0');
    expect(closed.shortfallCovered).toBe(settlement[0].fee);
    expect(v.ledger!.reconciled).toBe(true);
    expect(v.ledger!.totals.shortfallCovered).toBe(settlement[0].fee);
    expect(v.account!.liquidatable).toBe(false);
  });

  test('a gap that stays inside the post is an ordinary close at the observed book: the fill is the served bid, exactly', async () => {
    const { f, id, walletAfterOpen } = await opened();
    f.clock.t += 2_000; f.market.price = '47000';
    const v = await f.service.command(actor, { kind: 'CLOSE', positionId: id, idempotencyKey: key() });
    const closed = v.history.find(p => p.id === id)!;
    expect(closed.status).toBe('CLOSED');
    const fill = v.events.at(-1)!;
    expect(fill).toMatchObject({ kind: 'CLOSE', price: f.market.served.at(-1)!.bids[0].price, quantity: '1', pricing: 'OBSERVED_BOOK' });
    expect(fill.price).toBe('46999.9');
    expect(v.events.filter(e => e.kind === 'SHORTFALL')).toHaveLength(0);
    // -3 000.2 gross - 25.849945 fee + 5 000.01 post = 1 973.960055 back to the wallet.
    expect(bn(f.repo.row!.snapshot.walletBalance).minus(walletAfterOpen).toFixed()).toBe('1973.960055');
  });

  test('a book with a thin level inside the post and a deep level past bankruptcy: two fills at the two served prices, ONE action, a shortfall for the second slice only', async () => {
    const { f, id, walletAfterOpen } = await opened();
    // Mark 46 000 (above the 45 000.09 bankruptcy: no liquidation in the risk pass); the bid side is 0.5 at
    // 45 999.9, nothing until 44 000, then 10.
    f.clock.t += 2_000; f.market.price = '46000';
    f.market.bids = [{ price: '45999.9', quantity: '0.5' }, { price: '44000', quantity: '10' }];
    const v = await f.service.command(actor, { kind: 'CLOSE', positionId: id, idempotencyKey: key() });
    expect(v.history.find(p => p.id === id)!.status).toBe('CLOSED');
    const fills = v.events.filter(e => e.positionId === id && e.kind === 'CLOSE');
    const served = f.market.served.at(-1)!.bids;
    expect(fills.map(e => [e.price, e.quantity, e.pricing])).toEqual([[served[0].price, '0.5', 'OBSERVED_BOOK'], [served[1].price, '0.5', 'OBSERVED_BOOK']]);
    expect(new Set(fills.map(e => e.actionId)).size).toBe(1);
    // Slice 1: 0.5 × (45 999.9 - 50 000.1) = -2 000.1, fee 12.649972 5, released 2 500.005 → +487.2550275 to the wallet, no line.
    // Slice 2: 0.5 × (44 000 - 50 000.1) = -3 000.05, fee 12.1, released 2 500.005 → -512.145 uncovered.
    const cover = v.events.filter(e => e.positionId === id && e.kind === 'SHORTFALL');
    expect(cover).toHaveLength(1);
    expect(cover[0]).toMatchObject({ quantity: '0.5', cashflow: '512.145', actionId: fills[0].actionId });
    expect(bn(f.repo.row!.snapshot.walletBalance).minus(walletAfterOpen).toFixed()).toBe('487.2550275');
    const closed = v.history.find(p => p.id === id)!;
    expect(closed.realizedGross).toBe('-5000.15');
    expect(closed.shortfallCovered).toBe('512.145');
    expect(v.ledger!.reconciled).toBe(true);
  });

  test('the same ordering protects a CROSS account: a gap past maintenance liquidates before the close can execute at the gap', async () => {
    const f = service('5200'); await f.service.initialize(actor, 'gap-init-cross');
    const v = await f.service.command(actor, { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '2', leverage: '20', idempotencyKey: key() });
    const id = v.positions[0].id;
    f.clock.t += 2_000; f.market.price = '30000'; // far below the account's boundary (~47 600)
    const after = await f.service.command(actor, { kind: 'CLOSE', positionId: id, idempotencyKey: key() });
    expect(after.history.find(p => p.id === id)!.status).toBe('LIQUIDATED');
    expect(after.events.filter(e => e.kind === 'LIQUIDATION')).toHaveLength(1);
    expect(after.events.filter(e => e.kind === 'SHORTFALL')).toHaveLength(0);   // a cross loss is the account's own
  });
});
