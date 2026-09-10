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
  getLeverageTier,
} from '../config/futuresConfig';
import { projectFuturesExposure } from './exposureRisk';
import { FuturesBookTransaction } from './FuturesBookTransaction';
import { estimateFuturesMarketExecution } from './FuturesMarketExecution';

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

    const result = await FuturesBookTransaction.run(this.prisma, this.engine, async (tx: TxClient) => {
      const session = await FuturesBookTransaction.load(tx, params.symbol);

      // Serialize exposure reads and order creation for this exact risk
      // bucket across requests and application instances. Without this,
      // simultaneous split orders could both observe the same pre-order
      // snapshot before either OPEN row became visible.
      const riskLockKey = `futures-exposure:${params.userId}:${params.symbol}:${params.marginType}`;
      await tx.$queryRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${riskLockKey}, 0))::text AS locked`
      );

      const user = await tx.user.findUnique({ where: { id: params.userId } });
      if (!user) throw new Error('User not found');

      const existingPosition = await tx.futuresPosition.findFirst({
        where: { userId: params.userId, symbol: params.symbol, marginType: params.marginType, status: 'OPEN' },
      });
      const impliedDirection: PositionSide = params.side === 'BUY' ? 'LONG' : 'SHORT';
      // MARKET must be fully executable before tier checks, order creation or
      // margin writes. Keep exact per-level legs: a VWAP would understate an
      // expensive flip remainder when the earlier fills close the old position.
      const market = params.type === 'MARKET' ? await estimateFuturesMarketExecution(tx, session, params) : null;
      const executionLegs = market
        ? market.legs.map(leg => ({ side: params.side, remainingQuantity: leg.quantity, price: leg.price, leverage: params.leverage }))
        : [{ side: params.side, remainingQuantity: params.quantity, price: params.price!, leverage: params.leverage }];
      const estimatedNotional = market ? market.notional : params.quantity.times(params.price!);

      if (params.reduceOnly) {
        const opposingSize =
          existingPosition && existingPosition.side !== impliedDirection
            ? new BigNumber(existingPosition.size.toString())
            : new BigNumber(0);
        if (params.quantity.isGreaterThan(opposingSize)) {
          throw new Error('reduceOnly order would exceed the current position size');
        }
      } else {
        const activeOrders = await tx.futuresOrder.findMany({
          where: {
            userId: params.userId,
            symbol: params.symbol,
            marginType: params.marginType,
            status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
            reduceOnly: false,
          },
        });
        const projected = projectFuturesExposure({
          position: existingPosition
            ? {
                side: existingPosition.side as PositionSide,
                size: new BigNumber(existingPosition.size.toString()),
                entryPrice: new BigNumber(existingPosition.entryPrice.toString()),
                leverage: existingPosition.leverage,
              }
            : null,
          activeOrders: [...activeOrders.map((order) => {
            if (!order.price) {
              throw new Error('Cannot determine exposure for an active futures market order');
            }
            return {
              side: order.side as OrderSide,
              remainingQuantity: new BigNumber(order.remainingQuantity.toString()),
              price: new BigNumber(order.price.toString()),
              leverage: order.leverage,
            };
          }), ...executionLegs.slice(1)],
          candidate: executionLegs[0],
        });
        if (projected.notional.isGreaterThan(0)) {
          const tier = getLeverageTier(projected.notional.toNumber());
          if (projected.maxContributingLeverage > tier.maxLeverage) {
            throw new Error(
              `Max leverage for a ${projected.notional.toFixed(2)} ${quote} resulting exposure is ${tier.maxLeverage}x`
            );
          }
        }

        // There is no full-position re-margin operation: every increase
        // must use the leverage already backing this position. Validate
        // under the same risk lock, before reserving margin or writing orders.
        if (existingPosition?.side === impliedDirection && existingPosition.leverage !== params.leverage) {
          throw new Error(`Increasing this position requires ${existingPosition.leverage}x leverage`);
        }
        // A non-reduce-only resting order can become an increase after
        // other fills close/flip the position. Do not net it away merely
        // because it currently appears to reduce the opposite position.
        const incompatibleOrder = activeOrders.find((order) =>
          order.side === params.side
          && new BigNumber(order.remainingQuantity.toString()).isGreaterThan(0)
          && order.leverage !== params.leverage
        );
        if (incompatibleOrder) {
          throw new Error(`Pending ${params.side} orders require ${incompatibleOrder.leverage}x leverage; cancel them before changing leverage`);
        }
      }

      // Conservative margin lock: full estimated notional at this leverage.
      // reduceOnly orders never need new margin — they can only shrink an
      // existing position, which frees margin rather than consuming it.
      const lockAmount = params.reduceOnly ? new BigNumber(0)
        : market ? market.reservedMargin : computeInitialMargin(estimatedNotional, params.leverage);
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
      // Durable FIFO even for admissions within the same millisecond. Legacy
      // timestamp ties use the same id tie-break in staging and startup recovery.
      let createdAt = Date.now();
      for (const row of session.rows.values()) createdAt = Math.max(createdAt, row.createdAt.getTime() + 1);
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
        createdAt,
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
          createdAt: new Date(createdAt),
        },
      });

      let { trades, marginConsumed } = await this.matchAndSettle(tx, session, order, {
        leverage: params.leverage, marginType: params.marginType, reduceOnly: !!params.reduceOnly,
      }, quote);
      const finalOrder = order;
      if (market) {
        if (!finalOrder.remainingQuantity.isZero() || trades.length !== market.legs.length
          || trades.some((trade, index) => trade.makerOrderId !== market.legs[index].makerOrderId
            || !trade.quantity.eq(market.legs[index].quantity) || !trade.price.eq(market.legs[index].price))) {
          throw new Error('Market execution changed after estimation; order aborted');
        }
        // Reconcile to persisted (18-decimal) allocation, not a sum of unrounded
        // intermediate margins. A reduction consumes no new margin; a flip
        // consumes only the new remainder's margin. LIMIT reconciliation is unchanged.
        const resultingPosition = await tx.futuresPosition.findFirst({
          where: { userId: params.userId, symbol: params.symbol, marginType: params.marginType, status: 'OPEN' },
        });
        marginConsumed = resultingPosition?.side === impliedDirection
          ? new BigNumber(resultingPosition.initialMargin.toString()).minus(
              existingPosition?.side === impliedDirection ? existingPosition.initialMargin.toString() : 0)
          : new BigNumber(0);
        if (marginConsumed.isGreaterThan(lockAmount)) throw new Error('Market execution exceeds reserved margin; order aborted');
      }

      await tx.futuresOrder.update({
        where: { id: orderId },
        data: { status: finalOrder.status, remainingQuantity: finalOrder.remainingQuantity.toString() },
      });

      // Refund whatever of the conservative lock wasn't actually consumed
      // as margin for an open/increase, and isn't still backing a resting
      // portion of the order.
      const stillResting = params.type === 'LIMIT' && finalOrder.status !== 'CANCELLED' && finalOrder.remainingQuantity.isGreaterThan(0);
      const restingLock = stillResting && !params.reduceOnly
        ? computeInitialMargin(finalOrder.remainingQuantity.times(params.price!), params.leverage)
        : new BigNumber(0);
      const refund = lockAmount.minus(marginConsumed).minus(restingLock);
      if (refund.isGreaterThan(0)) {
        await this.adjustBalance(tx, params.userId, quote, { available: refund, locked: refund.negated() });
      }

      return { session, result: { order: finalOrder, trades } };
    });
    // No uncommitted/rolled-back trade may influence mark prices.
    for (const trade of result.trades) this.markPriceService.recordFuturesTrade(params.symbol, trade.price);
    return result;
  }

  async cancelOrder(userId: string, orderId: string) {
    return FuturesBookTransaction.run(this.prisma, this.engine, async (tx: TxClient) => {
      const order = await tx.futuresOrder.findUnique({ where: { id: orderId } });
      if (!order || order.userId !== userId) return { result: null };
      if (order.status !== 'OPEN' && order.status !== 'PARTIALLY_FILLED') return { result: null };

      const session = await FuturesBookTransaction.load(tx, order.symbol);
      await this.cancelRestingOrderWithin(tx, session, order);

      return { session, result: { ...order, status: 'CANCELLED' } };
    });
  }

  /**
   * Run `work` inside the futures-book transaction — the same advisory lock,
   * the same commit verification, the same synchronous book publication that
   * every placement and cancellation already goes through.
   *
   * It exists so a caller that must be ATOMIC with order cancellation
   * (`FuturesProtectionService`, when a trigger wins its claim) does not need
   * its own `MatchingEngine` reference, and cannot accidentally open a second,
   * nested `FuturesBookTransaction` — which would deadlock on this class's own
   * per-engine queue rather than in PostgreSQL, and be that much harder to see.
   *
   * The caller must therefore NOT be inside one already.
   */
  async withFuturesBook<T>(
    work: (tx: TxClient) => Promise<{ session?: FuturesBookTransaction; result: T }>
  ): Promise<T> {
    return FuturesBookTransaction.run(this.prisma, this.engine, work);
  }

  /**
   * Cancel one resting order using a transaction and staged book the CALLER
   * owns — extracted verbatim out of `cancelOrder` rather than written twice,
   * so the cancellation and its margin release have exactly one implementation
   * in this service. Not a new formula: `computeInitialMargin(remaining ×
   * price)` at the order's own leverage is the same reserve placement took,
   * returned once.
   *
   * `reduceOnly` orders reserved no margin, so they release none — the guard
   * is kept here rather than at the call sites so no caller has to remember it.
   */
  async cancelRestingOrderWithin(
    tx: TxClient,
    session: FuturesBookTransaction,
    order: {
      id: string;
      userId: string;
      symbol: string;
      reduceOnly: boolean;
      leverage: number;
      remainingQuantity: { toString(): string };
      price: { toString(): string } | null;
    }
  ): Promise<void> {
    session.staged.cancelOrder(order.symbol, order.id);
    await tx.futuresOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });

    if (!order.reduceOnly) {
      const [, quote] = order.symbol.split('/');
      const remaining = new BigNumber(order.remainingQuantity.toString());
      const price = order.price ? new BigNumber(order.price.toString()) : null;
      if (price) {
        const releasedMargin = computeInitialMargin(remaining.times(price), order.leverage);
        await this.adjustBalance(tx, order.userId, quote, { available: releasedMargin, locked: releasedMargin.negated() });
      }
    }
  }

  /**
   * Cancel every resting ENTRY order in one risk bucket, inside a transaction
   * that already holds the futures-book lock.
   *
   * THE DEFECT THIS EXISTS FOR. A TP/SL trigger closes the position it
   * protects — but a non-reduce-only order of the same user resting in the
   * same `(userId, symbol, marginType)` bucket was left alive, and filling
   * later re-opened the very exposure the stop had just closed, with no
   * protection on it at all. The trigger and these cancellations have to be
   * one atomic step, or the gap between them is the bug.
   *
   * `reduceOnly` orders are deliberately NOT cancelled: they can only shrink
   * an existing opposing position, so they can never re-open exposure, and
   * the execution path already retires the ones that lose their capacity.
   *
   * The staged session is returned so the caller publishes the book with these
   * orders gone, exactly as `cancelOrder` does — it is only loaded when there
   * is something to cancel, so the common case costs one indexed query.
   */
  async cancelBucketEntryOrdersWithin(
    tx: TxClient,
    bucket: { userId: string; symbol: string; marginType: string }
  ): Promise<{ session?: FuturesBookTransaction; cancelledOrderIds: string[] }> {
    const resting = await tx.futuresOrder.findMany({
      where: {
        userId: bucket.userId,
        symbol: bucket.symbol,
        marginType: bucket.marginType,
        reduceOnly: false,
        status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (resting.length === 0) return { cancelledOrderIds: [] };

    const session = await FuturesBookTransaction.load(tx, bucket.symbol);
    for (const order of resting) await this.cancelRestingOrderWithin(tx, session, order);
    return { session, cancelledOrderIds: resting.map((order) => order.id) };
  }

  /** Current transactional capacity, re-read between every fill on BOTH sides. */
  private async reducibleQuantity(tx: TxClient, order: Order, marginType: MarginType) {
    const position = await tx.futuresPosition.findFirst({
      where: { userId: order.userId, symbol: order.pair, marginType, status: 'OPEN' },
    });
    const direction = order.side === 'BUY' ? 'LONG' : 'SHORT';
    return position && position.side !== direction
      ? new BigNumber(position.size.toString()) : new BigNumber(0);
  }

  private async matchAndSettle(tx: TxClient, session: FuturesBookTransaction, taker: Order,
    terms: { leverage: number; marginType: MarginType; reduceOnly: boolean }, quote: string) {
    const book = session.staged.getBook(taker.pair);
    const trades: Trade[] = [];
    let marginConsumed = new BigNumber(0);
    while (taker.remainingQuantity.isGreaterThan(0)) {
      const takerCap = terms.reduceOnly
        ? await this.reducibleQuantity(tx, taker, terms.marginType) : taker.remainingQuantity;
      if (takerCap.isZero()) { taker.status = 'CANCELLED'; break; }
      const maker = book.getOppositeBook(taker.side)[0];
      if (!maker) break;
      if (taker.type === 'LIMIT' && (taker.side === 'BUY'
        ? taker.price!.isLessThan(maker.price!) : taker.price!.isGreaterThan(maker.price!))) break;
      const makerTerms = session.rows.get(maker.id)!;
      const makerCap = makerTerms.reduceOnly
        ? await this.reducibleQuantity(tx, maker, makerTerms.marginType as MarginType) : maker.remainingQuantity;
      if (makerCap.isZero()) {
        await this.cancelReduceOnlyRemainder(tx, session, maker);
        continue;
      }
      // Two legs for the same user could invalidate the second leg's capacity
      // within one trade. Refuse self-matches atomically, without a trade print.
      if (maker.userId === taker.userId) throw new Error('Futures self-match is not allowed');
      const quantity = BigNumber.minimum(taker.remainingQuantity, maker.remainingQuantity, takerCap, makerCap);
      // Reuse the unchanged matching algorithm for exactly the executable
      // quantity, in an isolated book. Never generate then truncate a trade.
      const match = new MatchingEngine();
      match.loadRestingOrder({ ...maker, originalQuantity: quantity, remainingQuantity: quantity });
      const { trades: fills } = match.submitOrder({ ...taker, originalQuantity: quantity, remainingQuantity: quantity });
      const trade = fills[0];
      if (!trade || fills.length !== 1) throw new Error('Invalid staged Futures match');
      const consumed = await this.settleFuturesTrade(tx, trade, taker.pair, quote);
      // A persistence failure aborts the whole transaction and discards staging.
      await tx.trade.create({ data: {
        id: trade.id, pair: trade.pair, takerOrderId: trade.takerOrderId, makerOrderId: trade.makerOrderId,
        takerUserId: trade.takerUserId, makerUserId: trade.makerUserId,
        price: trade.price.toString(), quantity: trade.quantity.toString(), side: trade.side,
      } });
      marginConsumed = marginConsumed.plus(consumed);
      trades.push(trade);
      taker.remainingQuantity = taker.remainingQuantity.minus(quantity);
      maker.remainingQuantity = maker.remainingQuantity.minus(quantity);
      maker.status = maker.remainingQuantity.isZero() ? 'FILLED' : 'PARTIALLY_FILLED';
      maker.updatedAt = Date.now();
      if (maker.remainingQuantity.isZero()) session.staged.cancelOrder(taker.pair, maker.id);
      await tx.futuresOrder.update({ where: { id: maker.id }, data: {
        status: maker.status, remainingQuantity: maker.remainingQuantity.toString(),
      } });
    }
    if (taker.status !== 'CANCELLED') {
      taker.status = taker.remainingQuantity.isZero() ? 'FILLED'
        : taker.remainingQuantity.isLessThan(taker.originalQuantity) ? 'PARTIALLY_FILLED' : 'OPEN';
      if (taker.remainingQuantity.isGreaterThan(0)) {
        const capacity = terms.reduceOnly ? await this.reducibleQuantity(tx, taker, terms.marginType) : taker.remainingQuantity;
        if (taker.type === 'MARKET' || taker.remainingQuantity.isGreaterThan(capacity)) taker.status = 'CANCELLED';
        else session.staged.loadRestingOrder(taker);
      }
    }
    taker.updatedAt = Date.now();
    // Cancel stale reduce-only remainders, including siblings not reached by
    // this taker. Keep their unfilled quantity for audit; CANCELLED never rests.
    for (const side of ['BUY', 'SELL'] as const) {
      for (const order of [...book.getBook(side)]) {
        const row = session.rows.get(order.id);
        if (!row?.reduceOnly) continue;
        const capacity = await this.reducibleQuantity(tx, order, row.marginType as MarginType);
        if (order.remainingQuantity.isGreaterThan(capacity)) await this.cancelReduceOnlyRemainder(tx, session, order);
      }
    }
    return { trades, marginConsumed };
  }

  private async cancelReduceOnlyRemainder(tx: TxClient, session: FuturesBookTransaction, order: Order) {
    order.status = 'CANCELLED';
    order.updatedAt = Date.now();
    session.staged.cancelOrder(order.pair, order.id);
    await tx.futuresOrder.update({ where: { id: order.id }, data: {
      status: 'CANCELLED', remainingQuantity: order.remainingQuantity.toString(),
    } });
    // Reduce-only placement reserved no margin, so cancellation releases none.
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

    const buyerConsumed = await this.applyFill(tx, buyerId, symbol, quote, 'BUY', trade.quantity, trade.price, buyerOrder.leverage, buyerOrder.marginType as MarginType, buyerOrder.reduceOnly);
    const sellerConsumed = await this.applyFill(tx, sellerId, symbol, quote, 'SELL', trade.quantity, trade.price, sellerOrder.leverage, sellerOrder.marginType as MarginType, sellerOrder.reduceOnly);

    const makerOrder = trade.side === 'BUY' ? sellerOrder : buyerOrder;
    const makerConsumed = trade.side === 'BUY' ? sellerConsumed : buyerConsumed;
    if (!makerOrder.reduceOnly) {
      const reserved = computeInitialMargin(trade.quantity.times(trade.price), makerOrder.leverage);
      const refund = reserved.minus(makerConsumed);
      if (refund.isGreaterThan(0)) await this.adjustBalance(tx, makerOrder.userId, quote, { available: refund, locked: refund.negated() });
    }

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
    marginType: MarginType,
    reduceOnly = false
  ): Promise<BigNumber> {
    const fillDirection: PositionSide = fillSide === 'BUY' ? 'LONG' : 'SHORT';
    const existing = await tx.futuresPosition.findFirst({
      where: { userId, symbol, marginType, status: 'OPEN' },
    });

    if (reduceOnly && (!existing || existing.side === fillDirection
      || quantity.isGreaterThan(new BigNumber(existing.size.toString())))) {
      throw new Error('reduceOnly fill exceeds the current opposing position');
    }

    if (!existing) {
      await this.openPosition(tx, userId, symbol, quote, fillDirection, quantity, price, leverage, marginType);
      return computeInitialMargin(quantity.times(price), leverage);
    }

    const existingSize = new BigNumber(existing.size.toString());
    const existingEntry = new BigNumber(existing.entryPrice.toString());
    const existingMargin = new BigNumber(existing.initialMargin.toString());

    if (existing.side === fillDirection) {
      // Defensive invariant for resting orders as well as incoming orders.
      // Never reinterpret a fill's reserved margin at another leverage.
      if (leverage !== existing.leverage) {
        throw new Error(`Increasing this position requires ${existing.leverage}x leverage`);
      }
      // Increase: average the entry price, add proportional margin.
      const newSize = existingSize.plus(quantity);
      const newEntry = existingSize.times(existingEntry).plus(quantity.times(price)).dividedBy(newSize);
      const addedMargin = computeInitialMargin(quantity.times(price), leverage);
      const newMargin = existingMargin.plus(addedMargin);
      await this.saveOpenPosition(tx, userId, quote, existing, newSize, newEntry, marginType, newMargin);
      return addedMargin;
    }

    // Opposite direction: reduce, close, or flip.
    if (quantity.isLessThan(existingSize)) {
      const realizedPnl = computeUnrealizedPnl(existing.side as PositionSide, quantity, existingEntry, price);
      const releasedMargin = existingMargin.times(quantity).dividedBy(existingSize);
      const newSize = existingSize.minus(quantity);
      const newMargin = existingMargin.minus(releasedMargin);
      await this.saveOpenPosition(tx, userId, quote, existing, newSize, existingEntry, marginType, newMargin);
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
    existing: { id: string; side: string; leverage: number },
    size: BigNumber,
    entryPrice: BigNumber,
    marginType: MarginType,
    initialMargin: BigNumber
  ) {
    const notional = size.times(entryPrice);
    // Existing positions own their leverage; an order cannot supply a
    // different value to the remaining position's liquidation calculation.
    const liquidationPrice = await this.computeLiqPrice(tx, userId, quote, existing.side as PositionSide, entryPrice, existing.leverage, notional, marginType);
    await tx.futuresPosition.update({
      where: { id: existing.id },
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
