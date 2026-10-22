import BigNumber from 'bignumber.js';
import { OrderService } from '../OrderService';
import { MatchingEngine } from '../../matching-engine/MatchingEngine';
import { walletDelegate } from '../../test-utils/walletDelegate';

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
  const audits: any[] = [];

  const tx = {
    user: {
      findUnique: jest.fn(async ({ where: { id } }: any) => ({ id, role: 'USER', blockedAt: null })),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => { audits.push(data); return data; }),
    },
    $queryRaw: jest.fn(async () => [{ id: '1' }]),
    balance: walletDelegate(balances),
    order: {
      create: jest.fn(async ({ data }: any) => {
        orders.set(data.id, { createdAt: new Date(), updatedAt: new Date(), ...data });
      }),
      update: jest.fn(async ({ where: { id }, data }: any) => {
        Object.assign(orders.get(id), data);
      }),
      findUnique: jest.fn(async ({ where: { id } }: any) => (orders.has(id) ? { ...orders.get(id) } : null)),
      findMany: jest.fn(async ({ where }: any) => [...orders.values()].filter(row => row.pair === where.pair
        && where.status.in.includes(row.status)).map(row => ({ ...row }))),
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
      findMany: jest.fn(async ({ where }: any) => trades.filter(row => where.OR.some((clause: any) =>
        Object.entries(clause).some(([key, value]: any) => value.in.includes(row[key]))))),
      create: jest.fn(async ({ data }: any) => {
        trades.push(data);
      }),
    },
  };

  const prisma = { order: tx.order, user: tx.user, auditLog: tx.auditLog, $queryRaw: jest.fn(async () => [{ status: 'committed' }]), $transaction: jest.fn(async (fn: any) => {
    const saved = [balances, orders].map(map => structuredClone([...map.entries()]));
    const tradeCount = trades.length;
    try { return await fn(tx); } catch (error) {
      [balances, orders].forEach((map, i) => { map.clear(); for (const [key, value] of saved[i]) map.set(key, value); });
      trades.length = tradeCount; throw error;
    }
  }) } as any;
  return { prisma, balances, orders, trades, audits, users: tx.user };
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

  it('simulation-only team USER can MARKET SELL credited ETH at current price without book liquidity', async () => {
    const saved = process.env.PRIVATE_TRADING_TEST_USER_IDS;
    const tester = '11111111-1111-4111-8111-111111111111';
    process.env.PRIVATE_TRADING_TEST_USER_IDS = tester;
    try {
      const engine = new MatchingEngine();
      const { prisma, balances, trades, audits } = makeFakePrisma({
        [tester + ':ETH']: { available: '2', locked: '0' },
        [tester + ':USDT']: { available: '0', locked: '0' },
      });
      const service = new OrderService(prisma, engine, makePriceSource('2500'));

      const result = await service.placeOrder({
        userId: tester,
        pair: 'ETH/USDT',
        side: 'SELL',
        type: 'MARKET',
        quantity: new BigNumber('1.25'),
      });

      expect(result.order.status).toBe('FILLED');
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0]).toMatchObject({ makerUserId: 'simulation:ETH', takerUserId: tester, pair: 'ETH/USDT' });
      expect(bal(balances, tester, 'ETH').available.toString()).toBe('0.75');
      expect(bal(balances, tester, 'USDT').available.toString()).toBe('3125');
      expect(trades).toHaveLength(1);
      expect(audits).toEqual([expect.objectContaining({ userId: tester, action: 'TEAM_SPOT_SIMULATION_SOLD' })]);
    } finally {
      if (saved === undefined) delete process.env.PRIVATE_TRADING_TEST_USER_IDS;
      else process.env.PRIVATE_TRADING_TEST_USER_IDS = saved;
    }
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

describe('OrderService.updateConditionalOrder (drag-to-edit a SL/TP line)', () => {
  it('moves a SELL stop trigger price without changing the locked amount (SELL locks base qty regardless of price)', async () => {
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

    const result = await service.updateConditionalOrder('trader', order.id, {
      triggerPrice: new BigNumber(56000),
      price: new BigNumber(55900),
    });

    expect(result).not.toBeNull();
    expect(orders.get(order.id).triggerPrice).toBe('56000');
    expect(orders.get(order.id).price).toBe('55900');
    expect(bal(balances, 'trader', 'BTC').locked.toString()).toBe('1'); // unchanged
  });

  it('adjusts the lock by the delta for a BUY-side conditional order', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances } = makeFakePrisma({ 'trader:USDT': { available: '100000', locked: '0' } });
    const service = new OrderService(prisma, engine, makePriceSource('60000'));

    const { order } = await service.placeOrder({
      userId: 'trader',
      pair: 'BTC/USDT',
      side: 'BUY',
      type: 'STOP_LIMIT',
      triggerPrice: new BigNumber(65000),
      price: new BigNumber(65100),
      quantity: new BigNumber(1),
    });
    expect(bal(balances, 'trader', 'USDT').locked.toString()).toBe('65100');

    await service.updateConditionalOrder('trader', order.id, {
      triggerPrice: new BigNumber(70000),
      price: new BigNumber(70200),
    });

    expect(bal(balances, 'trader', 'USDT').locked.toString()).toBe('70200');
    expect(bal(balances, 'trader', 'USDT').available.toString()).toBe('29800'); // 100000 - 70200
  });

  it('rejects moving the trigger price to the wrong side of the current price', async () => {
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

    await expect(
      service.updateConditionalOrder('trader', order.id, { triggerPrice: new BigNumber(65000) })
    ).rejects.toThrow(/Trigger price must be below/);
  });

  it('rejects an insufficient-balance move and leaves the order untouched', async () => {
    const engine = new MatchingEngine();
    const { prisma, balances, orders } = makeFakePrisma({ 'trader:USDT': { available: '65100', locked: '0' } });
    const service = new OrderService(prisma, engine, makePriceSource('60000'));

    const { order } = await service.placeOrder({
      userId: 'trader',
      pair: 'BTC/USDT',
      side: 'BUY',
      type: 'STOP_LIMIT',
      triggerPrice: new BigNumber(65000),
      price: new BigNumber(65100),
      quantity: new BigNumber(1),
    });

    await expect(
      service.updateConditionalOrder('trader', order.id, { triggerPrice: new BigNumber(90000), price: new BigNumber(90100) })
    ).rejects.toThrow(/Insufficient/);

    expect(orders.get(order.id).triggerPrice).toBe('65000'); // unchanged
    expect(bal(balances, 'trader', 'USDT').locked.toString()).toBe('65100'); // unchanged
  });

  it('returns null for another user\'s order', async () => {
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

    expect(await service.updateConditionalOrder('someone-else', order.id, { triggerPrice: new BigNumber(56000) })).toBeNull();
  });
});
