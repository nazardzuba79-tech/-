import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { v5 as uuidv5 } from 'uuid';
import { VOLTORA } from './testAssetConfig';
import { publicTestAsset } from './testMarketService';

export class VtaDemoError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const receipt = (order: { id: string; price: unknown; originalQuantity: unknown }) => {
  const price = new BigNumber(String(order.price));
  const quantity = new BigNumber(String(order.originalQuantity));
  return { id: order.id, price: price.toFixed(), quantity: quantity.toFixed(), proceeds: price.times(quantity).toFixed() };
};

/** Private simulated liquidation, not an order submitted to the real Spot book.
 * Only DemoBalance/DemoOrder/DemoTrade and the audit log may be written here.
 * The synthetic counterparty is identified explicitly; no user is charged. */
export class VtaDemoSales {
  constructor(private prisma: PrismaClient, private clock: () => number = Date.now) {}

  async snapshot(userId: string) {
    const [balances, orders] = await Promise.all([
      this.prisma.demoBalance.findMany({ where: { userId, asset: { in: ['VTA', 'USDT'] } } }),
      this.prisma.demoOrder.findMany({ where: { userId, pair: VOLTORA.pair, side: 'SELL', status: 'FILLED' }, orderBy: { createdAt: 'desc' }, take: 20 }),
    ]);
    return { balances: balances.map(b => ({ asset: b.asset, available: b.available.toString(), locked: b.locked.toString() })),
      sales: orders.map(o => ({ ...receipt(o), createdAt: o.createdAt })) };
  }

  async sell(params: { userId: string; requestId: string; quantity: string }) {
    const quantity = new BigNumber(params.quantity);
    if (!quantity.isFinite() || quantity.lte(0) || quantity.decimalPlaces()! > 8 || quantity.gte('1000000000000000000')) {
      throw new VtaDemoError('Количество должно быть положительным числом, не более 8 знаков после запятой.');
    }
    const id = uuidv5(`voltex:vta-demo-sale:${params.userId}:${params.requestId}`, uuidv5.URL);
    const replay = (order: any) => {
      if (order.userId !== params.userId || order.pair !== VOLTORA.pair || order.side !== 'SELL'
        || order.status !== 'FILLED' || !quantity.eq(String(order.originalQuantity))) {
        throw new VtaDemoError('Этот запрос уже использован для другой продажи.', 409);
      }
      return receipt(order);
    };
    try {
      return await this.prisma.$transaction(async tx => {
        const user = await tx.user.findUnique({ where: { id: params.userId }, select: { role: true, blockedAt: true } });
        if (user?.role !== 'ADMIN' || user.blockedAt) throw new VtaDemoError('Доступ запрещён.', 403);
        const existing = await tx.demoOrder.findUnique({ where: { id } });
        if (existing) return replay(existing);
        const state = publicTestAsset(VOLTORA, this.clock()).state;
        if (state.phase !== 'live' || state.lastPrice === null) throw new VtaDemoError('Продажа откроется после листинга.');
        // Use exactly the server simulation's executable price, never a client quote or preview clock.
        const price = new BigNumber(state.lastPrice).decimalPlaces(10, BigNumber.ROUND_DOWN);
        const proceeds = price.times(quantity);
        if (!price.isFinite() || price.lte(0) || proceeds.gte('1000000000000000000')) throw new VtaDemoError('Цена временно недоступна.');
        await tx.demoOrder.create({ data: { id, userId: params.userId, pair: VOLTORA.pair, side: 'SELL', type: 'MARKET',
          price: price.toFixed(), originalQuantity: quantity.toFixed(), remainingQuantity: '0', status: 'FILLED' } });
        // Conditional decrement takes the row lock: parallel different requests cannot oversell.
        const debit = await tx.demoBalance.updateMany({ where: { userId: params.userId, asset: 'VTA', available: { gte: quantity.toFixed() } },
          data: { available: { decrement: quantity.toFixed() } } });
        if (debit.count !== 1) throw new VtaDemoError('Недостаточно VTA.');
        await tx.demoBalance.upsert({ where: { userId_asset: { userId: params.userId, asset: 'USDT' } },
          create: { userId: params.userId, asset: 'USDT', available: proceeds.toFixed(), locked: '0' },
          update: { available: { increment: proceeds.toFixed() } } });
        await tx.demoTrade.create({ data: { id, pair: VOLTORA.pair, takerOrderId: id, makerOrderId: 'simulation:VTA',
          takerUserId: params.userId, makerUserId: 'simulation:VTA', side: 'SELL', price: price.toFixed(), quantity: quantity.toFixed() } });
        await tx.auditLog.create({ data: { userId: params.userId, action: 'VTA_DEMO_SOLD',
          metadata: { orderId: id, quantity: quantity.toFixed(), price: price.toFixed(), proceeds: proceeds.toFixed(), source: 'VOLTORA simulation', ledger: 'DEMO' } } });
        return { id, price: price.toFixed(), quantity: quantity.toFixed(), proceeds: proceeds.toFixed() };
      });
    } catch (error) {
      // A concurrent retry loses the unique-order race and rolls back in full.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.demoOrder.findUnique({ where: { id } });
        if (existing) return replay(existing);
      }
      throw error;
    }
  }
}
