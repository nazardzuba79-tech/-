import BigNumber from 'bignumber.js';
import { DemoTradingService, DemoTradingError } from '../DemoTradingService';
import { MatchingEngine } from '../../matching-engine/MatchingEngine';

/** Same fake-Prisma-transaction pattern as OrderService.test.ts, adapted to
 * the demo tables. */
function makeFakePrisma(seed: Record<string, { available: string; locked: string }> = {}) {
  const balances = new Map(Object.entries(seed));
  const orders = new Map<string, any>();
  const trades: any[] = [];
  const auditLogs: any[] = [];

  const applyDelta = (current: string, change: any) => typeof change === 'object'
    ? new BigNumber(current).plus(change.increment ?? new BigNumber(change.decrement ?? 0).negated()).toFixed()
    : change ?? current;

  const tx = {
    demoBalance: {
      findUnique: jest.fn(async ({ where: { userId_asset: { userId, asset } } }: any) => {
        const b = balances.get(`${userId}:${asset}`);
        return b ? { asset, ...b } : null;
      }),
      findUniqueOrThrow: jest.fn(async ({ where: { userId_asset: { userId, asset } } }: any) => {
        const b = balances.get(`${userId}:${asset}`); if (!b) throw new Error('Balance missing'); return { asset, ...b };
      }),
      update: jest.fn(async ({ where: { userId_asset: { userId, asset } }, data }: any) => {
        balances.set(`${userId}:${asset}`, { available: data.available, locked: data.locked });
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const key = `${where.userId}:${where.asset}`, row = balances.get(key);
        if (!row || (where.available?.gte !== undefined && new BigNumber(row.available).lt(where.available.gte))
          || (where.locked?.gte !== undefined && new BigNumber(row.locked).lt(where.locked.gte))) return { count: 0 };
        balances.set(key, { available: applyDelta(row.available, data.available), locked: applyDelta(row.locked, data.locked) });
        return { count: 1 };
      }),
      upsert: jest.fn(async ({ where: { userId_asset: { userId, asset } }, create, update }: any) => {
        const key = `${userId}:${asset}`;
        if (!balances.has(key)) balances.set(key, { available: create.available, locked: create.locked ?? '0' });
        else {
          const row = balances.get(key)!;
          balances.set(key, { available: applyDelta(row.available, update.available), locked: applyDelta(row.locked, update.locked) });
        }
        return { asset, ...balances.get(key)! };
      }),
    },
    // SpotBookTransaction: advisory lock + transaction id inside, commit status outside.
    $queryRaw: jest.fn(async () => [{ id: '1' }]),
    demoOrder: {
      create: jest.fn(async ({ data }: any) => {
        orders.set(data.id, { createdAt: new Date(), updatedAt: new Date(), ...data });
      }),
      findMany: jest.fn(async ({ where }: any) => [...orders.values()].filter(row => row.pair === where.pair
        && (!where.type || row.type === where.type) && where.status.in.includes(row.status)).map(row => ({ ...row }))),
      update: jest.fn(async ({ where: { id }, data }: any) => {
        Object.assign(orders.get(id), data);
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const order = orders.get(where.id);
        if (!order || order.userId !== where.userId || !where.status.in.includes(order.status)) return { count: 0 };
        Object.assign(order, data); return { count: 1 };
      }),
      findUnique: jest.fn(async ({ where: { id } }: any) => (orders.has(id) ? { ...orders.get(id) } : null)),
    },
    demoTrade: {
      create: jest.fn(async ({ data }: any) => {
        trades.push({ executedAt: new Date(), ...data }); // the column default, as in PostgreSQL
      }),
      findMany: jest.fn(async ({ where }: any) => trades.filter(row => row.pair === where.pair && (where.OR
        ? where.OR.some((clause: any) => Object.entries(clause).some(([key, value]: any) => value.in.includes(row[key])))
        : row.takerOrderId === where.takerOrderId))),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditLogs.push(data);
      }),
    },
  };

  // A thrown transaction leaves no partial writes, like PostgreSQL.
  const prisma = { demoOrder: tx.demoOrder, $queryRaw: jest.fn(async () => [{ status: 'committed' }]), $transaction: jest.fn(async (fn: any) => {
    const saved = [balances, orders].map(map => structuredClone([...map.entries()]));
    const tradeCount = trades.length;
    try { return await fn(tx); } catch (error) {
      [balances, orders].forEach((map: Map<string, any>, i) => { map.clear(); for (const [key, value] of saved[i]) map.set(key, value); });
      trades.length = tradeCount; throw error;
    }
  }) } as any;
  return { prisma, balances, orders, trades, auditLogs, tx };
}

function bal(balances: Map<string, { available: string; locked: string }>, userId: string, asset: string) {
  const b = balances.get(`${userId}:${asset}`);
  return { available: new BigNumber(b?.available ?? '0'), locked: new BigNumber(b?.locked ?? '0') };
}

describe('DemoTradingService', () => {
  describe('placeOrder', () => {
    it('matches two demo LIMIT orders and settles both sides from DemoBalance', async () => {
      const engine = new MatchingEngine();
      const { prisma, balances } = makeFakePrisma({
        'maker:BTC': { available: '1', locked: '0' },
        'taker:USDT': { available: '100000', locked: '0' },
      });
      const service = new DemoTradingService(prisma, engine);

      await service.placeOrder({ userId: 'maker', pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1) });
      await service.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1) });

      expect(bal(balances, 'taker', 'BTC').available.toString()).toBe('1');
      expect(bal(balances, 'maker', 'USDT').available.toString()).toBe('60000');
    });

    it('rejects a MARKET order with no resting demo liquidity to fill against', async () => {
      const engine = new MatchingEngine();
      const { prisma } = makeFakePrisma({ 'taker:USDT': { available: '100000', locked: '0' } });
      const service = new DemoTradingService(prisma, engine);

      await expect(
        service.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber(1) })
      ).rejects.toMatchObject({ message: 'No liquidity available for this market order', code: 'NO_LIQUIDITY' });
    });

    it('rejects placing an order with insufficient demo balance', async () => {
      const engine = new MatchingEngine();
      const { prisma } = makeFakePrisma({ 'taker:USDT': { available: '10', locked: '0' } });
      const service = new DemoTradingService(prisma, engine);

      await expect(
        service.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1) })
      ).rejects.toThrow(DemoTradingError);
      await expect(
        service.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1) })
      ).rejects.toMatchObject({ message: 'Insufficient USDT balance', code: 'INSUFFICIENT_BALANCE' });
    });

    it('never touches a real Balance/Order table — the fake prisma has none and nothing throws looking for one', async () => {
      const engine = new MatchingEngine();
      const { prisma } = makeFakePrisma({ 'maker:BTC': { available: '1', locked: '0' } });
      const service = new DemoTradingService(prisma, engine);

      // If placeOrder ever called tx.balance/tx.order (the REAL tables)
      // instead of tx.demoBalance/tx.demoOrder, this fake (which defines
      // no `balance`/`order` keys at all) would throw "not a function".
      await expect(
        service.placeOrder({ userId: 'maker', pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1) })
      ).resolves.toBeDefined();
    });
  });

  describe('cancelOrder', () => {
    it('releases the lock and removes the order from the demo book', async () => {
      const engine = new MatchingEngine();
      const { prisma, balances } = makeFakePrisma({ 'maker:BTC': { available: '1', locked: '0' } });
      const service = new DemoTradingService(prisma, engine);

      const { order } = await service.placeOrder({ userId: 'maker', pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1) });

      const cancelled = await service.cancelOrder('maker', order.id);
      expect(cancelled).not.toBeNull();
      expect(bal(balances, 'maker', 'BTC')).toEqual({ available: new BigNumber('1'), locked: new BigNumber('0') });
      expect(engine.getBook('BTC/USDT').snapshot().asks).toHaveLength(0);
    });

    it('returns null for another user\'s order', async () => {
      const engine = new MatchingEngine();
      const { prisma } = makeFakePrisma({ 'maker:BTC': { available: '1', locked: '0' } });
      const service = new DemoTradingService(prisma, engine);
      const { order } = await service.placeOrder({ userId: 'maker', pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1) });

      expect(await service.cancelOrder('someone-else', order.id)).toBeNull();
    });
  });

  describe('one transactional book (Issue #592)', () => {
    const limit = (userId: string, side: 'BUY' | 'SELL', price: number, quantity: number) =>
      ({ userId, pair: 'BTC/USDT', side, type: 'LIMIT' as const, price: new BigNumber(price), quantity: new BigNumber(quantity) });

    it('persists the maker after a fill, so a filled maker can never be cancelled into a second refund', async () => {
      const { prisma, balances, orders } = makeFakePrisma({ 'maker:BTC': { available: '2', locked: '0' }, 'taker:USDT': { available: '1000', locked: '0' } });
      const service = new DemoTradingService(prisma, new MatchingEngine());
      const { order: maker } = await service.placeOrder(limit('maker', 'SELL', 100, 2));
      await service.placeOrder(limit('taker', 'BUY', 100, 0.5));
      expect(orders.get(maker.id)).toMatchObject({ status: 'PARTIALLY_FILLED', remainingQuantity: '1.5' });
      await service.placeOrder(limit('taker', 'BUY', 100, 1.5));
      expect(orders.get(maker.id)).toMatchObject({ status: 'FILLED', remainingQuantity: '0' });
      expect(await service.cancelOrder('maker', maker.id)).toBeNull();
      expect(bal(balances, 'maker', 'BTC')).toEqual({ available: new BigNumber(0), locked: new BigNumber(0) });
      expect(bal(balances, 'maker', 'USDT').available.toFixed()).toBe('200');
    });

    it('a resting order survives a restart: a new process loads it from the committed rows', async () => {
      const { prisma, balances } = makeFakePrisma({ 'maker:BTC': { available: '1', locked: '0' }, 'taker:USDT': { available: '1000', locked: '0' } });
      await new DemoTradingService(prisma, new MatchingEngine()).placeOrder(limit('maker', 'SELL', 100, 1));
      const restarted = new DemoTradingService(prisma, new MatchingEngine());
      expect((await restarted.getOrderBook('BTC/USDT')).asks).toHaveLength(1);
      const { order, trades } = await restarted.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber(1) });
      expect(order.status).toBe('FILLED'); expect(trades).toHaveLength(1);
      // MARKET BUY locked 1 × 100 × 1.02; everything beyond the fill is refunded.
      expect(bal(balances, 'taker', 'USDT')).toEqual({ available: new BigNumber(900), locked: new BigNumber(0) });
      expect(bal(balances, 'taker', 'BTC').available.toFixed()).toBe('1');
    });

    it('a failed transaction leaves the published book and every balance unchanged', async () => {
      const engine = new MatchingEngine();
      const { prisma, balances, orders, tx } = makeFakePrisma({ 'maker:BTC': { available: '1', locked: '0' }, 'taker:USDT': { available: '1000', locked: '0' } });
      const service = new DemoTradingService(prisma, engine);
      await service.placeOrder(limit('maker', 'SELL', 100, 1));
      const before = { book: engine.getBook('BTC/USDT').snapshot(), balances: structuredClone([...balances]), orders: orders.size };
      tx.demoTrade.create.mockRejectedValueOnce(new Error('isolated settlement failure'));
      await expect(service.placeOrder(limit('taker', 'BUY', 100, 1))).rejects.toThrow('isolated settlement failure');
      expect(engine.getBook('BTC/USDT').snapshot().asks).toEqual(before.book.asks);
      expect([...balances]).toEqual(before.balances); expect(orders.size).toBe(before.orders);
    });

    it('a MARKET order fills only resting depth; the unfilled rest is cancelled and refunded, never invented', async () => {
      const { prisma, balances } = makeFakePrisma({ 'maker:BTC': { available: '1', locked: '0' }, 'taker:USDT': { available: '1000', locked: '0' } });
      const service = new DemoTradingService(prisma, new MatchingEngine());
      await service.placeOrder(limit('maker', 'SELL', 100, 0.4));
      const { order, trades } = await service.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber(1) });
      expect(trades.map(t => t.quantity.toFixed())).toEqual(['0.4']);
      expect(order.status).toBe('CANCELLED'); expect(order.remainingQuantity.toFixed()).toBe('0.6');
      expect(bal(balances, 'taker', 'USDT')).toEqual({ available: new BigNumber(960), locked: new BigNumber(0) });
      expect(bal(balances, 'taker', 'BTC').available.toFixed()).toBe('0.4');
    });

    it('a client request ID makes a retry return the committed order: one order, one reserve', async () => {
      const { prisma, balances, orders } = makeFakePrisma({ 'maker:BTC': { available: '1', locked: '0' }, 'taker:USDT': { available: '1000', locked: '0' } });
      const service = new DemoTradingService(prisma, new MatchingEngine());
      await service.placeOrder(limit('maker', 'SELL', 100, 0.5));
      const requestId = '6b0f6f1e-8c1d-4c7a-9d0e-1f2a3b4c5d6e';
      const first = await service.placeOrder({ ...limit('taker', 'BUY', 100, 1), requestId });
      expect(first.trades.map(t => t.quantity.toFixed())).toEqual(['0.5']);
      const again = await service.placeOrder({ ...limit('taker', 'BUY', 100, 1), requestId });
      expect('replayed' in again).toBe(true);
      expect(again.order.id).toBe(first.order.id);
      expect(again.order.remainingQuantity.toFixed()).toBe('0.5');
      expect(again.trades.map(t => [t.price.toFixed(), t.quantity.toFixed()])).toEqual([['100', '0.5']]);
      expect([...orders.values()].filter(o => o.userId === 'taker')).toHaveLength(1);
      expect(bal(balances, 'taker', 'USDT')).toEqual({ available: new BigNumber(900), locked: new BigNumber(50) });
      // The same ID with other terms is a conflict, never a second order.
      await expect(service.placeOrder({ ...limit('taker', 'BUY', 101, 1), requestId })).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
      // Another account's identical ID is its own order.
      await service.topUp({ userId: 'other', asset: 'USDT', amount: '100', performedByAdminId: 'admin' });
      const other = await service.placeOrder({ ...limit('other', 'BUY', 90, 1), requestId });
      expect(other.order.id).not.toBe(first.order.id);
    });

    it('a stale legacy maker (fills not reflected in its row) stops trading on that pair instead of refunding twice', async () => {
      const { prisma, orders, trades, balances } = makeFakePrisma({ 'taker:USDT': { available: '1000', locked: '0' } });
      const at = new Date('2026-10-01T00:00:00Z');
      orders.set('legacy', { id: 'legacy', userId: 'maker', pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: '100',
        originalQuantity: '1', remainingQuantity: '1', status: 'OPEN', createdAt: at, updatedAt: at });
      trades.push({ id: 't', pair: 'BTC/USDT', makerOrderId: 'legacy', takerOrderId: 'old', quantity: '0.5' });
      const service = new DemoTradingService(prisma, new MatchingEngine());
      await expect(service.placeOrder(limit('taker', 'BUY', 100, 1))).rejects.toThrow('manual reconciliation required');
      await expect(service.cancelOrder('maker', 'legacy')).rejects.toThrow('manual reconciliation required');
      expect(bal(balances, 'taker', 'USDT')).toEqual({ available: new BigNumber(1000), locked: new BigNumber(0) });
    });
  });

  describe('topUp', () => {
    it('credits the demo balance and logs a DEMO_BALANCE_ADJUSTED audit entry tagged "demo top-up"', async () => {
      const engine = new MatchingEngine();
      const { prisma, balances, auditLogs } = makeFakePrisma();
      const service = new DemoTradingService(prisma, engine);

      const result = await service.topUp({ userId: 'ksenia', asset: 'BTC', amount: '272', performedByAdminId: 'ksenia' });

      expect(result).toEqual({ asset: 'BTC', available: '272', locked: '0' });
      expect(bal(balances, 'ksenia', 'BTC').available.toString()).toBe('272');
      expect(auditLogs).toEqual([
        expect.objectContaining({
          userId: 'ksenia',
          action: 'DEMO_BALANCE_ADJUSTED',
          metadata: expect.objectContaining({ asset: 'BTC', delta: '272', reason: 'demo top-up' }),
        }),
      ]);
    });

    it('rejects a top-up that would push the demo balance negative', async () => {
      const engine = new MatchingEngine();
      const { prisma } = makeFakePrisma({ 'ksenia:BTC': { available: '10', locked: '0' } });
      const service = new DemoTradingService(prisma, engine);

      await expect(service.topUp({ userId: 'ksenia', asset: 'BTC', amount: '-50', performedByAdminId: 'ksenia' })).rejects.toThrow(DemoTradingError);
    });
  });

  describe('atomic interop with private leveraged-demo capital', () => {
    const allocate = async (tx: any, amount: string) => {
      const result = await tx.demoBalance.updateMany({ where: { userId: 'owner', asset: 'USDT', available: { gte: amount } },
        data: { available: { decrement: amount } } });
      if (result.count !== 1) throw new DemoTradingError('Insufficient demo allocation');
    };
    it('concurrent top-up and private allocation conserve both deltas', async () => {
      const { prisma, balances, tx } = makeFakePrisma({ 'owner:USDT': { available: '100', locked: '0' } });
      const service = new DemoTradingService(prisma, new MatchingEngine());
      await Promise.all([service.topUp({ userId: 'owner', asset: 'USDT', amount: '25', performedByAdminId: 'owner' }), allocate(tx, '80')]);
      expect(bal(balances, 'owner', 'USDT').available.toFixed()).toBe('45');
      expect(tx.demoBalance.update).not.toHaveBeenCalled();
    });
    it('concurrent lock and allocation cannot both spend the same available funds', async () => {
      const { prisma, balances, tx } = makeFakePrisma({ 'owner:USDT': { available: '100', locked: '0' } });
      const service = new DemoTradingService(prisma, new MatchingEngine());
      const results = await Promise.allSettled([
        service.placeOrder({ userId: 'owner', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(30), quantity: new BigNumber(1) }),
        allocate(tx, '80'),
      ]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      const value = bal(balances, 'owner', 'USDT');
      expect(value.available.gte(0)).toBe(true);
      expect(value.available.plus(value.locked).toFixed()).toBe(results[1].status === 'fulfilled' ? '20' : '100');
    });
    it('concurrent top-ups accumulate rather than overwrite each other', async () => {
      const { prisma, balances } = makeFakePrisma({ 'owner:USDT': { available: '100', locked: '4' } });
      const service = new DemoTradingService(prisma, new MatchingEngine());
      await Promise.all(['25', '30'].map(amount => service.topUp({ userId: 'owner', asset: 'USDT', amount, performedByAdminId: 'owner' })));
      expect(bal(balances, 'owner', 'USDT')).toEqual({ available: new BigNumber(155), locked: new BigNumber(4) });
    });
    it('two negative adjustments cannot debit below zero', async () => {
      const { prisma, balances } = makeFakePrisma({ 'owner:USDT': { available: '100', locked: '0' } });
      const service = new DemoTradingService(prisma, new MatchingEngine());
      const results = await Promise.allSettled([1, 2].map(() => service.topUp({ userId: 'owner', asset: 'USDT', amount: '-60', performedByAdminId: 'owner' })));
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(bal(balances, 'owner', 'USDT').available.toFixed()).toBe('40');
    });
    it('duplicate cancellation releases one lock even with another resting order', async () => {
      const { prisma, balances } = makeFakePrisma({ 'owner:BTC': { available: '2', locked: '0' } });
      const service = new DemoTradingService(prisma, new MatchingEngine());
      const { order } = await service.placeOrder({ userId: 'owner', pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(100), quantity: new BigNumber(1) });
      await service.placeOrder({ userId: 'owner', pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(110), quantity: new BigNumber(1) });
      const results = await Promise.all([service.cancelOrder('owner', order.id), service.cancelOrder('owner', order.id)]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(bal(balances, 'owner', 'BTC')).toEqual({ available: new BigNumber(1), locked: new BigNumber(1) });
    });
    it('precision beyond Decimal(36,18) cannot silently round a credit or lock', async () => {
      const { prisma, balances } = makeFakePrisma({ 'owner:USDT': { available: '100', locked: '0' } });
      const service = new DemoTradingService(prisma, new MatchingEngine());
      await expect(service.topUp({ userId: 'owner', asset: 'USDT', amount: '0.0000000000000000001', performedByAdminId: 'owner' })).rejects.toThrow('precision');
      await expect(service.placeOrder({ userId: 'owner', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber('0.0000000001'), quantity: new BigNumber('0.0000000001') })).rejects.toThrow('precision');
      expect(bal(balances, 'owner', 'USDT').available.toFixed()).toBe('100');
    });
  });
});
