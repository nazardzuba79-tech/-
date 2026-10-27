import { Prisma, PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { MatchingEngine } from '../matching-engine/MatchingEngine';
import { Order } from '../matching-engine/types';

const queues = new WeakMap<MatchingEngine, Promise<void>>();
const halted = new WeakSet<MatchingEngine>();

/** The offline release audit must reject exactly the makers that book loading rejects. */
export function assertRestorableSpotOrder(row: {
  id: string; type: string; side: string; price: { toString(): string } | null;
  originalQuantity: { toString(): string }; remainingQuantity: { toString(): string };
}, filled: BigNumber) {
  const remaining = new BigNumber(row.remainingQuantity.toString());
  const original = new BigNumber(row.originalQuantity.toString());
  if (row.type !== 'LIMIT' || !row.price || !new BigNumber(row.price.toString()).isGreaterThan(0)
    || !remaining.isGreaterThan(0) || !original.minus(filled).eq(remaining)
    || !['BUY', 'SELL'].includes(row.side)) {
    throw new Error(`Invalid active Spot order ${row.id}; manual reconciliation required`);
  }
}

type ActiveOrderRow = {
  id: string; userId: string; side: string; type: string; price: { toString(): string } | null;
  originalQuantity: { toString(): string }; remainingQuantity: { toString(): string };
  status: string; createdAt: Date; updatedAt: Date;
};
type FillRow = { makerOrderId: string; takerOrderId: string; quantity: { toString(): string } };

/** The persisted tables behind one book, and the advisory-lock namespace that
 * serializes its state transitions. Two ledgers never share a lock or a row. */
export interface SpotBookLedger {
  lock: string;
  activeOrders(tx: Prisma.TransactionClient, pair: string): Promise<ActiveOrderRow[]>;
  fills(tx: Prisma.TransactionClient, pair: string, ids: string[]): Promise<FillRow[]>;
}

export const REAL_SPOT_LEDGER: SpotBookLedger = {
  lock: 'spot-book',
  activeOrders: (tx, pair) => tx.order.findMany({ where: { pair, status: { in: ['OPEN', 'PARTIALLY_FILLED'] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
  fills: (tx, _pair, ids) => tx.trade.findMany({
    where: { OR: [{ makerOrderId: { in: ids } }, { takerOrderId: { in: ids } }] },
    select: { makerOrderId: true, takerOrderId: true, quantity: true },
  }),
};

/** DemoOrder/DemoTrade: the same matching, reserve and refund rules on the demo ledger. */
export const DEMO_SPOT_LEDGER: SpotBookLedger = {
  lock: 'demo-spot-book',
  activeOrders: (tx, pair) => tx.demoOrder.findMany({ where: { pair, status: { in: ['OPEN', 'PARTIALLY_FILLED'] } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
  fills: (tx, pair, ids) => tx.demoTrade.findMany({
    where: { pair, OR: [{ makerOrderId: { in: ids } }, { takerOrderId: { in: ids } }] },
    select: { makerOrderId: true, takerOrderId: true, quantity: true },
  }),
};

/** Transaction-local matching; the live book is a committed projection only.
 * Global Spot lock orders all order/OCO/trigger/cancel state transitions across
 * instances. Balance writers in other products use conditional atomic deltas.
 * READ COMMITTED deliberately reads the latest rows after waiting for the lock.
 */
export class SpotBookTransaction {
  private readonly books = new Map<string, MatchingEngine>();
  constructor(private readonly tx: Prisma.TransactionClient, private readonly ledger: SpotBookLedger = REAL_SPOT_LEDGER) {}

  async book(pair: string): Promise<MatchingEngine> {
    const loaded = this.books.get(pair);
    if (loaded) return loaded;
    const staged = new MatchingEngine();
    const rows = await this.ledger.activeOrders(this.tx, pair);
    const ids = rows.map(row => row.id);
    // Older Spot code did not persist maker remainingQuantity. Never resurrect
    // such a legacy maker from the DB, or refund its already-consumed hold.
    const fills = ids.length ? await this.ledger.fills(this.tx, pair, ids) : [];
    const filled = new Map<string, BigNumber>();
    for (const fill of fills) for (const id of [fill.makerOrderId, fill.takerOrderId]) {
      filled.set(id, (filled.get(id) ?? new BigNumber(0)).plus(fill.quantity.toString()));
    }
    for (const row of rows) {
      const remaining = new BigNumber(row.remainingQuantity.toString());
      const original = new BigNumber(row.originalQuantity.toString());
      assertRestorableSpotOrder(row, filled.get(row.id) ?? new BigNumber(0));
      staged.loadRestingOrder({ id: row.id, userId: row.userId, pair, side: row.side as Order['side'], type: 'LIMIT',
        price: new BigNumber(row.price!.toString()), originalQuantity: original, remainingQuantity: remaining,
        status: row.status as Order['status'], createdAt: row.createdAt.getTime(), updatedAt: row.updatedAt.getTime() });
    }
    this.books.set(pair, staged);
    return staged;
  }

  private publish(engine: MatchingEngine) {
    for (const [pair, staged] of this.books) for (const side of ['BUY', 'SELL'] as const) {
      const live = engine.getBook(pair).getBook(side);
      live.length = 0;
      for (const order of staged.getBook(pair).getBook(side)) live.push(order);
    }
  }

  static async run<T>(prisma: PrismaClient, engine: MatchingEngine,
    work: (tx: Prisma.TransactionClient, session: SpotBookTransaction) => Promise<T>,
    ledger: SpotBookLedger = REAL_SPOT_LEDGER): Promise<T> {
    const previous = queues.get(engine) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    queues.set(engine, next);
    await previous;
    try {
      if (halted.has(engine)) throw new Error('Spot commit outcome unknown; reconcile database and restart before trading');
      let identity: string | undefined, prepared: { session: SpotBookTransaction; result: T } | undefined;
      let commitError: unknown;
      try {
        await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ledger.lock}, 0))::text`;
          const session = new SpotBookTransaction(tx, ledger);
          const result = await work(tx, session);
          const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT pg_current_xact_id()::text AS id`;
          identity = row.id;
          prepared = { session, result };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 30000 });
      } catch (error) {
        if (!identity) throw error;
        commitError = error;
      }
      // Also detects Prisma 5's deferred-constraint COMMIT rollback and lost ACKs.
      let status: string | null;
      try {
        const [outcome] = await prisma.$queryRaw<{ status: string | null }[]>`SELECT pg_xact_status(${identity}::xid8) AS status`;
        status = outcome?.status;
        if (status !== 'committed' && status !== 'aborted') throw new Error('Unknown commit');
      } catch {
        halted.add(engine);
        throw new Error('Spot commit outcome unknown; reconcile database and restart before trading');
      }
      if (status === 'aborted') throw commitError ?? new Error('Spot transaction rolled back; book unchanged');
      prepared!.session.publish(engine);
      return prepared!.result;
    } finally {
      release();
      if (queues.get(engine) === next) queues.delete(engine);
    }
  }
}
