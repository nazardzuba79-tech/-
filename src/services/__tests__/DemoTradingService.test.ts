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

  const tx = {
    demoBalance: {
      findUnique: jest.fn(async ({ where: { userId_asset: { userId, asset } } }: any) => {
        const b = balances.get(`${userId}:${asset}`);
        return b ? { ...b } : null;
      }),
      update: jest.fn(async ({ where: { userId_asset: { userId, asset } }, data }: any) => {
        balances.set(`${userId}:${asset}`, { available: data.available, locked: data.locked });
      }),
      upsert: jest.fn(async ({ where: { userId_asset: { userId, asset } }, create }: any) => {
        const key = `${userId}:${asset}`;
        if (!balances.has(key)) balances.set(key, { available: create.available, locked: create.locked ?? '0' });
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
  return { prisma, balances, orders, trades, auditLogs };
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
});
