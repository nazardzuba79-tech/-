import BigNumber from 'bignumber.js';
import { MatchingEngine } from '../../matching-engine/MatchingEngine';
import { recoverOrderBook } from '../OrderBookRecovery';

function dbOrderRow(overrides: Partial<any>) {
  return {
    id: 'id',
    userId: 'user',
    pair: 'BTC/USDT',
    side: 'BUY',
    type: 'LIMIT',
    price: { toString: () => '100' },
    originalQuantity: { toString: () => '1' },
    remainingQuantity: { toString: () => '1' },
    status: 'OPEN',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('recoverOrderBook', () => {
  it('reloads OPEN and PARTIALLY_FILLED orders into the engine with correct time priority', async () => {
    const rows = [
      dbOrderRow({ id: 'first', userId: 'alice', createdAt: new Date('2026-01-01T00:00:00Z') }),
      dbOrderRow({ id: 'second', userId: 'bob', createdAt: new Date('2026-01-01T00:01:00Z') }),
    ];
    const prisma = { order: { findMany: jest.fn().mockResolvedValue(rows) } } as any;
    const engine = new MatchingEngine();

    const count = await recoverOrderBook(prisma, engine);

    expect(count).toBe(2);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['OPEN', 'PARTIALLY_FILLED'] } },
        orderBy: { createdAt: 'asc' },
      })
    );

    // Both resting buy orders sit at the book, at the same price — the
    // earlier-loaded one ('first'/alice) must have time priority. Sending a
    // crossing sell should match it first.
    const result = engine.submitOrder({
      id: 'incoming-sell',
      userId: 'taker',
      pair: 'BTC/USDT',
      side: 'SELL',
      type: 'LIMIT',
      price: new BigNumber(100),
      originalQuantity: new BigNumber(1),
      remainingQuantity: new BigNumber(1),
      status: 'OPEN',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].makerUserId).toBe('alice');
  });

  it('does not load CANCELLED or FILLED orders', async () => {
    const prisma = { order: { findMany: jest.fn().mockResolvedValue([]) } } as any;
    const engine = new MatchingEngine();

    await recoverOrderBook(prisma, engine);

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ['OPEN', 'PARTIALLY_FILLED'] } } })
    );
    expect(engine.getBook('BTC/USDT').snapshot().bids).toHaveLength(0);
  });
});
