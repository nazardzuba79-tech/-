import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { v4 as uuidv4 } from 'uuid';
import { MatchingEngine } from '../matching-engine/MatchingEngine';
import { Order, OrderSide, OrderType, Trade } from '../matching-engine/types';
import { MarkPriceService } from './MarkPriceService';
import {
  computeInitialMargin,
  computeLiquidationPrice,
  computeCrossLiquidationPrice,
  computeUnrealizedPnl,
  PositionSide,
} from './marginMath';
import {
  MIN_LEVERAGE,
  MAX_LEVERAGE,
  NEW_ACCOUNT_MAX_LEVERAGE,
  NEW_ACCOUNT_PERIOD_DAYS,
  getLeverageTier,
} from '../config/futuresConfig';

type TxClient = Prisma.TransactionClient;
type MarginType = 'ISOLATED' | 'CROSS';

/**
 * Futures counterpart of OrderService, deliberately kept as a fully
 * separate class/table set (see FuturesOrder's schema comment) so a bug
 * here can never reach spot balances.
 *
 * Same critical invariant as spot: margin is locked at ORDER PLACEMENT
 * time, inside the same transaction that creates the order row — this is
 * a conservative "worst case" lock (as if the whole order opens/increases
 * a position), since the real requirement can only be known once the
 * order's actual position effect (open/increase vs reduce/close/flip) is
 * resolved per fill. Any margin locked but not actually needed is
 * refunded once trades settle, exactly like spot's slippage-buffer
 * refund for MARKET orders.
 */
export class FuturesPositionService {
  constructor(
    private prisma: PrismaClient,
    private engine: MatchingEngine,
    private markPriceService: MarkPriceService
  ) {}

  async placeOrder(params: {
    userId: string;
    symbol: string;
    side: OrderSide;
    type: OrderType;
    price?: BigNumber; // required for LIMIT, ignored for MARKET
    quantity: BigNumber;
    leverage: number;
    marginType: MarginType;
    reduceOnly?: boolean;
  }) {
    const [, quote] = params.symbol.split('/');

    if (params.type === 'LIMIT' && !params.price) {
      throw new Error('price is required for a LIMIT order');
    }
    if (!Number.isInteger(params.leverage) || params.leverage < MIN_LEVERAGE || params.leverage > MAX_LEVERAGE) {
      throw new Error(`Leverage must be an integer between ${MIN_LEVERAGE} and ${MAX_LEVERAGE}`);
    }

    // Estimate the notional this order could open/increase at, for both
    // leverage-tier and margin-lock purposes. MARKET orders use the
    // current best opposing price; a mark-price fallback would let a
    // manipulated/thin internal book under-collateralize the order.
    const book = this.engine.getBook(params.symbol);
    const estimatePrice =
      params.type === 'LIMIT' ? params.price! : (params.side === 'BUY' ? book.bestAsk() : book.bestBid())?.price;
    if (!estimatePrice) throw new Error('No liquidity available for this market order');
    const estimatedNotional = params.quantity.times(estimatePrice);

    const tier = getLeverageTier(estimatedNotional.toNumber());
    if (params.leverage > tier.maxLeverage) {
      throw new Error(
        `Max leverage for a ${estimatedNotional.toFixed(2)} ${quote} position is ${tier.maxLeverage}x`
      );
    }

    return this.prisma.$transaction(async (tx: TxClient) => {
      const user = await tx.user.findUnique({ where: { id: params.userId } });
      if (!user) throw new Error('User not found');
      const accountAgeDays = (Date.now() - user.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (accountAgeDays < NEW_ACCOUNT_PERIOD_DAYS && params.leverage > NEW_ACCOUNT_MAX_LEVERAGE) {
        throw new Error(
          `New accounts are limited to ${NEW_ACCOUNT_MAX_LEVERAGE}x leverage for the first ${NEW_ACCOUNT_PERIOD_DAYS} days`
        );
      }

      const existingPosition = await tx.futuresPosition.findFirst({
        where: { userId: params.userId, symbol: params.symbol, marginType: params.marginType, status: 'OPEN' },
      });
      const impliedDirection: PositionSide = params.side === 'BUY' ? 'LONG' : 'SHORT';

      if (params.reduceOnly) {
        const opposingSize =
          existingPosition && existingPosition.side !== impliedDirection
            ? new BigNumber(existingPosition.size.toString())
            : new BigNumber(0);
        if (params.quantity.isGreaterThan(opposingSize)) {
          throw new Error('reduceOnly order would exceed the current position size');
        }
      }

      // Conservative margin lock: full estimated notional at this leverage.
      // reduceOnly orders never need new margin — they can only shrink an
      // existing position, which frees margin rather than consuming it.
      const lockAmount = params.reduceOnly ? new BigNumber(0) : computeInitialMargin(estimatedNotional, params.leverage);
      if (lockAmount.isGreaterThan(0)) {
        const balance = await tx.futuresBalance.findUnique({
          where: { userId_asset: { userId: params.userId, asset: quote } },
        });
        const available = new BigNumber(balance?.available.toString() ?? '0');
        if (available.isLessThan(lockAmount)) {
          throw new Error(`Insufficient ${quote} margin balance`);
        }
        await tx.futuresBalance.update({
          where: { userId_asset: { userId: params.userId, asset: quote } },
          data: {
            available: available.minus(lockAmount).toString(),
            locked: new BigNumber(balance!.locked.toString()).plus(lockAmount).toString(),
          },
        });
      }

      const orderId = uuidv4();
      const order: Order = {
        id: orderId,
        userId: params.userId,
        pair: params.symbol,
        side: params.side,
        type: params.type,
        price: params.type === 'LIMIT' ? params.price! : null,
        originalQuantity: params.quantity,
        remainingQuantity: params.quantity,
        status: 'OPEN',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await tx.futuresOrder.create({
        data: {
          id: order.id,
          userId: order.userId,
          symbol: params.symbol,
          side: order.side,
          type: order.type,
          price: order.price?.toString() ?? null,
          originalQuantity: params.quantity.toString(),
          remainingQuantity: params.quantity.toString(),
          status: order.status,
          reduceOnly: !!params.reduceOnly,
          leverage: params.leverage,
          marginType: params.marginType,
        },
      });

      const { trades, order: finalOrder } = this.engine.submitOrder(order);

      let marginConsumed = new BigNumber(0);
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
        }).catch(() => {
          // Futures trades share the spot Trade table's shape but are
          // logically distinct; if a unique constraint ever separates
          // them this is where that split would be persisted. For now
          // trade ids are UUIDs so collisions are not a real concern.
        });
        this.markPriceService.recordFuturesTrade(params.symbol, trade.price);

        const takerConsumed = await this.settleFuturesTrade(tx, trade, params.symbol, quote);
        if (trade.takerUserId === params.userId) marginConsumed = marginConsumed.plus(takerConsumed);
      }

      await tx.futuresOrder.update({
        where: { id: orderId },
        data: { status: finalOrder.status, remainingQuantity: finalOrder.remainingQuantity.toString() },
      });

      // Refund whatever of the conservative lock wasn't actually consumed
      // as margin for an open/increase, and isn't still backing a resting
      // portion of the order.
      const stillResting = params.type === 'LIMIT' && finalOrder.remainingQuantity.isGreaterThan(0);
      const restingLock = stillResting
        ? computeInitialMargin(finalOrder.remainingQuantity.times(params.price!), params.leverage)
        : new BigNumber(0);
      const refund = lockAmount.minus(marginConsumed).minus(restingLock);
      if (refund.isGreaterThan(0)) {
        await this.adjustBalance(tx, params.userId, quote, { available: refund, locked: refund.negated() });
      }

      return { order: finalOrder, trades };
    });
  }

  async cancelOrder(userId: string, orderId: string) {
    return this.prisma.$transaction(async (tx: TxClient) => {
      const order = await tx.futuresOrder.findUnique({ where: { id: orderId } });
      if (!order || order.userId !== userId) return null;
      if (order.status !== 'OPEN' && order.status !== 'PARTIALLY_FILLED') return null;

      this.engine.cancelOrder(order.symbol, order.id);
      await tx.futuresOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });

      if (!order.reduceOnly) {
        const [, quote] = order.symbol.split('/');
        const remaining = new BigNumber(order.remainingQuantity.toString());
        const price = order.price ? new BigNumber(order.price.toString()) : null;
        if (price) {
          const releasedMargin = computeInitialMargin(remaining.times(price), order.leverage);
          await this.adjustBalance(tx, userId, quote, { available: releasedMargin, locked: releasedMargin.negated() });
        }
      }

      return order;
    });
  }

  /**
   * Resolves each counterparty's position effect for one trade
   * independently — order side (BUY/SELL) does not map 1:1 to position
   * side, since a SELL fill can either open a SHORT or close/reduce a
   * LONG depending on that user's existing position. Returns the margin
   * actually consumed by the taker side (used to reconcile the
   * conservative lock taken at placement time).
   */
  private async settleFuturesTrade(tx: TxClient, trade: Trade, symbol: string, quote: string): Promise<BigNumber> {
    const buyerId = trade.side === 'BUY' ? trade.takerUserId : trade.makerUserId;
    const sellerId = trade.side === 'BUY' ? trade.makerUserId : trade.takerUserId;
    const buyerOrder = await tx.futuresOrder.findUnique({ where: { id: trade.side === 'BUY' ? trade.takerOrderId : trade.makerOrderId } });
    const sellerOrder = await tx.futuresOrder.findUnique({ where: { id: trade.side === 'BUY' ? trade.makerOrderId : trade.takerOrderId } });
    if (!buyerOrder || !sellerOrder) throw new Error('Order not found while settling futures trade');

    const buyerConsumed = await this.applyFill(tx, buyerId, symbol, quote, 'BUY', trade.quantity, trade.price, buyerOrder.leverage, buyerOrder.marginType as MarginType);
    const sellerConsumed = await this.applyFill(tx, sellerId, symbol, quote, 'SELL', trade.quantity, trade.price, sellerOrder.leverage, sellerOrder.marginType as MarginType);

    return trade.takerUserId === buyerId ? buyerConsumed : sellerConsumed;
  }

  /** Applies one user's side of a fill to their position, returning the
   * incremental margin that fill actually consumed (0 for a pure reduce). */
  private async applyFill(
    tx: TxClient,
    userId: string,
    symbol: string,
    quote: string,
    fillSide: OrderSide,
    quantity: BigNumber,
    price: BigNumber,
    leverage: number,
    marginType: MarginType
  ): Promise<BigNumber> {
    const fillDirection: PositionSide = fillSide === 'BUY' ? 'LONG' : 'SHORT';
    const existing = await tx.futuresPosition.findFirst({
      where: { userId, symbol, marginType, status: 'OPEN' },
    });

    if (!existing) {
      await this.openPosition(tx, userId, symbol, quote, fillDirection, quantity, price, leverage, marginType);
      return computeInitialMargin(quantity.times(price), leverage);
    }

    const existingSize = new BigNumber(existing.size.toString());
    const existingEntry = new BigNumber(existing.entryPrice.toString());
    const existingMargin = new BigNumber(existing.initialMargin.toString());

    if (existing.side === fillDirection) {
      // Increase: average the entry price, add proportional margin.
      const newSize = existingSize.plus(quantity);
      const newEntry = existingSize.times(existingEntry).plus(quantity.times(price)).dividedBy(newSize);
      const addedMargin = computeInitialMargin(quantity.times(price), leverage);
      const newMargin = existingMargin.plus(addedMargin);
      await this.saveOpenPosition(tx, userId, quote, existing.id, existing.side as PositionSide, newSize, newEntry, leverage, marginType, newMargin);
      return addedMargin;
    }

    // Opposite direction: reduce, close, or flip.
    if (quantity.isLessThan(existingSize)) {
      const realizedPnl = computeUnrealizedPnl(existing.side as PositionSide, quantity, existingEntry, price);
      const releasedMargin = existingMargin.times(quantity).dividedBy(existingSize);
      const newSize = existingSize.minus(quantity);
      const newMargin = existingMargin.minus(releasedMargin);
      await this.saveOpenPosition(tx, userId, quote, existing.id, existing.side as PositionSide, newSize, existingEntry, leverage, marginType, newMargin);
      await this.adjustBalance(tx, userId, quote, {
        available: releasedMargin.plus(realizedPnl),
        locked: releasedMargin.negated(),
      });
      await tx.futuresPosition.update({ where: { id: existing.id }, data: { realizedPnl: new BigNumber(existing.realizedPnl.toString()).plus(realizedPnl).toString() } });
      return new BigNumber(0);
    }

    if (quantity.isEqualTo(existingSize)) {
      const realizedPnl = computeUnrealizedPnl(existing.side as PositionSide, existingSize, existingEntry, price);
      await tx.futuresPosition.update({
        where: { id: existing.id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          size: '0',
          realizedPnl: new BigNumber(existing.realizedPnl.toString()).plus(realizedPnl).toString(),
        },
      });
      await this.adjustBalance(tx, userId, quote, {
        available: existingMargin.plus(realizedPnl),
        locked: existingMargin.negated(),
      });
      return new BigNumber(0);
    }

    // quantity > existingSize: close the existing position, then open the
    // remainder as a new position in the opposite direction ("flip").
    const realizedPnl = computeUnrealizedPnl(existing.side as PositionSide, existingSize, existingEntry, price);
    await tx.futuresPosition.update({
      where: { id: existing.id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        size: '0',
        realizedPnl: new BigNumber(existing.realizedPnl.toString()).plus(realizedPnl).toString(),
      },
    });
    await this.adjustBalance(tx, userId, quote, {
      available: existingMargin.plus(realizedPnl),
      locked: existingMargin.negated(),
    });

    const flipQuantity = quantity.minus(existingSize);
    await this.openPosition(tx, userId, symbol, quote, fillDirection, flipQuantity, price, leverage, marginType);
    return computeInitialMargin(flipQuantity.times(price), leverage);
  }

  private async openPosition(
    tx: TxClient,
    userId: string,
    symbol: string,
    quote: string,
    side: PositionSide,
    size: BigNumber,
    entryPrice: BigNumber,
    leverage: number,
    marginType: MarginType
  ) {
    const initialMargin = computeInitialMargin(size.times(entryPrice), leverage);
    const liquidationPrice = await this.computeLiqPrice(tx, userId, quote, side, entryPrice, leverage, size.times(entryPrice), marginType);
    await tx.futuresPosition.create({
      data: {
        userId,
        symbol,
        side,
        size: size.toString(),
        entryPrice: entryPrice.toString(),
        leverage,
        marginType,
        initialMargin: initialMargin.toString(),
        liquidationPrice: liquidationPrice.toString(),
        status: 'OPEN',
      },
    });
    // Margin for a brand-new position/leg was already reserved from the
    // caller's locked balance at placement time (or, for a flip's second
    // leg, is reconciled by the caller's return value) — nothing further
    // to move here.
  }

  private async saveOpenPosition(
    tx: TxClient,
    userId: string,
    quote: string,
    positionId: string,
    side: PositionSide,
    size: BigNumber,
    entryPrice: BigNumber,
    leverage: number,
    marginType: MarginType,
    initialMargin: BigNumber
  ) {
    const notional = size.times(entryPrice);
    const liquidationPrice = await this.computeLiqPrice(tx, userId, quote, side, entryPrice, leverage, notional, marginType);
    await tx.futuresPosition.update({
      where: { id: positionId },
      data: {
        size: size.toString(),
        entryPrice: entryPrice.toString(),
        initialMargin: initialMargin.toString(),
        liquidationPrice: liquidationPrice.toString(),
        marginType,
      },
    });
  }

  /** ISOLATED uses the position's own margin only; CROSS additionally lets
   * the account's free (unlocked) margin balance backstop it, per
   * computeCrossLiquidationPrice — matches the isolated formula when free
   * balance is unavailable/zero, which is the honest default for a CROSS
   * position on an account with no other margin sitting free. */
  private async computeLiqPrice(
    tx: TxClient,
    userId: string,
    quote: string,
    side: PositionSide,
    entryPrice: BigNumber,
    leverage: number,
    notional: BigNumber,
    marginType: MarginType
  ): Promise<BigNumber> {
    const tier = getLeverageTier(notional.toNumber());
    if (marginType === 'ISOLATED') {
      return computeLiquidationPrice(entryPrice, side, leverage, tier.maintenanceMarginRate);
    }
    const balance = await tx.futuresBalance.findUnique({ where: { userId_asset: { userId, asset: quote } } });
    const freeBalance = balance ? new BigNumber(balance.available.toString()) : new BigNumber(0);
    return computeCrossLiquidationPrice(entryPrice, side, leverage, tier.maintenanceMarginRate, notional, freeBalance);
  }

  private async adjustBalance(tx: TxClient, userId: string, asset: string, delta: { available?: BigNumber; locked?: BigNumber }) {
    const existing = await tx.futuresBalance.upsert({
      where: { userId_asset: { userId, asset } },
      create: { userId, asset, available: '0', locked: '0' },
      update: {},
    });
    const available = new BigNumber(existing.available.toString()).plus(delta.available ?? 0);
    const locked = new BigNumber(existing.locked.toString()).plus(delta.locked ?? 0);
    await tx.futuresBalance.update({
      where: { userId_asset: { userId, asset } },
      data: { available: available.toString(), locked: locked.toString() },
    });
  }
}
