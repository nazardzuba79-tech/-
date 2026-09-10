import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { randomUUID } from 'crypto';
import { LiquidationEngine } from '../LiquidationEngine';
import { MarkPriceService } from '../MarkPriceService';

/**
 * The `futures-book` advisory lock, against a REAL PostgreSQL.
 *
 * Everything else in this repo's futures suites runs on a fake Prisma. A fake
 * can model a lock, and this repo's does — but a model of a lock proves only
 * that the model is self-consistent. `pg_advisory_xact_lock` is a database
 * primitive, and the claim that liquidation and a TP/SL close can no longer
 * interleave rests entirely on how PostgreSQL actually behaves: that the lock
 * is transaction-scoped, that a second taker blocks rather than failing, and
 * that it is released by COMMIT or ROLLBACK without anyone calling unlock.
 *
 * So this suite talks to a real server.
 *
 * HOW TO RUN IT. Point `VOLTEX_PG_TEST_URL` at a PostgreSQL database with
 * this schema migrated:
 *
 *     createdb voltex_test
 *     DATABASE_URL=postgresql://…/voltex_test npx prisma migrate deploy
 *     VOLTEX_PG_TEST_URL=postgresql://…/voltex_test npx jest futuresBookLock
 *
 * `VOLTEX_PG_TEST_URL` and nothing else — see the constant below.
 *
 * WITHOUT the variable the whole suite is `describe.skip`, so `npx jest` on a
 * checkout with no database is not red for the wrong reason — and Jest counts
 * these as SKIPPED, never as passed. That distinction matters: an earlier
 * draft returned early inside each test, which reported a green suite that had
 * in fact verified nothing.
 *
 * WITH the variable set but the database unreachable, the suite FAILS. Asking
 * for these tests and silently not getting them is the one outcome worth
 * being loud about.
 */

/**
 * DELIBERATELY NOT `DATABASE_URL`.
 *
 * This suite creates and deletes users, positions and balances. Falling back
 * to whatever `DATABASE_URL` happens to point at would let `npx jest` write
 * to a developer's real database, or worse. It runs only against a URL
 * somebody set for exactly this purpose.
 */
const URL = process.env.VOLTEX_PG_TEST_URL;
const LOCK = `SELECT pg_advisory_xact_lock(hashtextextended('futures-book', 0))::text AS locked`;

let prisma: PrismaClient | null = null;

/** Configured or not, decided at COLLECTION time so Jest can report the
 *  difference between "skipped" and "passed". */
const describePg = URL ? describe : describe.skip;
const pgIt = it;

beforeAll(async () => {
  if (!URL) return;
  const client = new PrismaClient({ datasources: { db: { url: URL } } });
  try {
    await client.$queryRawUnsafe('SELECT 1');
    // The schema has to be migrated, not merely present.
    await client.futuresPositionProtection.count();
    prisma = client;
  } catch (err: any) {
    await client.$disconnect().catch(() => {});
    // Loud on purpose. VOLTEX_PG_TEST_URL was set, so somebody asked for
    // these tests; quietly not running them would report a green suite that
    // verified nothing about the lock.
    throw new Error(
      `[futuresBookLock.pg] VOLTEX_PG_TEST_URL is set but the database is not usable: ${err?.message ?? err}\n` +
      'Run `prisma migrate deploy` against it, or unset the variable to skip this suite.'
    );
  }
});

/** A whole account with one open position, isolated from every other test. */
async function seed(over: { size?: string; entryPrice?: string; initialMargin?: string; liquidationPrice?: string } = {}) {
  const db = prisma!;
  const suffix = randomUUID();
  const user = await db.user.create({
    data: {
      email: `pg-lock-${suffix}@localhost.invalid`,
      passwordHash: 'x',
      referralCode: `PGL${suffix.slice(0, 8)}`,
    },
  });
  await db.futuresBalance.create({
    data: { userId: user.id, asset: 'USDT', available: '4000', locked: '6000' },
  });
  const position = await db.futuresPosition.create({
    data: {
      userId: user.id,
      symbol: 'BTC/USDT',
      side: 'LONG',
      size: over.size ?? '1',
      entryPrice: over.entryPrice ?? '60000',
      leverage: 10,
      marginType: 'ISOLATED',
      initialMargin: over.initialMargin ?? '6000',
      liquidationPrice: over.liquidationPrice ?? '54300',
      status: 'OPEN',
    },
  });
  return { user, position };
}

/** Scoped to this test's own rows. A broader delete would quietly destroy
 *  another test's fixtures and make failures impossible to attribute. */
async function cleanup(userId: string) {
  const db = prisma!;
  const positions = await db.futuresPosition.findMany({ where: { userId }, select: { id: true } });
  const positionIds = positions.map((p) => p.id);
  await db.futuresPositionProtection.deleteMany({ where: { userId } });
  if (positionIds.length) {
    await db.insuranceFundLedger.deleteMany({ where: { positionId: { in: positionIds } } }).catch(() => {});
  }
  await db.futuresPosition.deleteMany({ where: { userId } });
  await db.futuresBalance.deleteMany({ where: { userId } });
  await db.user.delete({ where: { id: userId } }).catch(() => {});
}

const engineAt = (price: string) => {
  const marks = new MarkPriceService({} as any);
  jest.spyOn(marks, 'getMarkPrice').mockResolvedValue(new BigNumber(price));
  return new LiquidationEngine(prisma!, marks);
};

const balanceOf = async (userId: string) =>
  prisma!.futuresBalance.findUniqueOrThrow({ where: { userId_asset: { userId, asset: 'USDT' } } });

describePg('pg_advisory_xact_lock on the futures-book key', () => {
  pgIt('is transaction-scoped: a second taker WAITS, and is released by COMMIT', async () => {
    const order: string[] = [];
    let firstHasLock!: () => void;
    const firstHoldsIt = new Promise<void>((r) => { firstHasLock = r; });
    let letFirstFinish!: () => void;
    const firstMayFinish = new Promise<void>((r) => { letFirstFinish = r; });

    const first = prisma!.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(LOCK);
      order.push('A took the lock');
      firstHasLock();
      await firstMayFinish;
      order.push('A commits');
    });

    await firstHoldsIt;
    const second = prisma!.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(LOCK);
      order.push('B took the lock');
    }, { timeout: 20_000 });

    // Give B every chance to barge in. It cannot.
    await new Promise((r) => setTimeout(r, 250));
    expect(order).toEqual(['A took the lock']);

    letFirstFinish();
    await Promise.all([first, second]);
    // B was admitted only after A's COMMIT — nobody called unlock.
    expect(order).toEqual(['A took the lock', 'A commits', 'B took the lock']);
  }, 60_000);

  pgIt('a ROLLBACK releases it too, so a failed transaction cannot wedge the book', async () => {
    const failing = prisma!.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(LOCK);
      throw new Error('deliberate rollback');
    });
    await expect(failing).rejects.toThrow('deliberate rollback');

    const after = await prisma!.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(LOCK);
      return 'acquired';
    }, { timeout: 10_000 });
    expect(after).toBe('acquired');
  }, 60_000);

  pgIt('the key LiquidationEngine uses is byte-identical to FuturesBookTransaction\'s', async () => {
    // Different keys would serialize nothing at all, and the two call sites
    // are in different files. Compare the numbers PostgreSQL actually derives.
    const [{ book }] = await prisma!.$queryRawUnsafe<{ book: string }[]>(
      `SELECT hashtextextended('futures-book', 0)::text AS book`
    );
    const sources = ['FuturesBookTransaction.ts', 'LiquidationEngine.ts', 'FuturesProtectionService.ts'].map((f) =>
      require('fs').readFileSync(require('path').resolve(__dirname, '..', f), 'utf8')
    );
    for (const source of sources) {
      expect(source).toContain("pg_advisory_xact_lock(hashtextextended('futures-book', 0))");
    }
    expect(book).toMatch(/^-?\d+$/);
  }, 60_000);
});

describePg('liquidation vs a close, on a real database', () => {
  /** A stand-in for what a reduce-only fill does to these rows: it takes the
   *  futures-book lock (as `FuturesBookTransaction` does), closes the
   *  position and releases its margin. Deliberately not the whole matching
   *  engine — what is under test here is the ORDERING, and this is the exact
   *  lock and the exact rows. */
  async function closeUnderTheLock(positionId: string, userId: string, realizedPnl: string) {
    return prisma!.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(LOCK);
      const claimed = await tx.futuresPosition.updateMany({
        where: { id: positionId, status: 'OPEN' },
        data: { status: 'CLOSED', size: '0', closedAt: new Date(), realizedPnl },
      });
      if (claimed.count === 0) return false;
      const balance = await tx.futuresBalance.findUniqueOrThrow({
        where: { userId_asset: { userId, asset: 'USDT' } },
      });
      await tx.futuresBalance.update({
        where: { userId_asset: { userId, asset: 'USDT' } },
        data: {
          available: new BigNumber(balance.available.toString()).plus('6000').plus(realizedPnl).toString(),
          locked: new BigNumber(balance.locked.toString()).minus('6000').toString(),
        },
      });
      return true;
    }, { timeout: 20_000 });
  }

  pgIt('G. the close wins the lock -> liquidation is a no-op, and settles nothing', async () => {
    const { user, position } = await seed();
    try {
      const closed = await closeUnderTheLock(position.id, user.id, '-5700');
      expect(closed).toBe(true);

      const liquidated = await engineAt('54000').liquidatePosition(position.id, new BigNumber('54000'));

      expect(liquidated).toBe(false);
      const row = await prisma!.futuresPosition.findUniqueOrThrow({ where: { id: position.id } });
      expect(row.status).toBe('CLOSED');
      // PnL settled ONCE, at the close's figure.
      expect(row.realizedPnl.toString()).toBe('-5700');
      const balance = await balanceOf(user.id);
      // Margin released ONCE: 4000 + 6000 - 5700.
      expect(balance.available.toString()).toBe('4300');
      expect(balance.locked.toString()).toBe('0');
    } finally {
      await cleanup(user.id);
    }
  }, 60_000);

  pgIt('H. liquidation wins the lock -> the close then finds nothing to close', async () => {
    const { user, position } = await seed();
    try {
      const liquidated = await engineAt('54000').liquidatePosition(position.id, new BigNumber('54000'));
      expect(liquidated).toBe(true);

      const closed = await closeUnderTheLock(position.id, user.id, '-5700');
      expect(closed).toBe(false);

      const row = await prisma!.futuresPosition.findUniqueOrThrow({ where: { id: position.id } });
      expect(row.status).toBe('LIQUIDATED');
      expect(row.realizedPnl.toString()).toBe('-6000');
      const balance = await balanceOf(user.id);
      // Liquidation forfeits the margin: locked goes to 0, available is not
      // credited. Exactly one settlement, and no second release.
      expect(balance.available.toString()).toBe('4000');
      expect(balance.locked.toString()).toBe('0');
    } finally {
      await cleanup(user.id);
    }
  }, 60_000);

  pgIt('I. started TOGETHER, exactly one of the two settles — either way the books balance', async () => {
    const { user, position } = await seed();
    try {
      const [liquidated, closed] = await Promise.all([
        engineAt('54000').liquidatePosition(position.id, new BigNumber('54000')),
        closeUnderTheLock(position.id, user.id, '-5700'),
      ]);

      // One winner. Never both, never neither.
      expect([liquidated, closed].filter(Boolean)).toHaveLength(1);

      const row = await prisma!.futuresPosition.findUniqueOrThrow({ where: { id: position.id } });
      const balance = await balanceOf(user.id);

      expect(row.status).toBe(liquidated ? 'LIQUIDATED' : 'CLOSED');
      // PnL written ONCE, by the winner.
      expect(row.realizedPnl.toString()).toBe(liquidated ? '-6000' : '-5700');
      // Margin released ONCE. A double release would drive locked negative.
      expect(balance.locked.toString()).toBe('0');
      expect(balance.available.toString()).toBe(liquidated ? '4000' : '4300');
      // Size can only reach zero, never go through it.
      expect(new BigNumber(row.size.toString()).isZero()).toBe(true);
      expect(new BigNumber(row.size.toString()).isNegative()).toBe(false);
    } finally {
      await cleanup(user.id);
    }
  }, 60_000);

  pgIt('two concurrent liquidations of the same position settle it once', async () => {
    const { user, position } = await seed();
    try {
      const engine = engineAt('54000');
      const results = await Promise.all([
        engine.liquidatePosition(position.id, new BigNumber('54000')),
        engine.liquidatePosition(position.id, new BigNumber('54000')),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);

      const balance = await balanceOf(user.id);
      expect(balance.locked.toString()).toBe('0');
      expect(balance.available.toString()).toBe('4000');
      const ledger = await prisma!.insuranceFundLedger.findMany({ where: { positionId: position.id } });
      expect(ledger).toHaveLength(1);
    } finally {
      await cleanup(user.id);
    }
  }, 60_000);

  pgIt('a partial reduce that commits first is settled at its REAL size, not the pre-claim one', async () => {
    const { user, position } = await seed();
    try {
      // Half the position closed by hand, margin halved with it.
      await prisma!.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(LOCK);
        await tx.futuresPosition.update({
          where: { id: position.id },
          data: { size: '0.5', initialMargin: '3000' },
        });
        await tx.futuresBalance.update({
          where: { userId_asset: { userId: user.id, asset: 'USDT' } },
          data: { available: '7000', locked: '3000' },
        });
      });

      expect(await engineAt('54000').liquidatePosition(position.id, new BigNumber('54000'))).toBe(true);

      const row = await prisma!.futuresPosition.findUniqueOrThrow({ where: { id: position.id } });
      // 0.5 × (54000 − 60000) = −3000, not the −6000 a stale snapshot implies.
      expect(row.realizedPnl.toString()).toBe('-3000');
      const balance = await balanceOf(user.id);
      expect(balance.locked.toString()).toBe('0');
      expect(balance.available.toString()).toBe('7000');
    } finally {
      await cleanup(user.id);
    }
  }, 60_000);
});

describePg('the protection claim, on a real database', () => {
  async function seedProtection(triggerPrice: string) {
    const { user, position } = await seed();
    const row = await prisma!.futuresPositionProtection.create({
      data: {
        positionId: position.id, userId: user.id, symbol: 'BTC/USDT',
        kind: 'STOP_LOSS', triggerPrice, status: 'PENDING',
      },
    });
    return { user, position, row };
  }

  pgIt('the compare-and-swap claim really is atomic against a concurrent edit', async () => {
    const { user, row } = await seedProtection('95000');
    try {
      // The trader's edit commits first, bumping the CAS token.
      await prisma!.futuresPositionProtection.update({
        where: { id: row.id },
        data: { triggerPrice: '90000', revision: { increment: 1 } },
      });

      // A sweep still holding the pre-edit version tries to claim it.
      const stale = await prisma!.futuresPositionProtection.updateMany({
        where: { id: row.id, status: { in: ['PENDING', 'FAILED'] }, revision: 0, triggerPrice: '95000' },
        data: { status: 'TRIGGERING', triggeredAt: new Date(), attempts: { increment: 1 } },
      });
      expect(stale.count).toBe(0);

      const after = await prisma!.futuresPositionProtection.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.status).toBe('PENDING');
      expect(after.attempts).toBe(0);

      // The sweep that DID evaluate the new version claims it.
      const fresh = await prisma!.futuresPositionProtection.updateMany({
        where: { id: row.id, status: { in: ['PENDING', 'FAILED'] }, revision: 1, triggerPrice: '90000' },
        data: { status: 'TRIGGERING', triggeredAt: new Date(), attempts: { increment: 1 } },
      });
      expect(fresh.count).toBe(1);
    } finally {
      await cleanup(user.id);
    }
  }, 60_000);

  pgIt('DECIMAL(36,18) compares by VALUE, so a claim is not defeated by stored scale', async () => {
    // The claim carries the price the sweep read back into the predicate.
    // `95000` and `95000.000000000000000000` are the same number; if numeric
    // comparison were textual, every claim would silently fail.
    const { user, row } = await seedProtection('95000');
    try {
      // PostgreSQL stores it padded to the column's scale. Read the raw text
      // the server holds, not Prisma's normalised Decimal — the point is that
      // the STORED form differs from the string the claim passes in.
      const [{ raw }] = await prisma!.$queryRawUnsafe<{ raw: string }[]>(
        `SELECT "triggerPrice"::text AS raw FROM "FuturesPositionProtection" WHERE id = $1`,
        row.id
      );
      expect(raw).toBe('95000.000000000000000000');
      expect(raw).not.toBe('95000');
      const claim = await prisma!.futuresPositionProtection.updateMany({
        where: { id: row.id, status: { in: ['PENDING', 'FAILED'] }, revision: 0, triggerPrice: '95000' },
        data: { status: 'TRIGGERING' },
      });
      expect(claim.count).toBe(1);
    } finally {
      await cleanup(user.id);
    }
  }, 60_000);

  pgIt('only ONE of many concurrent claims on the same trigger wins', async () => {
    const { user, row } = await seedProtection('95000');
    try {
      const attempts = await Promise.all(
        Array.from({ length: 8 }, () =>
          prisma!.futuresPositionProtection.updateMany({
            where: { id: row.id, status: { in: ['PENDING', 'FAILED'] }, revision: 0, triggerPrice: '95000' },
            data: { status: 'TRIGGERING', triggeredAt: new Date(), attempts: { increment: 1 } },
          })
        )
      );
      expect(attempts.filter((a) => a.count === 1)).toHaveLength(1);
      const after = await prisma!.futuresPositionProtection.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.attempts).toBe(1);
    } finally {
      await cleanup(user.id);
    }
  }, 60_000);

  pgIt('the unique (positionId, kind) pair is enforced by the database, not just by convention', async () => {
    const { user, position } = await seedProtection('95000');
    try {
      await expect(
        prisma!.futuresPositionProtection.create({
          data: {
            positionId: position.id, userId: user.id, symbol: 'BTC/USDT',
            kind: 'STOP_LOSS', triggerPrice: '90000', status: 'PENDING',
          },
        })
      ).rejects.toThrow();
    } finally {
      await cleanup(user.id);
    }
  }, 60_000);
});
