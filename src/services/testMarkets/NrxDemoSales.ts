import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { v5 as uuidv5 } from 'uuid';
import { NEURIX } from './neurix';
import { publicTestAsset } from './testMarketService';

export class NrxDemoError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const saleId = (userId: string, requestId: string) => uuidv5(`voltex:nrx-demo-sale:${userId}:${requestId}`, uuidv5.URL);
const receipt = (order: { id: string; price: unknown; originalQuantity: unknown }) => {
  const price = new BigNumber(String(order.price));
  const quantity = new BigNumber(String(order.originalQuantity));
  return { id: order.id, price: price.toFixed(), quantity: quantity.toFixed(), proceeds: price.times(quantity).toFixed() };
};
async function authorize(db: Prisma.TransactionClient, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, blockedAt: true } });
  if (user?.role !== 'ADMIN' || user.blockedAt) throw new NrxDemoError('Доступ запрещён.', 403);
}

/** Same accounting boundary as VtaDemoSales. Never reads or writes ordinary
 * Balance/Order/Trade, never supplies real funds, never charges another user.
 * Existing ordinary NRX inventory is NOT copied, converted or reset on read,
 * sale, startup or deploy. Any legacy reconciliation requires a separate,
 * explicitly approved and audited operation against verified live records. */
export class NrxDemoSales {
  constructor(private prisma: PrismaClient, private clock: () => number = Date.now) {}

  async snapshot(userId: string) {
    return this.prisma.$transaction(async tx => {
      await authorize(tx, userId);
      const [held, orders] = await Promise.all([
        tx.demoBalance.findMany({ where: { userId, asset: { in: ['NRX', 'USDT'] } } }),
        tx.demoOrder.findMany({ where: { userId, pair: NEURIX.pair, side: 'SELL', status: 'FILLED' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 }),
      ]);
      const asOf = this.clock(), state = publicTestAsset(NEURIX, asOf).state;
      const mark = NEURIX.listingArmed && state.phase === 'live' && state.lastPrice !== null
        ? new BigNumber(state.lastPrice).decimalPlaces(10, BigNumber.ROUND_DOWN).toFixed() : null;
      const balances = ['NRX', 'USDT'].map(asset => {
        const b = held.find(h => h.asset === asset);
        const available = b?.available.toString() ?? '0', locked = b?.locked.toString() ?? '0';
        const priceUsd = asset === 'USDT' ? '1' : mark;
        const quantity = new BigNumber(available).plus(locked);
        return { asset, available, locked, priceUsd,
          valueUsd: quantity.isZero() ? '0' : priceUsd === null ? null : quantity.times(priceUsd).toFixed() };
      });
      return { account: { id: userId, scope: 'SIMULATION_SPOT' as const, cashPolicy: 'SHARED_DEMO_BALANCE' as const,
        active: held.some(b => b.asset === 'NRX') || orders.length > 0 },
        asOf, valuationSource: 'NEURIX_SIMULATION' as const, balances,
        totalValueUsd: balances.some(b => b.valueUsd === null) ? null : balances.reduce((sum, b) => sum.plus(b.valueUsd!), new BigNumber(0)).toFixed(),
        sales: orders.map(o => ({ ...receipt(o), createdAt: o.createdAt })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  /** Read-only recovery: absence is not permission to generate another key. */
  async operation(userId: string, requestId: string) {
    await authorize(this.prisma, userId);
    const order = await this.prisma.demoOrder.findFirst({ where: { id: saleId(userId, requestId), userId, pair: NEURIX.pair, side: 'SELL', status: 'FILLED' } });
    return { receipt: order ? { ...receipt(order), createdAt: order.createdAt } : null };
  }

  async sell(params: { userId: string; requestId: string; quantity: string }) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.requestId)) throw new NrxDemoError('Некорректный ID запроса.');
    const quantity = new BigNumber(params.quantity);
    if (!quantity.isFinite() || quantity.lte(0) || quantity.decimalPlaces()! > 8 || quantity.gte('1000000000000000000')) {
      throw new NrxDemoError('Количество должно быть положительным числом, не более 8 знаков после запятой.');
    }
    const id = saleId(params.userId, params.requestId);
    const replay = (order: any) => {
      if (order.userId !== params.userId || order.pair !== NEURIX.pair || order.side !== 'SELL'
        || order.status !== 'FILLED' || !quantity.eq(String(order.originalQuantity))) {
        throw new NrxDemoError('Этот запрос уже использован для другой продажи.', 409);
      }
      return receipt(order);
    };
    try {
      return await this.prisma.$transaction(async tx => {
        await authorize(tx, params.userId);
        const existing = await tx.demoOrder.findUnique({ where: { id } });
        if (existing) return replay(existing);
        const state = publicTestAsset(NEURIX, this.clock()).state;
        if (!NEURIX.listingArmed || state.phase !== 'live' || state.lastPrice === null) throw new NrxDemoError('Продажа откроется после листинга.');
        const price = new BigNumber(state.lastPrice).decimalPlaces(10, BigNumber.ROUND_DOWN);
        const proceeds = price.times(quantity);
        if (!price.isFinite() || price.lte(0) || proceeds.gte('1000000000000000000')) throw new NrxDemoError('Цена временно недоступна.');
        // Unique request-scoped order claims the operation before the debit.
        await tx.demoOrder.create({ data: { id, userId: params.userId, pair: NEURIX.pair, side: 'SELL', type: 'MARKET',
          price: price.toFixed(), originalQuantity: quantity.toFixed(), remainingQuantity: '0', status: 'FILLED' } });
        const debit = await tx.demoBalance.updateMany({ where: { userId: params.userId, asset: 'NRX', available: { gte: quantity.toFixed() } },
          data: { available: { decrement: quantity.toFixed() } } });
        if (debit.count !== 1) throw new NrxDemoError('Недостаточно NRX на счёте симуляции.');
        await tx.demoBalance.upsert({ where: { userId_asset: { userId: params.userId, asset: 'USDT' } },
          create: { userId: params.userId, asset: 'USDT', available: proceeds.toFixed(), locked: '0' },
          update: { available: { increment: proceeds.toFixed() } } });
        await tx.demoTrade.create({ data: { id, pair: NEURIX.pair, takerOrderId: id, makerOrderId: 'simulation:NRX',
          takerUserId: params.userId, makerUserId: 'simulation:NRX', side: 'SELL', price: price.toFixed(), quantity: quantity.toFixed() } });
        await tx.auditLog.create({ data: { userId: params.userId, action: 'NRX_DEMO_SOLD',
          metadata: { orderId: id, quantity: quantity.toFixed(), price: price.toFixed(), proceeds: proceeds.toFixed(), source: 'NEURIX simulation', ledger: 'DEMO' } } });
        return { id, price: price.toFixed(), quantity: quantity.toFixed(), proceeds: proceeds.toFixed() };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // A duplicate concurrent request rolled back. Re-authorize recovery.
        await authorize(this.prisma, params.userId);
        const existing = await this.prisma.demoOrder.findUnique({ where: { id } });
        if (existing) return replay(existing);
      }
      throw error;
    }
  }
}
