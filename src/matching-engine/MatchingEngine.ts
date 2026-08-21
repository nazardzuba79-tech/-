import { v4 as uuidv4 } from 'uuid';
import BigNumber from 'bignumber.js';
import { OrderBook } from './OrderBook';
import { Order, Trade, OrderSide } from './types';

export interface MatchResult {
  order: Order; // the incoming (taker) order, updated
  trades: Trade[];
}

/**
 * Matches incoming orders against resting orders in the book.
 *
 * This class is intentionally pure / side-effect-free w.r.t. persistence:
 * it returns the trades that happened and the updated order state. The caller
 * (OrderService) is responsible for:
 *   1. Wrapping this in a DB transaction
 *   2. Persisting trades + updated orders atomically
 *   3. Updating user balances (locking funds BEFORE calling match, releasing/
 *      transferring AFTER, inside the same transaction)
 *   4. Publishing trade events (websocket, kafka, etc.)
 *
 * CRITICAL INVARIANT: funds must be locked (reserved) at order placement time,
 * not at match time. Otherwise a user can place multiple orders spending the
 * same balance twice ("double spend" at the app layer) before any of them fill.
 */
export class MatchingEngine {
  private books = new Map<string, OrderBook>();

  private getOrCreateBook(pair: string): OrderBook {
    let book = this.books.get(pair);
    if (!book) {
      book = new OrderBook(pair);
      this.books.set(pair, book);
    }
    return book;
  }

  getBook(pair: string): OrderBook {
    return this.getOrCreateBook(pair);
  }

  /**
   * Submits an order for matching. Returns resulting trades and the order's
   * final state (OPEN / PARTIALLY_FILLED / FILLED). If a LIMIT order isn't
   * fully filled, its remainder is added to the book.
   */
  submitOrder(order: Order): MatchResult {
    const book = this.getOrCreateBook(order.pair);
    const trades: Trade[] = [];
    const opposite = book.getOppositeBook(order.side);

    while (order.remainingQuantity.isGreaterThan(0) && opposite.length > 0) {
      const maker = opposite[0];
      const priceCrosses = this.pricesCross(order, maker);
      if (!priceCrosses) break;

      const tradeQty = BigNumber.minimum(order.remainingQuantity, maker.remainingQuantity);
      const tradePrice = maker.price!; // maker's price is always the execution price

      const trade: Trade = {
        id: uuidv4(),
        pair: order.pair,
        takerOrderId: order.id,
        makerOrderId: maker.id,
        takerUserId: order.userId,
        makerUserId: maker.userId,
        price: tradePrice,
        quantity: tradeQty,
        side: order.side,
        executedAt: Date.now(),
      };
      trades.push(trade);

      order.remainingQuantity = order.remainingQuantity.minus(tradeQty);
      maker.remainingQuantity = maker.remainingQuantity.minus(tradeQty);
      maker.updatedAt = Date.now();

      if (maker.remainingQuantity.isZero()) {
        maker.status = 'FILLED';
        opposite.shift(); // fully consumed, remove from book
      } else {
        maker.status = 'PARTIALLY_FILLED';
      }
    }

    order.status = order.remainingQuantity.isZero()
      ? 'FILLED'
      : order.remainingQuantity.isLessThan(order.originalQuantity)
      ? 'PARTIALLY_FILLED'
      : 'OPEN';
    order.updatedAt = Date.now();

    // MARKET orders never rest on the book; unfilled remainder is cancelled.
    if (order.type === 'MARKET') {
      if (order.status !== 'FILLED') order.status = 'CANCELLED';
      return { order, trades };
    }

    // LIMIT order: rest any remainder on the book.
    if (order.remainingQuantity.isGreaterThan(0)) {
      book.addLimitOrder(order);
    }

    return { order, trades };
  }

  cancelOrder(pair: string, orderId: string): Order | null {
    return this.getOrCreateBook(pair).removeOrder(orderId);
  }

  /**
   * Inserts an order directly into the book WITHOUT running it through
   * matching. Used only at server startup to restore resting (OPEN /
   * PARTIALLY_FILLED) orders from the database — these orders already
   * didn't match against each other while the process was running, so
   * re-matching them would be wrong (and could cross orders that were
   * deliberately left unmatched, e.g. two orders from the same user).
   * Callers MUST load orders in ascending createdAt order to preserve
   * correct time priority within each price level.
   */
  loadRestingOrder(order: Order): void {
    this.getOrCreateBook(order.pair).addLimitOrder(order);
  }

  private pricesCross(taker: Order, maker: Order): boolean {
    if (taker.type === 'MARKET') return true;
    if (taker.side === 'BUY') return taker.price!.isGreaterThanOrEqualTo(maker.price!);
    return taker.price!.isLessThanOrEqualTo(maker.price!);
  }
}
