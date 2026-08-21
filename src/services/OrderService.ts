import { PrismaClient, Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;
import BigNumber from 'bignumber.js';
import { v4 as uuidv4 } from 'uuid';
import { MatchingEngine } from '../matching-engine/MatchingEngine';
import { Order, OrderSide, OrderType } from '../matching-engine/types';

/**
 * Bridges the in-memory MatchingEngine with persistent balances/orders.
 *
 * CRITICAL INVARIANT (repeated from MatchingEngine.ts because it matters):
 * funds are locked at ORDER PLACEMENT time, inside the same DB transaction
 * that creates the order row. This prevents a user from placing two orders
 * that both spend the same balance before either fills ("balance race").
 */
export class OrderService {
  constructor(private prisma: PrismaClient, private engine: MatchingEngine) {}

  async placeOrder(params: {
    userId: string;
    pair: string;
    side: OrderSide;
    type: OrderType;
    price?: BigNumber; // required for LIMIT, ignored for MARKET
    quantity: BigNumber;
  }) {
    const [base, quote] = params.pair.split('/'); // e.g. BTC/USDT

    if (params.type === 'LIMIT' && !params.price) {
      throw new Error('price is required for a LIMIT order');
    }

    const lockAsset = params.side === 'BUY' ? quote : base;
    // LIMIT: lock exactly what the order can spend/sell at its own price.
    // MARKET BUY: we don't know the fill price yet, so lock against the
    // current best ask plus a slippage buffer, then refund whatever wasn't
    // actually spent once the trades settle (see step 6 below). MARKET
    // SELL locks the exact base quantity, same as a limit sell.
    let lockAmount: BigNumber;
    if (params.type === 'LIMIT') {
      lockAmount = params.side === 'BUY' ? params.price!.times(params.quantity) : params.quantity;
    } else if (params.side === 'SELL') {
      lockAmount = params.quantity;
    } else {
      const bestAsk = this.engine.getBook(params.pair).bestAsk()?.price;
      if (!bestAsk) throw new Error('No liquidity available for this market order');
      lockAmount = params.quantity.times(bestAsk).times(1.02); // 2% slippage buffer
    }

    return this.prisma.$transaction(async (tx: TxClient) => {
      // 1. Lock funds atomically — fails if insufficient available balance.
      const balance = await tx.balance.findUnique({
        where: { userId_asset: { userId: params.userId, asset: lockAsset } },
      });
      const available = new BigNumber(balance?.available.toString() ?? '0');
      if (available.isLessThan(lockAmount)) {
        throw new Error(`Insufficient ${lockAsset} balance`);
      }
      await tx.balance.update({
        where: { userId_asset: { userId: params.userId, asset: lockAsset } },
        data: {
          available: available.minus(lockAmount).toString(),
          locked: new BigNumber(balance!.locked.toString()).plus(lockAmount).toString(),
        },
      });

      // 2. Create the order row.
      const orderId = uuidv4();
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
      await tx.order.create({
        data: {
          id: order.id,
          userId: order.userId,
          pair: order.pair,
          side: order.side,
          type: order.type,
          price: order.price?.toString() ?? null,
          originalQuantity: params.quantity.toString(),
          remainingQuantity: params.quantity.toString(),
          status: order.status,
        },
      });

      // 3. Run matching (in-memory, synchronous, deterministic).
      const { trades, order: finalOrder } = this.engine.submitOrder(order);

      // 4. Persist resulting trades + settle balances for both sides.
      for (const trade of trades) {
        await tx.trade.create({
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

      // 5. Update order status/remaining quantity.
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: finalOrder.status,
          remainingQuantity: finalOrder.remainingQuantity.toString(),
        },
      });

      // 6. Refund whatever of the initial lock wasn't actually consumed AND
      // isn't still backing a resting order. A LIMIT order that's still
      // (partially) OPEN must keep remainingQuantity locked at its limit
      // price/quantity — only the "price improvement" on the filled slice
      // (trade price better than the limit) is refundable now. A MARKET
      // order never rests, so everything beyond what actually filled —
      // including the slippage buffer — is refundable.
      const stillResting = params.type === 'LIMIT' && finalOrder.remainingQuantity.isGreaterThan(0);
      const shouldRemainLocked = stillResting
        ? params.side === 'BUY'
          ? finalOrder.remainingQuantity.times(params.price!)
          : finalOrder.remainingQuantity
        : new BigNumber(0);
      const consumedOrFilled =
        params.side === 'BUY'
          ? trades.reduce((sum: BigNumber, t: (typeof trades)[number]) => sum.plus(t.price.times(t.quantity)), new BigNumber(0))
          : params.quantity.minus(finalOrder.remainingQuantity);
      const refund = lockAmount.minus(consumedOrFilled).minus(shouldRemainLocked);
      if (refund.isGreaterThan(0)) {
        await this.adjustBalance(tx, params.userId, lockAsset, { available: refund, locked: refund.negated() });
      }

      return { order: finalOrder, trades };
    });
  }

  /**
   * Cancels a resting order and releases whatever of it was still locked.
   * Returns null if the order doesn't exist, isn't the caller's, or is no
   * longer cancellable (already FILLED/CANCELLED) — the route maps that to
   * a 404/409 as appropriate.
   */
  async cancelOrder(userId: string, orderId: string) {
    return this.prisma.$transaction(async (tx: TxClient) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order || order.userId !== userId) return null;
      if (order.status !== 'OPEN' && order.status !== 'PARTIALLY_FILLED') return null;

      this.engine.cancelOrder(order.pair, order.id);
      await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });

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

  /** Moves locked/available balances for both counterparties of a trade. */
  private async settleTrade(tx: TxClient, trade: any, base: string, quote: string) {
    const quoteAmount = trade.price.times(trade.quantity);

    // Taker and maker sides depend on trade.side (side of the taker).
    const buyerId = trade.side === 'BUY' ? trade.takerUserId : trade.makerUserId;
    const sellerId = trade.side === 'BUY' ? trade.makerUserId : trade.takerUserId;

    // Buyer: loses locked quote, gains available base.
    await this.adjustBalance(tx, buyerId, quote, { locked: quoteAmount.negated() });
    await this.adjustBalance(tx, buyerId, base, { available: trade.quantity });

    // Seller: loses locked base, gains available quote.
    await this.adjustBalance(tx, sellerId, base, { locked: trade.quantity.negated() });
    await this.adjustBalance(tx, sellerId, quote, { available: quoteAmount });
  }

  private async adjustBalance(
    tx: TxClient,
    userId: string,
    asset: string,
    delta: { available?: BigNumber; locked?: BigNumber }
  ) {
    const existing = await tx.balance.upsert({
      where: { userId_asset: { userId, asset } },
      create: { userId, asset, available: '0', locked: '0' },
      update: {},
    });
    const available = new BigNumber(existing.available.toString()).plus(delta.available ?? 0);
    const locked = new BigNumber(existing.locked.toString()).plus(delta.locked ?? 0);
    await tx.balance.update({
      where: { userId_asset: { userId, asset } },
      data: { available: available.toString(), locked: locked.toString() },
    });
  }
}
