import BigNumber from 'bignumber.js';
import { Order, OrderBookLevel, OrderBookSnapshot } from './types';

/**
 * Price-time priority order book for a single trading pair.
 *
 * Bids (buy orders) are kept sorted highest price first.
 * Asks (sell orders) are kept sorted lowest price first.
 * Within the same price, orders are FIFO by arrival time (price-time priority),
 * which is the standard fairness model used by real exchanges (NASDAQ, Binance, etc).
 *
 * NOTE: this in-memory implementation is for correctness/clarity of the matching
 * ALGORITHM. A production system needs this backed by a durable, low-latency
 * store (e.g. Redis sorted sets or a custom in-memory engine with WAL persistence
 * and snapshotting) so the book survives a process restart without losing orders.
 */
export class OrderBook {
  readonly pair: string;
  private bids: Order[] = [];
  private asks: Order[] = [];

  constructor(pair: string) {
    this.pair = pair;
  }

  private insertSorted(book: Order[], order: Order, side: 'BUY' | 'SELL'): void {
    // Find insertion index maintaining price priority, then time priority (FIFO) within price.
    let i = 0;
    while (i < book.length) {
      const cmp = order.price!.comparedTo(book[i].price!) ?? 0;
      const better = side === 'BUY' ? cmp > 0 : cmp < 0;
      if (better) break;
      if (cmp === 0) {
        // same price -> goes after existing orders at this price (time priority)
        while (i < book.length && order.price!.isEqualTo(book[i].price!)) i++;
        break;
      }
      i++;
    }
    book.splice(i, 0, order);
  }

  addLimitOrder(order: Order): void {
    if (order.side === 'BUY') this.insertSorted(this.bids, order, 'BUY');
    else this.insertSorted(this.asks, order, 'SELL');
  }

  removeOrder(orderId: string): Order | null {
    for (const book of [this.bids, this.asks]) {
      const idx = book.findIndex((o) => o.id === orderId);
      if (idx !== -1) return book.splice(idx, 1)[0];
    }
    return null;
  }

  bestBid(): Order | undefined {
    return this.bids[0];
  }

  bestAsk(): Order | undefined {
    return this.asks[0];
  }

  getOppositeBook(side: 'BUY' | 'SELL'): Order[] {
    return side === 'BUY' ? this.asks : this.bids;
  }

  getBook(side: 'BUY' | 'SELL'): Order[] {
    return side === 'BUY' ? this.bids : this.asks;
  }

  /** Aggregated depth snapshot for API/UI consumption. */
  snapshot(depth = 50): OrderBookSnapshot {
    const aggregate = (orders: Order[]): OrderBookLevel[] => {
      const levels = new Map<string, OrderBookLevel>();
      for (const o of orders) {
        const key = o.price!.toString();
        const existing = levels.get(key);
        if (existing) {
          existing.quantity = existing.quantity.plus(o.remainingQuantity);
          existing.orderCount += 1;
        } else {
          levels.set(key, {
            price: o.price!,
            quantity: new BigNumber(o.remainingQuantity),
            orderCount: 1,
          });
        }
      }
      return Array.from(levels.values()).slice(0, depth);
    };

    return {
      pair: this.pair,
      bids: aggregate(this.bids),
      asks: aggregate(this.asks),
      timestamp: Date.now(),
    };
  }
}
