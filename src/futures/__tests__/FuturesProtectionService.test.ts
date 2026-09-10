import BigNumber from 'bignumber.js';
import {
  FuturesProtectionService,
  NotFound,
  hasCrossed,
  validateTriggers,
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

function makeFakePrisma(positions: Row[], protections: Row[] = []) {
  const positionMap = new Map<string, Row>(positions.map((p) => [p.id, { realizedPnl: '0', ...p }]));
  const protectionMap = new Map<string, Row>(
    protections.map((p) => [
      p.id,
      { status: 'PENDING', attempts: 0, lastError: null, triggeredAt: null, resolvedAt: null, createdAt: new Date(), updatedAt: new Date(), ...p },
    ])
  );

  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, cond]) => {
      const value = row[key];
      if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
        if ('in' in cond) return (cond.in as any[]).includes(value);
        if ('lt' in cond) return value !== null && value !== undefined && new Date(value) < new Date(cond.lt);
        return false;
      }
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
        status: 'PENDING', attempts: 0, lastError: null, triggeredAt: null, resolvedAt: null,
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

  const prisma = {
    futuresPosition: positionDelegate,
    futuresPositionProtection: protectionDelegate,
    $transaction: async (fn: any) => fn({ futuresPosition: positionDelegate, futuresPositionProtection: protectionDelegate }),
  } as any;

  return { prisma, positionMap, protectionMap };
}

function makeMarkPrice(price: string | null) {
  const service = new MarkPriceService({} as any);
  jest.spyOn(service, 'getMarkPrice').mockResolvedValue(price === null ? null : new BigNumber(price));
  return service;
}

/** A stand-in for the ONE path protection is allowed to use. It behaves the
 *  way the real `placeOrder` does for a reduce-only MARKET close: it refuses
 *  when there is no opposing position left, and it closes the size it was
 *  handed — never a size of its own choosing. */
function makePositionService(positionMap: Map<string, Row>, opts: { onPlace?: () => void | Promise<void>; fail?: string } = {}) {
  const calls: any[] = [];
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
  return { service: { placeOrder } as any, placeOrder, calls };
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
    const { service, calls } = makePositionService(positionMap);
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
    const { service, calls } = makePositionService(positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('109999'));

    expect(await svc.checkAndTrigger()).toBe(0);
    expect(calls).toHaveLength(0);
    expect(positionMap.get('pos-1')!.status).toBe('OPEN');
    expect(protectionMap.get('prot-tp')!.status).toBe('PENDING');
  });

  it('LONG stop-loss only: fires below the level and sells to close', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [arm({ id: 'prot-sl', kind: 'STOP_LOSS', triggerPrice: '95000' })]);
    const { service, calls } = makePositionService(positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('94900'));

    expect(await svc.checkAndTrigger()).toBe(1);
    expect(calls[0]).toMatchObject({ side: 'SELL', reduceOnly: true });
    expect(protectionMap.get('prot-sl')!.status).toBe('EXECUTED');
  });

  it('SHORT stop-loss buys to close, and SHORT take-profit fires on the other side', async () => {
    const short = { ...SHORT, id: 'pos-2' };
    const slUp = makeFakePrisma([short], [arm({ id: 'p-sl', positionId: 'pos-2', kind: 'STOP_LOSS', triggerPrice: '105000' })]);
    const a = makePositionService(slUp.positionMap);
    expect(await new FuturesProtectionService(slUp.prisma, a.service, makeMarkPrice('105100')).checkAndTrigger()).toBe(1);
    expect(a.calls[0]).toMatchObject({ side: 'BUY', reduceOnly: true });

    const tpDown = makeFakePrisma([short], [arm({ id: 'p-tp', positionId: 'pos-2', kind: 'TAKE_PROFIT', triggerPrice: '90000' })]);
    const b = makePositionService(tpDown.positionMap);
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
    const { service, calls } = makePositionService(positionMap);
    expect(await new FuturesProtectionService(prisma, service, makeMarkPrice('111000')).checkAndTrigger()).toBe(1);

    expect(calls).toHaveLength(1);
    expect(protectionMap.get('p-tp')!.status).toBe('EXECUTED');
    expect(protectionMap.get('p-sl')!.status).toBe('CANCELLED');
  });

  it('the stop loss winning cancels the take profit', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], both());
    const { service, calls } = makePositionService(positionMap);
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
    const { service, calls } = makePositionService(positionMap);
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
    const { service, calls } = makePositionService(positionMap);
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
    const { service, calls } = makePositionService(positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('111000'));

    await svc.checkAndTrigger();
    expect(await svc.checkAndTrigger()).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it('MANUAL CLOSE BEFORE the trigger: nothing is placed, protection is cancelled', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [arm({ triggerPrice: '110000' })]);
    positionMap.get('pos-1')!.status = 'CLOSED';
    positionMap.get('pos-1')!.size = '0';
    const { service, calls } = makePositionService(positionMap);

    expect(await new FuturesProtectionService(prisma, service, makeMarkPrice('111000')).checkAndTrigger()).toBe(0);
    expect(calls).toHaveLength(0);
    expect(protectionMap.get('prot-tp')!.status).toBe('CANCELLED');
  });

  it('MANUAL CLOSE RACE: the close lands mid-flight, and the trigger settles nothing', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [arm({ triggerPrice: '110000' })]);
    // The trader's own Close commits between the claim and the trigger's
    // order reaching the book — the exact window that matters.
    const { service, calls } = makePositionService(positionMap, {
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
    const { service, calls } = makePositionService(positionMap, {
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
    const { service } = makePositionService(positionMap, { fail: 'Insufficient market liquidity for requested quantity' });
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('94000'));

    expect(await svc.checkAndTrigger()).toBe(0);
    const row = protectionMap.get('p-sl')!;
    expect(row.status).toBe('FAILED');
    expect(row.lastError).toContain('Insufficient market liquidity');
    expect(positionMap.get('pos-1')!.status).toBe('OPEN');

    // FAILED is re-claimed: a stop loss is never abandoned while the
    // position it guards is still open.
    const retry = makePositionService(positionMap);
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
    const { service, calls } = makePositionService(positionMap);

    expect(await new FuturesProtectionService(prisma, service, makeMarkPrice('94000')).checkAndTrigger()).toBe(1);
    expect(calls[0].quantity.toString()).toBe('0.75');
    expect(positionMap.get('pos-1')!.status).toBe('CLOSED');
  });

  it('an increase that lands mid-flight leaves the trigger ARMED, not falsely executed', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000' })]);
    let grown = false;
    const { service, calls } = makePositionService(positionMap, {
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
    const { service, calls } = makePositionService(positionMap);

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
    const { service, calls } = makePositionService(positionMap);
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
    const { service, calls } = makePositionService(positionMap);
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
    const { service, calls } = makePositionService(positionMap);

    expect(await new FuturesProtectionService(prisma, service, makeMarkPrice('111000')).checkAndTrigger()).toBe(1);
    expect(calls).toHaveLength(1);
    expect(protectionMap.get('prot-tp')!.status).toBe('EXECUTED');
  });

  it('a claim a live process is still working on is NOT stolen', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [
      arm({ triggerPrice: '110000', status: 'TRIGGERING', triggeredAt: new Date(), attempts: 1 }),
    ]);
    const { service, calls } = makePositionService(positionMap);

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
    const { service } = makePositionService(positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('100000'));
    await expect(svc.setProtection('user-1', 'pos-1', { takeProfit: new BigNumber('90000'), stopLoss: null }))
      .rejects.toThrow(/takeProfit must be above the current mark/);
  });
});

describe('protection is scoped to its owner', () => {
  it('another user can neither read nor write it, and cannot tell it exists', async () => {
    const { prisma, positionMap, protectionMap } = makeFakePrisma([LONG], [arm({})]);
    const { service } = makePositionService(positionMap);
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
    const { service } = makePositionService(positionMap);
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
    const { service } = makePositionService(positionMap);
    const svc = new FuturesProtectionService(prisma, service, makeMarkPrice('100000'));
    await expect(svc.setProtection('user-1', 'pos-1', { takeProfit: new BigNumber('110000'), stopLoss: null }))
      .rejects.toBeInstanceOf(NotFound);
  });

  it('activeProtectionByPosition reports only live triggers', async () => {
    const { prisma, positionMap } = makeFakePrisma([LONG], [
      arm({ id: 'p-tp', kind: 'TAKE_PROFIT', triggerPrice: '110000', status: 'PENDING' }),
      arm({ id: 'p-sl', kind: 'STOP_LOSS', triggerPrice: '95000', status: 'CANCELLED' }),
    ]);
    const { service } = makePositionService(positionMap);
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
    const orderPath = require('fs').readFileSync(require('path').resolve(__dirname, '../FuturesPositionService.ts'), 'utf8');
    for (const term of ['Protection', 'protection', 'takeProfit', 'stopLoss', 'triggerPrice', 'TAKE_PROFIT', 'STOP_LOSS']) {
      expect(orderPath).not.toContain(term);
    }
    // And the one thing protection relies on is still the reduce-only
    // guarantee itself, stated in the engine rather than assumed here.
    expect(orderPath).toContain('reduceOnly order would exceed the current position size');
    expect(orderPath).toContain('reduceOnly fill exceeds the current opposing position');
  });
});
