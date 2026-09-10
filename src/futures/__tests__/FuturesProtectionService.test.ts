import BigNumber from 'bignumber.js';
import {
  FuturesProtectionService,
  NotFound,
  Conflict,
  MarkPriceUnavailable,
  hasCrossed,
  validateTriggers,
  isSerializationFailure,
} from '../FuturesProtectionService';
import { MarkPriceService } from '../MarkPriceService';
import { PROTECTION_STALE_CLAIM_MS } from '../../config/futuresConfig';

/**
 * Real futures TP/SL, tested where it can actually go wrong: the races.
 *
 * The fake Prisma below is deliberately not a stub that returns canned
 * answers. It models the two properties the design leans on and would be
 * worthless without:
 *
 *   1. `updateMany` is a CONDITIONAL WRITE. It re-reads the row, checks the
 *      predicate, and writes — with no `await` between the check and the
 *      write, which is exactly the atomicity PostgreSQL gives a single
 *      `UPDATE ... WHERE id = ? AND status IN (...)` under a row lock.
 *   2. Every other method yields a real microtask before answering, so two
 *      concurrent `checkAndTrigger()` calls genuinely interleave rather
 *      than running to completion one after the other. Without this the
 *      idempotency tests would pass on a single-threaded accident.
 */

type Row = Record<string, any>;
const tick = () => new Promise((r) => setTimeout(r, 0));

function makeFakePrisma(
  positions: Row[],
  protections: Row[] = [],
  /** Fires the first time the futures-book advisory lock is taken — i.e.
   *  once a mutation is INSIDE its transaction. That is the window in which
   *  a close commits while a request waits for the lock. */
  onLock?: () => void
) {
  const positionMap = new Map<string, Row>(positions.map((p) => [p.id, { realizedPnl: '0', ...p }]));
  const protectionMap = new Map<string, Row>(
    protections.map((p) => [
      p.id,
      { status: 'PENDING', attempts: 0, revision: 0, lastError: null, triggeredAt: null, resolvedAt: null, createdAt: new Date(), updatedAt: new Date(), ...p },
    ])
  );
  /** Every `pg_advisory_xact_lock` the code under test issues. */
  const locks: string[] = [];

  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, cond]) => {
      const value = row[key];
      if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
        if ('in' in cond) return (cond.in as any[]).includes(value);
        if ('lt' in cond) return value !== null && value !== undefined && new Date(value) < new Date(cond.lt);
        return false;
      }
      // `triggerPrice` is DECIMAL(36,18) in PostgreSQL, where `numeric = $1`
      // compares by VALUE — '95000' and '95000.000000000000000000' are equal.
      // A fake that compared them as strings would fail claims the database
      // would accept, and hide the ones it would reject.
      if (key === 'triggerPrice') return new BigNumber(String(value)).isEqualTo(new BigNumber(String(cond)));
      return value === cond;
    });

  const applyData = (row: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) {
      row[key] = value && typeof value === 'object' && 'increment' in value
        ? (row[key] ?? 0) + (value as any).increment
        : value;
    }
    row.updatedAt = new Date();
  };

  const protectionDelegate = {
    findMany: async ({ where = {} }: any = {}) => {
      await tick();
      return [...protectionMap.values()].filter((r) => matches(r, where)).map((r) => ({ ...r }));
    },
    findUnique: async ({ where }: any) => {
      await tick();
      if (where.id) return protectionMap.has(where.id) ? { ...protectionMap.get(where.id)! } : null;
      const { positionId, kind } = where.positionId_kind;
      const found = [...protectionMap.values()].find((r) => r.positionId === positionId && r.kind === kind);
      return found ? { ...found } : null;
    },
    create: async ({ data }: any) => {
      await tick();
      const row = {
        id: `prot-${protectionMap.size + 1}`,
        status: 'PENDING', attempts: 0, revision: 0, lastError: null, triggeredAt: null, resolvedAt: null,
        createdAt: new Date(), updatedAt: new Date(), ...data,
      };
      protectionMap.set(row.id, row);
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      await tick();
      const row = protectionMap.get(where.id)!;
      applyData(row, data);
      return { ...row };
    },
    // THE atomic one. No await between reading the predicate and writing.
    updateMany: async ({ where, data }: any) => {
      await tick(); // the wait to reach the database, not a gap in the write
      let count = 0;
      for (const row of protectionMap.values()) {
        if (!matches(row, where)) continue;
        applyData(row, data);
        count++;
      }
      return { count };
    },
  };

  const positionDelegate = {
    findUnique: async ({ where: { id } }: any) => {
      await tick();
      return positionMap.has(id) ? { ...positionMap.get(id)! } : null;
    },
    findMany: async ({ where = {} }: any = {}) => {
      await tick();
      return [...positionMap.values()].filter((p) => matches(p, where)).map((p) => ({ ...p }));
    },
    updateMany: async ({ where, data }: any) => {
      await tick();
      let count = 0;
      for (const row of positionMap.values()) {
        if (!matches(row, where)) continue;
        applyData(row, data);
        count++;
      }
      return { count };
    },
    update: async ({ where: { id }, data }: any) => {
      await tick();
      applyData(positionMap.get(id)!, data);
      return { ...positionMap.get(id)! };
    },
  };

  // The advisory lock is MODELLED, not merely recorded: a transaction that
  // takes it waits for the previous holder and keeps it until it commits,
  // which is what `pg_advisory_xact_lock` does. Without that these tests
  // could not tell a serialized design from an unserialized one.
  //
  // It is still a model. That the REAL lock behaves this way is proven
  // separately against a live PostgreSQL in `futuresBookLock.pg.test.ts`.
  let lockQueue: Promise<void> = Promise.resolve();
  let lockCount = 0;

  const makeTxClient = () => {
    let release: (() => void) | null = null;
    const client = {
      futuresPosition: positionDelegate,
      futuresPositionProtection: protectionDelegate,
      $queryRaw: async (sql: any) => {
        const text = Array.isArray(sql?.strings) ? sql.strings.join('?') : String(sql?.sql ?? sql);
        locks.push(text);
        if (!text.includes('pg_advisory_xact_lock')) return [{}];
        const waitFor = lockQueue;
        lockQueue = new Promise<void>((resolve) => { release = resolve; });
        await waitFor;
        if (++lockCount === 1) onLock?.();
        return [{ locked: 'true' }];
      },
    };
    return { client, finish: () => release?.() };
  };

  const prisma = {
    futuresPosition: positionDelegate,
    futuresPositionProtection: protectionDelegate,
    $transaction: async (fn: any) => {
      const { client, finish } = makeTxClient();
      try {
        return await fn(client);
      } finally {
        // COMMIT or ROLLBACK — either way the transaction-scoped lock goes.
        finish();
      }
    },
  } as any;

  return { prisma, positionMap, protectionMap, locks };
}

function makeMarkPrice(price: string | null, betweenScanAndClaim?: () => void) {
  const service = new MarkPriceService({} as any);
  // The sweep reads mark prices AFTER capturing the armed rows and BEFORE
  // claiming any of them, so a side effect here lands in exactly the window
  // a trader's edit would: the scan has already decided, the claim has not
  // yet run.
  jest.spyOn(service, 'getMarkPrice').mockImplementation(async () => {
    betweenScanAndClaim?.();
    return price === null ? null : new BigNumber(price);
  });
  return service;
}

/** A stand-in for the ONE path protection is allowed to use. It behaves the
 *  way the real `placeOrder` does for a reduce-only MARKET close: it refuses
 *  when there is no opposing position left, and it closes the size it was
 *  handed — never a size of its own choosing. */
/**
 * The fake `FuturesPositionService`.
 *
 * It now models three of its methods, not one, because a trigger no longer
 * only places a close: winning the claim also clears the bucket's resting
 * ENTRY orders, and that has to happen inside the same futures-book
 * transaction. `withFuturesBook` therefore takes the modelled advisory lock
 * exactly as the real `FuturesBookTransaction.run` does, so the mutual
 * exclusion these tests rely on is unchanged.
 *
 * `orders` and `balances` are optional: the suites that predate this fix pass
 * neither, so the bucket is empty, nothing is cancelled, and every one of
 * their assertions runs against the behaviour it always did.
 */
function makePositionService(
  prisma: any,
  positionMap: Map<string, Row>,
  opts: {
    onPlace?: () => void | Promise<void>;
    fail?: string;
    orders?: Map<string, Row>;
    balances?: Map<string, Row>;
    /** Returns something to throw INSTEAD of running the transaction body,
     *  or undefined to run it. PostgreSQL raises a serialization failure at
     *  the conflicting statement, so an aborted transaction never reaches
     *  its later statements and leaves nothing behind — modelled by never
     *  running `work` at all. */
    abortWith?: () => unknown;
  } = {}
) {
  const calls: any[] = [];
  const orders = opts.orders ?? new Map<string, Row>();
  const balances = opts.balances ?? new Map<string, Row>();
  const placeOrder = jest.fn(async (params: any) => {
    calls.push(params);
    await opts.onPlace?.();
    if (opts.fail) throw new Error(opts.fail);
    const position = [...positionMap.values()].find(
      (p) => p.userId === params.userId && p.symbol === params.symbol && p.marginType === params.marginType && p.status === 'OPEN'
    );
    // Real behaviour: a reduce-only MARKET with no opposing capacity never
    // settles anything — the preflight refuses it.
    if (!position) throw new Error('Insufficient market liquidity for requested quantity');
    const size = new BigNumber(position.size.toString());
    const quantity = new BigNumber(params.quantity.toString());
    if (quantity.isGreaterThan(size)) throw new Error('reduceOnly order would exceed the current position size');
    const remaining = size.minus(quantity);
    if (remaining.isZero()) {
      position.status = 'CLOSED';
      position.size = '0';
      position.closedAt = new Date();
    } else {
      position.size = remaining.toString();
    }
    return { order: {}, trades: [] };
  });
  /** The real one runs `work` inside FuturesBookTransaction.run, which takes
   *  the futures-book lock itself. Modelled the same way here. */
  const withFuturesBook = async (work: any) =>
    prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw({ strings: ["SELECT pg_advisory_xact_lock(hashtextextended('futures-book', 0))"] });
      const abort = opts.abortWith?.();
      if (abort !== undefined) throw abort;
      const { result } = await work(tx);
      return result;
    });

  /** The real one selects the bucket's non-reduce-only OPEN/PARTIALLY_FILLED
   *  orders, cancels each and returns its reserved margin once. Same
   *  selection, same single release, against the maps this fake holds. */
  const cancelBucketEntryOrdersWithin = jest.fn(async (_tx: any, bucket: any) => {
    const resting = [...orders.values()].filter(
      (o) =>
        o.userId === bucket.userId &&
        o.symbol === bucket.symbol &&
        o.marginType === bucket.marginType &&
        o.reduceOnly === false &&
        ['OPEN', 'PARTIALLY_FILLED'].includes(o.status)
    );
    for (const order of resting) {
      order.status = 'CANCELLED';
      const [, quote] = String(order.symbol).split('/');
      const key = `${order.userId}:${quote}`;
      const balance = balances.get(key) ?? { available: '0', locked: '0' };
      const released = new BigNumber(order.remainingQuantity)
        .times(order.price)
        .dividedBy(order.leverage);
      balances.set(key, {
        available: new BigNumber(balance.available).plus(released).toString(),
        locked: new BigNumber(balance.locked).minus(released).toString(),
      });
    }
    return { cancelledOrderIds: resting.map((o) => o.id) };
  });

  return {
    service: { placeOrder, withFuturesBook, cancelBucketEntryOrdersWithin } as any,
    placeOrder,
    calls,
    orders,
    balances,
    cancelBucketEntryOrdersWithin,
  };
}

const LONG = { id: 'pos-1', userId: 'user-1', symbol: 'BTC/USDT', side: 'LONG', size: '2', entryPrice: '100000', leverage: 10, marginType: 'ISOLATED', status: 'OPEN' };
const SHORT = { id: 'pos-2', userId: 'user-1', symbol: 'BTC/USDT', side: 'SHORT', size: '1', entryPrice: '100000', leverage: 10, marginType: 'ISOLATED', status: 'OPEN' };

const arm = (over: Row) => ({ id: 'prot-tp', positionId: 'pos-1', userId: 'user-1', symbol: 'BTC/USDT', kind: 'TAKE_PROFIT', triggerPrice: '110000', ...over });

// ── Thresholds ──────────────────────────────────────────────────────

describe('trigger thresholds are the futures mark price against the level', () => {
  const mark = (v: string) => new BigNumber(v);
  const level = new BigNumber('100');

  it('LONG take profit fires at or above the level, never below', () => {
    expect(hasCrossed('LONG', 'TAKE_PROFIT', mark('100.01'), level)).toBe(true);
    expect(hasCrossed('LONG', 'TAKE_PROFIT', mark('100'), level)).toBe(true);
    expect(hasCrossed('LONG', 'TAKE_PROFIT', mark('99.99'), level)).toBe(false);
  });

  it('LONG stop loss fires at or below the level, never above', () => {
    expect(hasCrossed('LONG', 'STOP_LOSS', mark('99.99'), level)).toBe(true);
    expect(hasCrossed('LONG', 'STOP_LOSS', mark('100'), level)).toBe(true);
    expect(hasCrossed('LONG', 'STOP_LOSS', mark('100.01'), level)).toBe(false);
  });

  it('SHORT take profit fires at or below the level, never above', () => {
    expect(hasCrossed('SHORT', 'TAKE_PROFIT', mark('99.99'), level)).toBe(true);
    expect(hasCrossed('SHORT', 'TAKE_PROFIT', mark('100'), level)).toBe(true);
    expect(hasCrossed('SHORT', 'TAKE_PROFIT', mark('100.01'), level)).toBe(false);
  });

  it('SHORT stop loss fires at or above the level, never below', () => {
    expect(hasCrossed('SHORT', 'STOP_LOSS', mark('100.01'), level)).toBe(true);
    expect(hasCrossed('SHORT', 'STOP_LOSS', mark('100'), level)).toBe(true);
    expect(hasCrossed('SHORT', 'STOP_LOSS', mark('99.99'), level)).toBe(false);
  });
});

describe('a sweep fires the right side and nothing else', () => {
  it('LONG take-profit only: fires above the level, closes the whole position', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [arm({ triggerPrice: '110000' })]);
    const { service, calls } = makePositionService(prisma, positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('110500'));

    expect(await svc.checkAndTrigger()).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ symbol: 'BTC/USDT', side: 'SELL', type: 'MARKET', reduceOnly: true, leverage: 10, marginType: 'ISOLATED' });
    expect(calls[0].quantity.toString()).toBe('2');
    expect(positionMap.get('pos-1')!.status).toBe('CLOSED');
    expect(protectionMap.get('prot-tp')!.status).toBe('EXECUTED');
  });

  it('LONG take-profit does NOT fire below the level', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [arm({ triggerPrice: '110000' })]);
    const { service, calls } = makePositionService(prisma, positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('109999'));

    expect(await svc.checkAndTrigger()).toBe(0);
    expect(calls).toHaveLength(0);
    expect(positionMap.get('pos-1')!.status).toBe('OPEN');
    expect(protectionMap.get('prot-tp')!.status).toBe('PENDING');
  });

  it('LONG stop-loss only: fires below the level and sells to close', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [arm({ id: 'prot-sl', kind: 'STOP_LOSS', triggerPrice: '95000' })]);
    const { service, calls } = makePositionService(prisma, positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('94900'));

    expect(await svc.checkAndTrigger()).toBe(1);
    expect(calls[0]).toMatchObject({ side: 'SELL', reduceOnly: true });
    expect(protectionMap.get('prot-sl')!.status).toBe('EXECUTED');
  });

  it('SHORT stop-loss buys to close, and SHORT take-profit fires on the other side', async () => {
    const short = { ...SHORT, id: 'pos-2' };
    const slUp = makeFakePrisma([short], [arm({ id: 'p-sl', positionId: 'pos-2', kind: 'STOP_LOSS', triggerPrice: '105000' })]);
    const a = makePositionService(slUp.prisma, slUp.positionMap);
    expect(await new FuturesProtectionService(slUp.prisma, a.service, makeMarkPrice('105100')).checkAndTrigger()).toBe(1);
    expect(a.calls[0]).toMatchObject({ side: 'BUY', reduceOnly: true });

    const tpDown = makeFakePrisma([short], [arm({ id: 'p-tp', positionId: 'pos-2', kind: 'TAKE_PROFIT', triggerPrice: '90000' })]);
    const b = makePositionService(tpDown.prisma, tpDown.positionMap);
    expect(await new FuturesProtectionService(tpDown.prisma, b.service, makeMarkPrice('89900')).checkAndTrigger()).toBe(1);
    expect(b.calls[0]).toMatchObject({ side: 'BUY', reduceOnly: true });
  });
});

// ── OCO ─────────────────────────────────────────────────────────────

describe('TP + SL are one-cancels-the-other', () => {
  const both = () => [
    arm({ id: 'p-tp', kind: 'TAKE_PROFIT', triggerPrice: '110000' }),
    arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000' }),
  ];

  it('the take profit winning cancels the stop loss, and only one order is placed', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], both());
    const { service, calls } = makePositionService(prisma, positionMap);
    expect(await new FuturesProtectionService(prisma, service, makeMarkPrice('111000')).checkAndTrigger()).toBe(1);

    expect(calls).toHaveLength(1);
    expect(protectionMap.get('p-tp')!.status).toBe('EXECUTED');
    expect(protectionMap.get('p-sl')!.status).toBe('CANCELLED');
  });

  it('the stop loss winning cancels the take profit', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], both());
    const { service, calls } = makePositionService(prisma, positionMap);
    expect(await new FuturesProtectionService(prisma, service, makeMarkPrice('94000')).checkAndTrigger()).toBe(1);

    expect(calls).toHaveLength(1);
    expect(protectionMap.get('p-sl')!.status).toBe('EXECUTED');
    expect(protectionMap.get('p-tp')!.status).toBe('CANCELLED');
  });

  it('BOTH levels crossed at once still closes the position exactly once', async () => {
    // Only reachable with a nonsensical pair, but the invariant has to hold
    // whatever the levels are: one close, one winner, one cancelled sibling.
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [
      arm({ id: 'p-tp', kind: 'TAKE_PROFIT', triggerPrice: '90000' }),
      arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '110000' }),
    ]);
    const { service, calls } = makePositionService(prisma, positionMap);
    expect(await new FuturesProtectionService(prisma, service, makeMarkPrice('100000')).checkAndTrigger()).toBe(1);

    expect(calls).toHaveLength(1);
    const statuses = [protectionMap.get('p-tp')!.status, protectionMap.get('p-sl')!.status].sort();
    expect(statuses).toEqual(['CANCELLED', 'EXECUTED']);
    expect(positionMap.get('pos-1')!.status).toBe('CLOSED');
  });
});

// ── Idempotency and races ───────────────────────────────────────────

describe('exactly one outcome wins', () => {
  it('two concurrent sweeps place ONE order — the claim is a conditional write', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [arm({ triggerPrice: '110000' })]);
    const { service, calls } = makePositionService(prisma, positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('111000'));

    const results = await Promise.all([svc.checkAndTrigger(), svc.checkAndTrigger()]);

    expect(calls).toHaveLength(1);
    expect(results.filter((n) => n === 1)).toHaveLength(1);
    expect(protectionMap.get('prot-tp')!.status).toBe('EXECUTED');
    // Claimed once, so counted once.
    expect(protectionMap.get('prot-tp')!.attempts).toBe(1);
  });

  it('a second sweep after execution does nothing at all', async () => {
    const { prisma, positionMap } = makeFakePrisma([LONG], [arm({ triggerPrice: '110000' })]);
    const { service, calls } = makePositionService(prisma, positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('111000'));

    await svc.checkAndTrigger();
    expect(await svc.checkAndTrigger()).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('MANUAL CLOSE BEFORE the trigger: nothing is placed, protection is cancelled', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [arm({ triggerPrice: '110000' })]);
    positionMap.get('pos-1')!.status = 'CLOSED';
    positionMap.get('pos-1')!.size = '0';
    const { service, calls } = makePositionService(prisma, positionMap);

    expect(await new FuturesProtectionService(prisma, service, makeMarkPrice('111000')).checkAndTrigger()).toBe(0);
    expect(calls).toHaveLength(0);
    expect(protectionMap.get('prot-tp')!.status).toBe('CANCELLED');
  });

  it('MANUAL CLOSE RACE: the close lands mid-flight, and the trigger settles nothing', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [arm({ triggerPrice: '110000' })]);
    // The trader's own Close commits between the claim and the trigger's
    // order reaching the book — the exact window that matters.
    const { service, calls } = makePositionService(prisma, positionMap, {
      onPlace: async () => {
        const position = positionMap.get('pos-1')!;
        position.status = 'CLOSED';
        position.size = '0';
      },
    });
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('111000'));

    expect(await svc.checkAndTrigger()).toBe(0);
    // The order was attempted and REFUSED by the reduce-only preflight,
    // which is what stops a second settlement — the trigger never gets to
    // decide that for itself.
    expect(calls).toHaveLength(1);
    expect(positionMap.get('pos-1')!.status).toBe('CLOSED');
    expect(protectionMap.get('prot-tp')!.status).toBe('CANCELLED');
  });

  it('LIQUIDATION RACE: a position liquidated mid-flight is not closed again', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000' })]);
    const { service, calls } = makePositionService(prisma, positionMap, {
      onPlace: async () => {
        const position = positionMap.get('pos-1')!;
        position.status = 'LIQUIDATED';
        position.size = '0';
      },
    });
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('94000'));

    expect(await svc.checkAndTrigger()).toBe(0);
    expect(calls).toHaveLength(1);
    expect(positionMap.get('pos-1')!.status).toBe('LIQUIDATED');
    // Not FAILED: there is nothing left to protect, so retrying would be a
    // lie. The stop did not fail — the position stopped existing.
    expect(protectionMap.get('p-sl')!.status).toBe('CANCELLED');
  });

  it('a trigger that cannot execute stays armed instead of being dropped', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000' })]);
    const { service } = makePositionService(prisma, positionMap, { fail: 'Insufficient market liquidity for requested quantity' });
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('94000'));

    expect(await svc.checkAndTrigger()).toBe(0);
    const row = protectionMap.get('p-sl')!;
    expect(row.status).toBe('FAILED');
    expect(row.lastError).toContain('Insufficient market liquidity');
    expect(positionMap.get('pos-1')!.status).toBe('OPEN');

    // FAILED is re-claimed: a stop loss is never abandoned while the
    // position it guards is still open.
    const retry = makePositionService(prisma, positionMap);
    expect(await new FuturesProtectionService(prisma, retry.service, makeMarkPrice('94000')).checkAndTrigger()).toBe(1);
    expect(protectionMap.get('p-sl')!.status).toBe('EXECUTED');
    expect(protectionMap.get('p-sl')!.attempts).toBe(2);
  });
});

// ── Position size ───────────────────────────────────────────────────

describe('protection closes the CURRENT remaining size', () => {
  it('after a manual partial close, the stop closes only what is left', async () => {
    const { prisma, positionMap } = makeFakePrisma([LONG], [arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000' })]);
    // Opened 2, the trader closed 1.25 by hand, 0.75 remains.
    positionMap.get('pos-1')!.size = '0.75';
    const { service, calls } = makePositionService(prisma, positionMap);

    expect(await new FuturesProtectionService(prisma, service, makeMarkPrice('94000')).checkAndTrigger()).toBe(1);
    expect(calls[0].quantity.toString()).toBe('0.75');
    expect(positionMap.get('pos-1')!.status).toBe('CLOSED');
  });

  it('an increase that lands mid-flight leaves the trigger ARMED, not falsely executed', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000' })]);
    let grown = false;
    const { service, calls } = makePositionService(prisma, positionMap, {
      onPlace: async () => {
        if (grown) return;
        grown = true;
        positionMap.get('pos-1')!.size = '3'; // 2 read, 3 now: 1 will remain
      },
    });
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('94000'));

    expect(await svc.checkAndTrigger()).toBe(0);
    expect(calls[0].quantity.toString()).toBe('2');
    expect(positionMap.get('pos-1')!.size).toBe('1');
    expect(protectionMap.get('p-sl')!.status).toBe('PENDING');

    // The next sweep protects the remainder, at its real current size.
    expect(await svc.checkAndTrigger()).toBe(1);
    expect(calls[1].quantity.toString()).toBe('1');
    expect(positionMap.get('pos-1')!.status).toBe('CLOSED');
  });

  it('no stored quantity exists to go stale', async () => {
    // The guarantee above is structural, not incidental: the row has no
    // size column at all, so there is nothing a stale value could live in.
    const { protectionMap } = makeFakePrisma([LONG], [arm({})]);
    const row = protectionMap.get('prot-tp')!;
    for (const key of ['size', 'quantity', 'originalQuantity', 'remainingQuantity']) {
      expect(row).not.toHaveProperty(key);
    }
  });
});

// ── Mark price ──────────────────────────────────────────────────────

describe('an unavailable mark price triggers nothing and cancels nothing', () => {
  it('leaves protection armed and places no order', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [
      arm({ id: 'p-tp', kind: 'TAKE_PROFIT', triggerPrice: '110000' }),
      arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000' }),
    ]);
    const { service, calls } = makePositionService(prisma, positionMap);

    expect(await new FuturesProtectionService(prisma, service, makeMarkPrice(null)).checkAndTrigger()).toBe(0);
    expect(calls).toHaveLength(0);
    expect(protectionMap.get('p-tp')!.status).toBe('PENDING');
    expect(protectionMap.get('p-sl')!.status).toBe('PENDING');
    expect(positionMap.get('pos-1')!.status).toBe('OPEN');
  });

  it('and zero is never substituted for it', async () => {
    // A zero mark would fire every stop loss on the book at once. Prove the
    // null path is taken rather than a falsy-to-zero coercion.
    const { prisma, positionMap } = makeFakePrisma([LONG], [arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000' })]);
    const { service, calls } = makePositionService(prisma, positionMap);
    const markPriceService = new MarkPriceService({} as any);
    const spy = jest.spyOn(markPriceService, 'getMarkPrice').mockResolvedValue(null);

    await new FuturesProtectionService(prisma, service, markPriceService).checkAndTrigger();
    expect(spy).toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});

// ── Restart ─────────────────────────────────────────────────────────

describe('state survives a backend restart', () => {
  it('an armed trigger is loaded from the database by a brand-new service', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [arm({ triggerPrice: '110000' })]);
    // Nothing in memory: a fresh instance, exactly as after a redeploy.
    const { service, calls } = makePositionService(prisma, positionMap);
    const restarted = new FuturesProtectionService(prisma, service, makeMarkPrice('111000'));

    expect(await restarted.checkAndTrigger()).toBe(1);
    expect(calls).toHaveLength(1);
    expect(protectionMap.get('prot-tp')!.status).toBe('EXECUTED');
  });

  it('a claim orphaned by the crash is reclaimed, not stranded', async () => {
    const orphanedAt = new Date(Date.now() - PROTECTION_STALE_CLAIM_MS - 1_000);
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [
      arm({ triggerPrice: '110000', status: 'TRIGGERING', triggeredAt: orphanedAt, attempts: 1 }),
    ]);
    const { service, calls } = makePositionService(prisma, positionMap);

    expect(await new FuturesProtectionService(prisma, service, makeMarkPrice('111000')).checkAndTrigger()).toBe(1);
    expect(calls).toHaveLength(1);
    expect(protectionMap.get('prot-tp')!.status).toBe('EXECUTED');
  });

  it('a claim a live process is still working on is NOT stolen', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [
      arm({ triggerPrice: '110000', status: 'TRIGGERING', triggeredAt: new Date(), attempts: 1 }),
    ]);
    const { service, calls } = makePositionService(prisma, positionMap);

    expect(await new FuturesProtectionService(prisma, service, makeMarkPrice('111000')).checkAndTrigger()).toBe(0);
    expect(calls).toHaveLength(0);
    expect(protectionMap.get('prot-tp')!.status).toBe('TRIGGERING');
  });
});

// ── Validation and ownership ────────────────────────────────────────

describe('invalid trigger prices are refused', () => {
  const mark = new BigNumber('100000');

  it('a non-positive or non-finite price is never accepted', () => {
    for (const bad of ['0', '-1', 'NaN']) {
      expect(() => validateTriggers('LONG', { takeProfit: new BigNumber(bad), stopLoss: null }, mark)).toThrow();
      expect(() => validateTriggers('LONG', { takeProfit: null, stopLoss: new BigNumber(bad) }, mark)).toThrow();
    }
  });

  it('a LONG needs its stop below its take profit, and both on the right side of the mark', () => {
    expect(() => validateTriggers('LONG', { takeProfit: new BigNumber('90000'), stopLoss: new BigNumber('95000') }, mark))
      .toThrow(/stopLoss must be below takeProfit/);
    expect(() => validateTriggers('LONG', { takeProfit: new BigNumber('99000'), stopLoss: null }, mark))
      .toThrow(/takeProfit must be above the current mark/);
    expect(() => validateTriggers('LONG', { takeProfit: null, stopLoss: new BigNumber('101000') }, mark))
      .toThrow(/stopLoss must be below the current mark/);
    expect(() => validateTriggers('LONG', { takeProfit: new BigNumber('110000'), stopLoss: new BigNumber('95000') }, mark)).not.toThrow();
  });

  it('a SHORT is the mirror of it', () => {
    expect(() => validateTriggers('SHORT', { takeProfit: new BigNumber('110000'), stopLoss: new BigNumber('95000') }, mark))
      .toThrow(/stopLoss must be above takeProfit/);
    expect(() => validateTriggers('SHORT', { takeProfit: new BigNumber('101000'), stopLoss: null }, mark))
      .toThrow(/takeProfit must be below the current mark/);
    expect(() => validateTriggers('SHORT', { takeProfit: null, stopLoss: new BigNumber('99000') }, mark))
      .toThrow(/stopLoss must be above the current mark/);
    expect(() => validateTriggers('SHORT', { takeProfit: new BigNumber('90000'), stopLoss: new BigNumber('105000') }, mark)).not.toThrow();
  });

  it('with NO mark price the ordering rules still apply and no price is invented', () => {
    expect(() => validateTriggers('LONG', { takeProfit: new BigNumber('90000'), stopLoss: new BigNumber('95000') }, null))
      .toThrow(/stopLoss must be below takeProfit/);
    // A level that happens to be through the current price is accepted
    // rather than judged against a fabricated mark. It simply fires on the
    // first sweep that has one.
    expect(() => validateTriggers('LONG', { takeProfit: new BigNumber('1'), stopLoss: null }, null)).not.toThrow();
  });

  it('the service refuses the same bad input end to end', async () => {
    const { prisma, positionMap } = makeFakePrisma([LONG]);
    const { service } = makePositionService(prisma, positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('100000'));
    await expect(svc.setProtection('user-1', 'pos-1', { takeProfit: new BigNumber('90000'), stopLoss: null }))
      .rejects.toThrow(/takeProfit must be above the current mark/);
  });
});

describe('protection is scoped to its owner', () => {
  it('another user can neither read nor write it, and cannot tell it exists', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [arm({})]);
    const { service } = makePositionService(prisma, positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('100000'));

    expect(await svc.getProtection('intruder', 'pos-1')).toBeNull();
    // Identical answer for a position that genuinely does not exist, so the
    // response cannot be used to probe another account.
    expect(await svc.getProtection('intruder', 'no-such-position')).toBeNull();

    await expect(svc.setProtection('intruder', 'pos-1', { takeProfit: new BigNumber('120000'), stopLoss: null }))
      .rejects.toBeInstanceOf(NotFound);
    await expect(svc.clearProtection('intruder', 'pos-1')).rejects.toBeInstanceOf(NotFound);

    // Untouched by the attempts.
    expect(protectionMap.get('prot-tp')!.triggerPrice).toBe('110000');
    expect(protectionMap.get('prot-tp')!.status).toBe('PENDING');
  });

  it('the owner can create, edit and remove each side', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG]);
    const { service } = makePositionService(prisma, positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('100000'));

    // Create both.
    let state = await svc.setProtection('user-1', 'pos-1', { takeProfit: new BigNumber('110000'), stopLoss: new BigNumber('95000') });
    expect(state!.takeProfit).toMatchObject({ triggerPrice: '110000', status: 'PENDING' });
    expect(state!.stopLoss).toMatchObject({ triggerPrice: '95000', status: 'PENDING' });

    // Edit one.
    state = await svc.setProtection('user-1', 'pos-1', { takeProfit: new BigNumber('115000'), stopLoss: new BigNumber('95000') });
    expect(state!.takeProfit!.triggerPrice).toBe('115000');

    // Remove one leg by omitting it — PUT replaces the whole protection.
    state = await svc.setProtection('user-1', 'pos-1', { takeProfit: null, stopLoss: new BigNumber('95000') });
    expect(state!.takeProfit!.status).toBe('CANCELLED');
    expect(state!.stopLoss!.status).toBe('PENDING');

    // Remove everything.
    await svc.clearProtection('user-1', 'pos-1');
    const cleared = await svc.getProtection('user-1', 'pos-1');
    expect(cleared!.takeProfit!.status).toBe('CANCELLED');
    expect(cleared!.stopLoss!.status).toBe('CANCELLED');

    // Re-arming is a FRESH trigger, not a resurrected one.
    await svc.setProtection('user-1', 'pos-1', { takeProfit: null, stopLoss: new BigNumber('96000') });
    const reArmed = [...protectionMap.values()].find((r) => r.kind === 'STOP_LOSS')!;
    expect(reArmed).toMatchObject({ status: 'PENDING', attempts: 0, lastError: null, triggerPrice: '96000' });
  });

  it('protection cannot be attached to a position that is no longer open', async () => {
    const { prisma, positionMap } = makeFakePrisma([{ ...LONG, status: 'CLOSED', size: '0' }]);
    const { service } = makePositionService(prisma, positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('100000'));
    await expect(svc.setProtection('user-1', 'pos-1', { takeProfit: new BigNumber('110000'), stopLoss: null }))
      .rejects.toBeInstanceOf(NotFound);
  });

  it('activeProtectionByPosition reports only live triggers', async () => {
    const { prisma, positionMap } = makeFakePrisma([LONG], [
      arm({ id: 'p-tp', kind: 'TAKE_PROFIT', triggerPrice: '110000', status: 'PENDING' }),
      arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000', status: 'CANCELLED' }),
    ]);
    const { service } = makePositionService(prisma, positionMap);
    const map = await new FuturesProtectionService(prisma, service, makeMarkPrice('100000')).activeProtectionByPosition(['pos-1']);
    expect(map.get('pos-1')!.takeProfit).toMatchObject({ triggerPrice: '110000' });
    expect(map.get('pos-1')!.stopLoss).toBeNull();
  });
});

// ── Separation ──────────────────────────────────────────────────────

describe('the futures path is the only path', () => {
  const source = require('fs').readFileSync(require('path').resolve(__dirname, '../FuturesProtectionService.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('never reaches for the spot conditional-order stack', () => {
    for (const spot of ['PENDING_TRIGGER', 'updateOrderTrigger', 'ocoGroupId', 'getMyOrders', 'OrderService', 'priceWatcher', 'PriceWatcher']) {
      expect(code).not.toContain(spot);
    }
    // Not `prisma.order` / `prisma.balance` either — futures tables only.
    expect(code).not.toMatch(/\.order\./);
    expect(code).not.toMatch(/tx\.balance/);
  });

  it('closes only through the shared reduce-only order path', () => {
    // One call site, one flag. If this ever grows a second way to move a
    // position, the whole safety argument of this file is void.
    expect(code.match(/placeOrder\(/g)).toHaveLength(1);
    expect(code).toContain('reduceOnly: true');
    expect(code).not.toMatch(/futuresBalance/);
    expect(code).not.toMatch(/insuranceFund/i);
    expect(code).not.toMatch(/realizedPnl/);
  });

  it('takes its price from the mark price service and nothing else', () => {
    expect(code).toContain('markPriceService.getMarkPrice');
    expect(code).not.toContain('getTicker');
    expect(code).not.toContain('lastPrice');
    expect(code).not.toContain('Kraken');
  });

  it('the dependency is one-way: the order path knows nothing about TP/SL', () => {
    // FuturesPositionService is the trusted engine every fill, margin move
    // and position write goes through. Protection calls INTO it and it
    // never calls back — so normal LIMIT and MARKET placement, reduce-only
    // capacity, the exposure/tier checks and the margin reconciliation are
    // reached by exactly the code they were reached by before, with no
    // branch that only a triggered order takes.
    const source = require('fs').readFileSync(require('path').resolve(__dirname, '../FuturesPositionService.ts'), 'utf8');
    // EXECUTABLE code, with comments stripped. The engine gained a generic
    // "cancel this risk bucket's resting entry orders" primitive, and its
    // doc comment says plainly which defect that exists for — naming the
    // caller in prose is how the file explains itself, and pinning the
    // invariant to the prose would only make the comment dishonest. What
    // must stay true is that no protection module is imported and no
    // protection identifier is reachable from any code path here.
    const ts = require('typescript');
    const orderPath = ts
      .createPrinter({ removeComments: true })
      .printFile(ts.createSourceFile('FuturesPositionService.ts', source, ts.ScriptTarget.Latest, true));
    for (const term of ['Protection', 'protection', 'takeProfit', 'stopLoss', 'triggerPrice', 'TAKE_PROFIT', 'STOP_LOSS']) {
      expect(orderPath).not.toContain(term);
    }
    expect(source).not.toMatch(/from '\.\/FuturesProtectionService'/);
    // And the one thing protection relies on is still the reduce-only
    // guarantee itself, stated in the engine rather than assumed here.
    expect(orderPath).toContain('reduceOnly order would exceed the current position size');
    expect(orderPath).toContain('reduceOnly fill exceeds the current opposing position');
  });
});

// ── Review follow-up 1: the stale scan ──────────────────────────────

/**
 * A sweep decides to fire against ONE version of a trigger. By the time it
 * claims, the trader may have edited that trigger, removed it, or replaced
 * it. The claim has to prove it is taking the version the decision was made
 * about — otherwise a stop edited from 95000 down to 90000 gets executed at
 * 94000, a level that never crossed.
 *
 * The edit is injected inside `getMarkPrice`, which the sweep calls AFTER
 * capturing the armed rows and BEFORE claiming any of them: precisely the
 * window that matters.
 */
describe('a stale scan cannot fire a trigger that has since been edited', () => {
  it('A. SL scanned at 95000, edited to 90000 before the claim, mark 94000 -> ZERO orders', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma(
      [LONG], [arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000' })]
    );
    const { service, calls } = makePositionService(prisma, positionMap);
    const editToNinety = () => {
      const row = protectionMap.get('p-sl')!;
      if (row.triggerPrice !== '95000') return;
      row.triggerPrice = '90000';
      row.revision += 1;
    };
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('94000', editToNinety));

    expect(await svc.checkAndTrigger()).toBe(0);
    // 94000 is BELOW the old 95000 but ABOVE the new 90000. The position must
    // not be closed at a level the live instruction never reached.
    expect(calls).toHaveLength(0);
    expect(positionMap.get('pos-1')!.status).toBe('OPEN');
    // Untouched: still armed, and never counted as attempted.
    expect(protectionMap.get('p-sl')).toMatchObject({ status: 'PENDING', triggerPrice: '90000', attempts: 0 });
  });

  it('B. TP scanned, removed before the claim -> ZERO orders', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma(
      [LONG], [arm({ id: 'p-tp', kind: 'TAKE_PROFIT', triggerPrice: '110000' })]
    );
    const { service, calls } = makePositionService(prisma, positionMap);
    const removeIt = () => {
      const row = protectionMap.get('p-tp')!;
      if (row.status !== 'PENDING') return;
      row.status = 'CANCELLED';
      row.revision += 1;
      row.resolvedAt = new Date();
    };
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('111000', removeIt));

    expect(await svc.checkAndTrigger()).toBe(0);
    expect(calls).toHaveLength(0);
    expect(positionMap.get('pos-1')!.status).toBe('OPEN');
    expect(protectionMap.get('p-tp')!.status).toBe('CANCELLED');
  });

  it('C. the trigger is REPLACED at a level that has also crossed — the stale sweep still cannot claim it', async () => {
    // The subtle one. 94000 crosses the old 95000 AND the new 94500, so a
    // price-only check would wave this through. The replacement is a
    // different instruction with a different history (attempts reset), and a
    // sweep that never evaluated it has no business executing it: the CAS
    // token is what makes that decidable.
    const { prisma, positionMap, protectionMap } = makeFakePrisma(
      [LONG], [arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000', attempts: 3, status: 'FAILED' })]
    );
    const { service, calls } = makePositionService(prisma, positionMap);
    const replace = () => {
      const row = protectionMap.get('p-sl')!;
      if (row.revision !== 0) return;
      row.triggerPrice = '94500';
      row.status = 'PENDING';
      row.attempts = 0;
      row.revision += 1;
    };
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('94000', replace));

    expect(await svc.checkAndTrigger()).toBe(0);
    expect(calls).toHaveLength(0);
    expect(protectionMap.get('p-sl')).toMatchObject({ status: 'PENDING', triggerPrice: '94500', attempts: 0 });

    // And the NEXT sweep, which evaluated the replacement, does fire it.
    const next = makePositionService(prisma, positionMap);
    expect(await new FuturesProtectionService(prisma, next.service, makeMarkPrice('94000')).checkAndTrigger()).toBe(1);
    expect(next.calls).toHaveLength(1);
    expect(protectionMap.get('p-sl')!.status).toBe('EXECUTED');
  });

  it('an untouched trigger still fires — the CAS narrows the claim, it does not break it', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma(
      [LONG], [arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000', revision: 7 })]
    );
    const { service, calls } = makePositionService(prisma, positionMap);
    expect(await new FuturesProtectionService(prisma, service, makeMarkPrice('94000')).checkAndTrigger()).toBe(1);
    expect(calls).toHaveLength(1);
    expect(protectionMap.get('p-sl')!.status).toBe('EXECUTED');
  });

  it('the claim carries BOTH the CAS token and the value it decided from', async () => {
    // A write that somehow failed to bump `revision` still cannot resurrect a
    // stale decision, because the price it was made from is in the predicate
    // too. Belt and braces, asserted on the actual query.
    const { prisma, positionMap, protectionMap } = makeFakePrisma(
      [LONG], [arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000' })]
    );
    const { service, calls } = makePositionService(prisma, positionMap);
    const priceOnlyEdit = () => {
      const row = protectionMap.get('p-sl')!;
      if (row.triggerPrice !== '95000') return;
      row.triggerPrice = '90000'; // revision deliberately NOT bumped
    };
    expect(await new FuturesProtectionService(prisma, service, makeMarkPrice('94000', priceOnlyEdit)).checkAndTrigger()).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

// ── Review follow-up 2: mutation vs a live claim ────────────────────

describe('edit and delete refuse to overwrite a trigger that is executing', () => {
  const triggering = () => [
    arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000', status: 'TRIGGERING', triggeredAt: new Date() }),
    arm({ id: 'p-tp', kind: 'TAKE_PROFIT', triggerPrice: '110000', status: 'PENDING' }),
  ];

  it('D. a PUT during TRIGGERING is a CONFLICT, and changes nothing', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], triggering());
    const { service } = makePositionService(prisma, positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('100000'));

    await expect(svc.setProtection('user-1', 'pos-1', {
      takeProfit: new BigNumber('120000'), stopLoss: new BigNumber('90000'),
    })).rejects.toBeInstanceOf(Conflict);

    // Not one field moved — the live claim is untouched and the other leg is
    // not quietly re-armed either.
    expect(protectionMap.get('p-sl')).toMatchObject({ status: 'TRIGGERING', triggerPrice: '95000', revision: 0 });
    expect(protectionMap.get('p-tp')).toMatchObject({ status: 'PENDING', triggerPrice: '110000', revision: 0 });
  });

  it('E. a DELETE during TRIGGERING is a CONFLICT, and never reports a cancellation', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], triggering());
    const { service } = makePositionService(prisma, positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('100000'));

    await expect(svc.clearProtection('user-1', 'pos-1')).rejects.toBeInstanceOf(Conflict);
    expect(protectionMap.get('p-sl')!.status).toBe('TRIGGERING');
    expect(protectionMap.get('p-tp')!.status).toBe('PENDING');
  });

  it('a sweep and an edit racing for the lock produce ONE coherent outcome, whichever wins', async () => {
    // Both orderings are legitimate; what must never happen is both. The
    // claim and the mutation take the SAME futures-book lock, so one runs to
    // COMMIT before the other starts, and the loser sees the winner's state:
    //
    //   claim first -> the edit is refused with a conflict, the close happens
    //   edit  first -> the CAS token has moved, so the stale sweep cannot
    //                  claim and places nothing
    const { prisma, positionMap, protectionMap } = makeFakePrisma(
      [LONG], [arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000' })]
    );
    const { service, calls } = makePositionService(prisma, positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('94000'));

    const edit = svc
      .setProtection('user-1', 'pos-1', { takeProfit: null, stopLoss: new BigNumber('90000') })
      .then(() => 'saved' as const)
      .catch((e) => (e instanceof Conflict ? ('conflict' as const) : (`other:${e.message}` as const)));
    const [fired, editOutcome] = await Promise.all([svc.checkAndTrigger(), edit]);

    const row = protectionMap.get('p-sl')!;
    if (fired === 1) {
      // The sweep won: the position is closed and the edit was refused
      // rather than silently overwriting a trigger already on its way.
      expect(editOutcome).toBe('conflict');
      expect(calls).toHaveLength(1);
      expect(row).toMatchObject({ status: 'EXECUTED', triggerPrice: '95000' });
      expect(positionMap.get('pos-1')!.status).toBe('CLOSED');
    } else {
      // The edit won: nothing was closed at the superseded level, and the
      // new instruction is the live one.
      expect(editOutcome).toBe('saved');
      expect(calls).toHaveLength(0);
      expect(row).toMatchObject({ status: 'PENDING', triggerPrice: '90000', revision: 1 });
      expect(positionMap.get('pos-1')!.status).toBe('OPEN');
    }
    // Never both.
    expect(fired === 1 && editOutcome === 'saved').toBe(false);
  });

  it('a claim taken while an edit is mid-transaction is impossible — both take the same lock', async () => {
    // The specific hole this closes: without the shared lock, a mutation
    // could read "nothing is TRIGGERING", the sweep could claim, and the
    // mutation could then overwrite a trigger whose close was already on its
    // way. The claim is issued inside a transaction that takes the lock.
    const source = require('fs').readFileSync(require('path').resolve(__dirname, '../FuturesProtectionService.ts'), 'utf8');
    // Anchored on CODE, not prose: the comments in this method mention both
    // names, so matching bare words would compare the wrong offsets.
    const strip = (text: string) =>
      text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    const fireBody = strip(
      source.slice(source.indexOf('private async fire('), source.indexOf('private async claimAndClearBucket'))
    );
    const wrapper = strip(
      source.slice(source.indexOf('private async claimAndClearBucket'), source.indexOf('private async reclaimOrphanedClaims'))
    );

    // The claim runs inside `withFuturesBook`, which is
    // FuturesBookTransaction.run — the SAME literal advisory key the
    // hand-rolled helper took, plus the staged book, which is what lets the
    // bucket's resting entries be cancelled in the very same transaction.
    // fire() reaches it through claimAndClearBucket, whose ONLY job is that
    // transaction plus the narrow serialization catch.
    expect(wrapper).toContain('this.positionService.withFuturesBook(');
    const bookAt = fireBody.indexOf('this.claimAndClearBucket(');
    const claimAt = fireBody.indexOf('tx.futuresPositionProtection.updateMany(');
    const clearAt = fireBody.indexOf('this.positionService.cancelBucketEntryOrdersWithin(');
    const placeAt = fireBody.indexOf('this.positionService.placeOrder(');
    expect(bookAt).toBeGreaterThanOrEqual(0);
    expect(claimAt).toBeGreaterThan(bookAt);
    // The resting entries go in the same transaction as the claim, AFTER it —
    // a watcher that lost the CAS must cancel nothing and refund nothing.
    expect(clearAt).toBeGreaterThan(claimAt);
    // …and the lock is released before the order is placed, or it would
    // deadlock against the order path's own transaction taking the same lock.
    expect(placeAt).toBeGreaterThan(clearAt);
    expect(fireBody.slice(placeAt)).not.toContain('claimAndClearBucket');
    expect(fireBody.slice(placeAt)).not.toContain('withFuturesBook');
    expect(fireBody.slice(placeAt)).not.toContain('lockFuturesBook');

    // One literal key across all three, or none of the above serializes
    // anything. Read out of the files rather than restated here.
    const KEY = "pg_advisory_xact_lock(hashtextextended('futures-book', 0))";
    expect(source).toContain(KEY);
    const book = require('fs').readFileSync(require('path').resolve(__dirname, '../FuturesBookTransaction.ts'), 'utf8');
    expect(book).toContain(KEY);
  });

  it('once the claim resolves, the same mutation succeeds', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma(
      [LONG], [arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000', status: 'FAILED', lastError: 'thin book' })]
    );
    const { service } = makePositionService(prisma, positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('100000'));
    const state = await svc.setProtection('user-1', 'pos-1', { takeProfit: null, stopLoss: new BigNumber('96000') });
    expect(state!.stopLoss).toMatchObject({ triggerPrice: '96000', status: 'PENDING', lastError: null });
    expect(protectionMap.get('p-sl')!.revision).toBe(1);
  });

  it('F. a position that closes while the mutation waits for the lock re-arms NOTHING', async () => {
    let closed = false;
    const state: any = {};
    const closeItUnderTheLock = () => {
      if (closed) return;
      closed = true;
      const position = state.positionMap.get('pos-1')!;
      position.status = 'CLOSED';
      position.size = '0';
    };
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [], closeItUnderTheLock);
    state.positionMap = positionMap;
    const { service } = makePositionService(prisma, positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('100000'));

    // The pre-flight read saw OPEN; the position closed before the write.
    await expect(svc.setProtection('user-1', 'pos-1', { takeProfit: new BigNumber('110000'), stopLoss: null }))
      .rejects.toBeInstanceOf(NotFound);
    expect(protectionMap.size).toBe(0);
  });

  it('clearing stale protection on an ALREADY closed position still works', async () => {
    // The mirror of F: a trader must be able to tidy away protection left on
    // a position that has closed. It arms nothing, so OPEN is not required.
    const { prisma, positionMap, protectionMap } = makeFakePrisma(
      [{ ...LONG, status: 'CLOSED', size: '0' }],
      [arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000' })]
    );
    const { service } = makePositionService(prisma, positionMap);
    await new FuturesProtectionService(prisma, service, makeMarkPrice('100000')).clearProtection('user-1', 'pos-1');
    expect(protectionMap.get('p-sl')!.status).toBe('CANCELLED');
  });

  it('every protection mutation runs under the SAME futures-book advisory lock', async () => {
    const { prisma, positionMap, locks } = makeFakePrisma([LONG]);
    const { service } = makePositionService(prisma, positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('100000'));

    await svc.setProtection('user-1', 'pos-1', { takeProfit: new BigNumber('110000'), stopLoss: null });
    await svc.clearProtection('user-1', 'pos-1');

    expect(locks).toHaveLength(2);
    for (const sql of locks) {
      // The exact key FuturesBookTransaction uses. A different key would
      // serialize nothing at all.
      expect(sql).toContain('pg_advisory_xact_lock');
      expect(sql).toContain("hashtextextended('futures-book', 0)");
    }
  });
});

// ── Review follow-up 4: arming requires a mark price ────────────────

describe('a trigger is never armed without an authoritative mark price', () => {
  const noMark = (positionMap: Map<string, Row>, prisma: any) =>
    new FuturesProtectionService(prisma, makePositionService(prisma, positionMap).service, makeMarkPrice(null));

  it('J. creating a take profit with no mark price is REJECTED, and writes nothing', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG]);
    await expect(noMark(positionMap, prisma).setProtection('user-1', 'pos-1', {
      takeProfit: new BigNumber('110000'), stopLoss: null,
    })).rejects.toBeInstanceOf(MarkPriceUnavailable);
    expect(protectionMap.size).toBe(0);
  });

  it('K. creating a stop loss with no mark price is REJECTED, and writes nothing', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG]);
    await expect(noMark(positionMap, prisma).setProtection('user-1', 'pos-1', {
      takeProfit: null, stopLoss: new BigNumber('95000'),
    })).rejects.toBeInstanceOf(MarkPriceUnavailable);
    expect(protectionMap.size).toBe(0);
  });

  it('L. editing existing protection with no mark price is REJECTED, and the old server state stands', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [
      arm({ id: 'p-tp', kind: 'TAKE_PROFIT', triggerPrice: '110000' }),
      arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000' }),
    ]);
    await expect(noMark(positionMap, prisma).setProtection('user-1', 'pos-1', {
      takeProfit: new BigNumber('115000'), stopLoss: new BigNumber('95000'),
    })).rejects.toBeInstanceOf(MarkPriceUnavailable);

    expect(protectionMap.get('p-tp')).toMatchObject({ triggerPrice: '110000', status: 'PENDING', revision: 0 });
    expect(protectionMap.get('p-sl')).toMatchObject({ triggerPrice: '95000', status: 'PENDING', revision: 0 });
  });

  it('M. DELETE succeeds with no mark price — a stop can always be REMOVED', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [
      arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000' }),
    ]);
    await noMark(positionMap, prisma).clearProtection('user-1', 'pos-1');
    expect(protectionMap.get('p-sl')!.status).toBe('CANCELLED');
  });

  it('N. a PUT that clears BOTH legs succeeds with no mark price', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [
      arm({ id: 'p-tp', kind: 'TAKE_PROFIT', triggerPrice: '110000' }),
      arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000' }),
    ]);
    const state = await noMark(positionMap, prisma).setProtection('user-1', 'pos-1', { takeProfit: null, stopLoss: null });
    expect(state!.takeProfit!.status).toBe('CANCELLED');
    expect(state!.stopLoss!.status).toBe('CANCELLED');
  });

  it('the mark price is not even READ when the request only removes protection', async () => {
    // Not merely tolerated — not consulted. A feed outage cannot block a
    // trader from taking a stop off.
    const { prisma, positionMap } = makeFakePrisma([LONG], [arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000' })]);
    const markPriceService = new MarkPriceService({} as any);
    const spy = jest.spyOn(markPriceService, 'getMarkPrice').mockResolvedValue(new BigNumber('100000'));
    const svc = new FuturesProtectionService(prisma, makePositionService(prisma, positionMap).service, markPriceService);

    await svc.clearProtection('user-1', 'pos-1');
    await svc.setProtection('user-1', 'pos-1', { takeProfit: null, stopLoss: null });
    expect(spy).not.toHaveBeenCalled();
  });

  it('and zero is never used in place of a missing mark price', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG]);
    // A zero mark would make every LONG take profit "above the mark" and
    // every stop loss "below" it — every level would validate. Proving the
    // rejection happens is proving zero was not substituted.
    await expect(noMark(positionMap, prisma).setProtection('user-1', 'pos-1', {
      takeProfit: new BigNumber('0.00000001'), stopLoss: null,
    })).rejects.toBeInstanceOf(MarkPriceUnavailable);
    expect(protectionMap.size).toBe(0);
  });
});

// ── The reopen-after-protection race ────────────────────────────────

/**
 * THE DEFECT. Protection closed the position it was keyed to and stopped
 * there. A non-reduce-only order of the same user, resting in the same
 * `(userId, symbol, marginType)` bucket, outlived that close — and when it
 * filled it re-opened the very exposure the stop had just closed, with no
 * protection on it, because the protection rows were resolved along with
 * the position they belonged to.
 *
 * The fix is not "also cancel them afterwards". It is that the claim and
 * the cancellations are ONE transaction under the futures-book lock: a
 * trigger that wins takes the bucket's resting entries with it, and a
 * trigger that loses the CAS touches nothing at all.
 */
describe('winning the claim takes the bucket\'s resting entries with it', () => {
  const entry = (over: Row = {}) => ({
    id: 'ord-1', userId: 'user-1', symbol: 'BTC/USDT', marginType: 'ISOLATED',
    side: 'BUY', type: 'LIMIT', price: '90000', originalQuantity: '1', remainingQuantity: '1',
    status: 'OPEN', reduceOnly: false, leverage: 10, ...over,
  });
  const bucketFake = (
    protections: Row[],
    orderRows: Row[],
    mark: string,
    position: Row | Row[] = LONG,
    abortWith?: () => unknown
  ) => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma(
      Array.isArray(position) ? position : [position],
      protections
    );
    const orders = new Map<string, Row>(orderRows.map((o) => [o.id, { ...o }]));
    const balances = new Map<string, Row>([['user-1:USDT', { available: '0', locked: '10000' }]]);
    const made = makePositionService(prisma, positionMap, { orders, balances, abortWith });
    const svc = new FuturesProtectionService(prisma, made.service, makeMarkPrice(mark));
    return { svc, prisma, positionMap, protectionMap, ...made };
  };

  it('1. a TP that wins cancels the resting entry, returns its margin ONCE, and closes the position', async () => {
    const f = bucketFake([arm({ triggerPrice: '110000' })], [entry()], '110500');

    expect(await f.svc.checkAndTrigger()).toBe(1);

    // The position closed, as it always did.
    expect(f.positionMap.get('pos-1')!.status).toBe('CLOSED');
    expect(f.protectionMap.get('prot-tp')!.status).toBe('EXECUTED');
    // And the order that would have re-opened it is gone.
    expect(f.orders.get('ord-1')!.status).toBe('CANCELLED');
    // Its reserve came back exactly once: 1 × 90000 / 10 = 9000.
    expect(f.balances.get('user-1:USDT')).toEqual({ available: '9000', locked: '1000' });
    expect(f.cancelBucketEntryOrdersWithin).toHaveBeenCalledTimes(1);
  });

  it('2. the same holds when the STOP LOSS is the side that wins', async () => {
    const f = bucketFake(
      [arm({ id: 'prot-sl', kind: 'STOP_LOSS', triggerPrice: '95000' })],
      [entry()],
      '94000'
    );

    expect(await f.svc.checkAndTrigger()).toBe(1);
    expect(f.positionMap.get('pos-1')!.status).toBe('CLOSED');
    expect(f.orders.get('ord-1')!.status).toBe('CANCELLED');
    expect(f.balances.get('user-1:USDT')!.available).toBe('9000');
  });

  it('3. two resting entries in the bucket are both cancelled, each refunded once', async () => {
    const f = bucketFake(
      [arm({ triggerPrice: '110000' })],
      [entry(), entry({ id: 'ord-2', price: '80000', remainingQuantity: '2' })],
      '110500'
    );

    await f.svc.checkAndTrigger();
    expect(f.orders.get('ord-1')!.status).toBe('CANCELLED');
    expect(f.orders.get('ord-2')!.status).toBe('CANCELLED');
    // 9000 + (2 × 80000 / 10 = 16000) = 25000, and not a unit more.
    expect(f.balances.get('user-1:USDT')!.available).toBe('25000');
  });

  it('4. a resting order on ANOTHER SYMBOL is untouched', async () => {
    const f = bucketFake([arm({ triggerPrice: '110000' })], [entry({ symbol: 'ETH/USDT' })], '110500');
    await f.svc.checkAndTrigger();
    expect(f.orders.get('ord-1')!.status).toBe('OPEN');
    expect(f.balances.get('user-1:USDT')!.available).toBe('0');
  });

  it('5. a resting order in another MARGIN TYPE is untouched', async () => {
    const f = bucketFake([arm({ triggerPrice: '110000' })], [entry({ marginType: 'CROSS' })], '110500');
    await f.svc.checkAndTrigger();
    expect(f.orders.get('ord-1')!.status).toBe('OPEN');
  });

  it('6. another USER\'s resting order in the same market is untouched', async () => {
    const f = bucketFake([arm({ triggerPrice: '110000' })], [entry({ userId: 'user-2' })], '110500');
    await f.svc.checkAndTrigger();
    expect(f.orders.get('ord-1')!.status).toBe('OPEN');
  });

  it('7. a REDUCE-ONLY resting order is not an entry and stays alive', async () => {
    // It can only shrink an opposing position, so it can never re-open
    // exposure — and it reserved no margin, so there is none to return.
    const f = bucketFake([arm({ triggerPrice: '110000' })], [entry({ reduceOnly: true })], '110500');
    await f.svc.checkAndTrigger();
    expect(f.orders.get('ord-1')!.status).toBe('OPEN');
    expect(f.balances.get('user-1:USDT')!.available).toBe('0');
  });

  it('8. a sweep that LOSES the CAS cancels nothing and refunds nothing', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [arm({ triggerPrice: '110000' })]);
    const orders = new Map<string, Row>([['ord-1', entry()]]);
    const balances = new Map<string, Row>([['user-1:USDT', { available: '0', locked: '10000' }]]);
    const made = makePositionService(prisma, positionMap, { orders, balances });
    // The trader edits the trigger in the window between the scan deciding
    // and the claim landing, so the scanned revision is stale.
    const marks = makeMarkPrice('110500', () => {
      const row = protectionMap.get('prot-tp')!;
      row.revision += 1;
      row.triggerPrice = '120000';
    });
    const svc = new FuturesProtectionService(prisma, made.service, marks);

    expect(await svc.checkAndTrigger()).toBe(0);
    expect(made.calls).toHaveLength(0);
    expect(positionMap.get('pos-1')!.status).toBe('OPEN');
    expect(orders.get('ord-1')!.status).toBe('OPEN');
    expect(balances.get('user-1:USDT')).toEqual({ available: '0', locked: '10000' });
    expect(made.cancelBucketEntryOrdersWithin).not.toHaveBeenCalled();
  });

  it('9. a fill landing on the resting order and the trigger are ordered by the lock, never interleaved', async () => {
    // The fill commits FIRST: it holds the futures-book lock, so the claim
    // waits behind it. Protection therefore reads the exposure the fill
    // produced — the increased size — and the order it then cancels is the
    // remainder the fill left, refunded for that remainder alone.
    let fill: Promise<unknown> | null = null;
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [arm({ triggerPrice: '110000' })], () => {
      // Fires inside the first lock acquisition, which is the fill's.
    });
    const orders = new Map<string, Row>([['ord-1', entry({ remainingQuantity: '1' })]]);
    const balances = new Map<string, Row>([['user-1:USDT', { available: '0', locked: '10000' }]]);
    const made = makePositionService(prisma, positionMap, { orders, balances });
    const svc = new FuturesProtectionService(prisma, made.service, makeMarkPrice('110500', () => {
      // Between the scan and the claim, a fill takes the lock and commits:
      // 0.4 of the resting order fills, growing the position to 2.4.
      fill = prisma.$transaction(async (tx: any) => {
        await tx.$queryRaw({ strings: ["SELECT pg_advisory_xact_lock(hashtextextended('futures-book', 0))"] });
        positionMap.get('pos-1')!.size = '2.4';
        orders.get('ord-1')!.remainingQuantity = '0.6';
        orders.get('ord-1')!.status = 'PARTIALLY_FILLED';
      });
    }));

    expect(await svc.checkAndTrigger()).toBe(1);
    await fill;

    // Protection closed the CURRENT exposure, not the size it scanned.
    expect(made.calls[0].quantity.toString()).toBe('2.4');
    expect(positionMap.get('pos-1')!.status).toBe('CLOSED');
    // And the partially filled parent can no longer fill again.
    expect(orders.get('ord-1')!.status).toBe('CANCELLED');
    // Only the REMAINDER's reserve is returned: 0.6 × 90000 / 10 = 5400.
    expect(balances.get('user-1:USDT')!.available).toBe('5400');
  });

  it('10. two watcher workers produce exactly one cancellation, one refund and one close', async () => {
    const f = bucketFake([arm({ triggerPrice: '110000' })], [entry()], '110500');

    const [a, b] = await Promise.all([f.svc.checkAndTrigger(), f.svc.checkAndTrigger()]);

    expect(a + b).toBe(1);
    expect(f.calls).toHaveLength(1);
    expect(f.cancelBucketEntryOrdersWithin).toHaveBeenCalledTimes(1);
    expect(f.orders.get('ord-1')!.status).toBe('CANCELLED');
    expect(f.balances.get('user-1:USDT')).toEqual({ available: '9000', locked: '1000' });
    expect(f.positionMap.get('pos-1')!.status).toBe('CLOSED');
  });

  // ── Losing by ABORT rather than by count === 0 ──────────────────────
  //
  // The claim now runs inside FuturesBookTransaction.run, which is
  // SERIALIZABLE. That changes how a loser loses. Under READ COMMITTED the
  // second writer waited on the row lock and then saw its CAS match nothing
  // (count === 0). Under SERIALIZABLE PostgreSQL ABORTS it instead —
  // SQLSTATE 40001, surfaced by Prisma as P2034 — at the conflicting
  // statement, so it commits nothing at all.
  //
  // Both are the same outcome: this worker did not take the trigger, and
  // left no trace. The sweep must treat them the same, or a race the
  // system is designed to survive kills the rest of the sweep — there is
  // no per-trigger catch in checkAndTrigger's loop.

  const serializationFailure = () => Object.assign(new Error('write conflict'), { code: 'P2034' });

  it('11. a serialization abort is a lost race, not a crash: the sweep carries on', async () => {
    // Two armed triggers in two different buckets. The first transaction is
    // aborted by the database; the second must still fire.
    const aborted = arm({ id: 'prot-a', positionId: 'pos-1', triggerPrice: '110000' });
    const survivor = arm({
      id: 'prot-b', positionId: 'pos-2', symbol: 'ETH/USDT', kind: 'STOP_LOSS', triggerPrice: '110000',
    });
    const other = { ...SHORT, symbol: 'ETH/USDT' };
    let first = true;
    const f = bucketFake([aborted, survivor], [entry()], '110500', [LONG, other], () => {
      if (!first) return undefined;
      first = false;
      return serializationFailure();
    });

    // Did not throw, and the surviving trigger still executed.
    expect(await f.svc.checkAndTrigger()).toBe(1);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ symbol: 'ETH/USDT', reduceOnly: true });
    expect(f.positionMap.get('pos-2')!.status).toBe('CLOSED');

    // The aborted one changed NOTHING: still claimable, never counted an
    // attempt, and its bucket's resting entry is still resting.
    const prot = f.protectionMap.get('prot-a')!;
    expect(prot.status).toBe('PENDING');
    expect(prot.attempts).toBe(0);
    expect(f.positionMap.get('pos-1')!.status).toBe('OPEN');
    expect(f.orders.get('ord-1')!.status).toBe('OPEN');
    expect(f.balances.get('user-1:USDT')).toEqual({ available: '0', locked: '10000' });
  });

  it('12. an aborted claim cancels no orders and refunds no margin', async () => {
    const f = bucketFake([arm({ triggerPrice: '110000' })], [entry()], '110500', LONG, serializationFailure);

    expect(await f.svc.checkAndTrigger()).toBe(0);

    expect(f.cancelBucketEntryOrdersWithin).not.toHaveBeenCalled();
    expect(f.calls).toHaveLength(0);
    expect(f.orders.get('ord-1')!.status).toBe('OPEN');
    expect(f.balances.get('user-1:USDT')).toEqual({ available: '0', locked: '10000' });
    expect(f.positionMap.get('pos-1')!.status).toBe('OPEN');
    expect(f.protectionMap.get('prot-tp')!.status).toBe('PENDING');
  });

  it('13. the catch is narrow: a real failure inside the claim still propagates', async () => {
    // If any error were swallowed as "lost the race", a genuine bug in the
    // cancellation path would look like a quiet no-op forever.
    const f = bucketFake([arm({ triggerPrice: '110000' })], [entry()], '110500', LONG, () =>
      Object.assign(new Error('column does not exist'), { code: 'P2022' })
    );

    await expect(f.svc.checkAndTrigger()).rejects.toThrow('column does not exist');
  });

  it('only serialization SQLSTATEs count as a lost race', () => {
    expect(isSerializationFailure({ code: 'P2034' })).toBe(true);
    expect(isSerializationFailure({ code: '40001' })).toBe(true);
    expect(isSerializationFailure({ code: '40P01' })).toBe(true);
    expect(isSerializationFailure({ code: 'P2022' })).toBe(false);
    expect(isSerializationFailure(new Error('boom'))).toBe(false);
    expect(isSerializationFailure(undefined)).toBe(false);
    expect(isSerializationFailure(null)).toBe(false);
  });
});
