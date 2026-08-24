import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { v4 as uuidv4 } from 'uuid';
import { MatchingEngine } from '../matching-engine/MatchingEngine';
import { Order, OrderSide, OrderType, OrderBookSnapshot } from '../matching-engine/types';

type TxClient = Prisma.TransactionClient;

export class DemoTradingError extends Error {}

/**
 * A stripped-down mirror of OrderService (LIMIT/MARKET only — no
 * stop/take-profit/OCO, no PriceWatcher integration) that trades against
 * its own MatchingEngine instance and its own DemoBalance/DemoOrder/
 * DemoTrade tables instead of the real ones. See the DemoBalance doc
 * comment in schema.prisma for why this is a fully separate stack rather
 * than a flag on the real tables: nothing here can ever reach a real
 * user's balance, order, or the reserves calculation.
 *
 * A MARKET order fills only against resting DemoOrder liquidity in this
 * same demo book — deliberately not priced off the real Kraken mirror, so
 * the sandbox behaves exactly like a brand-new, empty exchange: you have
 * to place LIMIT orders to build depth before a MARKET order has anything
 * to fill against, which is the point of using this to watch how a book
 * behaves.
 */
export class DemoTradingService {
  constructor(private prisma: PrismaClient, private engine: MatchingEngine) {}

  async getBalances(userId: string) {
    return this.prisma.demoBalance.findMany({ where: { userId }, orderBy: { asset: 'asc' } });
  }

  async getOpenOrders(userId: string) {
    return this.prisma.demoOrder.findMany({
      where: { userId, status: { in: ['OPEN', 'PARTIALLY_FILLED'] } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRecentTrades(pair: string, limit = 50) {
    return this.prisma.demoTrade.findMany({ where: { pair }, orderBy: { executedAt: 'desc' }, take: limit });
  }

  getOrderBook(pair: string): OrderBookSnapshot {
    return this.engine.getBook(pair).snapshot();
  }

  async placeOrder(params: {
    userId: string;
    pair: string;
    side: OrderSide;
    type: OrderType;
    price?: BigNumber; // required for LIMIT
    quantity: BigNumber;
  }) {
    const [base, quote] = params.pair.split('/');
    if (!base || !quote) throw new DemoTradingError(`Invalid pair: ${params.pair}`);
    if (params.type === 'LIMIT' && !params.price) {
      throw new DemoTradingError('price is required for a LIMIT order');
    }
    if (!params.quantity.isFinite() || params.quantity.isLessThanOrEqualTo(0)) {
      throw new DemoTradingError('quantity must be a positive number');
    }

    const lockAsset = params.side === 'BUY' ? quote : base;
    let lockAmount: BigNumber;
    if (params.type === 'LIMIT') {
      lockAmount = params.side === 'BUY' ? params.price!.times(params.quantity) : params.quantity;
    } else if (params.side === 'SELL') {
      lockAmount = params.quantity;
    } else {
      const bestAsk = this.engine.getBook(params.pair).bestAsk()?.price;
      if (!bestAsk) throw new DemoTradingError('No demo liquidity available for this market order — place a LIMIT order first');
      lockAmount = params.quantity.times(bestAsk).times(1.02); // same 2% slippage buffer as real MARKET orders
    }

    return this.prisma.$transaction(async (tx: TxClient) => {
      await this.lockFunds(tx, params.userId, lockAsset, lockAmount);

      const orderId = uuidv4();
      await tx.demoOrder.create({
        data: {
          id: orderId,
          userId: params.userId,
          pair: params.pair,
          side: params.side,
          type: params.type,
          price: params.type === 'LIMIT' ? params.price!.toString() : null,
          originalQuantity: params.quantity.toString(),
          remainingQuantity: params.quantity.toString(),
          status: 'OPEN',
        },
      });

      const order: Order = {
        id: orderId,
        userId: params.userId,
        pair: params.pair,
        side: params.side,
        type: params.type,
        price: params.type === 'LIMIT' ? params.price! : null,
        originalQuantity: params.quantity,
        remainingQuantity: params.quantity,
        status: 'OPEN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      return this.matchAndSettle(tx, order, base, quote, lockAsset, lockAmount, params.price ?? null);
    });
  }

  async cancelOrder(userId: string, orderId: string) {
    return this.prisma.$transaction(async (tx: TxClient) => {
      const order = await tx.demoOrder.findUnique({ where: { id: orderId } });
      if (!order || order.userId !== userId) return null;
      if (!['OPEN', 'PARTIALLY_FILLED'].includes(order.status)) return null;

      await tx.demoOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
      this.engine.cancelOrder(order.pair, order.id);

      const [base, quote] = order.pair.split('/');
      const remaining = new BigNumber(order.remainingQuantity.toString());
      if (order.side === 'BUY') {
        const amount = remaining.times(new BigNumber(order.price!.toString()));
        await this.adjustBalance(tx, userId, quote, { available: amount, locked: amount.negated() });
      } else {
        await this.adjustBalance(tx, userId, base, { available: remaining, locked: remaining.negated() });
      }

      return order;
    });
  }

  private async matchAndSettle(
    tx: TxClient,
    order: Order,
    base: string,
    quote: string,
    lockAsset: string,
    lockAmount: BigNumber,
    limitPrice: BigNumber | null
  ) {
    const { trades, order: finalOrder } = this.engine.submitOrder(order);

    for (const trade of trades) {
      await tx.demoTrade.create({
        data: {
          id: trade.id,
          pair: trade.pair,
          takerOrderId: trade.takerOrderId,
          makerOrderId: trade.makerOrderId,
          takerUserId: trade.takerUserId,
          makerUserId: trade.makerUserId,
          price: trade.price.toString(),
          quantity: trade.quantity.toString(),
          side: trade.side,
        },
      });
      await this.settleTrade(tx, trade, base, quote);
    }

    await tx.demoOrder.update({
      where: { id: order.id },
      data: { status: finalOrder.status, remainingQuantity: finalOrder.remainingQuantity.toString() },
    });

    // Same refund logic as OrderService.matchAndSettle — see there for the
    // reasoning behind each term.
    const stillResting = order.type === 'LIMIT' && finalOrder.remainingQuantity.isGreaterThan(0);
    const shouldRemainLocked = stillResting
      ? order.side === 'BUY'
        ? finalOrder.remainingQuantity.times(limitPrice!)
        : finalOrder.remainingQuantity
      : new BigNumber(0);
    const consumedOrFilled =
      order.side === 'BUY'
        ? trades.reduce((sum, t) => sum.plus(t.price.times(t.quantity)), new BigNumber(0))
        : order.originalQuantity.minus(finalOrder.remainingQuantity);
    const refund = lockAmount.minus(consumedOrFilled).minus(shouldRemainLocked);
    if (refund.isGreaterThan(0)) {
      await this.adjustBalance(tx, order.userId, lockAsset, { available: refund, locked: refund.negated() });
    }

    return { order: finalOrder, trades };
  }

  private async lockFunds(tx: TxClient, userId: string, asset: string, amount: BigNumber) {
    const balance = await tx.demoBalance.findUnique({ where: { userId_asset: { userId, asset } } });
    const available = new BigNumber(balance?.available.toString() ?? '0');
    if (available.isLessThan(amount)) {
      throw new DemoTradingError(`Insufficient demo ${asset} balance`);
    }
    await tx.demoBalance.update({
      where: { userId_asset: { userId, asset } },
      data: {
        available: available.minus(amount).toString(),
        locked: new BigNumber(balance!.locked.toString()).plus(amount).toString(),
      },
    });
  }

  private async settleTrade(tx: TxClient, trade: { side: OrderSide; price: BigNumber; quantity: BigNumber; takerUserId: string; makerUserId: string }, base: string, quote: string) {
    const quoteAmount = trade.price.times(trade.quantity);
    const buyerId = trade.side === 'BUY' ? trade.takerUserId : trade.makerUserId;
    const sellerId = trade.side === 'BUY' ? trade.makerUserId : trade.takerUserId;

    await this.adjustBalance(tx, buyerId, quote, { locked: quoteAmount.negated() });
    await this.adjustBalance(tx, buyerId, base, { available: trade.quantity });
    await this.adjustBalance(tx, sellerId, base, { locked: trade.quantity.negated() });
    await this.adjustBalance(tx, sellerId, quote, { available: quoteAmount });
  }

  private async adjustBalance(tx: TxClient, userId: string, asset: string, delta: { available?: BigNumber; locked?: BigNumber }) {
    const existing = await tx.demoBalance.upsert({
      where: { userId_asset: { userId, asset } },
      create: { userId, asset, available: '0', locked: '0' },
      update: {},
    });
    const available = new BigNumber(existing.available.toString()).plus(delta.available ?? 0);
    const locked = new BigNumber(existing.locked.toString()).plus(delta.locked ?? 0);
    await tx.demoBalance.update({ where: { userId_asset: { userId, asset } }, data: { available: available.toString(), locked: locked.toString() } });
  }

  /** Manual credit/debit — the demo equivalent of BalanceAdjustmentService,
   * used only by the admin "demo top-up" route. Always logs to AuditLog. */
  async topUp(params: { userId: string; asset: string; amount: string; performedByAdminId: string; note?: string }) {
    const delta = new BigNumber(params.amount);
    if (!delta.isFinite() || delta.isZero()) throw new DemoTradingError('Amount must be a non-zero number');

    return this.prisma.$transaction(async (tx: TxClient) => {
      const existing = await tx.demoBalance.findUnique({ where: { userId_asset: { userId: params.userId, asset: params.asset } } });
      const currentAvailable = new BigNumber(existing?.available.toString() ?? '0');
      const newAvailable = currentAvailable.plus(delta);
      if (newAvailable.isNegative()) throw new DemoTradingError('Adjustment would make the demo balance negative');

      const updated = await tx.demoBalance.upsert({
        where: { userId_asset: { userId: params.userId, asset: params.asset } },
        create: { userId: params.userId, asset: params.asset, available: newAvailable.toString() },
        update: { available: newAvailable.toString() },
      });

      await tx.auditLog.create({
        data: {
          userId: params.userId,
          action: 'DEMO_BALANCE_ADJUSTED',
          metadata: {
            asset: params.asset,
            delta: delta.toString(),
            newAvailable: newAvailable.toString(),
            reason: 'demo top-up',
            note: params.note ?? null,
            performedByAdminId: params.performedByAdminId,
          },
        },
      });

      return { asset: updated.asset, available: updated.available.toString(), locked: updated.locked.toString() };
    });
  }
}
