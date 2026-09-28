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
const saleId = (userId: string, requestId: string) => uuidv5(`voltex:vta-demo-sale:${userId}:${requestId}`, uuidv5.URL);
async function authorize(db: Prisma.TransactionClient, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, blockedAt: true } });
  if (user?.role !== 'ADMIN' || user.blockedAt) throw new VtaDemoError('Доступ запрещён.', 403);
}

/** Private simulated liquidation, not an order submitted to the real Spot book.
 * Only DemoBalance/DemoOrder/DemoTrade and the audit log may be written here.
 * The synthetic counterparty is identified explicitly; no user is charged. */
export class VtaDemoSales {
  constructor(private prisma: PrismaClient, private clock: () => number = Date.now) {}

  async snapshot(userId: string) {
    // One committed ledger version for balances AND receipts. Never merge this
    // projection into real wallet totals or withdrawal/deposit availability.
    return this.prisma.$transaction(async tx => {
      await authorize(tx, userId);
      const [held, orders] = await Promise.all([
        tx.demoBalance.findMany({ where: { userId, asset: { in: ['VTA', 'USDT'] } } }),
        tx.demoOrder.findMany({ where: { userId, pair: VOLTORA.pair, side: 'SELL', status: 'FILLED' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 }),
      ]);
      const asOf = this.clock(), state = publicTestAsset(VOLTORA, asOf).state;
      const mark = state.phase === 'live' && state.lastPrice !== null
        ? new BigNumber(state.lastPrice).decimalPlaces(10, BigNumber.ROUND_DOWN).toFixed() : null;
      const balances = ['VTA', 'USDT'].map(asset => {
        const b = held.find(h => h.asset === asset);
        const available = b?.available.toString() ?? '0', locked = b?.locked.toString() ?? '0';
        const priceUsd = asset === 'USDT' ? '1' : mark;
        const quantity = new BigNumber(available).plus(locked);
        return { asset, available, locked, priceUsd,
          valueUsd: quantity.isZero() ? '0' : priceUsd === null ? null : quantity.times(priceUsd).toFixed() };
      });
      return { account: { id: userId, scope: 'SIMULATION_SPOT' as const, cashPolicy: 'SHARED_DEMO_BALANCE' as const,
        active: held.some(b => b.asset === 'VTA') || orders.length > 0 },
        asOf, valuationSource: 'VOLTORA_SIMULATION' as const, balances,
        totalValueUsd: balances.some(b => b.valueUsd === null) ? null : balances.reduce((sum, b) => sum.plus(b.valueUsd!), new BigNumber(0)).toFixed(),
        sales: orders.map(o => ({ ...receipt(o), createdAt: o.createdAt })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  /** Read-only recovery. A missing receipt is not permission to create a new intent. */
  async operation(userId: string, requestId: string) {
    await authorize(this.prisma, userId);
    const order = await this.prisma.demoOrder.findFirst({ where: { id: saleId(userId, requestId), userId, pair: VOLTORA.pair, side: 'SELL', status: 'FILLED' } });
    return { receipt: order ? { ...receipt(order), createdAt: order.createdAt } : null };
  }

  async sell(params: { userId: string; requestId: string; quantity: string }) {
    const quantity = new BigNumber(params.quantity);
    if (!quantity.isFinite() || quantity.lte(0) || quantity.decimalPlaces()! > 8 || quantity.gte('1000000000000000000')) {
      throw new VtaDemoError('Количество должно быть положительным числом, не более 8 знаков после запятой.');
    }
    const id = saleId(params.userId, params.requestId);
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
