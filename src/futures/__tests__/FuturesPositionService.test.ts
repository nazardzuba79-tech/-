import BigNumber from 'bignumber.js';
import { v4 as uuidv4 } from 'uuid';
import { FuturesPositionService } from '../FuturesPositionService';
import { MatchingEngine } from '../../matching-engine/MatchingEngine';
import { MarkPriceService } from '../MarkPriceService';
import express from 'express';
import request from 'supertest';
import { futuresRouter } from '../../api/routes/futures';
import { LEVERAGE_TIERS, HIGH_LEVERAGE_WARNING_THRESHOLD } from '../../config/futuresConfig';
import { FuturesBookTransaction } from '../FuturesBookTransaction';
import { estimateFuturesMarketExecution } from '../FuturesMarketExecution';

jest.mock('../../api/middleware/apiKeyAuth', () => ({
  requireAuthOrApiKey: () => (req: any, _res: any, next: any) => { req.userId = 'taker'; next(); },
  requireTradePermission: (_req: any, _res: any, next: any) => next(),
}));

/** Same fake-Prisma-transaction-client pattern as OrderService.test.ts,
 * extended with the futures-specific tables (position/balance/order). */
function makeFakePrisma(opts?: {
  balances?: Record<string, { available: string; locked: string }>;
  userCreatedAt?: Date;
  orders?: any[];
  positions?: any[];
}) {
  const balances = new Map(Object.entries(opts?.balances ?? {}));
  const orders = new Map<string, any>((opts?.orders ?? []).map((order) => [order.id, { createdAt: new Date(), updatedAt: new Date(), ...order }]));
  const positions = new Map<string, any>((opts?.positions ?? []).map((position) => [position.id, { ...position }]));
  const trades: any[] = [];
  const faults = { beforeCommit: undefined as (() => Promise<void>) | undefined };
  const userCreatedAt = opts?.userCreatedAt ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1yr-old account by default

  const tx = {
    $queryRaw: jest.fn(async (query: any) => query.strings.join('').includes('pg_current_xact_id') ? [{ id: '1' }] : [{ locked: null }]),
    user: {
      findUnique: jest.fn(async () => ({ id: 'u', createdAt: userCreatedAt })),
    },
    futuresBalance: {
      findUnique: jest.fn(async ({ where: { userId_asset: { userId, asset } } }: any) => {
        const b = balances.get(`${userId}:${asset}`);
        return b ? { ...b } : null;
      }),
      update: jest.fn(async ({ where: { userId_asset: { userId, asset } }, data }: any) => {
        balances.set(`${userId}:${asset}`, { available: data.available, locked: data.locked });
      }),
      upsert: jest.fn(async ({ where: { userId_asset: { userId, asset } }, create }: any) => {
        const key = `${userId}:${asset}`;
        if (!balances.has(key)) balances.set(key, { available: create.available, locked: create.locked });
        return { ...balances.get(key)! };
      }),
    },
    futuresOrder: {
      create: jest.fn(async ({ data }: any) => {
        orders.set(data.id, { createdAt: new Date(), updatedAt: new Date(), ...data });
      }),
      update: jest.fn(async ({ where: { id }, data }: any) => {
        Object.assign(orders.get(id), data);
      }),
      findUnique: jest.fn(async ({ where: { id } }: any) => (orders.has(id) ? { ...orders.get(id) } : null)),
      findMany: jest.fn(async ({ where }: any) => Array.from(orders.values()).filter((order) =>
        (where.userId === undefined || order.userId === where.userId)
        && order.symbol === where.symbol
        && (where.marginType === undefined || order.marginType === where.marginType)
        && where.status.in.includes(order.status)
        && (where.reduceOnly === undefined || order.reduceOnly === where.reduceOnly)
      ).map((order) => ({ ...order }))),
    },
    futuresPosition: {
      findFirst: jest.fn(async ({ where }: any) => {
        for (const p of positions.values()) {
          if (
            p.userId === where.userId &&
            p.symbol === where.symbol &&
            p.marginType === where.marginType &&
            p.status === where.status
          ) {
            return { ...p };
          }
        }
        return null;
      }),
      create: jest.fn(async ({ data }: any) => {
        const id = uuidv4();
        const row = { id, realizedPnl: '0', ...data };
        positions.set(id, row);
        return { ...row };
      }),
      update: jest.fn(async ({ where: { id }, data }: any) => {
        Object.assign(positions.get(id), data);
        return { ...positions.get(id) };
      }),
    },
    trade: {
      create: jest.fn(async ({ data }: any) => { trades.push({ ...data }); }),
    },
  };

  const prisma = { $queryRaw: jest.fn(async () => [{ status: 'committed' }]), $transaction: jest.fn(async (fn: any) => {
    const snapshot = [balances, orders, positions].map(map => structuredClone([...map.entries()]));
    const tradeCount = trades.length;
    let callbackCompleted = false;
    try {
      const result = await fn(tx);
      callbackCompleted = true;
      await faults.beforeCommit?.();
      return result;
    } catch (error) {
      [balances, orders, positions].forEach((map, index) => {
        map.clear();
        for (const [key, value] of snapshot[index]) map.set(key, value);
      });
      trades.length = tradeCount;
      if (callbackCompleted) prisma.$queryRaw.mockResolvedValueOnce([{ status: 'aborted' }]);
      throw error;
    }
  }) } as any;
  return { prisma, balances, orders, positions, trades, faults, riskLock: tx.$queryRaw, tx };
}

function bal(balances: Map<string, { available: string; locked: string }>, userId: string, asset: string) {
  const b = balances.get(`${userId}:${asset}`);
  return { available: new BigNumber(b?.available ?? '0'), locked: new BigNumber(b?.locked ?? '0') };
}

describe('Futures API config -> schema -> actual position service', () => {
  function setup() {
    const engine = new MatchingEngine();
    const state = makeFakePrisma({ userCreatedAt: new Date(), balances: {
      'taker:USDT': { available: '10000000', locked: '0' },
      'maker:USDT': { available: '10000000', locked: '0' },
    } });
    const mark = makeMarkPriceService('50000');
    const service = new FuturesPositionService(state.prisma, engine, mark);
    const app = express(); app.use(express.json());
    app.use(futuresRouter(state.prisma, engine, service, mark, { list: () => ['BTC/USDT'], has: (s: string) => s === 'BTC/USDT' } as any));
    return { app, service, engine, ...state };
  }

  it('publishes unchanged five risk tiers and warning threshold, without account-age fields', async () => {
    const { app } = setup();
    const { body } = await request(app).get('/futures/config').expect(200);
    expect(body.minLeverage).toBe(1); expect(body.maxLeverage).toBe(100);
    expect(body).not.toHaveProperty('newAccountMaxLeverage');
    expect(body).not.toHaveProperty('newAccountPeriodDays');
    expect(body.highLeverageWarningThreshold).toBe(HIGH_LEVERAGE_WARNING_THRESHOLD);
    expect(body.leverageTiers).toEqual(JSON.parse(JSON.stringify(LEVERAGE_TIERS)));
    expect(body.leverageTiers.map((t: any) => [t.notionalCap, t.maxLeverage])).toEqual([
      [50000, 100], [250000, 50], [1000000, 20], [5000000, 10], [null, 5],
    ]);
  });

  it.each(['LIMIT', 'MARKET'] as const)('fills a real matching-engine %s order at 100x for a new account', async (type) => {
    const { app, service, positions, balances, orders } = setup();
    await service.placeOrder({ userId: 'maker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(50000), quantity: new BigNumber(1), leverage: 100, marginType: 'ISOLATED' });
    const { body } = await request(app).post('/futures/orders').send({ symbol: 'BTC/USDT', side: 'BUY', type, price: type === 'LIMIT' ? '50000' : undefined, quantity: '1', leverage: 100, marginType: 'ISOLATED' }).expect(201);
    expect(body.order.status).toBe('FILLED');
    expect(body.trades).toHaveLength(1);
    expect(orders.get(body.order.id).leverage).toBe(100);
    const position = [...positions.values()].find(p => p.userId === 'taker');
    expect(position).toMatchObject({ leverage: 100, size: '1', entryPrice: '50000', initialMargin: '500', liquidationPrice: '49700' });
    expect(bal(balances, 'taker', 'USDT').locked.toFixed()).toBe('500');
    expect(bal(balances, 'taker', 'USDT').available.toFixed()).toBe('9999500');
  });

  it.each([
    [50000, 100], [50000.01, 50], [250000, 50], [250000.01, 20],
    [1000000, 20], [1000000.01, 10], [5000000, 10], [5000000.01, 5],
  ])('accepts the tier maximum and rejects excess at %d USDT / %dx', async (notional, max) => {
    const { app, engine, balances, orders } = setup();
    const payload = { symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: String(notional), quantity: '1', leverage: max, marginType: 'CROSS' };
    const tooHigh = max === 100 ? 101 : 100;
    const denied = await request(app).post('/futures/orders').send({ ...payload, leverage: tooHigh }).expect(400);
    if (max < 100) expect(denied.body.error).toContain(`is ${max}x`);
    expect(orders.size).toBe(0);
    expect(bal(balances, 'taker', 'USDT').locked.toFixed()).toBe('0');
    expect(engine.getBook('BTC/USDT').bestBid()).toBeUndefined();
    await request(app).post('/futures/orders').send(payload).expect(201);
    expect([...orders.values()][0].leverage).toBe(max);
    expect(bal(balances, 'taker', 'USDT').locked.toFixed()).toBe(new BigNumber(notional).div(max).toFixed());
  });

  it.each([0, 101, 1.5])('rejects invalid platform leverage %s before any order writes', async leverage => {
    const { app, orders } = setup();
    await request(app).post('/futures/orders').send({ symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: '50000', quantity: '1', leverage, marginType: 'ISOLATED' }).expect(400);
    expect(orders.size).toBe(0);
  });
});

function makeMarkPriceService(price = '60000') {
  return new MarkPriceService({ getTicker: jest.fn().mockResolvedValue({ lastPrice: price }) } as any);
}

describe('Futures MARKET full-depth collateral and tier preflight', () => {
  function setup(side: 'BUY' | 'SELL' = 'BUY', marginType: 'ISOLATED' | 'CROSS' = 'ISOLATED', position?: any) {
    const s = makeFakePrisma({ balances: {
      'taker:USDT': { available: '1000000', locked: position?.initialMargin ?? '0' },
      'maker1:USDT': { available: '1000000', locked: '0' },
      'maker2:USDT': { available: '1000000', locked: '0' },
    }, positions: position ? [position] : [] });
    const engine = new MatchingEngine();
    const service = new FuturesPositionService(s.prisma, engine, makeMarkPriceService());
    const opposite = side === 'BUY' ? 'SELL' : 'BUY';
    const maker = (userId: string, quantity: string, price: string, reduceOnly = false) => service.placeOrder({
      userId, symbol: 'BTC/USDT', side: opposite, type: 'LIMIT', quantity: new BigNumber(quantity),
      price: new BigNumber(price), leverage: 20, marginType, reduceOnly,
    });
    const market = (leverage = 50, quantity = '1', reduceOnly = false) => service.placeOrder({
      userId: 'taker', symbol: 'BTC/USDT', side, type: 'MARKET', quantity: new BigNumber(quantity), leverage, marginType, reduceOnly,
    });
    const snapshot = () => JSON.stringify({ orders: [...s.orders], positions: [...s.positions], balances: [...s.balances], trades: s.trades,
      book: ['BUY', 'SELL'].map(side => engine.getBook('BTC/USDT').getBook(side as 'BUY' | 'SELL')) });
    const clearWrites = () => { for (const spy of [s.tx.futuresOrder.create, s.tx.futuresOrder.update, s.tx.futuresBalance.update,
      s.tx.futuresPosition.create, s.tx.futuresPosition.update, s.tx.trade.create]) spy.mockClear(); };
    const noWrites = () => { for (const spy of [s.tx.futuresOrder.create, s.tx.futuresOrder.update, s.tx.futuresBalance.update,
      s.tx.futuresPosition.create, s.tx.futuresPosition.update, s.tx.trade.create]) expect(spy).not.toHaveBeenCalled(); };
    return { ...s, engine, service, maker, market, snapshot, clearWrites, noWrites };
  }
  function position(side = 'LONG', size = '4', leverage = 100) {
    return { id: 'position', userId: 'taker', symbol: 'BTC/USDT', side, size, entryPrice: '10000', leverage,
      initialMargin: new BigNumber(size).times(10000).div(leverage).toString(), marginType: 'ISOLATED',
      status: 'OPEN', realizedPnl: '0', liquidationPrice: '9940' };
  }

  it.each([['BUY', 'ISOLATED'], ['SELL', 'ISOLATED'], ['BUY', 'CROSS'], ['SELL', 'CROSS']] as const)
  ('%s/%s fills two levels at 75k notional with fully backed 50x margin', async (side, mode) => {
    const s = setup(side, mode);
    await s.maker('maker1', '0.5', '50000'); await s.maker('maker2', '0.5', '100000');
    const result = await s.market();
    expect(result.order.status).toBe('FILLED'); expect(result.order.remainingQuantity.toString()).toBe('0');
    expect(result.trades.map(t => t.price.toString())).toEqual(side === 'BUY' ? ['50000', '100000'] : ['100000', '50000']);
    expect(result.trades.reduce((n, t) => n.plus(t.price.times(t.quantity)), new BigNumber(0)).toString()).toBe('75000');
    expect([...s.positions.values()].find(p => p.userId === 'taker')).toMatchObject({ size: '1', leverage: 50, initialMargin: '1500', entryPrice: '75000' });
    expect(s.balances.get('taker:USDT')).toEqual({ available: '998500', locked: '1500' });
  });
  it('estimates without mutating staged/live orders, positions, balances or generating any trades', async () => {
    const s = setup();
    const first = await s.maker('maker1', '0.5', '50000'); const second = await s.maker('maker2', '0.5', '100000');
    const session = await FuturesBookTransaction.load(s.tx as any, 'BTC/USDT');
    const before = s.snapshot(), stagedBefore = JSON.stringify(session.staged.getBook('BTC/USDT').getBook('SELL'));
    s.clearWrites();
    const submit = jest.spyOn(MatchingEngine.prototype, 'submitOrder');
    try {
      const plan = await estimateFuturesMarketExecution(s.tx as any, session, { userId: 'taker', side: 'BUY',
        quantity: new BigNumber(1), leverage: 50, marginType: 'ISOLATED' });
      expect(plan.executableQuantity.toString()).toBe('1'); expect(plan.notional.toString()).toBe('75000');
      expect(plan.legs.map(leg => leg.makerOrderId)).toEqual([first.order.id, second.order.id]);
      expect(plan.reservedMargin.toString()).toBe('1500'); expect(submit).not.toHaveBeenCalled();
      expect(s.snapshot()).toBe(before); expect(JSON.stringify(session.staged.getBook('BTC/USDT').getBook('SELL'))).toBe(stagedBefore);
      s.noWrites();
    } finally { submit.mockRestore(); }
  });
  it('rejects a multi-level 75k MARKET at 100x before all writes and book mutations', async () => {
    const s = setup(); await s.maker('maker1', '0.5', '50000'); await s.maker('maker2', '0.5', '100000');
    const before = s.snapshot(); s.clearWrites();
    await expect(s.market(100)).rejects.toThrow('75000.00 USDT resulting exposure is 50x');
    expect(s.snapshot()).toBe(before); s.noWrites();
  });
  it('preserves same-price FIFO through estimation, execution and the remaining maker quantity', async () => {
    const s = setup();
    const first = await s.maker('maker1', '0.5', '50000');
    const second = await s.maker('maker2', '1', '50000');
    const result = await s.market();
    expect(result.trades.map(t => [t.makerOrderId, t.quantity.toString()])).toEqual([
      [first.order.id, '0.5'], [second.order.id, '0.5'],
    ]);
    expect(s.orders.get(second.order.id)).toMatchObject({ status: 'PARTIALLY_FILLED', remainingQuantity: '0.5' });
    expect(s.engine.getBook('BTC/USDT').getBook('SELL').map(o => [o.id, o.remainingQuantity.toString()]))
      .toEqual([[second.order.id, '0.5']]);
  });
  it.each(['self-match', 'legacy leverage'])('rejects a later %s maker during MARKET preflight before any writes', async condition => {
    const s = setup();
    await s.maker('maker1', '0.5', '10000');
    await s.maker(condition === 'self-match' ? 'taker' : 'maker2', '0.5', '12000');
    if (condition === 'legacy leverage') {
      s.positions.set('legacy', { ...position('SHORT', '1', 10), id: 'legacy', userId: 'maker2' });
      s.balances.set('maker2:USDT', { available: '998700', locked: '1300' });
    }
    const before = s.snapshot(); s.clearWrites();
    await expect(s.market()).rejects.toThrow(condition === 'self-match' ? 'Futures self-match is not allowed' : 'requires 10x leverage');
    expect(s.snapshot()).toBe(before); s.noWrites();
  });
  it.each(['BUY', 'SELL'] as const)('rejects insufficient total %s liquidity without any partial execution or writes', async side => {
    const s = setup(side); await s.maker('maker1', '0.5', '50000');
    const before = s.snapshot(); s.clearWrites();
    await expect(s.market()).rejects.toThrow('Insufficient market liquidity for requested quantity');
    expect(s.snapshot()).toBe(before); s.noWrites();
  });
  it('rejects a balance sufficient at best ask but insufficient for the complete execution', async () => {
    const s = setup(); await s.maker('maker1', '0.5', '50000'); await s.maker('maker2', '0.5', '100000');
    s.balances.set('taker:USDT', { available: '1000', locked: '0' });
    const before = s.snapshot(); s.clearWrites();
    await expect(s.market()).rejects.toThrow('Insufficient USDT margin balance');
    expect(s.snapshot()).toBe(before); s.noWrites();
  });
  it.each([['15000', true], ['15000.02', false]] as const)('existing 40k + multi-level MARKET uses all legs at the exact 50k boundary (%s)', async (secondPrice, accepted) => {
    const s = setup('BUY', 'ISOLATED', position());
    await s.maker('maker1', '0.5', '5000');
    await s.maker('maker2', '0.5', secondPrice);
    const before = s.snapshot(); s.clearWrites();
    if (accepted) {
      await s.market(100);
      expect(s.positions.get('position')).toMatchObject({ size: '5', initialMargin: '500', leverage: 100 });
      expect(s.balances.get('taker:USDT')!.locked).toBe('500');
    } else {
      await expect(s.market(100)).rejects.toThrow('50000.01 USDT resulting exposure is 50x');
      expect(s.snapshot()).toBe(before); s.noWrites();
    }
  });
  it('pending exposure is added to full MARKET notional rather than only the best-price prefix', async () => {
    const s = setup();
    await s.service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT',
      quantity: new BigNumber(1), price: new BigNumber(20000), leverage: 100, marginType: 'ISOLATED' });
    await s.maker('maker1', '0.5', '25000'); await s.maker('maker2', '0.5', '50000');
    const before = s.snapshot(); s.clearWrites();
    await expect(s.market(100)).rejects.toThrow('57500.00 USDT resulting exposure is 50x');
    expect(s.snapshot()).toBe(before); s.noWrites();
  });
  it('a flip tiers the expensive remainder, not the whole-sweep average', async () => {
    const s = setup('BUY', 'ISOLATED', position('SHORT', '0.5', 10));
    await s.maker('maker1', '0.5', '10000'); await s.maker('maker2', '0.5', '120000');
    const before = s.snapshot(); s.clearWrites();
    await expect(s.market(100)).rejects.toThrow('60000.00 USDT resulting exposure is 50x');
    expect(s.snapshot()).toBe(before); s.noWrites();
  });
  it('rolls back all persistence and preserves the live book if SQL fails after a multi-level estimate', async () => {
    const s = setup(); await s.maker('maker1', '0.5', '50000'); await s.maker('maker2', '0.5', '100000');
    const before = s.snapshot();
    s.tx.trade.create.mockImplementationOnce(async () => { throw new Error('injected trade failure'); });
    await expect(s.market()).rejects.toThrow('injected trade failure');
    expect(s.snapshot()).toBe(before);
  });
});

describe('Futures execution-time reduce-only and atomic book publication', () => {
  function setup(side: 'LONG' | 'SHORT' = 'LONG', marginType: 'ISOLATED' | 'CROSS' = 'ISOLATED') {
    const state = makeFakePrisma({ balances: {
      'owner:USDT': { available: '100000', locked: '1000' },
      'counter:USDT': { available: '100000', locked: '0' },
    }, positions: [{ id: 'position', userId: 'owner', symbol: 'BTC/USDT', side, size: '1',
      entryPrice: '10000', initialMargin: '1000', leverage: 10, marginType,
      liquidationPrice: '9040', status: 'OPEN', realizedPnl: '0' }] });
    const engine = new MatchingEngine();
    const mark = makeMarkPriceService('10000');
    const service = new FuturesPositionService(state.prisma, engine, mark);
    const closingSide: 'BUY' | 'SELL' = side === 'LONG' ? 'SELL' : 'BUY';
    const openingSide: 'BUY' | 'SELL' = side === 'LONG' ? 'BUY' : 'SELL';
    const place = (userId: string, orderSide: 'BUY' | 'SELL', qty: string, reduceOnly = false, leverage = 10) =>
      service.placeOrder({ userId, symbol: 'BTC/USDT', side: orderSide, type: 'LIMIT',
        quantity: new BigNumber(qty), price: new BigNumber(10000), leverage, marginType, reduceOnly });
    return { ...state, engine, mark, service, place, closingSide, openingSide };
  }

  it.each([['LONG', 'ISOLATED'], ['SHORT', 'ISOLATED'], ['LONG', 'CROSS'], ['SHORT', 'CROSS']] as const)
  ('%s/%s: two resting reduce-only orders cannot flip; partial maker fills persist exactly', async (side, mode) => {
    const s = setup(side, mode);
    const first = await s.place('owner', s.closingSide, '1', true, 100);
    const second = await s.place('owner', s.closingSide, '1', true, 20);
    expect(bal(s.balances, 'owner', 'USDT').locked.toFixed()).toBe('1000');
    const partial = await s.place('counter', s.openingSide, '0.4');
    expect(partial.trades.map(t => t.quantity.toString())).toEqual(['0.4']);
    expect(s.orders.get(first.order.id)).toMatchObject({ status: 'PARTIALLY_FILLED', remainingQuantity: '0.6' });
    expect(s.orders.get(second.order.id)).toMatchObject({ status: 'CANCELLED', remainingQuantity: '1' });
    const final = await s.place('counter', s.openingSide, '1');
    expect(final.trades.map(t => t.quantity.toString())).toEqual(['0.6']);
    expect(final.order.remainingQuantity.toString()).toBe('0.4');
    expect(s.trades).toHaveLength(2);
    expect(s.positions.get('position')).toMatchObject({ status: 'CLOSED', size: '0', leverage: 10 });
    expect([...s.positions.values()].filter(p => p.userId === 'owner' && p.status === 'OPEN')).toHaveLength(0);
    expect(bal(s.balances, 'owner', 'USDT').locked.toFixed()).toBe('0');
    expect(bal(s.balances, 'owner', 'USDT').available.toFixed()).toBe('101000');
    expect(s.engine.getBook('BTC/USDT').getBook(s.closingSide)).toHaveLength(0);
  });

  it('caps a legacy oversized maker to the CURRENT size and persists no excess trade', async () => {
    const s = setup();
    const resting = await s.place('owner', 'SELL', '1', true);
    Object.assign(s.positions.get('position'), { size: '0.25', initialMargin: '250' });
    s.balances.set('owner:USDT', { available: '100750', locked: '250' });
    const result = await s.place('counter', 'BUY', '1');
    expect(result.trades.map(t => t.quantity.toFixed())).toEqual(['0.25']);
    expect(s.orders.get(resting.order.id)).toMatchObject({ status: 'CANCELLED', remainingQuantity: '0.75' });
    expect(s.trades).toHaveLength(1);
    expect(bal(s.balances, 'owner', 'USDT').locked.toFixed()).toBe('0');
  });

  it.each(['LONG', 'SHORT'] as const)('%s taker reduce-only never opens or increases and retains no resting margin', async side => {
    const s = setup(side);
    await s.place('counter', s.openingSide, '0.4');
    const result = await s.place('owner', s.closingSide, '1', true, 100);
    expect(result.order.status).toBe('PARTIALLY_FILLED');
    expect(result.order.remainingQuantity.toFixed()).toBe('0.6');
    expect(s.positions.get('position')).toMatchObject({ size: '0.6', initialMargin: '600', leverage: 10 });
    expect(bal(s.balances, 'owner', 'USDT').locked.toFixed()).toBe('600');
    expect(bal(s.balances, 'owner', 'USDT').available.toFixed()).toBe('100400');
  });

  it('does not publish pending book mutations or mark prices before COMMIT; rolls back on COMMIT failure', async () => {
    const s = setup();
    const resting = await s.place('counter', 'BUY', '1');
    const maker = s.engine.getBook('BTC/USDT').bestBid()!;
    const originalBalances = structuredClone([...s.balances]);
    const mark = jest.spyOn(s.mark, 'recordFuturesTrade');
    s.faults.beforeCommit = async () => {
      expect(s.engine.getBook('BTC/USDT').bestBid()).toBe(maker);
      expect(maker.remainingQuantity.toString()).toBe('1');
      expect(mark).not.toHaveBeenCalled();
      throw new Error('commit rejected');
    };
    await expect(s.place('owner', 'SELL', '1', true)).rejects.toThrow('commit rejected');
    expect([...s.balances]).toEqual(originalBalances);
    expect(s.orders.size).toBe(1);
    expect(s.orders.get(resting.order.id)).toMatchObject({ status: 'OPEN', remainingQuantity: '1' });
    expect(s.positions.get('position')).toMatchObject({ status: 'OPEN', size: '1' });
    expect(s.trades).toHaveLength(0);
    s.faults.beforeCommit = undefined;
    expect((await s.place('owner', 'SELL', '1', true)).trades).toHaveLength(1);
  });

  it('legacy incompatible maker aborts without changing any live order, balance, position or trade', async () => {
    const s = setup();
    const resting = await s.place('owner', 'BUY', '1', false, 10);
    s.orders.get(resting.order.id).leverage = 50; // pre-release legacy row
    const maker = s.engine.getBook('BTC/USDT').bestBid()!;
    const original = structuredClone({ orders: [...s.orders], balances: [...s.balances], positions: [...s.positions] });
    await expect(s.place('counter', 'SELL', '1')).rejects.toThrow('requires 10x');
    expect({ orders: [...s.orders], balances: [...s.balances], positions: [...s.positions] }).toEqual(original);
    expect(s.engine.getBook('BTC/USDT').bestBid()).toBe(maker);
    expect(maker.remainingQuantity.toFixed()).toBe('1');
    expect(s.engine.getBook('BTC/USDT').bestAsk()).toBeUndefined();
    expect(s.trades).toHaveLength(0);
    // A valid non-crossing next order sees and preserves the original bid.
    await s.service.placeOrder({ userId: 'counter', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT',
      quantity: new BigNumber(1), price: new BigNumber(11000), leverage: 10, marginType: 'ISOLATED' });
    expect(s.engine.getBook('BTC/USDT').bestBid()!.remainingQuantity.toFixed()).toBe('1');
  });
});

describe('Futures position leverage consistency', () => {
  function setup(leverage?: number, marginType: 'ISOLATED' | 'CROSS' = 'ISOLATED') {
    const initialMargin = leverage ? new BigNumber(20000).div(leverage).toFixed() : '0';
    const state = makeFakePrisma({
      balances: {
        'taker:USDT': { available: '100000', locked: initialMargin },
        'maker:USDT': { available: '100000', locked: '0' },
      },
      positions: leverage ? [{
        id: 'long', userId: 'taker', symbol: 'BTC/USDT', side: 'LONG',
        size: '2', entryPrice: '10000', leverage, marginType, initialMargin,
        liquidationPrice: leverage === 100 ? '9940' : '9040',
        status: 'OPEN', realizedPnl: '0',
      }] : [],
    });
    const engine = new MatchingEngine();
    const service = new FuturesPositionService(state.prisma, engine, makeMarkPriceService('10000'));
    const place = (userId: string, side: 'BUY' | 'SELL', quantity: string, orderLeverage: number, reduceOnly = false) =>
      service.placeOrder({ userId, symbol: 'BTC/USDT', side, quantity: new BigNumber(quantity),
        price: new BigNumber(10000), type: 'LIMIT', leverage: orderLeverage, marginType, reduceOnly });
    return { ...state, engine, service, place };
  }

  it.each([
    [10, 100, false, '1000', '9040'], [100, 10, false, '100', '9940'],
    [10, 100, true, '1000', '9040'], [100, 10, true, '100', '9940'],
  ] as const)('partial reduction %dx with %dx order (reduceOnly=%s) retains position state', async (existing, incoming, reduceOnly, margin, liquidation) => {
    const s = setup(existing);
    await s.place('maker', 'BUY', '1', 20);
    const result = await s.place('taker', 'SELL', '1', incoming, reduceOnly);
    expect(result.order.status).toBe('FILLED');
    expect(s.positions.get('long')).toMatchObject({
      status: 'OPEN', side: 'LONG', size: '1', entryPrice: '10000',
      leverage: existing, initialMargin: margin, liquidationPrice: liquidation,
    });
    expect(bal(s.balances, 'taker', 'USDT').locked.toFixed()).toBe(margin);
    expect(bal(s.balances, 'taker', 'USDT').available.toFixed()).toBe(new BigNumber(100000).plus(margin).toFixed());
  });

  it.each([false, true])('full close with a different order leverage succeeds (reduceOnly=%s)', async reduceOnly => {
    const s = setup(10);
    await s.place('maker', 'BUY', '2', 20);
    expect((await s.place('taker', 'SELL', '2', 100, reduceOnly)).order.status).toBe('FILLED');
    expect(s.positions.get('long')).toMatchObject({ status: 'CLOSED', size: '0', leverage: 10 });
    expect(bal(s.balances, 'taker', 'USDT').locked.toFixed()).toBe('0');
    expect(bal(s.balances, 'taker', 'USDT').available.toFixed()).toBe('102000');
  });

  it.each([[10, 100], [100, 10]])('CROSS reduction retains %dx in the liquidation calculation despite a %dx order', async (existing, incoming) => {
    const s = setup(existing, 'CROSS');
    const calculation = jest.spyOn(s.service as any, 'computeLiqPrice');
    await s.place('maker', 'BUY', '1', 20);
    await s.place('taker', 'SELL', '1', incoming, true);
    const callIndex = calculation.mock.calls.findIndex(args => args[1] === 'taker');
    expect(callIndex).toBeGreaterThanOrEqual(0);
    expect(calculation.mock.calls[callIndex][5]).toBe(existing);
    const actualLiquidation = await calculation.mock.results[callIndex].value;
    expect(s.positions.get('long')).toMatchObject({ leverage: existing, size: '1',
      initialMargin: new BigNumber(10000).div(existing).toFixed(),
      liquidationPrice: actualLiquidation.toString() });
  });

  it('defensively refuses a legacy incompatible fill without rewriting position leverage or margin', async () => {
    const s = setup(20);
    await expect((s.service as any).applyFill(s.tx, 'taker', 'BTC/USDT', 'USDT', 'BUY',
      new BigNumber(1), new BigNumber(10000), 50, 'ISOLATED')).rejects.toThrow('requires 20x leverage');
    expect(s.tx.futuresPosition.update).not.toHaveBeenCalled();
    expect(s.tx.futuresBalance.update).not.toHaveBeenCalled();
  });

  it('accepts an existing 20x position plus a 20x increase with consistent margin and liquidation', async () => {
    const s = setup(20);
    await s.place('maker', 'SELL', '1', 20);
    await s.place('taker', 'BUY', '1', 20);
    expect(s.positions.get('long')).toMatchObject({
      size: '3', leverage: 20, initialMargin: '1500', liquidationPrice: '9540',
    });
    expect(bal(s.balances, 'taker', 'USDT').locked.toFixed()).toBe('1500');
  });

  it('rejects a 50x increase to 20x before any order/margin write or matching', async () => {
    const s = setup(20);
    const submit = jest.spyOn(s.engine, 'submitOrder');
    await expect(s.place('taker', 'BUY', '1', 50)).rejects.toThrow('requires 20x leverage');
    expect(s.tx.futuresOrder.create).not.toHaveBeenCalled();
    expect(s.tx.futuresBalance.update).not.toHaveBeenCalled();
    expect(s.tx.futuresPosition.update).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(s.riskLock).toHaveBeenCalledTimes(2); // global book lock plus unchanged risk-bucket lock
  });

  it.each(['OPEN', 'PARTIALLY_FILLED'])('rejects leverage incompatible with %s same-direction pending orders before writes', async status => {
    const s = setup();
    const first = await s.place('taker', 'BUY', '1', 20);
    if (status === 'PARTIALLY_FILLED') {
      // The maker has genuinely filled half, leaving a pending remainder.
      await s.place('maker', 'SELL', '0.5', 20);
      Object.assign(s.orders.get(first.order.id), { status, remainingQuantity: '0.5' });
      // Test pending checks even after the position has subsequently closed.
      s.positions.clear();
    }
    s.tx.futuresOrder.create.mockClear();
    s.tx.futuresBalance.update.mockClear();
    const submit = jest.spyOn(s.engine, 'submitOrder');
    await expect(s.place('taker', 'BUY', '1', 50)).rejects.toThrow('Pending BUY orders require 20x');
    expect(s.tx.futuresOrder.create).not.toHaveBeenCalled();
    expect(s.tx.futuresBalance.update).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('allows matching pending orders at one leverage to fill into a consistent position', async () => {
    const s = setup();
    await s.place('taker', 'BUY', '1', 20);
    await s.place('taker', 'BUY', '1', 20);
    await s.place('maker', 'SELL', '2', 50);
    const p = [...s.positions.values()].find(p => p.userId === 'taker');
    expect(p).toMatchObject({ side: 'LONG', size: '2', leverage: 20, initialMargin: '1000', liquidationPrice: '9540' });
  });

  it('keeps pending opposite-side orders compatible even when they initially only reduce', async () => {
    const s = setup(10);
    await s.place('taker', 'SELL', '1', 20);
    await expect(s.place('taker', 'SELL', '2', 50)).rejects.toThrow('Pending SELL orders require 20x');
    await s.place('taker', 'SELL', '2', 20);
    await s.place('maker', 'BUY', '3', 20);
    expect(s.positions.get('long')).toMatchObject({ status: 'CLOSED', leverage: 10 });
    const short = [...s.positions.values()].find(p => p.userId === 'taker' && p.status === 'OPEN');
    expect(short).toMatchObject({ side: 'SHORT', size: '1', leverage: 20, initialMargin: '500', liquidationPrice: '10460' });
  });

  it('flips LONG 10x to a new SHORT 50x with matching leverage, margin and liquidation', async () => {
    const s = setup(10);
    await s.place('maker', 'BUY', '3', 20);
    await s.place('taker', 'SELL', '3', 50);
    expect(s.positions.get('long')).toMatchObject({ status: 'CLOSED', size: '0', leverage: 10 });
    const short = [...s.positions.values()].find(p => p.userId === 'taker' && p.status === 'OPEN');
    expect(short).toMatchObject({ side: 'SHORT', size: '1', entryPrice: '10000', leverage: 50,
      initialMargin: '200', liquidationPrice: '10160' });
    expect(bal(s.balances, 'taker', 'USDT').locked.toFixed()).toBe('200');
    expect(bal(s.balances, 'taker', 'USDT').available.toFixed()).toBe('101800');
  });
});

describe('FuturesPositionService.placeOrder', () => {
  function existingLong(overrides: Record<string, any> = {}) {
    return {
      id: 'existing-long', userId: 'taker', symbol: 'BTC/USDT', side: 'LONG',
      size: '4', entryPrice: '10000', leverage: 100, marginType: 'ISOLATED',
      initialMargin: '400', liquidationPrice: '9940', status: 'OPEN', realizedPnl: '0',
      ...overrides,
    };
  }

  function activeOrder(overrides: Record<string, any> = {}) {
    return {
      id: uuidv4(), userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT',
      price: '25000', originalQuantity: '1', remainingQuantity: '1', status: 'OPEN',
      reduceOnly: false, leverage: 100, marginType: 'ISOLATED',
      ...overrides,
    };
  }

  it('accepts 40,000 USDT at 100x with no position or pending exposure', async () => {
    const engine = new MatchingEngine();
    const { prisma, orders } = makeFakePrisma({ balances: { 'taker:USDT': { available: '100000', locked: '0' } } });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    const result = await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(40000), quantity: new BigNumber(1), leverage: 100, marginType: 'ISOLATED' });
    expect(result.order.status).toBe('OPEN');
    expect(orders.get(result.order.id).leverage).toBe(100);
  });

  it('accepts exactly 50,000 but rejects 50,000.01 resulting same-direction exposure at 100x', async () => {
    const engine = new MatchingEngine();
    const { prisma, orders, positions } = makeFakePrisma({
      balances: {
        'maker:USDT': { available: '100000', locked: '0' },
        'taker:USDT': { available: '100000', locked: '400' },
      },
      positions: [existingLong()],
    });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    await service.placeOrder({ userId: 'maker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(10000), quantity: new BigNumber(1), leverage: 100, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(10000), quantity: new BigNumber(1), leverage: 100, marginType: 'ISOLATED' });
    expect(positions.get('existing-long').size).toBe('5');
    expect(positions.get('existing-long').entryPrice).toBe('10000');
    expect(orders.size).toBe(2);
    await expect(
      service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber('0.01'), quantity: new BigNumber(1), leverage: 100, marginType: 'ISOLATED' })
    ).rejects.toThrow('Max leverage for a 50000.01 USDT resulting exposure is 50x');
    expect(orders.size).toBe(2);
  });

  it('blocks the split-order bypass once pending same-direction orders exceed 50,000', async () => {
    const engine = new MatchingEngine();
    const { prisma, orders, riskLock } = makeFakePrisma({ balances: { 'taker:USDT': { available: '100000', locked: '0' } } });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());
    const place = (price: string) => service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(price), quantity: new BigNumber(1), leverage: 100, marginType: 'ISOLATED' });

    await place('25000');
    await place('25000');
    expect(orders.size).toBe(2);
    await expect(place('0.01')).rejects.toThrow('resulting exposure is 50x');
    expect(orders.size).toBe(2);
    expect(riskLock.mock.calls.filter(([query]) => query.strings.join('').includes('pg_advisory_xact_lock'))).toHaveLength(6);
  });

  it('counts PARTIALLY_FILLED remaining quantity and its leverage against pending exposure', async () => {
    const engine = new MatchingEngine();
    const { prisma, orders } = makeFakePrisma({
      balances: { 'taker:USDT': { available: '100000', locked: '250' } },
      orders: [activeOrder({ status: 'PARTIALLY_FILLED', originalQuantity: '2', remainingQuantity: '1' })],
    });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(25000), quantity: new BigNumber(1), leverage: 100, marginType: 'ISOLATED' });
    expect(orders.size).toBe(2);
    await expect(
      service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber('0.01'), quantity: new BigNumber(1), leverage: 100, marginType: 'ISOLATED' })
    ).rejects.toThrow('50000.01 USDT resulting exposure');
  });

  it('enforces 50x through 250,000 and 20x above 250,000 on aggregate pending exposure', async () => {
    const engine = new MatchingEngine();
    const { prisma, orders } = makeFakePrisma({
      balances: { 'taker:USDT': { available: '1000000', locked: '4000' } },
      orders: [activeOrder({ price: '200000', leverage: 50 })],
    });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(50000), quantity: new BigNumber(1), leverage: 50, marginType: 'ISOLATED' });
    expect(orders.size).toBe(2);
    await expect(
      service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber('0.01'), quantity: new BigNumber(1), leverage: 50, marginType: 'ISOLATED' })
    ).rejects.toThrow('resulting exposure is 20x');

    const allowedState = makeFakePrisma({
      balances: { 'taker:USDT': { available: '1000000', locked: '10000' } },
      orders: [activeOrder({ price: '200000', leverage: 20 })],
    });
    const allowedService = new FuturesPositionService(allowedState.prisma, new MatchingEngine(), makeMarkPriceService());
    await expect(
      allowedService.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber('50000.01'), quantity: new BigNumber(1), leverage: 20, marginType: 'ISOLATED' })
    ).resolves.toBeDefined();
  });

  it('does not tier-reject reduce-only, partial reductions, or closes of an old high-notional position', async () => {
    const engine = new MatchingEngine();
    const { prisma, positions, balances } = makeFakePrisma({
      balances: {
        'maker1:USDT': { available: '1000000', locked: '0' },
        'maker2:USDT': { available: '1000000', locked: '0' },
        'taker:USDT': { available: '99200', locked: '800' },
      },
      positions: [existingLong({ size: '8', initialMargin: '800' })],
    });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService('10000'));

    await service.placeOrder({ userId: 'maker1', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(10000), quantity: new BigNumber(1), leverage: 100, marginType: 'ISOLATED' });
    // A non-reduce-only opposite order that cannot flip is still a pure
    // partial reduction and must not inherit the old 80k tier rejection.
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(10000), quantity: new BigNumber(1), leverage: 100, marginType: 'ISOLATED' });
    expect(positions.get('existing-long').size).toBe('7');
    expect(bal(balances, 'taker', 'USDT').locked.toFixed()).toBe('700');

    await service.placeOrder({ userId: 'maker2', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(10000), quantity: new BigNumber(7), leverage: 20, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(10000), quantity: new BigNumber(7), leverage: 100, marginType: 'ISOLATED', reduceOnly: true });
    expect(positions.get('existing-long').status).toBe('CLOSED');
    expect(bal(balances, 'taker', 'USDT').locked.toFixed()).toBe('0');
  });

  it('validates only the resulting opposite-side remainder when a position flips', async () => {
    const acceptedState = makeFakePrisma({
      balances: { 'taker:USDT': { available: '100000', locked: '400' } },
      positions: [existingLong()],
    });
    const acceptedService = new FuturesPositionService(acceptedState.prisma, new MatchingEngine(), makeMarkPriceService('10000'));
    await expect(acceptedService.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(10000), quantity: new BigNumber(9), leverage: 100, marginType: 'ISOLATED' })).resolves.toBeDefined();

    const rejectedState = makeFakePrisma({
      balances: { 'taker:USDT': { available: '100000', locked: '400' } },
      positions: [existingLong()],
    });
    const rejectedService = new FuturesPositionService(rejectedState.prisma, new MatchingEngine(), makeMarkPriceService('10000'));
    await expect(rejectedService.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(10000), quantity: new BigNumber('9.000001'), leverage: 100, marginType: 'ISOLATED' }))
      .rejects.toThrow('50000.01 USDT resulting exposure');
  });

  it('opens a new LONG position and locks exactly the initial margin', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances, positions } = makeFakePrisma({
      balances: { 'maker:USDT': { available: '100000', locked: '0' }, 'taker:USDT': { available: '10000', locked: '0' } },
    });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    await service.placeOrder({ userId: 'maker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });

    // initial_margin = notional / leverage = 60000 / 10 = 6000
    const takerBal = bal(balances, 'taker', 'USDT');
    expect(takerBal.locked.toString()).toBe('6000');
    expect(takerBal.available.toString()).toBe('4000');

    const position = Array.from(positions.values()).find((p: any) => p.userId === 'taker');
    expect(position.side).toBe('LONG');
    expect(position.size).toBe('1');
    expect(position.entryPrice).toBe('60000');
    // notional 60000 sits in the 2nd tier (>50k cap), mmr = 0.005:
    // liq_price = entry * (1 - 1/10 + mmr) = 60000 * (0.9 + 0.005) = 54300
    expect(new BigNumber(position.liquidationPrice).toNumber()).toBeCloseTo(54300, 6);
  });

  it('averages entry price when increasing an existing same-direction position', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances, positions } = makeFakePrisma({
      balances: {
        'maker1:USDT': { available: '100000', locked: '0' },
        'maker2:USDT': { available: '100000', locked: '0' },
        'taker:USDT': { available: '100000', locked: '0' },
      },
    });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    await service.placeOrder({ userId: 'maker1', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });

    await service.placeOrder({ userId: 'maker2', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(62000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(62000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });

    const position = Array.from(positions.values()).find((p: any) => p.userId === 'taker' && p.status === 'OPEN');
    expect(position.size).toBe('2');
    // average entry = (1*60000 + 1*62000) / 2 = 61000
    expect(new BigNumber(position.entryPrice).toNumber()).toBeCloseTo(61000, 6);

    const takerBal = bal(balances, 'taker', 'USDT');
    // margin = 6000 + 6200 = 12200
    expect(takerBal.locked.toString()).toBe('12200');
  });

  it('partially reduces a position, releasing proportional margin and crediting realized PnL', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances, positions } = makeFakePrisma({
      balances: { 'maker:USDT': { available: '100000', locked: '0' }, 'taker:USDT': { available: '10000', locked: '0' } },
    });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    // taker opens LONG 1 BTC @ 60000, 10x -> margin 6000
    await service.placeOrder({ userId: 'maker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });

    // taker reduces by 0.4 BTC at a higher price (61000) via a SELL, reduceOnly
    await service.placeOrder({ userId: 'maker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(61000), quantity: new BigNumber(0.4), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(61000), quantity: new BigNumber(0.4), leverage: 10, marginType: 'ISOLATED', reduceOnly: true });

    const position = Array.from(positions.values()).find((p: any) => p.userId === 'taker' && p.status === 'OPEN');
    expect(position.size).toBe('0.6');
    expect(position.entryPrice).toBe('60000'); // unchanged on a reduce

    // realized pnl = (61000 - 60000) * 0.4 = 400
    expect(new BigNumber(position.realizedPnl).toNumber()).toBeCloseTo(400, 6);

    // released margin = 6000 * (0.4/1) = 2400; taker started with 10000,
    // locked 6000 (available 4000), then released 2400 margin + 400 pnl.
    const takerBal = bal(balances, 'taker', 'USDT');
    expect(takerBal.locked.toString()).toBe('3600'); // 6000 - 2400
    expect(takerBal.available.toString()).toBe('6800'); // 4000 + 2400 + 400
  });

  it('fully closes a position on an exact-size opposite fill', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances, positions } = makeFakePrisma({
      balances: { 'maker:USDT': { available: '100000', locked: '0' }, 'taker:USDT': { available: '10000', locked: '0' } },
    });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    await service.placeOrder({ userId: 'maker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });

    await service.placeOrder({ userId: 'maker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(58000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(58000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED', reduceOnly: true });

    const position = Array.from(positions.values()).find((p: any) => p.userId === 'taker');
    expect(position.status).toBe('CLOSED');
    expect(position.size).toBe('0');
    // realized pnl = (58000 - 60000) * 1 = -2000 (a loss)
    expect(new BigNumber(position.realizedPnl).toNumber()).toBeCloseTo(-2000, 6);

    const takerBal = bal(balances, 'taker', 'USDT');
    expect(takerBal.locked.toString()).toBe('0');
    // 10000 - 6000 (margin locked) + 6000 (released) - 2000 (loss) = 8000
    expect(takerBal.available.toString()).toBe('8000');
  });

  it('flips from LONG to SHORT when the opposite fill exceeds the existing position size', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances, positions } = makeFakePrisma({
      balances: { 'maker:USDT': { available: '100000', locked: '0' }, 'taker:USDT': { available: '20000', locked: '0' } },
    });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    // taker opens LONG 1 BTC @ 60000
    await service.placeOrder({ userId: 'maker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });

    // taker sells 1.5 BTC @ 61000 (not reduceOnly) -> closes the 1 BTC long, opens 0.5 BTC short
    await service.placeOrder({ userId: 'maker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(61000), quantity: new BigNumber(1.5), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(61000), quantity: new BigNumber(1.5), leverage: 10, marginType: 'ISOLATED' });

    const open = Array.from(positions.values()).find((p: any) => p.userId === 'taker' && p.status === 'OPEN');
    const closed = Array.from(positions.values()).find((p: any) => p.userId === 'taker' && p.status === 'CLOSED');
    expect(closed.realizedPnl).not.toBe('0');
    expect(open.side).toBe('SHORT');
    expect(open.size).toBe('0.5');
    expect(open.entryPrice).toBe('61000');
  });

  it('rejects a reduceOnly order that would exceed the current position size', async () => {
    const engine = new MatchingEngine();
    const { prisma } = makeFakePrisma({ balances: { 'taker:USDT': { available: '10000', locked: '0' } } });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    await expect(
      service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED', reduceOnly: true })
    ).rejects.toThrow('reduceOnly order would exceed the current position size');
  });

  it('rejects leverage above the tier cap for the position notional', async () => {
    const engine = new MatchingEngine();
    const { prisma } = makeFakePrisma({ balances: { 'taker:USDT': { available: '1000000', locked: '0' } } });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    // notional = 10 * 60000 = 600000 -> tier cap is 20x (250k-1M bracket)
    await expect(
      service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(10), leverage: 50, marginType: 'ISOLATED' })
    ).rejects.toThrow(/Max leverage/);
  });

  it.each([1, 5, 10, 20, 50, 100])('accepts %ix for a brand-new account at the 50,000 USDT tier boundary', async (leverage) => {
    const engine = new MatchingEngine();
    const { prisma, balances, orders } = makeFakePrisma({
      balances: { 'taker:USDT': { available: '100000', locked: '0' } },
      userCreatedAt: new Date(), // brand new account
    });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    const result = await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(50000), quantity: new BigNumber(1), leverage, marginType: 'ISOLATED' });
    expect(result.order.status).toBe('OPEN');
    expect(orders.get(result.order.id).leverage).toBe(leverage);
    expect(bal(balances, 'taker', 'USDT').locked.toFixed()).toBe(new BigNumber(50000).div(leverage).toFixed());
  });

  it('rejects when available margin balance is insufficient', async () => {
    const engine = new MatchingEngine();
    const { prisma } = makeFakePrisma({ balances: { 'taker:USDT': { available: '100', locked: '0' } } });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    await expect(
      service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' })
    ).rejects.toThrow('Insufficient USDT margin balance');
  });

  it('rejects a MARKET order with no resting liquidity instead of fake-filling', async () => {
    const engine = new MatchingEngine();
    const { prisma } = makeFakePrisma({ balances: { 'taker:USDT': { available: '10000', locked: '0' } } });
    const service = new FuturesPositionService(prisma, engine, makeMarkPriceService());

    await expect(
      service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' })
    ).rejects.toThrow('Insufficient market liquidity for requested quantity');
  });

  it('records every trade with MarkPriceService so mark price reflects real internal activity', async () => {
    const engine = new MatchingEngine();
    const { prisma } = makeFakePrisma({
      balances: { 'maker:USDT': { available: '100000', locked: '0' }, 'taker:USDT': { available: '10000', locked: '0' } },
    });
    const markPriceService = makeMarkPriceService('60000');
    const spy = jest.spyOn(markPriceService, 'recordFuturesTrade');
    const service = new FuturesPositionService(prisma, engine, markPriceService);

    await service.placeOrder({ userId: 'maker', symbol: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60500), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });
    await service.placeOrder({ userId: 'taker', symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60500), quantity: new BigNumber(1), leverage: 10, marginType: 'ISOLATED' });

    expect(spy).toHaveBeenCalledWith('BTC/USDT', expect.any(BigNumber));
  });
});
