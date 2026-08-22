import { PrismaClient, Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;
import BigNumber from 'bignumber.js';
import { v4 as uuidv4 } from 'uuid';
import { MatchingEngine } from '../matching-engine/MatchingEngine';
import { Order, OrderSide, OrderType } from '../matching-engine/types';

export type ExtendedOrderType = OrderType | 'STOP_LIMIT' | 'STOP_MARKET' | 'TAKE_PROFIT_LIMIT' | 'TAKE_PROFIT_MARKET';

const CONDITIONAL_TYPES = new Set<ExtendedOrderType>(['STOP_LIMIT', 'STOP_MARKET', 'TAKE_PROFIT_LIMIT', 'TAKE_PROFIT_MARKET']);
const LIMIT_FAMILY = new Set<ExtendedOrderType>(['LIMIT', 'STOP_LIMIT', 'TAKE_PROFIT_LIMIT']);

function isConditionalType(type: ExtendedOrderType): boolean {
  return CONDITIONAL_TYPES.has(type);
}

/** LIMIT-family orders (plain LIMIT and the two *_LIMIT conditional types)
 * execute at a fixed price once active; MARKET-family orders (plain
 * MARKET and the two *_MARKET conditional types) execute at whatever the
 * book gives once active. This is the "family" a conditional order joins
 * once PriceWatcherService triggers it. */
export function effectiveOrderType(type: ExtendedOrderType): OrderType {
  return LIMIT_FAMILY.has(type) ? 'LIMIT' : 'MARKET';
}

// Only what OrderService needs from KrakenMarketDataService — narrow
// interface so tests can supply a plain mock, same pattern as DepositService.
export interface PriceSource {
  getTicker(pair: string): Promise<{ lastPrice: string } | null>;
}

/**
 * Bridges the in-memory MatchingEngine with persistent balances/orders.
 *
 * CRITICAL INVARIANT (repeated from MatchingEngine.ts because it matters):
 * funds are locked at ORDER PLACEMENT time, inside the same DB transaction
 * that creates the order row. This prevents a user from placing two orders
 * that both spend the same balance before either fills ("balance race").
 * This applies to conditional orders too — a STOP_LIMIT/TAKE_PROFIT_* order
 * locks its funds at placement, sits as PENDING_TRIGGER (never touching the
 * matching engine), and only actually matches once PriceWatcherService
 * calls triggerOrder() after the real market price crosses its trigger.
 */
export class OrderService {
  constructor(private prisma: PrismaClient, private engine: MatchingEngine, private priceSource: PriceSource) {}

  async placeOrder(params: {
    userId: string;
    pair: string;
    side: OrderSide;
    type: ExtendedOrderType;
    price?: BigNumber; // required for LIMIT-family
    triggerPrice?: BigNumber; // required for conditional types
    quantity: BigNumber;
    ocoGroupId?: string; // internal — set by placeOcoOrder, not exposed on the public route
  }) {
    const [base, quote] = params.pair.split('/'); // e.g. BTC/USDT
    const conditional = isConditionalType(params.type);
    const effType = effectiveOrderType(params.type);

    if (effType === 'LIMIT' && !params.price) {
      throw new Error(`price is required for a ${params.type} order`);
    }
    if (conditional && !params.triggerPrice) {
      throw new Error(`triggerPrice is required for a ${params.type} order`);
    }

    let currentPrice: BigNumber | null = null;
    if (conditional) {
      const ticker = await this.priceSource.getTicker(params.pair);
      if (!ticker) throw new Error('Unable to fetch the current market price to validate the trigger price');
      currentPrice = new BigNumber(ticker.lastPrice);
      this.validateTriggerDirection(params.type, params.side, params.triggerPrice!, currentPrice);
    }

    const lockAsset = params.side === 'BUY' ? quote : base;
    let lockAmount: BigNumber;
    if (conditional) {
      // No live book price to lock against for a not-yet-active order — use
      // the trigger price (LIMIT-family locks its own execution price
      // instead, which is always at least as conservative). MARKET-family
      // gets the same 2% slippage buffer a live MARKET BUY gets, since the
      // price it actually fills at once triggered is just as uncertain.
      const refPrice = effType === 'LIMIT' ? params.price! : params.triggerPrice!;
      lockAmount =
        params.side === 'BUY' ? refPrice.times(params.quantity).times(effType === 'MARKET' ? 1.02 : 1) : params.quantity;
    } else if (params.type === 'LIMIT') {
      lockAmount = params.side === 'BUY' ? params.price!.times(params.quantity) : params.quantity;
    } else if (params.side === 'SELL') {
      lockAmount = params.quantity;
    } else {
      const bestAsk = this.engine.getBook(params.pair).bestAsk()?.price;
      if (!bestAsk) throw new Error('No liquidity available for this market order');
      lockAmount = params.quantity.times(bestAsk).times(1.02); // 2% slippage buffer
    }

    return this.prisma.$transaction(async (tx: TxClient) => {
      await this.lockFunds(tx, params.userId, lockAsset, lockAmount);

      const orderId = uuidv4();
      await tx.order.create({
        data: {
          id: orderId,
          userId: params.userId,
          pair: params.pair,
          side: params.side,
          type: params.type,
          price: effType === 'LIMIT' ? params.price!.toString() : null,
          triggerPrice: conditional ? params.triggerPrice!.toString() : null,
          ocoGroupId: params.ocoGroupId ?? null,
          lockedAmount: conditional ? lockAmount.toString() : null,
          lockedAsset: conditional ? lockAsset : null,
          originalQuantity: params.quantity.toString(),
          remainingQuantity: params.quantity.toString(),
          status: conditional ? 'PENDING_TRIGGER' : 'OPEN',
        },
      });

      // A conditional order does nothing else at placement time — it just
      // waits. PriceWatcherService is what actually submits it to the
      // matching engine, via triggerOrder(), once the real price crosses.
      if (conditional) {
        return {
          order: {
            id: orderId,
            userId: params.userId,
            pair: params.pair,
            side: params.side,
            type: params.type,
            price: effType === 'LIMIT' ? params.price! : null,
            originalQuantity: params.quantity,
            remainingQuantity: params.quantity,
            status: 'PENDING_TRIGGER' as const,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          trades: [],
        };
      }

      const order: Order = {
        id: orderId,
        userId: params.userId,
        pair: params.pair,
        side: params.side,
        type: effType,
        price: effType === 'LIMIT' ? params.price! : null,
        originalQuantity: params.quantity,
        remainingQuantity: params.quantity,
        status: 'OPEN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      return this.matchAndSettle(tx, order, base, quote, lockAsset, lockAmount, params.price ?? null);
    });
  }

  /**
   * Places a One-Cancels-the-Other pair: a take-profit leg and a stop leg,
   * same side/quantity, sharing one fund lock (only one leg will ever
   * actually execute) and one ocoGroupId. When either leg triggers or is
   * cancelled, PriceWatcherService/cancelOrder cancels the sibling.
   */
  async placeOcoOrder(params: {
    userId: string;
    pair: string;
    side: OrderSide;
    quantity: BigNumber;
    takeProfitPrice: BigNumber; // also used as this leg's trigger price
    stopTriggerPrice: BigNumber;
    stopLimitPrice: BigNumber;
  }) {
    const [base, quote] = params.pair.split('/');
    const ticker = await this.priceSource.getTicker(params.pair);
    if (!ticker) throw new Error('Unable to fetch the current market price to validate the trigger prices');
    const currentPrice = new BigNumber(ticker.lastPrice);

    this.validateTriggerDirection('TAKE_PROFIT_LIMIT', params.side, params.takeProfitPrice, currentPrice);
    this.validateTriggerDirection('STOP_LIMIT', params.side, params.stopTriggerPrice, currentPrice);

    const lockAsset = params.side === 'BUY' ? quote : base;
    // Only one leg will ever fill, so lock the larger of the two — the
    // other leg's cancellation (by triggerOrder, once its sibling fires)
    // never touches the balance again.
    const lockAmount =
      params.side === 'BUY'
        ? BigNumber.maximum(params.takeProfitPrice.times(params.quantity), params.stopLimitPrice.times(params.quantity))
        : params.quantity;

    return this.prisma.$transaction(async (tx: TxClient) => {
      await this.lockFunds(tx, params.userId, lockAsset, lockAmount);

      const ocoGroupId = uuidv4();
      const takeProfitId = uuidv4();
      const stopId = uuidv4();

      const shared = {
        userId: params.userId,
        pair: params.pair,
        side: params.side,
        ocoGroupId,
        lockedAmount: lockAmount.toString(),
        lockedAsset: lockAsset,
        originalQuantity: params.quantity.toString(),
        remainingQuantity: params.quantity.toString(),
        status: 'PENDING_TRIGGER',
      };

      await tx.order.create({
        data: {
          id: takeProfitId,
          ...shared,
          type: 'TAKE_PROFIT_LIMIT',
          price: params.takeProfitPrice.toString(),
          triggerPrice: params.takeProfitPrice.toString(),
        },
      });
      await tx.order.create({
        data: {
          id: stopId,
          ...shared,
          type: 'STOP_LIMIT',
          price: params.stopLimitPrice.toString(),
          triggerPrice: params.stopTriggerPrice.toString(),
        },
      });

      return { ocoGroupId, takeProfitOrderId: takeProfitId, stopOrderId: stopId };
    });
  }

  /**
   * Activates a PENDING_TRIGGER order once its trigger condition has been
   * met (called by PriceWatcherService, never directly by a route). Reuses
   * the exact settlement/refund logic real immediate orders go through —
   * the only difference is the fund lock already happened at placement
   * time, so it's read back from the stored row instead of recomputed.
   * Returns null if the order is no longer PENDING_TRIGGER (already
   * cancelled by the user, or by its OCO sibling triggering first) — a
   * normal, expected race, not an error.
   */
  async triggerOrder(orderId: string) {
    return this.prisma.$transaction(async (tx: TxClient) => {
      const row = await tx.order.findUnique({ where: { id: orderId } });
      if (!row || row.status !== 'PENDING_TRIGGER') return null;

      const [base, quote] = row.pair.split('/');
      const effType = effectiveOrderType(row.type as ExtendedOrderType);
      const lockAsset = row.lockedAsset!;
      const lockAmount = new BigNumber(row.lockedAmount!.toString());
      const price = row.price ? new BigNumber(row.price.toString()) : null;

      const order: Order = {
        id: row.id,
        userId: row.userId,
        pair: row.pair,
        side: row.side as OrderSide,
        type: effType,
        price: effType === 'LIMIT' ? price : null,
        originalQuantity: new BigNumber(row.originalQuantity.toString()),
        remainingQuantity: new BigNumber(row.remainingQuantity.toString()),
        status: 'OPEN',
        createdAt: row.createdAt.getTime(),
        updatedAt: Date.now(),
      };

      // Persist the type flip (STOP_LIMIT -> LIMIT etc.) so the order no
      // longer reads as "conditional" anywhere downstream (open-orders
      // list, cancelOrder) once it's a live book order.
      await tx.order.update({ where: { id: row.id }, data: { type: effType } });

      const result = await this.matchAndSettle(tx, order, base, quote, lockAsset, lockAmount, price);

      if (row.ocoGroupId) {
        const sibling = await tx.order.findFirst({
          where: { ocoGroupId: row.ocoGroupId, id: { not: row.id }, status: 'PENDING_TRIGGER' },
        });
        if (sibling) {
          // The shared lock was already fully accounted for by this leg's
          // own settlement above — cancelling the sibling must NOT touch
          // the balance again, or the same funds get refunded twice.
          await tx.order.update({ where: { id: sibling.id }, data: { status: 'CANCELLED' } });
        }
      }

      return result;
    });
  }

  /**
   * Moves a still-PENDING_TRIGGER order's trigger price (and, for a
   * LIMIT-family conditional order, its execution price too) — what
   * powers dragging a SL/TP line on the chart. Re-validates direction
   * against the current market price exactly like placement does, and
   * adjusts the fund lock by the delta rather than releasing and
   * re-locking (so a balance dip between the two steps can never leave
   * the order under-margined). Returns null if the order doesn't exist,
   * isn't the caller's, or is no longer pending (already triggered/
   * cancelled) — a normal race, not an error.
   */
  async updateConditionalOrder(
    userId: string,
    orderId: string,
    updates: { triggerPrice?: BigNumber; price?: BigNumber }
  ) {
    return this.prisma.$transaction(async (tx: TxClient) => {
      const row = await tx.order.findUnique({ where: { id: orderId } });
      if (!row || row.userId !== userId || row.status !== 'PENDING_TRIGGER') return null;

      const effType = effectiveOrderType(row.type as ExtendedOrderType);
      const newTriggerPrice = updates.triggerPrice ?? new BigNumber(row.triggerPrice!.toString());
      const newPrice = effType === 'LIMIT' ? updates.price ?? new BigNumber(row.price!.toString()) : null;

      const ticker = await this.priceSource.getTicker(row.pair);
      if (!ticker) throw new Error('Unable to fetch the current market price to validate the trigger price');
      const currentPrice = new BigNumber(ticker.lastPrice);
      this.validateTriggerDirection(row.type as ExtendedOrderType, row.side as OrderSide, newTriggerPrice, currentPrice);

      const lockAsset = row.lockedAsset!;
      const oldLockAmount = new BigNumber(row.lockedAmount!.toString());
      const quantity = new BigNumber(row.remainingQuantity.toString());
      const refPrice = effType === 'LIMIT' ? newPrice! : newTriggerPrice;
      // SELL locks the base quantity outright, unaffected by price — only
      // a BUY-side lock (quote-denominated) actually moves with the price.
      let newLockAmount = row.side === 'BUY' ? refPrice.times(quantity).times(effType === 'MARKET' ? 1.02 : 1) : quantity;

      // An OCO pair's shared lock must stay at least as large as whatever
      // the untouched sibling leg alone would need — never shrink below that.
      if (row.ocoGroupId && row.side === 'BUY') {
        const sibling = await tx.order.findFirst({
          where: { ocoGroupId: row.ocoGroupId, id: { not: row.id }, status: 'PENDING_TRIGGER' },
        });
        if (sibling) {
          const siblingRefPrice = sibling.price
            ? new BigNumber(sibling.price.toString())
            : new BigNumber(sibling.triggerPrice!.toString());
          newLockAmount = BigNumber.maximum(newLockAmount, siblingRefPrice.times(quantity));
        }
      }

      const delta = newLockAmount.minus(oldLockAmount);
      if (delta.isGreaterThan(0)) {
        const balance = await tx.balance.findUnique({ where: { userId_asset: { userId, asset: lockAsset } } });
        const available = new BigNumber(balance?.available.toString() ?? '0');
        if (available.isLessThan(delta)) {
          throw new Error(`Insufficient ${lockAsset} balance to move the trigger price that far`);
        }
      }
      if (!delta.isZero()) {
        await this.adjustBalance(tx, userId, lockAsset, { available: delta.negated(), locked: delta });
      }

      await tx.order.update({
        where: { id: row.id },
        data: {
          triggerPrice: newTriggerPrice.toString(),
          price: newPrice ? newPrice.toString() : row.price,
          lockedAmount: newLockAmount.toString(),
        },
      });

      if (row.ocoGroupId) {
        const sibling = await tx.order.findFirst({
          where: { ocoGroupId: row.ocoGroupId, id: { not: row.id }, status: 'PENDING_TRIGGER' },
        });
        if (sibling && new BigNumber(sibling.lockedAmount!.toString()).isLessThan(newLockAmount)) {
          await tx.order.update({ where: { id: sibling.id }, data: { lockedAmount: newLockAmount.toString() } });
        }
      }

      return { id: row.id, triggerPrice: newTriggerPrice.toString(), price: newPrice?.toString() ?? row.price };
    });
  }

  /** Shared core of placeOrder's immediate path and triggerOrder: run the
   * order through the matching engine, persist trades, settle both sides,
   * update the order row, and refund whatever of the lock wasn't consumed
   * or isn't still backing a resting order. */
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

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: finalOrder.status,
        remainingQuantity: finalOrder.remainingQuantity.toString(),
      },
    });

    // Refund whatever of the initial lock wasn't actually consumed AND
    // isn't still backing a resting order. A LIMIT order that's still
    // (partially) OPEN must keep remainingQuantity locked at its limit
    // price/quantity — only the "price improvement" on the filled slice
    // (trade price better than the limit) is refundable now. A MARKET
    // order never rests, so everything beyond what actually filled —
    // including the slippage buffer — is refundable.
    const stillResting = order.type === 'LIMIT' && finalOrder.remainingQuantity.isGreaterThan(0);
    const shouldRemainLocked = stillResting
      ? order.side === 'BUY'
        ? finalOrder.remainingQuantity.times(limitPrice!)
        : finalOrder.remainingQuantity
      : new BigNumber(0);
    const consumedOrFilled =
      order.side === 'BUY'
        ? trades.reduce((sum: BigNumber, t: (typeof trades)[number]) => sum.plus(t.price.times(t.quantity)), new BigNumber(0))
        : order.originalQuantity.minus(finalOrder.remainingQuantity);
    const refund = lockAmount.minus(consumedOrFilled).minus(shouldRemainLocked);
    if (refund.isGreaterThan(0)) {
      await this.adjustBalance(tx, order.userId, lockAsset, { available: refund, locked: refund.negated() });
    }

    return { order: finalOrder, trades };
  }

  /**
   * A STOP order protects against an adverse move, so it must sit on the
   * far side of the current price from where the market would need to go
   * to hurt the position: a SELL stop (protecting a long) triggers as
   * price falls, so it must start below the current price; a BUY stop
   * (protecting a short, or a breakout entry) triggers as price rises, so
   * it must start above. A TAKE_PROFIT order captures a favorable move, so
   * it's the mirror image: SELL take-profit sits above, BUY take-profit
   * sits below.
   */
  private validateTriggerDirection(
    type: ExtendedOrderType,
    side: OrderSide,
    triggerPrice: BigNumber,
    currentPrice: BigNumber
  ) {
    const isStopFamily = type === 'STOP_LIMIT' || type === 'STOP_MARKET';
    const mustBeBelow = (isStopFamily && side === 'SELL') || (!isStopFamily && side === 'BUY');
    if (mustBeBelow && triggerPrice.isGreaterThanOrEqualTo(currentPrice)) {
      throw new Error(`Trigger price must be below the current price (${currentPrice.toString()})`);
    }
    if (!mustBeBelow && triggerPrice.isLessThanOrEqualTo(currentPrice)) {
      throw new Error(`Trigger price must be above the current price (${currentPrice.toString()})`);
    }
  }

  private async lockFunds(tx: TxClient, userId: string, asset: string, amount: BigNumber) {
    const balance = await tx.balance.findUnique({ where: { userId_asset: { userId, asset } } });
    const available = new BigNumber(balance?.available.toString() ?? '0');
    if (available.isLessThan(amount)) {
      throw new Error(`Insufficient ${asset} balance`);
    }
    await tx.balance.update({
      where: { userId_asset: { userId, asset } },
      data: {
        available: available.minus(amount).toString(),
        locked: new BigNumber(balance!.locked.toString()).plus(amount).toString(),
      },
    });
  }

  /**
   * Cancels a resting OR pending-trigger order and releases whatever of it
   * was still locked. Returns null if the order doesn't exist, isn't the
   * caller's, or is no longer cancellable (already FILLED/CANCELLED) — the
   * route maps that to a 404/409 as appropriate.
   */
  async cancelOrder(userId: string, orderId: string) {
    return this.prisma.$transaction(async (tx: TxClient) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order || order.userId !== userId) return null;
      if (!['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'].includes(order.status)) return null;

      await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });

      if (order.status === 'PENDING_TRIGGER') {
        // Never touched the matching engine — its whole lock (shared with
        // its OCO sibling, if any) is refundable outright. Only refund
        // once per OCO pair: skip if the sibling already triggered and
        // resolved this lock (it would no longer be PENDING_TRIGGER).
        await this.adjustBalance(tx, userId, order.lockedAsset!, {
          available: new BigNumber(order.lockedAmount!.toString()),
          locked: new BigNumber(order.lockedAmount!.toString()).negated(),
        });
        if (order.ocoGroupId) {
          const sibling = await tx.order.findFirst({
            where: { ocoGroupId: order.ocoGroupId, id: { not: order.id }, status: 'PENDING_TRIGGER' },
          });
          if (sibling) await tx.order.update({ where: { id: sibling.id }, data: { status: 'CANCELLED' } });
        }
        return order;
      }

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
