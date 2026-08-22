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
        orders.set(data.id, { createdAt: new Date(), ...data });
      }),
      update: jest.fn(async ({ where: { id }, data }: any) => {
        Object.assign(orders.get(id), data);
      }),
      findUnique: jest.fn(async ({ where: { id } }: any) => (orders.has(id) ? { ...orders.get(id) } : null)),
      findFirst: jest.fn(async ({ where }: any) => {
        for (const o of orders.values()) {
          if (
            (where.ocoGroupId === undefined || o.ocoGroupId === where.ocoGroupId) &&
            (where.id?.not === undefined || o.id !== where.id.not) &&
            (where.status === undefined || o.status === where.status)
          ) {
            return { ...o };
          }
        }
        return null;
      }),
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

function makePriceSource(lastPrice = '60000') {
  return { getTicker: jest.fn(async () => ({ lastPrice })) };
}

describe('OrderService.placeOrder', () => {
  it('LIMIT BUY that fully fills refunds the price-improvement (trade price better than limit)', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances } = makeFakePrisma({
      'maker:BTC': { available: '1', locked: '0' },
      'taker:USDT': { available: '100000', locked: '0' },
    });
    const service = new OrderService(prisma, engine, makePriceSource());

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
    const service = new OrderService(prisma, engine, makePriceSource());

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
    const service = new OrderService(prisma, engine, makePriceSource());

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
    const service = new OrderService(prisma, engine, makePriceSource());

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
    const service = new OrderService(prisma, engine, makePriceSource());

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
    const service = new OrderService(prisma, engine, makePriceSource());

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
    const service = new OrderService(prisma, engine, makePriceSource());

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
    const service = new OrderService(prisma, engine, makePriceSource());

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

describe('OrderService conditional orders (STOP/TAKE_PROFIT)', () => {
  it('places a SELL STOP_LIMIT below the current price and locks the exact base quantity', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances, orders } = makeFakePrisma({ 'trader:BTC': { available: '1', locked: '0' } });
    const service = new OrderService(prisma, engine, makePriceSource('60000'));

    const { order } = await service.placeOrder({
      userId: 'trader',
      pair: 'BTC/USDT',
      side: 'SELL',
      type: 'STOP_LIMIT',
      triggerPrice: new BigNumber(55000),
      price: new BigNumber(54900),
      quantity: new BigNumber(1),
    });

    expect(order.status).toBe('PENDING_TRIGGER');
    expect(bal(balances, 'trader', 'BTC').locked.toString()).toBe('1');
    expect(orders.get(order.id).lockedAmount).toBe('1');
    expect(orders.get(order.id).lockedAsset).toBe('BTC');
  });

  it('rejects a SELL STOP whose trigger price is above the current price', async () => {
    const engine = new MatchingEngine();
    const { prisma } = makeFakePrisma({ 'trader:BTC': { available: '1', locked: '0' } });
    const service = new OrderService(prisma, engine, makePriceSource('60000'));

    await expect(
      service.placeOrder({
        userId: 'trader',
        pair: 'BTC/USDT',
        side: 'SELL',
        type: 'STOP_LIMIT',
        triggerPrice: new BigNumber(65000), // above current — invalid for a sell-stop
        price: new BigNumber(64900),
        quantity: new BigNumber(1),
      })
    ).rejects.toThrow(/Trigger price must be below/);
  });

  it('rejects a SELL TAKE_PROFIT whose trigger price is below the current price', async () => {
    const engine = new MatchingEngine();
    const { prisma } = makeFakePrisma({ 'trader:BTC': { available: '1', locked: '0' } });
    const service = new OrderService(prisma, engine, makePriceSource('60000'));

    await expect(
      service.placeOrder({
        userId: 'trader',
        pair: 'BTC/USDT',
        side: 'SELL',
        type: 'TAKE_PROFIT_LIMIT',
        triggerPrice: new BigNumber(55000), // below current — invalid for a sell-take-profit
        price: new BigNumber(55100),
        quantity: new BigNumber(1),
      })
    ).rejects.toThrow(/Trigger price must be above/);
  });

  it('locks a BUY STOP_MARKET with the same 2% slippage buffer a live MARKET BUY gets', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances } = makeFakePrisma({ 'trader:USDT': { available: '100000', locked: '0' } });
    const service = new OrderService(prisma, engine, makePriceSource('60000'));

    await service.placeOrder({
      userId: 'trader',
      pair: 'BTC/USDT',
      side: 'BUY',
      type: 'STOP_MARKET',
      triggerPrice: new BigNumber(65000), // above current — valid for a buy-stop (breakout entry)
      quantity: new BigNumber(1),
    });

    // 65000 * 1 * 1.02 = 66300
    expect(bal(balances, 'trader', 'USDT').locked.toString()).toBe('66300');
  });

  it('placeOcoOrder locks funds ONCE for a SELL pair (the base quantity, regardless of the two leg prices)', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances, orders } = makeFakePrisma({ 'trader:BTC': { available: '1', locked: '0' } });
    const service = new OrderService(prisma, engine, makePriceSource('60000'));

    const { ocoGroupId, takeProfitOrderId, stopOrderId } = await service.placeOcoOrder({
      userId: 'trader',
      pair: 'BTC/USDT',
      side: 'SELL',
      quantity: new BigNumber(1),
      takeProfitPrice: new BigNumber(65000),
      stopTriggerPrice: new BigNumber(55000),
      stopLimitPrice: new BigNumber(54900),
    });

    expect(bal(balances, 'trader', 'BTC').locked.toString()).toBe('1');
    expect(bal(balances, 'trader', 'BTC').available.toString()).toBe('0');
    expect(orders.get(takeProfitOrderId).ocoGroupId).toBe(ocoGroupId);
    expect(orders.get(stopOrderId).ocoGroupId).toBe(ocoGroupId);
    expect(orders.get(takeProfitOrderId).status).toBe('PENDING_TRIGGER');
    expect(orders.get(stopOrderId).status).toBe('PENDING_TRIGGER');
  });

  it('placeOcoOrder locks the LARGER of the two legs for a BUY pair', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances } = makeFakePrisma({ 'trader:USDT': { available: '100000', locked: '0' } });
    const service = new OrderService(prisma, engine, makePriceSource('60000'));

    await service.placeOcoOrder({
      userId: 'trader',
      pair: 'BTC/USDT',
      side: 'BUY',
      quantity: new BigNumber(1),
      takeProfitPrice: new BigNumber(55000), // buy-TP: below current
      stopTriggerPrice: new BigNumber(65000), // buy-stop: above current
      stopLimitPrice: new BigNumber(65100),
    });

    // max(55000*1, 65100*1) = 65100
    expect(bal(balances, 'trader', 'USDT').locked.toString()).toBe('65100');
  });

  it('triggerOrder converts a PENDING_TRIGGER order into a real fill and refunds unused lock', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances } = makeFakePrisma({
      'trader:BTC': { available: '1', locked: '0' },
      'maker:USDT': { available: '100000', locked: '0' },
    });
    const service = new OrderService(prisma, engine, makePriceSource('60000'));

    const { order } = await service.placeOrder({
      userId: 'trader',
      pair: 'BTC/USDT',
      side: 'SELL',
      type: 'STOP_LIMIT',
      triggerPrice: new BigNumber(55000),
      price: new BigNumber(54900),
      quantity: new BigNumber(1),
    });

    // A resting bid at exactly the stop's limit price, so it fills fully.
    await service.placeOrder({ userId: 'maker', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(54900), quantity: new BigNumber(1) });

    const result = await service.triggerOrder(order.id);

    expect(result).not.toBeNull();
    expect(result!.order.status).toBe('FILLED');
    expect(bal(balances, 'trader', 'BTC').locked.toString()).toBe('0');
    expect(bal(balances, 'trader', 'USDT').available.toString()).toBe('54900');
  });

  it('triggerOrder cancels the OCO sibling without double-refunding the shared lock', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances, orders } = makeFakePrisma({ 'trader:BTC': { available: '1', locked: '0' } });
    const service = new OrderService(prisma, engine, makePriceSource('60000'));

    const { takeProfitOrderId, stopOrderId } = await service.placeOcoOrder({
      userId: 'trader',
      pair: 'BTC/USDT',
      side: 'SELL',
      quantity: new BigNumber(1),
      takeProfitPrice: new BigNumber(65000),
      stopTriggerPrice: new BigNumber(55000),
      stopLimitPrice: new BigNumber(54900),
    });

    // Take-profit leg triggers (no counterparty, so it just rests OPEN — still a valid "activation").
    await service.triggerOrder(takeProfitOrderId);

    expect(orders.get(stopOrderId).status).toBe('CANCELLED');
    // Still fully locked (1 BTC), backing the now-resting take-profit limit order — the
    // stop leg's cancellation must NOT have released the shared lock a second time.
    expect(bal(balances, 'trader', 'BTC').locked.toString()).toBe('1');
  });

  it('triggerOrder is a no-op for an order that is no longer PENDING_TRIGGER', async () => {
    const engine = new MatchingEngine();
    const { prisma } = makeFakePrisma({ 'trader:BTC': { available: '1', locked: '0' } });
    const service = new OrderService(prisma, engine, makePriceSource('60000'));

    const { order } = await service.placeOrder({
      userId: 'trader',
      pair: 'BTC/USDT',
      side: 'SELL',
      type: 'STOP_LIMIT',
      triggerPrice: new BigNumber(55000),
      price: new BigNumber(54900),
      quantity: new BigNumber(1),
    });
    await service.cancelOrder('trader', order.id);

    expect(await service.triggerOrder(order.id)).toBeNull();
  });

  it('cancelOrder on a PENDING_TRIGGER order refunds the full lock and cancels its OCO sibling', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances, orders } = makeFakePrisma({ 'trader:BTC': { available: '1', locked: '0' } });
    const service = new OrderService(prisma, engine, makePriceSource('60000'));

    const { takeProfitOrderId, stopOrderId } = await service.placeOcoOrder({
      userId: 'trader',
      pair: 'BTC/USDT',
      side: 'SELL',
      quantity: new BigNumber(1),
      takeProfitPrice: new BigNumber(65000),
      stopTriggerPrice: new BigNumber(55000),
      stopLimitPrice: new BigNumber(54900),
    });

    await service.cancelOrder('trader', takeProfitOrderId);

    expect(orders.get(stopOrderId).status).toBe('CANCELLED');
    expect(bal(balances, 'trader', 'BTC').locked.toString()).toBe('0');
    expect(bal(balances, 'trader', 'BTC').available.toString()).toBe('1');
  });
});
