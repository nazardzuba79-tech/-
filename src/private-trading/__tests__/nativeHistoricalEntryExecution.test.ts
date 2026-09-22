import BigNumber from 'bignumber.js';
import { actor, setup, key, H, H0, M, outcome, instrument as fixtureInstrument } from '../native/testing/liveFixture';
import { NativeCommand, NativeDemoService } from '../native/service';
import { demoPositionView, DemoEngineError } from '../native/engine';
import { validateContractOrder, ContractRuleError } from '../math';
import { contractRules, simulationProfile } from '../service';
import type { PrivateInstrument, PrivateTradingMarketData, PrivateHistoryRequest } from '../marketData';

/**
 * A SELECTED HISTORICAL CANDLE IS THE EXECUTION.
 *
 * Owner rule (2026-09-22): once a historical candle is selected, the entry
 * is neither a LIMIT order nor a MARKET order — it is a HISTORICAL_DEMO
 * simulation entry. Pressing Open Long / Open Short must open a POSITION at
 * the selected historical price immediately: no resting order, nothing in
 * the open orders, no price touch, no order book, no liquidity, no live
 * max order quantity, no live risk-tier leverage. Current / Mark is the
 * near-live price and the unrealized P&L is historical entry → near-live.
 *
 * Two production defects sit behind this suite. (1) A LIMIT submitted with
 * a selected candle kept its limit price, so a LONG whose limit sat below
 * the candle RESTED in the open orders instead of opening a position.
 * (2) The historical OPEN ran the venue's LIVE admission — the market /
 * order quantity ceilings and the risk-tier leverage cap — so the owner's
 * example (1 200 000 contracts at a historical 0.004, 10x: 4 800 USDT of
 * notional) was refused with TIER_LEVERAGE_EXCEEDED, and it was even
 * reserved at today's quote rather than at the historical price.
 *
 * What HISTORICAL_DEMO keeps: the quantity step, the minimum size and
 * notional, the contract's leverage range, the available balance and the
 * margin reserve, the Cross/Isolated, liquidation, fee, TP/SL and P&L
 * arithmetic, and a close at the current near-live price. What
 * LIVE_EXECUTION keeps: everything — its twins below still rest and are
 * still refused. Legacy resting historical orders are left as they are.
 */

type Tiers = PrivateInstrument['riskTiers'];
/** A contract whose venue tier for the owner's example allows only 5x, with venue caps the tests move around. */
const tiered = (symbol: string, over: Partial<PrivateInstrument['filters']> = {}, tiers?: Tiers): PrivateInstrument => ({
  ...fixtureInstrument(symbol),
  filters: { tickSize: '0.0001', minPrice: '0.0001', maxPrice: '1000', qtyStep: '1', minOrderQty: '1', maxOrderQty: '5000000', maxMarketOrderQty: '5000000', minNotionalValue: '5', ...over },
  leverage: { min: '1', max: '100', step: '1' },
  riskTiers: tiers ?? [
    { riskLimitValue: '2000', maintenanceMarginRate: '0.01', initialMarginRate: '0.02', maintenanceDeduction: '0', maxLeverage: '50' },
    { riskLimitValue: '1000000000', maintenanceMarginRate: '0.02', initialMarginRate: '0.2', maintenanceDeduction: '20', maxLeverage: '5' },
  ],
  parameterVersion: 'HISTORICAL_ENTRY_FIXTURE',
});

const selectedAt = H0 - 24 * H;
const candle = { source: 'BYBIT_LINEAR' as const, interval: '1h' as const, openTime: selectedAt, pricePoint: 'OPEN' as const };
/** The owner's first example: 1 200 000 contracts at a historical 0.004, 10x. */
const EXAMPLE = { symbol: 'MEMEUSDT', side: 'LONG' as const, type: 'MARKET' as const, quantity: '1200000', leverage: '10', marginType: 'CROSS' as const };
const active = (o: { status: string }) => ['OPEN', 'PARTIALLY_FILLED'].includes(o.status);

async function fixture(opts: { entry?: string; current?: string; deposit?: string; filters?: Partial<PrivateInstrument['filters']>; tiers?: Tiers } = {}) {
  const f = setup({ price: opts.current ?? '0.005', deposit: opts.deposit ?? '100000' });
  const rules = (s: string) => tiered(s, opts.filters, opts.tiers);
  const market = Object.create(f.market) as PrivateTradingMarketData & Omit<typeof f.market, 'resolveCandle'>;
  market.instrument = async (s: string) => rules(s);
  market.history = async (r: PrivateHistoryRequest) => ({ ...(await f.market.history(r)), instrument: rules(r.symbol) });
  market.historicalDemoPrices = f.market.marks.bind(f.market);
  const entry = opts.entry ?? '0.004';
  market.resolveCandle = async s => ({ symbol: s.symbol, source: 'BYBIT_LINEAR', interval: s.interval, intervalMs: H, openTime: s.openTime, closeTime: s.openTime + H,
    effectiveAt: s.openTime, price: entry, pricePoint: s.pricePoint, candle: { timestamp: s.openTime, open: entry, close: entry, high: entry, low: entry, volume: '10' }, fetchedAt: f.clock.now(), verification: 'VERIFIED' });
  const service = new NativeDemoService(f.repo, market, f.clock.now);
  await service.initialize(actor, key());
  const command = (c: object) => service.command(actor, { ...c, idempotencyKey: key() } as NativeCommand);
  /** The example as a historical demo entry, with a selected candle. */
  const openHistorical = (extra: object = {}) => command({ kind: 'OPEN', ...EXAMPLE, executionMode: 'HISTORICAL_DEMO', candle, ...extra } as NativeCommand);
  /** The example as a live order: same contract, side, type, size and leverage; no candle, because a live order prices itself on the book. */
  const openLive = (extra: object = {}) => command({ kind: 'OPEN', ...EXAMPLE, executionMode: 'LIVE_EXECUTION', ...extra } as NativeCommand);
  /** A live book deep enough that the only thing that can refuse the live twin is admission. */
  const deepBook = () => { f.market.bids = [{ price: '0.0049', quantity: '100000000' }]; f.market.asks = [{ price: '0.0051', quantity: '100000000' }]; };
  /** No book at all, and a source that refuses to quote one. */
  const noBook = () => { f.market.bids = []; f.market.asks = []; market.freshQuote = async () => { throw new Error('BOOK_UNAVAILABLE'); }; };
  const snapshot = () => f.repo.row!.snapshot;
  const taker = () => snapshot().instruments.MEMEUSDT.profile.takerFeeRate;
  return { ...f, market, service, command, openHistorical, openLive, deepBook, noBook, entry, snapshot, taker };
}

const code = (e: unknown) => (e instanceof DemoEngineError || e instanceof ContractRuleError || e instanceof Error) ? e.message : String(e);
async function refusal(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) { return code((e as { code?: string }).code ? (e as { code: string }).code : e); }
  return 'ACCEPTED';
}
/** The one position a successful entry opened, plus proof that nothing rests. */
function opened<P extends { id: string }>(v: { positions: P[]; orders: { status: string; positionId?: string | null }[] }): P {
  expect(v.positions).toHaveLength(1);
  expect(v.orders.filter(active)).toEqual([]);
  return v.positions[0];
}

describe('1–3. a selected candle opens a position immediately, whichever tab submitted it', () => {
  test('1. candle + LIMIT + LONG, limit below the candle (the production case): a position, zero resting orders', async () => {
    const f = await fixture({ entry: '0.004', current: '0.005' });
    const v = await f.openHistorical({ type: 'LIMIT', price: '0.0039' });
    const p = opened(v);
    expect(p).toMatchObject({ side: 'LONG', status: 'OPEN', entryPrice: '0.004', quantity: '1200000', leverage: '10', markPrice: '0.005', executionMode: 'HISTORICAL_DEMO' });
    const order = f.snapshot().orders.find(o => o.positionId === p.id)!;
    expect(order).toMatchObject({ status: 'FILLED', remaining: '0', filled: '1200000', averagePrice: '0.004', price: null, historicalPrice: '0.004' });
    expect(outcome(await f.replay('FULL'))).toEqual(outcome(f.snapshot()));
  });
  test('1b. candle + LIMIT + LONG, limit above the candle: filled at the candle, not at the limit', async () => {
    const f = await fixture({ entry: '0.004', current: '0.005' });
    expect(opened(await f.openHistorical({ type: 'LIMIT', price: '0.0045' }))).toMatchObject({ entryPrice: '0.004', status: 'OPEN' });
  });
  test('2. candle + LIMIT + SHORT, limit above the candle: a position, zero resting orders', async () => {
    const f = await fixture({ entry: '0.004', current: '0.005' });
    const p = opened(await f.openHistorical({ side: 'SHORT', type: 'LIMIT', price: '0.0041' }));
    expect(p).toMatchObject({ side: 'SHORT', status: 'OPEN', entryPrice: '0.004', quantity: '1200000', markPrice: '0.005' });
    expect(p.unrealizedPnl).toBe(new BigNumber('0.004').minus('0.005').times('1200000').toFixed());
  });
  test('3. candle + MARKET: a position at the selected historical price', async () => {
    const f = await fixture({ entry: '0.004', current: '0.005' });
    const p = opened(await f.openHistorical());
    expect(p).toMatchObject({ entryPrice: '0.004', markPrice: '0.005', entryTimestamp: selectedAt });
    expect(f.snapshot().events.filter(e => e.positionId === p.id).map(e => [e.kind, e.price, e.pricing])).toEqual([['OPEN', '0.004', 'SELECTED_POINT']]);
  });
  test('3b. a selected price off the tick grid is still the entry, exactly', async () => {
    const f = await fixture({ entry: '0.004013', current: '0.005' });
    expect(opened(await f.openHistorical({ type: 'LIMIT', price: '0.004' }))).toMatchObject({ entryPrice: '0.004013' });
  });
});

describe('4–5. no order book is read, needed or consumed', () => {
  test('4. the entry reads no book: no quote call, no book on the instruction, no liquidity ledger', async () => {
    const f = await fixture(); f.noBook();
    const p = opened(await f.openHistorical({ type: 'LIMIT', price: '0.0039' }));
    expect(f.market.calls.quote).toBe(0);
    const open = f.repo.row!.commands.find(c => c.kind === 'OPEN')!;
    expect(open.kind === 'OPEN' && open.book).toBeUndefined();
    expect(open.kind === 'OPEN' && open.point).toBe('0.004');
    expect(f.snapshot().bookConsumption).toEqual({});
    expect(p.entryPrice).toBe('0.004');
  });
  test('5. an empty order book opens the entry at the selected price all the same', async () => {
    const f = await fixture(); f.market.bids = []; f.market.asks = [];
    expect(opened(await f.openHistorical())).toMatchObject({ entryPrice: '0.004', quantity: '1200000' });
  });
});

describe('6. venue admission does not apply to a historical entry', () => {
  test('tierMaxLeverage: 1 200 000 × 0.004 at 10x opens although the tier for 4 800 USDT allows 5x', async () => {
    const f = await fixture();
    expect(opened(await f.openHistorical())).toMatchObject({ leverage: '10', roiBasis: '480' });
  });
  test('maxMarketOrderQty: a MARKET quantity above the cap opens', async () => {
    const f = await fixture({ filters: { maxMarketOrderQty: '1000000', maxOrderQty: '1000000' } });
    expect(opened(await f.openHistorical())).toMatchObject({ quantity: '1200000', entryPrice: '0.004' });
    expect(outcome(await f.replay('FULL'))).toEqual(outcome(f.snapshot()));
  });
  test('maxOrderQty: a LIMIT quantity above the cap opens', async () => {
    const f = await fixture({ filters: { maxMarketOrderQty: '1000000', maxOrderQty: '1000000' } });
    expect(opened(await f.openHistorical({ type: 'LIMIT', price: '0.0041' }))).toMatchObject({ quantity: '1200000', entryPrice: '0.004' });
  });
  test('the LIVE twins are still refused: the cap first, the tier once it fits the cap', async () => {
    const f = await fixture({ filters: { maxMarketOrderQty: '1000000', maxOrderQty: '1000000' } }); f.deepBook();
    const before = structuredClone(f.repo.row);
    expect(await refusal(f.openLive())).toBe('INVALID_ORDER_SIZE');
    expect(await refusal(f.openLive({ quantity: '900000' }))).toBe('TIER_LEVERAGE_EXCEEDED');
    expect(await refusal(f.openLive({ type: 'LIMIT', price: '0.0045' }))).toBe('INVALID_ORDER_SIZE');
    expect(f.repo.row).toEqual(before);
  });
  test('what still binds: quantity step, minimum notional, the leverage range', async () => {
    const f = await fixture();
    expect(await refusal(f.openHistorical({ quantity: '1200000.5' }))).toBe('INVALID_QUANTITY_STEP');
    expect(await refusal(f.openHistorical({ quantity: '1' }))).toBe('INVALID_ORDER_SIZE');
    expect(await refusal(f.openHistorical({ leverage: '101' }))).toBe('INVALID_LEVERAGE');
    expect(f.snapshot().positions).toEqual([]);
  });
  test('the owner\'s second example: AKE 1 500 000 at a historical 0.004, 3x, current 0.0538, on a 10 000 USDT account', async () => {
    // Margin is measured at the historical entry (2 000 USDT), never at today's quote (26 900 USDT): the account covers the first and not the second.
    const f = await fixture({ entry: '0.004', current: '0.0538', deposit: '10000', filters: { maxMarketOrderQty: '1000000', maxOrderQty: '1000000' },
      tiers: [{ riskLimitValue: '2000', maintenanceMarginRate: '0.01', initialMarginRate: '0.02', maintenanceDeduction: '0', maxLeverage: '50' },
        { riskLimitValue: '1000000000', maintenanceMarginRate: '0.02', initialMarginRate: '0.5', maintenanceDeduction: '20', maxLeverage: '2' }] });
    const v = await f.openHistorical({ type: 'LIMIT', price: '0.004', quantity: '1500000', leverage: '3' });
    const p = opened(v);
    expect(p).toMatchObject({ entryPrice: '0.004', quantity: '1500000', leverage: '3', markPrice: '0.0538' });
    expect(p.unrealizedPnl).toBe(new BigNumber('0.0538').minus('0.004').times('1500000').toFixed());
    expect(p.roiBasis).toBe(new BigNumber('1500000').times('0.004').div('3').toFixed());
    expect(f.snapshot().walletBalance).toBe(new BigNumber('10000').minus(new BigNumber('1500000').times('0.004').times(f.taker())).toFixed());
    // The live twin on the same account does not open.
    const live = await fixture({ current: '0.0538', deposit: '10000', filters: { maxMarketOrderQty: '1000000', maxOrderQty: '1000000' } }); live.deepBook();
    expect(await refusal(live.openLive({ type: 'LIMIT', price: '0.004', quantity: '1500000', leverage: '3' }))).not.toBe('ACCEPTED');
    expect(live.snapshot().positions).toEqual([]);
  });
});

describe('7. margin, fees, liquidation, TP/SL and P&L are the arithmetic they always were', () => {
  test.each(['CROSS', 'ISOLATED'] as const)('%s: the same figures as a live position with the same entry', async marginType => {
    // A size the live tier admits (800 USDT of notional at 10x), so both engines accept it and the figures compare one to one.
    const same = { quantity: '200000', leverage: '10', marginType };
    const hist = await fixture({ entry: '0.004', current: '0.004' });
    const live = await fixture({ current: '0.004' });
    // The live twin fills at the ask, so the ask IS the historical entry; the bid sits below it, as a real book's does.
    live.market.bids = [{ price: '0.0039', quantity: '100000000' }]; live.market.asks = [{ price: '0.004', quantity: '100000000' }];
    const h = (await hist.openHistorical(same)).positions[0], l = (await live.openLive(same)).positions[0];
    expect(h.entryPrice).toBe('0.004'); expect(l.entryPrice).toBe('0.004');
    for (const field of ['quantity', 'leverage', 'roiBasis', 'openingFees', 'isolatedMargin', 'liquidationPrice', 'unrealizedPnl', 'marginMode'] as const) {
      expect([field, h[field]]).toEqual([field, l[field]]);
    }
    expect(hist.snapshot().walletBalance).toBe(live.snapshot().walletBalance);
    expect(h.openingFees).toBe(new BigNumber('200000').times('0.004').times(hist.taker()).toFixed());
    expect(h.roiBasis).toBe(new BigNumber('200000').times('0.004').div('10').toFixed());
  });
  test('the example posts its full margin and fee, has a liquidation price below its entry, and is refused when the balance cannot post it', async () => {
    // 1 000 USDT behind 4 800 USDT of notional: the cross liquidation is reachable, so the estimate is a number rather than "unreachable".
    const f = await fixture({ entry: '0.004', current: '0.005', deposit: '1000' });
    const before = f.snapshot().walletBalance;
    const p = opened(await f.openHistorical());
    const notional = new BigNumber('1200000').times('0.004');
    expect(p.openingFees).toBe(notional.times(f.taker()).toFixed());
    expect(p.roiBasis).toBe(notional.div('10').toFixed());
    expect(f.snapshot().walletBalance).toBe(new BigNumber(before).minus(notional.times(f.taker())).toFixed());
    expect(p.liquidationPrice).not.toBeNull();
    expect(new BigNumber(p.liquidationPrice!).lt('0.004') && new BigNumber(p.liquidationPrice!).gt(0)).toBe(true);
    const poor = await fixture({ deposit: '400' });
    expect(await refusal(poor.openHistorical())).toBe('INSUFFICIENT_DEMO_MARGIN');
  });
  test('TP/SL arm on the entry, are checked against the current price as before, and fire at the near-live price', async () => {
    const f = await fixture({ entry: '0.004', current: '0.005' });
    expect(await refusal(f.openHistorical({ protection: { takeProfit: '0.0045', stopLoss: null } }))).toBe('INVALID_TRIGGER_PRICE');
    const p = opened(await f.openHistorical({ protection: { takeProfit: '0.006', stopLoss: '0.003' } }));
    expect(p.protection).toMatchObject({ takeProfit: '0.006', stopLoss: '0.003' });
    f.clock.t += M; f.market.price = '0.0062';
    const v = await f.command({ kind: 'REFRESH' });
    expect(v.positions).toEqual([]);
    const closed = v.history.find(x => x.id === p.id)!;
    expect(closed.status).toBe('CLOSED');
    expect(new BigNumber(closed.realizedGross).gte(new BigNumber('0.006').minus('0.004').times('1200000'))).toBe(true);
  });
});

describe('8–9. current near-live valuation and close', () => {
  test('8. the mark is the current near-live price after open and after every refresh; the entry never moves', async () => {
    const f = await fixture({ entry: '0.004', current: '0.005' });
    const openedAt = f.clock.now();
    let p = opened(await f.openHistorical());
    expect(p).toMatchObject({ entryPrice: '0.004', markPrice: '0.005', entryTimestamp: selectedAt, fundingNet: '0' });
    // Opened NOW at a price from THEN: the snapshot keeps the real open time, the view reports the selected candle as the entry.
    expect(f.snapshot().positions[0].openedAt).toBe(openedAt);
    expect(p.unrealizedPnl).toBe(new BigNumber('0.005').minus('0.004').times('1200000').toFixed());
    f.clock.t += M; f.market.price = '0.0045';
    p = (await f.command({ kind: 'REFRESH' })).positions[0];
    expect(p).toMatchObject({ entryPrice: '0.004', markPrice: '0.0045' });
    expect(p.unrealizedPnl).toBe(new BigNumber('0.0045').minus('0.004').times('1200000').toFixed());
    expect(outcome(await f.replay('FULL'))).toEqual(outcome(f.snapshot()));
  });
  test('9. close settles at the current near-live price, with no book required', async () => {
    const f = await fixture({ entry: '0.004', current: '0.005' }); f.noBook();
    const p = opened(await f.openHistorical());
    f.clock.t += M; f.market.price = '0.0052';
    const v = await f.command({ kind: 'CLOSE', positionId: p.id });
    expect(v.positions).toEqual([]); expect(v.orders.filter(active)).toEqual([]);
    const closed = v.history.find(x => x.id === p.id)!;
    expect(closed.status).toBe('CLOSED');
    expect(closed.realizedGross).toBe(new BigNumber('0.0052').minus('0.004').times('1200000').toFixed());
    expect(closed.closingFees).toBe(new BigNumber('1200000').times('0.0052').times(f.taker()).toFixed());
    expect(f.market.calls.quote).toBe(0);
    expect(f.snapshot().bookConsumption).toEqual({});
    expect(outcome(await f.replay('FULL'))).toEqual(outcome(f.snapshot()));
  });
  test('a leverage change on the historical position is arithmetic too: 10x → 20x past the tier is allowed, the range still holds', async () => {
    const f = await fixture();
    const p = opened(await f.openHistorical());
    f.clock.t += M;
    const v = await f.command({ kind: 'LEVERAGE', positionId: p.id, leverage: '20' });
    expect(v.positions[0]).toMatchObject({ leverage: '20', entryPrice: '0.004', quantity: '1200000', roiBasis: new BigNumber('1200000').times('0.004').div('20').toFixed() });
    f.clock.t += M;
    expect(await refusal(f.command({ kind: 'LEVERAGE', positionId: p.id, leverage: '101' }))).toBe('INVALID_LEVERAGE');
  });
});

describe('10. LIVE_EXECUTION is untouched', () => {
  test('a live LIMIT below the ask still rests; a live MARKET still executes on the book', async () => {
    const f = await fixture({ current: '0.005' }); f.deepBook();
    let v = await f.openLive({ type: 'LIMIT', price: '0.0045', quantity: '200000', leverage: '5' });
    expect(v.positions).toEqual([]);
    expect(v.orders.filter(active)).toHaveLength(1);
    expect(v.orders.find(active)).toMatchObject({ type: 'LIMIT', price: '0.0045', remaining: '200000', filled: '0' });
    f.clock.t += M;
    v = await f.openLive({ type: 'MARKET', quantity: '100000', leverage: '5' });
    expect(v.positions).toHaveLength(1);
    expect(v.positions[0]).toMatchObject({ entryPrice: '0.0051', quantity: '100000' });
    expect(Object.keys(f.snapshot().bookConsumption)).not.toEqual([]);
  });
  test('a live leverage change past the tier is still refused', async () => {
    const f = await fixture({ current: '0.004' });
    f.market.bids = [{ price: '0.0039', quantity: '100000000' }]; f.market.asks = [{ price: '0.004', quantity: '100000000' }];
    const p = (await f.openLive({ quantity: '200000', leverage: '10' })).positions[0];
    // Tripled, and PERSISTED: a plain refresh inside the checkpoint window is not written, and a live
    // leverage change is judged on the persisted mark (unchanged here). Sixteen minutes on, it is written.
    f.clock.t += 16 * M; f.market.price = '0.012';
    f.market.bids = [{ price: '0.0119', quantity: '100000000' }]; f.market.asks = [{ price: '0.012', quantity: '100000000' }];
    await f.command({ kind: 'REFRESH' });
    expect(f.snapshot().marks.MEMEUSDT.mark).toBe('0.012');
    f.clock.t += M;
    expect(await refusal(f.command({ kind: 'LEVERAGE', positionId: p.id, leverage: '20' }))).toBe('TIER_LEVERAGE_EXCEEDED');
  });
});

describe('legacy resting historical orders are left alone', () => {
  test('a LIMIT without a candle on a historical account still rests, is cancellable, and fills when the near-live price touches it', async () => {
    const f = await fixture({ entry: '0.004', current: '0.005' });
    opened(await f.openHistorical({ quantity: '100000' }));
    f.clock.t += M;
    let v = await f.command({ kind: 'OPEN', symbol: 'MEMEUSDT', side: 'LONG', type: 'LIMIT', price: '0.0045', quantity: '100000', leverage: '5', marginType: 'CROSS' });
    const resting = v.orders.filter(active);
    expect(resting).toHaveLength(1);
    expect(resting[0]).toMatchObject({ type: 'LIMIT', price: '0.0045', remaining: '100000' });
    expect(f.snapshot().orders.find(o => o.id === resting[0].id)!.historicalPrice).toBeUndefined();
    expect(v.positions).toHaveLength(1);
    f.clock.t += M;
    v = await f.command({ kind: 'OPEN', symbol: 'MEMEUSDT', side: 'SHORT', type: 'LIMIT', price: '0.0055', quantity: '100000', leverage: '5', marginType: 'CROSS' });
    expect(v.orders.filter(active)).toHaveLength(2);
    f.clock.t += M;
    v = await f.command({ kind: 'CANCEL', orderId: v.orders.filter(active).find(o => o.side === 'SHORT')!.id });
    expect(v.orders.filter(active)).toHaveLength(1);
    // The near-live price touches the resting LONG: it fills there, as it did before.
    f.clock.t += M; f.market.price = '0.0044';
    v = await f.command({ kind: 'REFRESH' });
    expect(v.orders.filter(active)).toEqual([]);
    expect(v.positions).toHaveLength(2);
    expect(v.positions.find(p => p.id === resting[0].id)).toMatchObject({ entryPrice: '0.0044', quantity: '100000' });
    expect(outcome(await f.replay('FULL'))).toEqual(outcome(f.snapshot()));
  });
});

describe('math: validateContractOrder in HISTORICAL_DEMO keeps the contract rules and drops the venue admission', () => {
  const instrument = tiered('MEMEUSDT', { maxMarketOrderQty: '1000000', maxOrderQty: '1000000' });
  const rules = contractRules(instrument), profile = simulationProfile(instrument);
  const example = { rules, profile, quantity: '1200000', price: '0.004', leverage: '10', market: true };
  test('live: the example is refused by the market cap first, and by the tier once it fits the cap', () => {
    expect(() => validateContractOrder(example)).toThrow('INVALID_ORDER_SIZE');
    expect(() => validateContractOrder({ ...example, quantity: '900000' })).toThrow('TIER_LEVERAGE_EXCEEDED');
  });
  test('historical demo: neither the market cap, the order cap nor the tier refuses it', () => {
    expect(() => validateContractOrder({ ...example, historicalDemo: true })).not.toThrow();
    expect(() => validateContractOrder({ ...example, historicalDemo: true, market: false })).not.toThrow();
    expect(() => validateContractOrder({ ...example, historicalDemo: true, quantity: '900000' })).not.toThrow();
  });
  test.each([
    ['quantity step', { quantity: '1200000.5' }, 'INVALID_QUANTITY_STEP'],
    ['minimum notional', { quantity: '1' }, 'INVALID_ORDER_SIZE'],
    ['leverage range', { leverage: '101' }, 'INVALID_LEVERAGE'],
    ['leverage step', { leverage: '10.5' }, 'INVALID_LEVERAGE'],
    ['price step on a LIMIT', { market: false, price: '0.00405' }, 'INVALID_PRICE_STEP'],
  ])('historical demo still refuses a broken %s', (_name, over, expected) => {
    expect(() => validateContractOrder({ ...example, ...over, historicalDemo: true })).toThrow(expected);
  });
});

describe('the position view', () => {
  test('carries the near-live mark, the fixed entry and the mode', async () => {
    const f = await fixture({ entry: '0.004', current: '0.005' });
    await f.openHistorical();
    const s = f.snapshot(), view = demoPositionView(s, s.positions[0]);
    expect(view).toMatchObject({ entryPrice: '0.004', markPrice: '0.005', executionMode: 'HISTORICAL_DEMO' });
  });
});
