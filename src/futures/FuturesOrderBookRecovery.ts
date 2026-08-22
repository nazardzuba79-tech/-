import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { MatchingEngine } from '../matching-engine/MatchingEngine';
import { Order } from '../matching-engine/types';

/** Same reasoning as spot's OrderBookRecovery — the futures matching
 * engine's book only lives in process memory, so every restart needs
 * every still-resting futures order reloaded before the server accepts
 * requests, or a resting limit order would look OPEN in the database
 * while being invisible/unmatchable in the live book. */
export async function recoverFuturesOrderBook(prisma: PrismaClient, engine: MatchingEngine): Promise<number> {
  const restingOrders = await prisma.futuresOrder.findMany({
    where: { status: { in: ['OPEN', 'PARTIALLY_FILLED'] } },
    orderBy: { createdAt: 'asc' },
  });

  for (const row of restingOrders) {
    const order: Order = {
      id: row.id,
      userId: row.userId,
      pair: row.symbol,
      side: row.side as Order['side'],
      type: row.type as Order['type'],
      price: row.price ? new BigNumber(row.price.toString()) : null,
      originalQuantity: new BigNumber(row.originalQuantity.toString()),
      remainingQuantity: new BigNumber(row.remainingQuantity.toString()),
      status: row.status as Order['status'],
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
    engine.loadRestingOrder(order);
  }

  return restingOrders.length;
}
