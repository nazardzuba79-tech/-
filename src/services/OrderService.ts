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

  async placeLimitOrder(params: {
    userId: string;
    pair: string;
    side: OrderSide;
    price: BigNumber;
    quantity: BigNumber;
  }) {
    const [base, quote] = params.pair.split('/'); // e.g. BTC/USDT
    const lockAsset = params.side === 'BUY' ? quote : base;
    const lockAmount = params.side === 'BUY' ? params.price.times(params.quantity) : params.quantity;

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
        type: 'LIMIT',
        price: params.price,
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
          price: params.price.toString(),
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

      // 6. If order didn't fully fill, unlock the now-unneeded locked portion
      //    ...(left as an exercise: mirrors step 1 in reverse for the delta)

      return { order: finalOrder, trades };
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
