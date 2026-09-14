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
    demoOrder: {
      create: jest.fn(async ({ data }: any) => {
        orders.set(data.id, { createdAt: new Date(), ...data });
      }),
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
        trades.push(data);
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditLogs.push(data);
      }),
    },
  };

  const prisma = { $transaction: jest.fn(async (fn: any) => fn(tx)) } as any;
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
      ).rejects.toThrow('No demo liquidity available');
    });

    it('rejects placing an order with insufficient demo balance', async () => {
      const engine = new MatchingEngine();
      const { prisma } = makeFakePrisma({ 'taker:USDT': { available: '10', locked: '0' } });
      const service = new DemoTradingService(prisma, engine);

      await expect(
        service.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1) })
      ).rejects.toThrow(DemoTradingError);
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
