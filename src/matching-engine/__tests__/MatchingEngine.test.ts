import BigNumber from 'bignumber.js';
import { MatchingEngine } from '../MatchingEngine';
import { Order } from '../types';

function makeOrder(partial: Partial<Order>): Order {
  return {
    id: partial.id ?? Math.random().toString(36),
    userId: partial.userId ?? 'user',
    pair: 'BTC/USDT',
    side: partial.side!,
    type: partial.type ?? 'LIMIT',
    price: partial.price ?? null,
    originalQuantity: partial.originalQuantity!,
    remainingQuantity: partial.originalQuantity!,
    status: 'OPEN',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...partial,
  };
}

describe('MatchingEngine', () => {
  it('matches a crossing limit order fully at the maker price', () => {
    const engine = new MatchingEngine();
    const sell = makeOrder({
      id: 'sell1', userId: 'maker', side: 'SELL',
      price: new BigNumber(50000), originalQuantity: new BigNumber(1),
    });
    engine.submitOrder(sell);

    const buy = makeOrder({
      id: 'buy1', userId: 'taker', side: 'BUY',
      price: new BigNumber(50500), originalQuantity: new BigNumber(1),
    });
    const result = engine.submitOrder(buy);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].price.toString()).toBe('50000'); // executes at MAKER price
    expect(result.order.status).toBe('FILLED');
  });

  it('partially fills and rests the remainder on the book with time priority', () => {
    const engine = new MatchingEngine();
    engine.submitOrder(makeOrder({
      id: 's1', userId: 'm1', side: 'SELL', price: new BigNumber(100), originalQuantity: new BigNumber(2),
    }));

    const buy = makeOrder({
      id: 'b1', userId: 'taker', side: 'BUY', price: new BigNumber(100), originalQuantity: new BigNumber(5),
    });
    const result = engine.submitOrder(buy);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].quantity.toString()).toBe('2');
    expect(result.order.status).toBe('PARTIALLY_FILLED');
    expect(result.order.remainingQuantity.toString()).toBe('3');

    const snapshot = engine.getBook('BTC/USDT').snapshot();
    expect(snapshot.bids[0].quantity.toString()).toBe('3');
  });

  it('respects price-time priority: earlier order at same price fills first', () => {
    const engine = new MatchingEngine();
    engine.submitOrder(makeOrder({ id: 's1', userId: 'first', side: 'SELL', price: new BigNumber(100), originalQuantity: new BigNumber(1) }));
    engine.submitOrder(makeOrder({ id: 's2', userId: 'second', side: 'SELL', price: new BigNumber(100), originalQuantity: new BigNumber(1) }));

    const result = engine.submitOrder(makeOrder({ id: 'b1', userId: 'taker', side: 'BUY', price: new BigNumber(100), originalQuantity: new BigNumber(1) }));

    expect(result.trades[0].makerUserId).toBe('first'); // FIFO within same price level
  });

  it('does not match non-crossing prices', () => {
    const engine = new MatchingEngine();
    engine.submitOrder(makeOrder({ id: 's1', userId: 'm', side: 'SELL', price: new BigNumber(200), originalQuantity: new BigNumber(1) }));
    const result = engine.submitOrder(makeOrder({ id: 'b1', userId: 't', side: 'BUY', price: new BigNumber(100), originalQuantity: new BigNumber(1) }));

    expect(result.trades).toHaveLength(0);
    expect(result.order.status).toBe('OPEN');
  });

  it('market orders never rest on the book', () => {
    const engine = new MatchingEngine();
    const result = engine.submitOrder(makeOrder({ id: 'm1', userId: 't', side: 'BUY', type: 'MARKET', originalQuantity: new BigNumber(1) }));
    expect(result.order.status).toBe('CANCELLED'); // nothing to match against
    expect(engine.getBook('BTC/USDT').snapshot().bids).toHaveLength(0);
  });
});
