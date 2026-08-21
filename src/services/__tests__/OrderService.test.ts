import BigNumber from 'bignumber.js';
import { OrderService } from '../OrderService';
import { MatchingEngine } from '../../matching-engine/MatchingEngine';

/**
 * In-memory fake standing in for PrismaClient, tracking balances/orders the
 * same way the real transaction handlers would. Money-handling code (order
 * locking/settlement/refunds) is exactly the kind of logic that's cheap to
 * get subtly wrong and expensive to get wrong in production, so this is
 * worth a real harness rather than trusting hand-inspection.
 */
function makeFakePrisma(seed: Record<string, { available: string; locked: string }>) {
  const balances = new Map(Object.entries(seed));
  const orders = new Map<string, any>();
  const trades: any[] = [];

  const tx = {
    balance: {
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
    order: {
      create: jest.fn(async ({ data }: any) => {
        orders.set(data.id, { ...data });
      }),
      update: jest.fn(async ({ where: { id }, data }: any) => {
        Object.assign(orders.get(id), data);
      }),
      findUnique: jest.fn(async ({ where: { id } }: any) => (orders.has(id) ? { ...orders.get(id) } : null)),
    },
    trade: {
      create: jest.fn(async ({ data }: any) => {
        trades.push(data);
      }),
    },
  };

  const prisma = { $transaction: jest.fn(async (fn: any) => fn(tx)) } as any;
  return { prisma, balances, orders, trades };
}

function bal(balances: Map<string, { available: string; locked: string }>, userId: string, asset: string) {
  const b = balances.get(`${userId}:${asset}`);
  return { available: new BigNumber(b?.available ?? '0'), locked: new BigNumber(b?.locked ?? '0') };
}

describe('OrderService.placeOrder', () => {
  it('LIMIT BUY that fully fills refunds the price-improvement (trade price better than limit)', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances } = makeFakePrisma({
      'maker:BTC': { available: '1', locked: '0' },
      'taker:USDT': { available: '100000', locked: '0' },
    });
    const service = new OrderService(prisma, engine);

    // Resting ask at 59000 — cheaper than the taker's 60000 limit.
    await service.placeOrder({ userId: 'maker', pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(59000), quantity: new BigNumber(1) });

    await service.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1) });

    const takerQuote = bal(balances, 'taker', 'USDT');
    // Spent exactly 59000 (the maker's price), nothing left locked, no money vanished.
    expect(takerQuote.locked.toString()).toBe('0');
    expect(takerQuote.available.toString()).toBe('41000'); // 100000 - 59000
  });

  it('LIMIT BUY that only partially fills keeps the resting remainder locked at the limit price', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances } = makeFakePrisma({
      'maker:BTC': { available: '0.4', locked: '0' },
      'taker:USDT': { available: '100000', locked: '0' },
    });
    const service = new OrderService(prisma, engine);

    // Only 0.4 BTC of liquidity available at 60000.
    await service.placeOrder({ userId: 'maker', pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(0.4) });

    await service.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1) });

    const takerQuote = bal(balances, 'taker', 'USDT');
    // Spent 0.4 * 60000 = 24000 on the fill; the remaining 0.6 BTC still
    // resting on the book must keep its 0.6 * 60000 = 36000 locked — total
    // locked should NOT have been refunded away.
    expect(takerQuote.available.toString()).toBe('40000'); // 100000 - 24000 - 36000
    expect(takerQuote.locked.toString()).toBe('36000');
  });

  it('LIMIT SELL that only partially fills keeps the resting base quantity locked', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances } = makeFakePrisma({
      'taker:BTC': { available: '1', locked: '0' },
      'maker:USDT': { available: '100000', locked: '0' },
    });
    const service = new OrderService(prisma, engine);

    await service.placeOrder({ userId: 'maker', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(0.3) });

    await service.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1) });

    const takerBase = bal(balances, 'taker', 'BTC');
    expect(takerBase.available.toString()).toBe('0'); // nothing un-reserved yet
    expect(takerBase.locked.toString()).toBe('0.7'); // 1 - 0.3 filled, still resting
  });

  it('MARKET BUY refunds the unused slippage buffer once the real fill price is known', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances } = makeFakePrisma({
      'maker:BTC': { available: '1', locked: '0' },
      'taker:USDT': { available: '100000', locked: '0' },
    });
    const service = new OrderService(prisma, engine);

    await service.placeOrder({ userId: 'maker', pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1) });

    await service.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: new BigNumber(0.5) });

    const takerQuote = bal(balances, 'taker', 'USDT');
    // Locked ~0.5 * 60000 * 1.02 = 30600 as a buffer, but only 30000 was
    // actually spent — the buffer must come back, nothing stays locked
    // since a MARKET order never rests.
    expect(takerQuote.locked.toString()).toBe('0');
    expect(takerQuote.available.toString()).toBe('70000'); // 100000 - 30000
  });

  it('MARKET SELL that exhausts available liquidity refunds the un-fillable remainder', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances } = makeFakePrisma({
      'maker:USDT': { available: '100000', locked: '0' },
      'taker:BTC': { available: '1', locked: '0' },
    });
    const service = new OrderService(prisma, engine);

    // Only 0.2 BTC of bid liquidity exists.
    await service.placeOrder({ userId: 'maker', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(0.2) });

    await service.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'SELL', type: 'MARKET', quantity: new BigNumber(1) });

    const takerBase = bal(balances, 'taker', 'BTC');
    expect(takerBase.locked.toString()).toBe('0');
    expect(takerBase.available.toString()).toBe('0.8'); // 1 - 0.2 filled, 0.8 unfillable and refunded
  });

  it('throws on insufficient balance and locks nothing', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances } = makeFakePrisma({ 'taker:USDT': { available: '100', locked: '0' } });
    const service = new OrderService(prisma, engine);

    await expect(
      service.placeOrder({ userId: 'taker', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(60000), quantity: new BigNumber(1) })
    ).rejects.toThrow('Insufficient USDT balance');

    expect(bal(balances, 'taker', 'USDT').locked.toString()).toBe('0');
  });
});

describe('OrderService.cancelOrder', () => {
  it('unlocks the resting remainder of a LIMIT BUY', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances } = makeFakePrisma({ 'taker:USDT': { available: '100000', locked: '0' } });
    const service = new OrderService(prisma, engine);

    const { order } = await service.placeOrder({
      userId: 'taker',
      pair: 'BTC/USDT',
      side: 'BUY',
      type: 'LIMIT',
      price: new BigNumber(60000),
      quantity: new BigNumber(1),
    });

    expect(bal(balances, 'taker', 'USDT').locked.toString()).toBe('60000');

    const cancelled = await service.cancelOrder('taker', order.id);

    expect(cancelled).not.toBeNull();
    expect(bal(balances, 'taker', 'USDT').locked.toString()).toBe('0');
    expect(bal(balances, 'taker', 'USDT').available.toString()).toBe('100000');
  });

  it('returns null for another user\'s order', async () => {
    const engine = new MatchingEngine();
    const { prisma } = makeFakePrisma({ 'taker:USDT': { available: '100000', locked: '0' } });
    const service = new OrderService(prisma, engine);

    const { order } = await service.placeOrder({
      userId: 'taker',
      pair: 'BTC/USDT',
      side: 'BUY',
      type: 'LIMIT',
      price: new BigNumber(60000),
      quantity: new BigNumber(1),
    });

    expect(await service.cancelOrder('someone-else', order.id)).toBeNull();
  });
});
