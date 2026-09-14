import BigNumber from 'bignumber.js';
import { AsyncLocalStorage } from 'async_hooks';
import { PrivateTradingService } from '../service';
import { PrivateTradingStore, AccountTx } from '../store';
import { emptyState, OwnerSession, PrivateTradingError, TradeRequest } from '../serviceTypes';
import { PrivateFreshQuote, PrivateInstrument, PrivateTradingMarketData } from '../marketData';

const NOW = Date.UTC(2026, 8, 14, 16, 1);
const actor: OwnerSession = { userId: 'owner', sessionId: 'session', expiresAt: NOW + 86_400_000 };
const instrument = (): PrivateInstrument => ({ provider: 'bybit', symbol: 'XYZUSDT', baseAsset: 'XYZ', quoteAsset: 'USDT', settleAsset: 'USDT',
  contractType: 'LinearPerpetual', status: 'Trading', launchTime: Date.UTC(2020, 0, 1), fetchedAt: Date.now(), fundingIntervalMinutes: 480,
  filters: { tickSize: '0.1', minPrice: '0.1', maxPrice: '1000000', qtyStep: '0.1', minOrderQty: '0.1', maxOrderQty: '1000', maxMarketOrderQty: '100', minNotionalValue: '1' },
  leverage: { min: '1', max: '100', step: '0.1' }, riskTiers: [{ riskLimitValue: '1000000000', maintenanceMarginRate: '0.005', initialMarginRate: '0.01', maintenanceDeduction: '0', maxLeverage: '100' }],
  parameterModel: 'CURRENT_INSTRUMENT_PARAMETERS', parameterVersion: 'fixture-current-1' });
const quote = (): PrivateFreshQuote => ({ provider: 'bybit', symbol: 'XYZUSDT', bids: [{ price: '99', quantity: '10' }],
  asks: [{ price: '100', quantity: '1' }, { price: '110', quantity: '2' }], markPrice: '104', lastPrice: '104', fundingRate: '0.001',
  nextFundingTime: Date.now() + 28_800_000, providerTimestamp: Date.now(), bookGeneratedAt: Date.now(), markProviderTimestamp: Date.now(), fetchedAt: Date.now() });
const request = (patch: Partial<TradeRequest> = {}): TradeRequest => ({ mode: 'DEMO_LIVE', symbol: 'XYZUSDT', type: 'MARKET', side: 'LONG', leverage: '10', quantity: '2', idempotencyKey: 'request', ...patch });

function historicalFixture() {
  const f = fixture();
  f.market.resolveCandle.mockImplementation(async selection => {
    const candle = { timestamp: selection.openTime, open: '100', high: '100', low: '100', close: '100', volume: '10' };
    return { ...selection, source: 'BYBIT_LINEAR', symbol: selection.symbol, candle, intervalMs: 60000,
      closeTime: selection.openTime + 60000, effectiveAt: selection.openTime + (selection.pricePoint === 'CLOSE' ? 60000 : 0), price: '100', fetchedAt: Date.now(), verification: 'VERIFIED' };
  });
  f.market.history.mockImplementation(async input => {
    const candles = []; for (let at = input.startTime; at < input.endTime; at += 60000) candles.push({ timestamp: at, open: '100', high: '100', low: '100', close: '100' });
    const timestamps = candles.filter(c => c.timestamp % (480 * 60000) === 0).map(c => c.timestamp);
    return { symbol: 'XYZUSDT', instrument: instrument(), tradeCandles: candles, markCandles: candles, intervalMs: 60000, complete: true, issues: [],
      fundingEvents: timestamps.map(timestamp => ({ timestamp, rate: '0.0001', markPrice: '100' })), expectedFundingTimestamps: timestamps };
  });
  f.market.funding.mockImplementation(async (...args: any[]) => ({ events: [{ timestamp: args[1], rate: '0.0001', markPrice: '100' }], complete: true, issues: [] }));
  return f;
}
async function finished(f: ReturnType<typeof fixture>, id: string): Promise<any> {
  for (let step = 0; step < 500 && f.rows.get(id)?.status === 'RUNNING'; step++) await Promise.resolve();
  return f.service.getPreview(actor, id);
}
const candleRequest = (patch: Partial<TradeRequest> = {}) => request({ mode: 'HISTORICAL_REPLAY', quantity: '10', capital: '1000',
  candleEntry: { source: 'BYBIT_LINEAR', interval: '1m', openTime: NOW - 6 * 60000, pricePoint: 'CLOSE' }, ...patch });

/** Pure runtime harness; real row-lock/rollback behavior is covered separately on the TEST database. */
function fixture() {
  let allowed = true;
  const lockContext = new AsyncLocalStorage<boolean>();
  const rows = new Map<string, any>(), commands = new Map<string, any>(), entries: { kind: string; amount: string; suffix: string }[] = [];
  const state = emptyState();
  const tx: AccountTx = { db: {} as any, state, available: new BigNumber(10000), reserved: new BigNumber(0), principal: new BigNumber(10000), realized: new BigNumber(0),
    entry: async (kind, amount, suffix) => { entries.push({ kind, amount, suffix }); } };
  const matches = (row: any, where: any) => Object.entries(where ?? {}).every(([key, value]) => value && typeof value === 'object' && 'in' in value
    ? (value as any).in.includes(row[key]) : row[key] === value);
  const db: any = {
    privateTradingPreview: {
      findFirst: jest.fn(async ({ where }) => [...rows.values()].find(r => matches(r, where)) ?? null),
      findUniqueOrThrow: jest.fn(async ({ where }) => { const r = rows.get(where.id); if (!r) throw new Error('missing'); return r; }),
      findMany: jest.fn(async ({ where }) => [...rows.values()].filter(r => matches(r, where))),
      count: jest.fn(async ({ where }) => [...rows.values()].filter(r => matches(r, where)).length),
      create: jest.fn(async ({ data }) => { const r = { createdAt: new Date(), progress: 0, result: null, error: null, ...data }; rows.set(r.id, r); return r; }),
      updateMany: jest.fn(async ({ where, data }) => { let count = 0; for (const row of rows.values()) if (matches(row, where)) { Object.assign(row, data); count++; } return { count }; }),
      update: jest.fn(async ({ where, data }) => { const row = rows.get(where.id); Object.assign(row, data); return row; }),
    },
    privateTradingCommand: { findUnique: jest.fn(async ({ where }) => commands.get(where.userId_key.key) ?? null) },
    privateTradingAccount: { findUnique: jest.fn(async () => ({ state: tx.state })) },
    demoBalance: { findUnique: jest.fn(async () => ({ available: new BigNumber(1000) })) },
    privateTradingCard: { count: jest.fn(async () => 0), create: jest.fn(async ({ data }) => data), findFirst: jest.fn() },
  };
  tx.db = db;
  const authorized = jest.fn(async () => { if (!allowed) throw new PrivateTradingError('private_access_denied', 'Режим недоступен', 403); });
  let tail = Promise.resolve();
  const store: any = { db, authorized, config: () => ({ enabled: allowed, ownerId: 'owner' }), read: async () => {
    await authorized(); return { available: tx.available, reserved: tx.reserved, principal: tx.principal, realized: tx.realized, state: tx.state };
  }, transact: jest.fn(async (_actor: OwnerSession, _key: string | null, _input: unknown, run: (a: AccountTx) => Promise<any>, finalCheck?: () => void) => {
    const operation = tail.then(async () => { await authorized(); return lockContext.run(true, async () => { const value = await run(tx); await authorized(); finalCheck?.(); return value; }); });
    tail = operation.then(() => undefined, () => undefined); return operation;
  }) };
  const outsideLock = () => { if (lockContext.getStore()) throw new Error('Provider work must be outside account row lock'); };
  const market = {
    instrument: jest.fn(async (symbol = 'XYZUSDT') => { outsideLock(); return { ...instrument(), symbol }; }),
    freshQuote: jest.fn(async (symbol = 'XYZUSDT') => { outsideLock(); return { ...quote(), symbol }; }),
    funding: jest.fn(async () => { outsideLock(); return { events: [] as { timestamp: number; rate: string; markPrice: string }[], complete: true, issues: [] as string[] }; }),
    history: jest.fn(async (_request: any): Promise<any> => { outsideLock(); throw new Error('fixture history not provided'); }),
    resolveCandle: jest.fn(async (_selection: any): Promise<any> => { outsideLock(); throw new Error('fixture selection not provided'); }),
    chartCandles: jest.fn(async (_selection: any): Promise<any> => { outsideLock(); return { candles: [] }; }),
  };
  const service = new PrivateTradingService(store as PrivateTradingStore, market as unknown as PrivateTradingMarketData);
  return { service, store, market, rows, commands, entries, get state() { return tx.state; }, tx, authorized, revoke: () => { allowed = false; } };
}

describe('private service runtime integrity', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); });
  afterEach(() => { jest.useRealTimers(); });
  test('market preview uses depth VWAP and independently observed Mark Price', async () => {
    const f = fixture(), preview = await f.service.preview(actor, request());
    expect(preview.status).toBe('READY');
    expect(new BigNumber(preview.result.position.entryPrice).eq('105')).toBe(true);
    expect(preview.result.position.markPrice).toBe('104');
    expect(new BigNumber(preview.result.position.unrealizedPnl).eq('-2')).toBe(true);
    expect(new BigNumber(preview.result.position.notional).eq('208')).toBe(true);
    expect(preview.result.position.asOf).toBe(new Date(NOW).toISOString());
    expect(f.entries).toHaveLength(0); expect(f.state.positions).toHaveLength(0);
  });
  test('margin-sized depth preview stays within the explicit budget after price sweep and fees', async () => {
    const f = fixture(), preview = await f.service.preview(actor, request({ quantity: undefined, margin: '20' }));
    expect(preview.status).toBe('READY');
    expect(new BigNumber(preview.result.cost.required).lte('20')).toBe(true);
    expect(new BigNumber(preview.result.request.quantity).mod('0.1').isZero()).toBe(true);
    expect(new BigNumber(preview.result.position.entryPrice).gt('100')).toBe(true);
  });
  test('partial depth is explicit and prices only the actual fillable quantity', async () => {
    const f = fixture(), preview = await f.service.preview(actor, request({ quantity: '5' }));
    expect(preview.status).toBe('READY'); expect(preview.result.request.quantity).toBe('5');
    expect(preview.result.position.quantity).toBe('3'); expect(preview.result.issues).toHaveLength(1);
    await f.service.confirm(actor, preview.id, 'confirm');
    expect(f.state.positions[0].quantity).toBe('3'); expect(f.state.orders[0].status).toBe('CANCELLED');
  });
  test('crossing limit preview shows actual sweep while reserving the full limit intent', async () => {
    const f = fixture(), preview = await f.service.preview(actor, request({ type: 'LIMIT', limitPrice: '110', quantity: '5' }));
    expect(preview.status).toBe('READY'); expect(preview.result.position.quantity).toBe('3');
    expect(new BigNumber(preview.result.position.entryPrice).lt('110')).toBe(true);
    expect(new BigNumber(preview.result.cost.required).gt('55')).toBe(true);
    expect(preview.result.consent).toMatchObject({ quantity: '5', maxAveragePrice: '110', minimumFillQuantity: '0', slippagePercent: '0' });
    await f.service.confirm(actor, preview.id, 'limit'); expect(f.state.orders[0].status).toBe('PARTIALLY_FILLED');
  });
  test('a reviewed 60-second intent fetches a fresh quote and preserves exact quantity within explicit limits', async () => {
    const f = fixture(), preview = await f.service.preview(actor, request()); jest.setSystemTime(NOW + 15000);
    f.market.freshQuote.mockImplementation(async () => ({ ...quote(), asks: [{ price: '100.03', quantity: '1' }, { price: '110.03', quantity: '2' }] }));
    expect((await f.service.getPreview(actor, preview.id)).status).toBe('READY');
    await f.service.confirm(actor, preview.id, 'reviewed');
    expect(f.state.positions[0].quantity).toBe('2'); expect(new BigNumber(f.state.positions[0].entryPrice).eq('105.03')).toBe(true);
    expect(f.state.positions[0].asOf).toBe(new Date(NOW + 15000).toISOString()); expect(f.market.freshQuote).toHaveBeenCalledTimes(2);
    expect(preview.result.consent.slippagePercent).toBe('0.05');
  });
  test('adverse fresh price outside reviewed tolerance requires a new preview without financial writes', async () => {
    const f = fixture(), preview = await f.service.preview(actor, request()); jest.setSystemTime(NOW + 15000);
    f.market.freshQuote.mockImplementation(async () => ({ ...quote(), asks: [{ price: '101', quantity: '1' }, { price: '111', quantity: '2' }] }));
    await expect(f.service.confirm(actor, preview.id, 'adverse')).rejects.toMatchObject({ code: 'preview_changed' });
    expect(f.entries).toHaveLength(0); expect(f.state.positions).toHaveLength(0); expect(f.tx.available.eq(10000)).toBe(true);
  });
  test('consumed same-snapshot depth requires refresh when minimum reviewed fill no longer exists', async () => {
    const f = fixture(), a = await f.service.preview(actor, request()), b = await f.service.preview(actor, request({ idempotencyKey: 'other' }));
    await f.service.confirm(actor, a.id, 'first'); const before = f.entries.length;
    await expect(f.service.confirm(actor, b.id, 'second')).rejects.toMatchObject({ code: 'preview_changed' });
    expect(f.entries).toHaveLength(before); expect(f.state.positions).toHaveLength(1);
  });
  test('contract parameter changes invalidate the reviewed pricing and risk profile', async () => {
    const f = fixture(), preview = await f.service.preview(actor, request());
    f.market.instrument.mockResolvedValue({ ...instrument(), parameterVersion: 'changed-risk' });
    await expect(f.service.confirm(actor, preview.id, 'changed')).rejects.toMatchObject({ code: 'preview_changed' });
    expect(f.entries).toHaveLength(0); expect(f.state.positions).toHaveLength(0);
  });
  test('concurrent equivalent previews reuse one id even when JSON property order differs', async () => {
    const f = fixture(), first = request(), reordered = Object.fromEntries(Object.entries(first).reverse()) as unknown as TradeRequest;
    const [a, b] = await Promise.all([f.service.preview(actor, first), f.service.preview(actor, reordered)]);
    expect(a.id).toBe(b.id); expect(f.rows.size).toBe(1); expect(f.market.freshQuote).toHaveBeenCalledTimes(1);
  });
  test('expired quote preview reports EXPIRED and stale account PnL is not reported as LIVE', async () => {
    const f = fixture(), preview = await f.service.preview(actor, request()); await f.service.confirm(actor, preview.id, 'confirm');
    const other = await f.service.preview(actor, request({ idempotencyKey: 'second' }));
    jest.setSystemTime(NOW + 61_000);
    expect((await f.service.getPreview(actor, other.id)).status).toBe('EXPIRED');
    const state = await f.service.state(actor);
    expect(state.positions[0].dataStatus).toBe('UNAVAILABLE'); expect(state.wallet.unrealizedPnl).toBeNull();
    expect(state.positions[0].asOf).toBe(new Date(NOW).toISOString());
  });
  test('revocation during idempotent-response read prevents returning private saved data', async () => {
    const f = fixture(); f.store.db.privateTradingCommand.findUnique.mockImplementation(async () => {
      f.revoke(); return { requestHash: require('../store').hash({ id: 'p' }), response: { private: true } };
    });
    await expect(f.service.confirm(actor, 'p', 'same')).rejects.toMatchObject({ code: 'private_access_denied' });
    expect(f.market.freshQuote).not.toHaveBeenCalled();
  });
  test('revocation while an asynchronous preview loads cancels publication', async () => {
    const f = fixture(); f.market.freshQuote.mockImplementation(async () => { f.revoke(); return quote(); });
    await expect(f.service.preview(actor, request())).rejects.toMatchObject({ code: 'private_access_denied' });
    expect([...f.rows.values()][0]).toMatchObject({ status: 'CANCELLED', result: null });
    expect(f.state.positions).toHaveLength(0); expect(f.entries).toHaveLength(0);
  });
  test('restart resumes an unexpired RUNNING preview without duplicating it', async () => {
    const f = fixture(); f.rows.set('restart', { id: 'restart', userId: actor.userId, requestKey: 'restart', status: 'RUNNING', mode: 'DEMO_LIVE',
      session: actor, request: request(), createdAt: new Date(NOW - 1000), expiresAt: new Date(NOW + 10000), result: null });
    await (f.service as any).runPreview('restart'); await (f.service as any).runPreview('restart');
    expect(f.rows.get('restart').status).toBe('READY'); expect(f.market.freshQuote).toHaveBeenCalledTimes(1); expect(f.entries).toHaveLength(0);
  });
  test('restart does not resume a job after its persisted expiry', async () => {
    const f = fixture(); f.rows.set('expired', { id: 'expired', status: 'RUNNING', expiresAt: new Date(NOW - 1) });
    await (f.service as any).runPreview('expired');
    expect(f.rows.get('expired').status).toBe('EXPIRED'); expect(f.market.instrument).not.toHaveBeenCalled();
  });
  test('missing historical entry yields incomplete state, never a zero-price position', async () => {
    const f = fixture(); f.market.history.mockResolvedValue({ symbol: 'XYZUSDT', instrument: instrument(), tradeCandles: [], markCandles: [], fundingEvents: [], expectedFundingTimestamps: [], complete: false, issues: ['trade_history_gap'], intervalMs: 60000 });
    f.rows.set('history', { id: 'history', userId: actor.userId, status: 'RUNNING', mode: 'HISTORICAL_REPLAY', session: actor,
      request: request({ mode: 'HISTORICAL_REPLAY', effectiveOpenedAt: new Date(NOW - 3600000).toISOString(), asOf: new Date(NOW - 60000).toISOString() }),
      createdAt: new Date(NOW), expiresAt: new Date(NOW + 60000), result: null });
    await (f.service as any).runPreview('history');
    expect(f.rows.get('history')).toMatchObject({ status: 'INCOMPLETE', result: null }); expect(f.entries).toHaveLength(0);
  });
  test('overdue funding settles on the original quantity before a partial close and is not paid twice', async () => {
    const f = fixture(); jest.setSystemTime(NOW - 3600000);
    const preview = await f.service.preview(actor, request()); await f.service.confirm(actor, preview.id, 'confirm');
    const p = f.state.positions[0]; jest.setSystemTime(NOW);
    f.market.funding.mockResolvedValue({ events: [{ timestamp: NOW - 60000, rate: '0.001', markPrice: '100' }], complete: true, issues: [] });
    await f.service.close(actor, p.id, '1', 'partial');
    expect(new BigNumber(p.fundingNet).eq('-0.2')).toBe(true); expect(p.quantity).toBe('1');
    expect(f.entries.findIndex(e => e.kind === 'FUNDING')).toBeLessThan(f.entries.findIndex(e => e.kind === 'REALIZED_PNL'));
    jest.setSystemTime(NOW + 1000); await f.service.close(actor, p.id, undefined, 'rest');
    expect(f.entries.filter(e => e.kind === 'FUNDING')).toHaveLength(1); expect(f.market.funding).toHaveBeenCalledTimes(1);
  });
  test('incomplete overdue funding blocks quantity changes before the account transaction', async () => {
    const f = fixture(); jest.setSystemTime(NOW - 3600000);
    const preview = await f.service.preview(actor, request()); await f.service.confirm(actor, preview.id, 'confirm'); jest.setSystemTime(NOW);
    f.market.funding.mockResolvedValue({ events: [], complete: false, issues: ['funding_history_gap'] });
    const before = JSON.stringify({ state: f.state, entries: f.entries, available: f.tx.available });
    await expect(f.service.close(actor, f.state.positions[0].id, '1', 'partial')).rejects.toMatchObject({ code: 'funding_history_incomplete' });
    expect(JSON.stringify({ state: f.state, entries: f.entries, available: f.tx.available })).toBe(before);
  });
  test('leverage edit cancels old-leverage entry remainder before later fills can enlarge it', async () => {
    const f = fixture(), preview = await f.service.preview(actor, request({ type: 'LIMIT', limitPrice: '110', quantity: '5' }));
    await f.service.confirm(actor, preview.id, 'partial-limit'); const p = f.state.positions[0];
    expect(f.state.orders[0].status).toBe('PARTIALLY_FILLED'); jest.setSystemTime(NOW + 1000);
    await f.service.edit(actor, p.id, { leverage: '5' }, 'leverage');
    expect(f.state.orders[0].status).toBe('CANCELLED'); expect(p.leverage).toBe('5'); expect(p.quantity).toBe('3');
  });
  test('the fifth active contract is rejected while additional positions in the existing four remain allowed', async () => {
    const f = fixture(), preview = await f.service.preview(actor, request());
    f.state.positions = ['AAAUSDT', 'BBBUSDT', 'CCCUSDT', 'DDDUSDT'].map((symbol, i) => ({ ...structuredClone(preview.result.position), id: `p${i}`, symbol }));
    await expect(f.service.confirm(actor, preview.id, 'fifth')).rejects.toMatchObject({ code: 'active_contract_limit' });
    expect(f.entries).toHaveLength(0); expect(f.state.positions).toHaveLength(4);
    const sameContract = await f.service.preview(actor, request({ symbol: 'AAAUSDT', idempotencyKey: 'same-contract' }));
    await f.service.confirm(actor, sameContract.id, 'within-four');
    expect(f.state.positions).toHaveLength(5); expect(new Set(f.state.positions.map(p => p.symbol)).size).toBe(4);
  });
  test('four symbols obtain fresh valuations in one account transaction after all provider work', async () => {
    const f = fixture(), preview = await f.service.preview(actor, request());
    f.state.positions = ['AAAUSDT', 'BBBUSDT', 'CCCUSDT', 'DDDUSDT'].map((symbol, i) => ({ ...structuredClone(preview.result.position), id: `p${i}`, symbol }));
    f.state.session = actor; f.store.transact.mockClear(); f.market.freshQuote.mockClear(); jest.setSystemTime(NOW + 1000);
    await f.service.tick();
    expect(f.store.transact).toHaveBeenCalledTimes(1); expect(f.market.freshQuote).toHaveBeenCalledTimes(4);
    expect(f.state.positions.every(p => p.asOf === new Date(NOW + 1000).toISOString())).toBe(true);
    expect((await f.service.state(actor)).positions.every(p => p.dataStatus === 'LIVE')).toBe(true);
  });
  test('one unavailable quote is excluded while the other contracts still update in the same pass', async () => {
    const f = fixture(), preview = await f.service.preview(actor, request());
    f.state.positions = ['AAAUSDT', 'BBBUSDT'].map((symbol, i) => ({ ...structuredClone(preview.result.position), id: `p${i}`, symbol })); f.state.session = actor;
    f.market.freshQuote.mockImplementation(async symbol => { if (symbol === 'AAAUSDT') throw new Error('offline'); return { ...quote(), symbol }; });
    jest.setSystemTime(NOW + 1000); await f.service.tick();
    const result = await f.service.state(actor);
    expect(result.positions.find(p => p.symbol === 'AAAUSDT')!.dataStatus).toBe('UNAVAILABLE');
    expect(result.positions.find(p => p.symbol === 'BBBUSDT')!).toMatchObject({ dataStatus: 'LIVE', asOf: new Date(NOW + 1000).toISOString() });
  });
  test('a rejected resting entry cannot roll back a valid liquidation in the same risk batch', async () => {
    const f = fixture(), preview = await f.service.preview(actor, request()); await f.service.confirm(actor, preview.id, 'open');
    const p = f.state.positions[0], template = f.state.orders[0];
    f.state.orders.push({ ...template, id: 'invalid-entry', positionId: 'other-position', type: 'LIMIT', quantity: '1', remainingQuantity: '1', filledQuantity: '0', limitPrice: '100',
      leverage: '1000', status: 'OPEN', reserved: '10', lastBookTimestamp: 0 }); f.tx.available = f.tx.available.minus(10); f.tx.reserved = f.tx.reserved.plus(10);
    f.market.freshQuote.mockImplementation(async () => ({ ...quote(), markPrice: '2', bids: [{ price: '1', quantity: '10' }], asks: [{ price: '2', quantity: '10' }] }));
    jest.setSystemTime(NOW + 1000); await f.service.tick();
    expect(f.state.positions.find(position => position.id === p.id)!.status).toBe('LIQUIDATED');
    expect(f.state.orders.find(order => order.id === 'invalid-entry')!).toMatchObject({ status: 'OPEN', reserved: '10' });
    expect(f.entries.filter(e => e.kind === 'REALIZED_PNL')).toHaveLength(1); expect(f.entries.filter(e => e.kind === 'OPEN_FEE')).toHaveLength(1);
  });
  test('a fresh crossed SHORT limit cannot draw more than its reviewed maximum reserve', async () => {
    const f = fixture(); f.market.freshQuote.mockImplementation(async () => ({ ...quote(), bids: [{ price: '100', quantity: '10' }], asks: [{ price: '101', quantity: '10' }], markPrice: '100' }));
    const preview = await f.service.preview(actor, request({ side: 'SHORT', type: 'LIMIT', limitPrice: '100' }));
    jest.setSystemTime(NOW + 1000); f.market.freshQuote.mockImplementation(async () => ({ ...quote(), bids: [{ price: '200', quantity: '10' }], asks: [{ price: '201', quantity: '10' }], markPrice: '200' }));
    await expect(f.service.confirm(actor, preview.id, 'more-margin')).rejects.toMatchObject({ code: 'preview_changed' });
    expect(f.entries).toHaveLength(0); expect(f.tx.available.eq(10000)).toBe(true);
  });
  test('simultaneous opposing funding cashflows do not change collateral when position order is reversed', async () => {
    const run = async (reverse: boolean) => {
      const f = fixture(), preview = await f.service.preview(actor, request());
      const openedAt = NOW - 3600000;
      f.state.positions = (['LONG', 'SHORT'] as const).map(side => ({ ...structuredClone(preview.result.position), id: side, side,
        effectiveOpenedAt: new Date(openedAt).toISOString(), lastFundingAt: openedAt, lastFillAt: openedAt,
        quantityTimeline: [{ effectiveAt: openedAt, quantity: '2' }] }));
      if (reverse) f.state.positions.reverse();
      f.tx.available = new BigNumber(0); f.tx.reserved = new BigNumber(preview.result.position.allocatedMargin).times(2);
      await (f.service as any).settleFunding(f.tx, { symbol: 'XYZUSDT', intervalMs: 28_800_000, through: NOW - 60000, from: openedAt + 1,
        events: [{ timestamp: NOW - 60000, rate: '0.001', markPrice: '100' }] });
      return { available: f.tx.available.toFixed(), reserved: f.tx.reserved.toFixed(), positions: f.state.positions.map(p => ({ id: p.id, allocatedMargin: p.allocatedMargin, fundingNet: p.fundingNet })).sort((a, b) => a.id.localeCompare(b.id)),
        originalMargin: preview.result.position.allocatedMargin };
    };
    const a = await run(false), b = await run(true);
    expect(a).toEqual(b); expect(a.available).toBe('0'); expect(a.positions.every(p => new BigNumber(p.allocatedMargin).eq(a.originalMargin))).toBe(true);
  });
});

describe('private candle workflow runtime', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW); });
  afterEach(() => { jest.useRealTimers(); });
  test('server resolves selected entry, exposes exact marker and separate capital without allocating at click', async () => {
    const f = historicalFixture(), started = await f.service.preview(actor, candleRequest()), p = await finished(f, started.id);
    expect(p.status).toBe('READY'); expect(p.result.position.entryPrice).toBe('100');
    expect(p.result.profile.pricingModelVersion).toBe('VOLTEX_SELECTED_CANDLE_POINT_V2');
    expect(p.result.replay.candleEntry).toMatchObject({ openTime: NOW - 6 * 60000, effectiveAt: NOW - 5 * 60000, pricePoint: 'CLOSE' });
    expect(p.result.capital.total).toBe('1000'); expect(new BigNumber(p.result.capital.free).gt(800)).toBe(true);
    expect(f.entries).toHaveLength(0); expect(f.state.scenarios).toHaveLength(0);
    await f.service.confirm(actor, p.id, 'confirm-one');
    const dto = await f.service.state(actor); expect(dto.scenarios[0].fills[0]).toMatchObject({ kind: 'OPEN', effectiveAt: NOW - 5 * 60000, price: '100' });
    expect(dto.scenarios[0].candleEntry?.source).toBe('BYBIT_LINEAR'); expect(dto.scenarios[0].evaluatedThrough).toBe(NOW);
  });
  test('repeated candle click reuses preview and confirmation cannot reserve twice', async () => {
    const f = historicalFixture(), [one, two] = await Promise.all([f.service.preview(actor, candleRequest()), f.service.preview(actor, candleRequest())]);
    expect(one.id).toBe(two.id); await finished(f, one.id); await f.service.confirm(actor, one.id, 'first');
    await expect(f.service.confirm(actor, one.id, 'second')).rejects.toMatchObject({ code: 'preview_not_ready' });
    expect(f.state.scenarios).toHaveLength(1); expect(f.entries.filter(e => e.kind === 'SCENARIO_ALLOCATION')).toHaveLength(1); expect(f.tx.reserved.eq(1000)).toBe(true);
  });
  test('incremental advance fetches only after saved checkpoint, preserves entry and funding prefix', async () => {
    const f = historicalFixture(), initial = await f.service.preview(actor, candleRequest()); await finished(f, initial.id); await f.service.confirm(actor, initial.id, 'initial');
    const old = structuredClone(f.state.scenarios[0]); f.market.history.mockClear(); f.market.resolveCandle.mockClear(); jest.setSystemTime(NOW + 120000);
    const started = await f.service.advance(actor, old.id, new Date(NOW + 120000).toISOString(), 'advance-key'), next = await finished(f, started.id);
    expect(next.status).toBe('READY'); expect(f.market.history).toHaveBeenCalledWith(expect.objectContaining({ startTime: NOW, endTime: NOW + 120000 }));
    expect(f.market.resolveCandle).not.toHaveBeenCalled(); expect(next.result.replay.journal.slice(0, old.result.journal.length)).toEqual(old.result.journal);
    await f.service.confirm(actor, next.id, 'advance-confirm'); expect(f.state.scenarios[0].version).toBe(2);
    expect(f.state.scenarios[0].position.effectiveOpenedAt).toBe(old.position.effectiveOpenedAt); expect(f.tx.reserved.eq(1000)).toBe(true);
    expect(f.entries.filter(e => e.kind === 'OPEN_FEE')).toHaveLength(1); expect(f.entries.filter(e => e.kind === 'FUNDING')).toHaveLength(1);
  });
  test('legacy next-open model keeps its original slipped fill on an incremental advance', async () => {
    const f = historicalFixture(), initial = await f.service.preview(actor, candleRequest({ candleEntry: undefined, effectiveOpenedAt: new Date(NOW - 6 * 60000).toISOString() }));
    const first = await finished(f, initial.id); expect(first.status).toBe('READY'); expect(first.result.position.entryPrice).toBe('100.02');
    expect(first.result.profile.pricingModelVersion).toBe('VOLTEX_OBSERVED_DEPTH_IOC_NEXT_OPEN_V1');
    await f.service.confirm(actor, initial.id, 'initial'); const original = structuredClone(f.state.scenarios[0]); jest.setSystemTime(NOW + 60000);
    const started = await f.service.advance(actor, original.id, new Date(NOW + 60000).toISOString(), 'advance-key'), next = await finished(f, started.id);
    expect(next.status).toBe('READY'); expect(next.result.replay.fills[0]).toEqual(original.result.fills[0]);
    expect(next.result.profile).toEqual(original.profile); await f.service.confirm(actor, next.id, 'advance-confirm');
    expect(f.state.scenarios[0].position.entryPrice).toBe('100.02'); expect(f.state.scenarios[0].createdAt).toBe(original.createdAt);
  });
  test('close on an earlier chart candle revises same scenario and escrow with immutable prior audit', async () => {
    const f = historicalFixture(), initial = await f.service.preview(actor, candleRequest()); await finished(f, initial.id); await f.service.confirm(actor, initial.id, 'initial');
    const old = structuredClone(f.state.scenarios[0]), before = { available: f.tx.available.toFixed(), reserved: f.tx.reserved.toFixed(), entries: [...f.entries] };
    const candle = { source: 'BYBIT_LINEAR' as const, interval: '1m', openTime: NOW - 3 * 60000, pricePoint: 'CLOSE' as const };
    const started = await f.service.closeOnChart(actor, old.id, candle, 'close-chart'), p = await finished(f, started.id);
    expect(p.status).toBe('READY'); expect(p.result.scenarioAction).toBe('CLOSE_REVISION'); expect(p.result.position.status).toBe('CLOSED');
    expect(p.result.position.effectiveClosedAt).toBe(new Date(NOW - 2 * 60000).toISOString());
    const repeated = await f.service.closeOnChart(actor, old.id, candle, 'close-chart'); expect(repeated.id).toBe(started.id);
    await f.service.confirm(actor, p.id, 'close-confirm');
    expect(f.state.scenarios).toHaveLength(1); const updated = f.state.scenarios[0];
    expect(updated.id).toBe(old.id); expect(updated.version).toBe(2); expect(updated.position.entryPrice).toBe(old.position.entryPrice);
    expect(updated.revisions?.[0].result).toEqual(old.result); expect(updated.revisions?.[0].position).toEqual(old.position);
    expect(f.tx.available.toFixed()).toBe(before.available); expect(f.tx.reserved.toFixed()).toBe(before.reserved);
    expect(f.entries.slice(0, before.entries.length)).toEqual(before.entries); expect(f.entries.filter(e => e.kind === 'SCENARIO_ALLOCATION')).toHaveLength(1);
    expect(f.entries.filter(e => e.kind === 'SCENARIO_CLOSE_REVISION')).toHaveLength(1);
    await expect(f.service.confirm(actor, p.id, 'repeat-confirm')).rejects.toMatchObject({ code: 'preview_not_ready' }); expect(f.state.scenarios[0].revisions).toHaveLength(1);
  });
  test('a competing advance invalidates a previously reviewed close without another write', async () => {
    const f = historicalFixture(), initial = await f.service.preview(actor, candleRequest()); await finished(f, initial.id); await f.service.confirm(actor, initial.id, 'initial');
    const id = f.state.scenarios[0].id;
    const started = await f.service.closeOnChart(actor, id, { source: 'BYBIT_LINEAR', interval: '1m', openTime: NOW - 3 * 60000, pricePoint: 'CLOSE' }, 'close'); await finished(f, started.id);
    f.state.scenarios[0].version++; const length = f.entries.length;
    await expect(f.service.confirm(actor, started.id, 'confirm')).rejects.toMatchObject({ code: 'scenario_changed' }); expect(f.entries).toHaveLength(length);
  });
  test('mismatched contract or changed finer candle never publishes verified ready result', async () => {
    const f = historicalFixture(), history = f.market.history.getMockImplementation()!;
    f.market.history.mockImplementation(async input => ({ ...await history(input), symbol: 'OTHERUSDT' }));
    const started = await f.service.preview(actor, candleRequest()), p = await finished(f, started.id);
    expect(p.status).toBe('FAILED'); expect(f.entries).toHaveLength(0); expect(f.state.scenarios).toHaveLength(0);
  });
  test('candle read checks owner authorization after public data load', async () => {
    const f = historicalFixture(); f.market.chartCandles.mockImplementation(async () => { f.revoke(); return { candles: [] }; });
    await expect(f.service.getChartCandles(actor, { symbol: 'XYZUSDT', source: 'BYBIT_LINEAR', interval: '1m' })).rejects.toMatchObject({ code: 'private_access_denied' });
  });
});

describe('reference table server DTO',()=>{
 test('fees and signed funding are realized, USD stays unknown, stored position unchanged',()=>{
  const f=fixture(),position=Object.freeze({id:'dto',mode:'HISTORICAL_REPLAY',status:'OPEN',symbol:'XYZUSDT',quantity:'2',initialQuantity:'2',entryPrice:'100',markPrice:'101',asOf:new Date(NOW).toISOString(),realizedGross:'5',openingFees:'1',closingFees:'0.25',fundingNet:'-0.10',unrealizedPnl:'2',allocatedMargin:'100'});
  const before=JSON.stringify(position),dto=(f.service as any).positionDto(position);
  expect(new BigNumber(dto.realizedPnl).eq('3.65')).toBe(true);expect(new BigNumber(dto.unrealizedRoiPercent).eq('2')).toBe(true);expect(dto.usdUnrealizedPnl).toBeNull();expect(dto.usdRealizedPnl).toBeNull();expect(JSON.stringify(position)).toBe(before);
  expect((f.service as any).positionDto({...position,allocatedMargin:'0'}).unrealizedRoiPercent).toBeNull();
 });
});
