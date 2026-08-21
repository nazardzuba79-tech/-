import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { MatchingEngine } from '../matching-engine/MatchingEngine';
import { Order } from '../matching-engine/types';

/**
 * The matching engine keeps the live order book in process memory for
 * speed. The database is the source of truth for which orders exist and
 * their status, but NOT for the book's internal price/time ordering — that
 * only lives in memory while the process runs.
 *
 * This means every server restart (deploy, crash, reboot) wipes the live
 * book clean. Call `recoverOrderBook` once, right after the MatchingEngine
 * is constructed and BEFORE the HTTP server starts accepting requests, to
 * reload every still-open order back into memory in the correct order.
 *
 * Without this, a restart silently drops all resting orders from the
 * matching engine — they'd still show as OPEN in the database, but nobody
 * could ever trade against them again. That's a correctness bug, not just
 * an inconvenience: a user's limit order would look alive but be dead.
 */
export async function recoverOrderBook(prisma: PrismaClient, engine: MatchingEngine): Promise<number> {
  // Ascending createdAt is required: the engine assigns time priority in
  // load order, so loading newest-first would silently invert fairness
  // between orders resting at the same price.
  const restingOrders = await prisma.order.findMany({
    where: { status: { in: ['OPEN', 'PARTIALLY_FILLED'] } },
    orderBy: { createdAt: 'asc' },
  });

  for (const row of restingOrders) {
    const order: Order = {
      id: row.id,
      userId: row.userId,
      pair: row.pair,
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
