import BigNumber from 'bignumber.js';
import { NativeDemoService, NATIVE_QUOTE_REUSE_MS } from '../native/service';
import { NativeAccount, NativeRepository, revisionPayload, commandHash } from '../native/store';
import { emptyDemoState, demoAccount, positionRisk } from '../native/engine';
import { nativeAdmissionLimits } from '../native/replay';
import { assertNativeInvariants } from '../native/invariants';
import type { OwnerSession } from '../serviceTypes';
import { PrivateTradingError } from '../serviceTypes';
import type { PrivateTradingMarketData, PrivateInstrument, PrivateFreshQuote, PrivateHistoryRequest } from '../marketData';
import type { CollateralValuation } from '../native/collateral';

/**
 * THIRTY-PLUS LIVE POSITIONS, EVERY MUTATION, EVERY INVARIANT.
 *
 * Deterministic: a fixture market with one price per contract that the test
 * moves on purpose, a fixed clock advanced one second per command, and the
 * REAL service, replay and engine. After every command the whole account is
 * re-derived from its journal by `assertNativeInvariants` and compared with
 * what the engine reports, and the response account is checked to be the
 * engine account. Nothing here is a claim about latency.
 */
const M = 60_000, H = 3_600_000;
const H0 = Date.UTC(2026, 8, 15, 0, 0, 0);
const actor: OwnerSession = { userId: 'stress', sessionId: 's', expiresAt: Number.MAX_SAFE_INTEGER };
const bn = (v: string | number) => new BigNumber(v);

class Clock { constructor(public t: number) {} now = () => this.t; }
class MemoryRepository implements NativeRepository {
  row: NativeAccount | null = null; revisions = new Map<number, NativeAccount>(); keys = new Map<string, { hash: string; row: NativeAccount }>(); commits = 0;
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
    const row = structuredClone({ ...next, revision: expected + 1 }); this.row = row; this.commits++;
    this.revisions.set(row.revision, revisionPayload(row)); this.keys.set(key, { hash, row: revisionPayload(row) }); return structuredClone(row);
  }
}
const FLAT = [{ riskLimitValue: '1000000000', maintenanceMarginRate: '0.005', initialMarginRate: '0.01', maintenanceDeduction: '0', maxLeverage: '100' }];
// Continuous ladder for the tier-transition contract: deduction_i+1 = deduction_i + cap_i x (rate_i+1 - rate_i).
const LADDER = [
  { riskLimitValue: '100000', maintenanceMarginRate: '0.005', initialMarginRate: '0.01', maintenanceDeduction: '0', maxLeverage: '100' },
  { riskLimitValue: '200000', maintenanceMarginRate: '0.01', initialMarginRate: '0.02', maintenanceDeduction: '500', maxLeverage: '50' },
  { riskLimitValue: '400000', maintenanceMarginRate: '0.015', initialMarginRate: '0.03', maintenanceDeduction: '1500', maxLeverage: '25' },
  { riskLimitValue: '1000000000', maintenanceMarginRate: '0.02', initialMarginRate: '0.04', maintenanceDeduction: '3500', maxLeverage: '10' },
];
const instrument = (symbol: string): PrivateInstrument => ({ provider: 'bybit', symbol, baseAsset: symbol.replace(/USDT$/, ''), quoteAsset: 'USDT', settleAsset: 'USDT', contractType: 'LinearPerpetual', status: 'Trading', launchTime: Date.UTC(2020, 0, 1), fetchedAt: H0, fundingIntervalMinutes: 480,
  filters: { tickSize: '0.1', minPrice: '0.1', maxPrice: '10000000', qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1000', maxMarketOrderQty: '1000', minNotionalValue: '5' }, leverage: { min: '1', max: '100', step: '1' },
  riskTiers: symbol === 'TIERUSDT' ? LADDER : FLAT, parameterModel: 'CURRENT_INSTRUMENT_PARAMETERS', parameterVersion: 'STRESS_FIXTURE' });
class FakeMarket {
  prices = new Map<string, string>();
  depth = new Map<string, { price: string; quantity: string }[]>();
  calls = { instrument: 0, quote: 0, history: 0 };
  constructor(private clock: Clock) {}
  price(symbol: string) { return this.prices.get(symbol) ?? '1000'; }
  async instrument(symbol: string) { this.calls.instrument++; return instrument(symbol); }
  async freshQuote(symbol: string): Promise<PrivateFreshQuote> {
    this.calls.quote++;
    const t = this.clock.now(), p = bn(this.price(symbol));
    const custom = this.depth.get(symbol);
    const bids = custom ? custom.map((l, i) => ({ price: p.minus(0.1 * (i + 1)).toFixed(1), quantity: l.quantity })) : [{ price: p.minus('0.1').toFixed(1), quantity: '100' }];
    const asks = custom ? custom.map((l, i) => ({ price: p.plus(0.1 * (i + 1)).toFixed(1), quantity: l.quantity })) : [{ price: p.plus('0.1').toFixed(1), quantity: '100' }];
    return { provider: 'bybit', symbol, bids, asks, markPrice: p.toFixed(), lastPrice: p.toFixed(), fundingRate: '0.0001', nextFundingTime: t + H, providerTimestamp: t, bookGeneratedAt: t, markProviderTimestamp: t, fetchedAt: t };
  }
  async history(r: PrivateHistoryRequest) {
    this.calls.history++;
    const step = (r.intervalMinutes ?? 1) * M, candles = [], p = bn(this.price(r.symbol)).toFixed();
    for (let t = r.startTime; t < r.endTime; t += step) candles.push({ timestamp: t, open: p, high: p, low: p, close: p });
    return { symbol: r.symbol, tradeCandles: candles, markCandles: structuredClone(candles), fundingEvents: [], expectedFundingTimestamps: [], intervalMs: step, complete: true, issues: [], fetchedAt: this.clock.now(), fundingScheduleModel: 'NATIVE_DEMO_FIXED_FUNDING_V1' as const, instrument: instrument(r.symbol) };
  }
  async resolveCandle(): Promise<never> { throw new Error('not used'); }
}
const valuation: CollateralValuation = { settleAsset: 'USDT', lines: [], priced: '0', unpriced: [], complete: true, asOf: null };
const symbolAt = (i: number) => `S${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}USDT`;

describe('30+ live positions through the real service, with every invariant after every command', () => {
  jest.setTimeout(120_000);
  const capBefore = process.env.NATIVE_MAX_CONCURRENT_CONTRACTS;
  afterAll(() => { if (capBefore === undefined) delete process.env.NATIVE_MAX_CONCURRENT_CONTRACTS; else process.env.NATIVE_MAX_CONCURRENT_CONTRACTS = capBefore; });
  const clock = new Clock(H0 + 5 * H + 30_000), repo = new MemoryRepository(clock, '10000000'), market = new FakeMarket(clock);
  const service = new NativeDemoService(repo, market as unknown as PrivateTradingMarketData, clock.now);
  let seq = 0; const key = () => `stress-${++seq}`;
  const steps: string[] = [];
  /** Run one command, then hold the whole account to the invariants and the response to the engine. */
  async function run(label: string, request: Parameters<NativeDemoService['command']>[1]) {
    // Past the quote-reuse window, so every command values the account on the fixture's CURRENT prices.
    clock.t += NATIVE_QUOTE_REUSE_MS + 1;
    const commitsBefore = repo.commits;
    const v = await service.command(actor, request);
    const snapshot = repo.row!.snapshot;
    assertNativeInvariants(snapshot, valuation, label);
    const engine = demoAccount(snapshot);
    // The response account IS the engine account of the committed snapshot. A REFRESH that changed nothing is
    // not persisted (it answers with the projection at fresh marks on the same revision), so only a commit is compared.
    if (repo.commits > commitsBefore) {
      expect(v.revision).toBe(repo.row!.revision);
      expect(v.account!.available).toBe(engine.available);
      expect(v.account!.maintenanceMargin).toBe(engine.maintenanceMargin);
      // settleBalance is the wallet plus the margin posted to open isolated positions (Bybit's wallet-balance convention).
      const posted = snapshot.positions.filter(p => p.status === 'OPEN' && p.marginType === 'ISOLATED').reduce((a, p) => a.plus(p.isolatedMargin!), bn(0));
      expect(bn(v.account!.settleBalance).toFixed()).toBe(bn(engine.walletBalance).plus(posted).toFixed());
    } else {
      expect(request.kind).toBe('REFRESH');
    }
    expect(v.ledger!.reconciled).toBe(true);
    steps.push(label);
    return v;
  }
  const openPosition = (v: Awaited<ReturnType<typeof run>>, symbol: string, side: 'LONG' | 'SHORT', mode: 'CROSS' | 'ISOLATED' = 'CROSS') =>
    v.positions.find(p => p.symbol === symbol && p.side === side && p.marginMode === mode)!;

  test('the whole scenario holds', async () => {
    for (let i = 0; i < 32; i++) market.prices.set(symbolAt(i), String(1000 + i * 50));
    market.prices.set('TIERUSDT', '1000');
    await service.initialize(actor, 'stress-init');
    expect(nativeAdmissionLimits().contracts).toBeGreaterThanOrEqual(30);

    // 1. Thirty contracts, one cross long each.
    let v = await run('open-0', { kind: 'OPEN', symbol: symbolAt(0), side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() });
    for (let i = 1; i < 30; i++) v = await run(`open-${i}`, { kind: 'OPEN', symbol: symbolAt(i), side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() });
    expect(v.positions).toHaveLength(30);

    // 2. Same-side accumulation merges into ONE position at the weighted entry.
    market.prices.set(symbolAt(0), '1100');
    v = await run('accumulate', { kind: 'OPEN', symbol: symbolAt(0), side: 'LONG', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() });
    expect(v.positions).toHaveLength(30);
    expect(openPosition(v, symbolAt(0), 'LONG')).toMatchObject({ quantity: '2', entryPrice: '1050.1' }); // (1000.1 + 1100.1) / 2

    // 3. An opposite-side cross order is a hedge: its own position, shared collateral.
    v = await run('hedge', { kind: 'OPEN', symbol: symbolAt(1), side: 'SHORT', type: 'MARKET', quantity: '1', leverage: '10', idempotencyKey: key() });
    expect(v.positions).toHaveLength(31);

    // 4. Isolated positions on a 31st contract, both directions: their own books.
    //    The deployment's admission cap (default 30 contracts) refuses the 31st contract deterministically and
    //    leaves the journal untouched; the cap is tunable per deployment, so the rest of the scenario raises it.
    const revisionAtCap = repo.row!.revision;
    await expect(service.command(actor, { kind: 'OPEN', symbol: symbolAt(30), side: 'LONG', type: 'MARKET', quantity: '2', leverage: '5', marginType: 'ISOLATED', idempotencyKey: key() }))
      .rejects.toMatchObject({ code: 'CONTRACT_LIMIT' });
    expect(repo.row!.revision).toBe(revisionAtCap);
    process.env.NATIVE_MAX_CONCURRENT_CONTRACTS = '40';
    expect(nativeAdmissionLimits().contracts).toBe(40);
    v = await run('iso-long', { kind: 'OPEN', symbol: symbolAt(30), side: 'LONG', type: 'MARKET', quantity: '2', leverage: '5', marginType: 'ISOLATED', idempotencyKey: key() });
    v = await run('iso-short', { kind: 'OPEN', symbol: symbolAt(30), side: 'SHORT', type: 'MARKET', quantity: '1', leverage: '5', marginType: 'ISOLATED', idempotencyKey: key() });
    expect(v.positions).toHaveLength(33);
    const isoLong = openPosition(v, symbolAt(30), 'LONG', 'ISOLATED');
    expect(isoLong.isolatedMargin).toBe(bn('2').times('2500.1').div(5).toFixed());

    // 5. A resting LIMIT reserves margin and does not fill.
    v = await run('rest-limit', { kind: 'OPEN', symbol: symbolAt(2), side: 'LONG', type: 'LIMIT', price: '1000', quantity: '1', leverage: '10', idempotencyKey: key() });
    const resting = v.orders.find(o => o.status === 'OPEN' && o.symbol === symbolAt(2))!;
    expect(resting).toBeDefined();
    expect(bn(v.account!.orderReserve).gt(0)).toBe(true);

    // 6. TP and SL on two positions.
    const tpPos = openPosition(v, symbolAt(3), 'LONG'), slPos = openPosition(v, symbolAt(6), 'LONG');
    v = await run('protect-tp', { kind: 'PROTECTION', positionId: tpPos.id, protection: { takeProfit: '1300' }, idempotencyKey: key() });
    v = await run('protect-sl', { kind: 'PROTECTION', positionId: slPos.id, protection: { stopLoss: '1200' }, idempotencyKey: key() });

    // 7. Partial MARKET close: proportional, entry unchanged.
    const before0 = openPosition(v, symbolAt(0), 'LONG');
    v = await run('partial-close', { kind: 'CLOSE', positionId: before0.id, quantity: '0.5', idempotencyKey: key() });
    const after0 = openPosition(v, symbolAt(0), 'LONG');
    expect(after0).toMatchObject({ quantity: '1.5', entryPrice: before0.entryPrice });
    expect(v.events.filter(e => e.positionId === before0.id && e.kind === 'CLOSE')).toHaveLength(1);

    // 8. Full MARKET close that consumes several book levels: several fills, ONE action.
    market.depth.set(symbolAt(9), [{ price: '', quantity: '0.4' }, { price: '', quantity: '0.4' }, { price: '', quantity: '0.4' }]);
    const p9 = openPosition(v, symbolAt(9), 'LONG');
    v = await run('full-close-levels', { kind: 'CLOSE', positionId: p9.id, idempotencyKey: key() });
    expect(v.positions.some(p => p.id === p9.id)).toBe(false);
    const fills9 = v.events.filter(e => e.positionId === p9.id && e.kind === 'CLOSE');
    expect(fills9).toHaveLength(3);
    expect(new Set(fills9.map(e => e.actionId)).size).toBe(1);
    expect(fills9[0].actionId).toBeDefined();
    market.depth.delete(symbolAt(9));

    // 9. Exact reduce-only LIMIT close on a named position, filled later as maker when the path reaches it.
    const p5 = openPosition(v, symbolAt(5), 'LONG');
    v = await run('reduce-limit', { kind: 'OPEN', symbol: symbolAt(5), side: 'SHORT', type: 'LIMIT', price: '1400', quantity: '1', leverage: '10', reduceOnly: true, positionId: p5.id, idempotencyKey: key() });
    expect(v.orders.find(o => o.reduceOnly && o.status === 'OPEN')).toMatchObject({ positionId: p5.id, reserved: '0' });
    expect(v.positions.some(p => p.id === p5.id)).toBe(true);
    market.prices.set(symbolAt(5), '1450');
    clock.t += 2 * M;
    v = await run('reduce-limit-fills', { kind: 'REFRESH', idempotencyKey: key() });
    expect(v.positions.some(p => p.id === p5.id)).toBe(false);
    expect(v.orders.find(o => o.reduceOnly && o.positionId === p5.id)).toMatchObject({ status: 'FILLED', averagePrice: '1400' });

    // 10. TP fires on the observed quote; 11. SL fires.
    market.prices.set(symbolAt(3), '1320');
    v = await run('tp', { kind: 'REFRESH', idempotencyKey: key() });
    expect(v.history.find(p => p.id === tpPos.id)?.status).toBe('CLOSED');
    expect(v.events.filter(e => e.positionId === tpPos.id && e.kind === 'TAKE_PROFIT')).toHaveLength(1);
    market.prices.set(symbolAt(6), '1150');
    v = await run('sl', { kind: 'REFRESH', idempotencyKey: key() });
    expect(v.events.filter(e => e.positionId === slPos.id && e.kind === 'STOP_LOSS')).toHaveLength(1);

    // 12. Leverage change moves margin, never quantity or entry.
    const p7 = openPosition(v, symbolAt(7), 'LONG');
    v = await run('leverage', { kind: 'LEVERAGE', positionId: p7.id, leverage: '20', idempotencyKey: key() });
    expect(openPosition(v, symbolAt(7), 'LONG')).toMatchObject({ leverage: '20', quantity: p7.quantity, entryPrice: p7.entryPrice });

    // 13. Funding settles once per open position at the 8h boundary. The boundary is the open of the 08:00
    //     minute bar, and a bar is consumed only once it has closed, so the settlement shows up on the first
    //     command after 08:01, never on a still-forming minute.
    clock.t = H0 + 8 * H - M - 10_000;
    v = await run('to-boundary', { kind: 'REFRESH', idempotencyKey: key() });
    const openBefore = v.positions.map(p => p.id);
    expect(v.events.filter(e => e.kind === 'FUNDING')).toHaveLength(0);
    clock.t = H0 + 8 * H + 30_000;
    v = await run('inside-boundary-minute', { kind: 'REFRESH', idempotencyKey: key() });
    expect(v.events.filter(e => e.kind === 'FUNDING')).toHaveLength(0);
    clock.t = H0 + 8 * H + 2 * M;
    v = await run('funding', { kind: 'REFRESH', idempotencyKey: key() });
    const fundingEvents = v.events.filter(e => e.kind === 'FUNDING' && e.time === H0 + 8 * H);
    expect(new Set(fundingEvents.map(e => e.positionId)).size).toBe(openBefore.length);
    expect(fundingEvents).toHaveLength(openBefore.length);

    // 14. Risk-tier transition on a laddered contract: 50 x 1000 = 50k (tier 1) -> 150k after a rally (tier 2).
    v = await run('tier-open', { kind: 'OPEN', symbol: 'TIERUSDT', side: 'LONG', type: 'MARKET', quantity: '50', leverage: '10', idempotencyKey: key() });
    let tierPos = openPosition(v, 'TIERUSDT', 'LONG');
    expect(positionRisk(repo.row!.snapshot, repo.row!.snapshot.positions.find(p => p.id === tierPos.id)!, '1000').maintenance.toFixed()).toBe(bn(50).times(1000).times(0.005).plus(bn(50).times(1000).times(0.00055)).toFixed());
    market.prices.set('TIERUSDT', '3000');
    v = await run('tier-rally', { kind: 'REFRESH', idempotencyKey: key() });
    tierPos = openPosition(v, 'TIERUSDT', 'LONG');
    expect(positionRisk(repo.row!.snapshot, repo.row!.snapshot.positions.find(p => p.id === tierPos.id)!, '3000').maintenance.toFixed()).toBe(bn(150000).times(0.01).minus(500).plus(bn(150000).times(0.00055)).toFixed());

    // 15. Liquidation of the isolated long past its bankruptcy: the account loses the post and nothing more.
    const walletBefore = bn(repo.row!.snapshot.walletBalance);
    const isoBefore = repo.row!.snapshot.positions.find(p => p.id === isoLong.id)!;
    market.prices.set(symbolAt(30), '100');
    v = await run('iso-liquidation', { kind: 'REFRESH', idempotencyKey: key() });
    const liquidated = v.history.find(p => p.id === isoLong.id)!;
    expect(liquidated.status).toBe('LIQUIDATED');
    const liq = v.events.find(e => e.positionId === isoLong.id && e.kind === 'LIQUIDATION')!;
    expect(bn(liq.price!).toFixed()).toBe(bn(isoBefore.entryPrice).minus(bn(isoBefore.isolatedMargin!).div(isoBefore.quantity)).toFixed());
    expect(bn(repo.row!.snapshot.walletBalance).minus(walletBefore).plus(liq.fee).toFixed()).toBe('0');

    // 16. Cancel the resting limit; the reserve is released.
    v = await run('cancel', { kind: 'CANCEL', orderId: resting.id, idempotencyKey: key() });
    expect(v.orders.find(o => o.id === resting.id)!.status).toBe('CANCELLED');

    // 17. A plain read is the same account as the last command.
    const read = await service.state(actor);
    expect(read.account).toEqual(v.account);
    expect(read.ledger!.reconciled).toBe(true);
    expect(v.positions.length).toBeGreaterThanOrEqual(28);
    expect(steps.length).toBeGreaterThanOrEqual(50);
  });
});
