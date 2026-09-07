import { FuturesOrder, Prisma, PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { MatchingEngine } from '../matching-engine/MatchingEngine';
import { Order } from '../matching-engine/types';

// Shared by service instances using the same Futures engine. Never hold a
// mutable live-book reference across an await, including the database COMMIT.
const queues = new WeakMap<MatchingEngine, Promise<void>>();

export class FuturesBookTransaction {
  readonly staged = new MatchingEngine();
  readonly rows = new Map<string, FuturesOrder>();

  private constructor(readonly symbol: string) {}

  static async load(tx: Prisma.TransactionClient, symbol: string) {
    const session = new FuturesBookTransaction(symbol);
    const rows = await tx.futuresOrder.findMany({
      where: { symbol, status: { in: ['OPEN', 'PARTIALLY_FILLED'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const row of rows) {
      if (row.type !== 'LIMIT' || !row.price || !new BigNumber(row.remainingQuantity.toString()).isGreaterThan(0)) {
        throw new Error(`Invalid active Futures order ${row.id}; reconcile before trading`);
      }
      session.rows.set(row.id, row);
      session.staged.loadRestingOrder({
        id: row.id, userId: row.userId, pair: row.symbol,
        side: row.side as Order['side'], type: 'LIMIT',
        price: new BigNumber(row.price.toString()),
        originalQuantity: new BigNumber(row.originalQuantity.toString()),
        remainingQuantity: new BigNumber(row.remainingQuantity.toString()),
        status: row.status as Order['status'],
        createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime(),
      });
    }
    return session;
  }

  private publish(engine: MatchingEngine) {
    // Synchronous publication only after COMMIT. There are no database calls,
    // matching, validation, events or user callbacks in this critical section.
    const live = engine.getBook(this.symbol);
    const staged = this.staged.getBook(this.symbol);
    for (const side of ['BUY', 'SELL'] as const) {
      const target = live.getBook(side);
      target.length = 0;
      for (const order of staged.getBook(side)) target.push(order);
    }
  }

  static async run<T>(prisma: PrismaClient, engine: MatchingEngine,
    work: (tx: Prisma.TransactionClient) => Promise<{ session?: FuturesBookTransaction; result: T }>): Promise<T> {
    const previous = queues.get(engine) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    queues.set(engine, next);
    await previous;
    try {
      let transactionId: string | undefined;
      let prepared: { session?: FuturesBookTransaction; result: T } | undefined;
      let commitError: unknown;
      try {
        await prisma.$transaction(async tx => {
          // All Futures placements/cancellations share the database lock, including
          // both counterparties and cross-symbol balances. The existing per-risk-
          // bucket lock remains in placeOrder as well. Rebuild from committed DB
          // rows, never a possibly stale process-local book from another instance.
          await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended('futures-book', 0))::text AS locked`);
          const result = await work(tx);
          const [identity] = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT pg_current_xact_id()::text AS id`);
          transactionId = identity.id;
          prepared = result;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10000, timeout: 30000 });
      } catch (error) {
        if (!transactionId) throw error; // callback never completed; no COMMIT attempted
        commitError = error;
      }
      // Verify the actual PostgreSQL commit record, not only the driver's
      // promise. Prisma 5 can resolve COMMIT after a deferred SQL constraint
      // aborted it (covered on native PostgreSQL, not just a mocked client).
      // This also resolves a lost COMMIT acknowledgement without replaying fills.
      const [outcome] = await prisma.$queryRaw<{ status: string | null }[]>(
        Prisma.sql`SELECT pg_xact_status(${transactionId}::xid8) AS status`
      );
      if (outcome.status !== 'committed') {
        throw commitError ?? new Error(`Futures transaction not committed (${outcome.status ?? 'unknown'}); book not published`);
      }
      prepared!.session?.publish(engine);
      return prepared!.result;
    } finally {
      release();
      if (queues.get(engine) === next) queues.delete(engine);
    }
  }
}
