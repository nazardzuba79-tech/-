import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { randomUUID } from 'crypto';
import { FundingRateService } from '../FundingRateService';
import { MarkPriceService } from '../MarkPriceService';

/**
 * ONE SETTLEMENT PER BOUNDARY, against a REAL PostgreSQL.
 *
 * The unit suite proves the service checks for an earlier settlement after
 * taking its lock; this proves the lock and the check hold when two
 * instances (a deploy overlap) settle the same boundary at the same moment
 * on two connections, and that the next boundary settles again.
 *
 * HOW TO RUN IT. Point `VOLTEX_PG_TEST_URL` at a disposable PostgreSQL with
 * this schema migrated (`prisma migrate deploy`). Without the variable the
 * suite is `describe.skip` (reported as skipped, never as passed); with it
 * set but unusable, the suite FAILS. Deliberately not `DATABASE_URL`: this
 * suite writes users, positions, balances and funding rows.
 */
const URL = process.env.VOLTEX_PG_TEST_URL;
const describePg = URL ? describe : describe.skip;
let a: PrismaClient | null = null, b: PrismaClient | null = null;

beforeAll(async () => {
  if (!URL) return;
  const first = new PrismaClient({ datasources: { db: { url: URL } } }), second = new PrismaClient({ datasources: { db: { url: URL } } });
  try {
    await Promise.all([first.$queryRawUnsafe('SELECT 1'), second.$queryRawUnsafe('SELECT 1')]);
    await first.fundingPayment.count();
    a = first; b = second;
  } catch (err: any) {
    await Promise.all([first.$disconnect().catch(() => {}), second.$disconnect().catch(() => {})]);
    throw new Error(`[fundingOnce.pg] VOLTEX_PG_TEST_URL is set but the database is not usable: ${err?.message ?? err}`);
  }
});
afterAll(async () => { await Promise.all([a?.$disconnect(), b?.$disconnect()]); });

// A symbol of its own per run, so earlier rows in a reused database can never make a boundary look settled.
const symbol = `FT${randomUUID().slice(0, 6).toUpperCase()}/USDT`;
const BOUNDARY = Date.UTC(2031, 0, 1, 8);
const H8 = 8 * 60 * 60 * 1000;

async function seed(side: 'LONG' | 'SHORT', size: string) {
  const suffix = randomUUID();
  const user = await a!.user.create({ data: { email: `pg-funding-${suffix}@localhost.invalid`, passwordHash: 'x', referralCode: `PGF${suffix.slice(0, 8)}` } });
  await a!.futuresBalance.create({ data: { userId: user.id, asset: 'USDT', available: '10000', locked: '1000' } });
  const position = await a!.futuresPosition.create({ data: { userId: user.id, symbol, side, size, entryPrice: '50000', leverage: 10, marginType: 'CROSS', initialMargin: '1000', liquidationPrice: '1', status: 'OPEN' } });
  return { user, position };
}
const service = (db: PrismaClient, at: number) => {
  const marks = new MarkPriceService({} as any);
  jest.spyOn(marks, 'getMarkPrice').mockResolvedValue(new BigNumber('50000'));
  jest.spyOn(marks, 'getIndexPrice').mockResolvedValue(new BigNumber('50000'));
  return new FundingRateService(db, marks, () => [symbol], undefined, () => new Date(at));
};
const available = async (userId: string) => (await a!.futuresBalance.findUniqueOrThrow({ where: { userId_asset: { userId, asset: 'USDT' } } })).available.toString();

describePg('futures funding on real PostgreSQL', () => {
  jest.setTimeout(30_000);
  const users: string[] = [];
  afterAll(async () => {
    if (!a) return;
    await a.fundingPayment.deleteMany({ where: { symbol } });
    await a.fundingRateRecord.deleteMany({ where: { symbol } });
    await a.futuresPosition.deleteMany({ where: { symbol } });
    await a.futuresBalance.deleteMany({ where: { userId: { in: users } } });
    await a.user.deleteMany({ where: { id: { in: users } } });
  });

  test('two instances settling the same boundary at once pay each position exactly once', async () => {
    const long = await seed('LONG', '2'), short = await seed('SHORT', '2');
    users.push(long.user.id, short.user.id);

    const results = await Promise.all([
      service(a!, BOUNDARY + 5).settleFundingForSymbol(symbol),
      service(b!, BOUNDARY + 7).settleFundingForSymbol(symbol),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);

    // 2 × 50 000 × −0.0001 = −10 for the long, × 0.0004 = +40 for the short.
    const payments = await a!.fundingPayment.findMany({ where: { symbol }, orderBy: { amount: 'asc' } });
    expect(payments.map((p) => [p.positionId, p.amount.toString(), p.rate.toString()])).toEqual([
      [long.position.id, '-10', '-0.0001'], [short.position.id, '40', '0.0004'],
    ]);
    expect(await available(long.user.id)).toBe('9990');
    expect(await available(short.user.id)).toBe('10040');
    expect(await a!.fundingRateRecord.count({ where: { symbol } })).toBe(1);

    // A restart later in the same interval settles nothing.
    expect(await service(a!, BOUNDARY + H8 - 1).settleFundingForSymbol(symbol)).toBeNull();
    expect(await a!.fundingPayment.count({ where: { symbol } })).toBe(2);

    // The next boundary settles again, and the earlier payments are unchanged.
    await service(b!, BOUNDARY + H8 + 3).settleFundingForSymbol(symbol);
    expect(await a!.fundingPayment.count({ where: { symbol } })).toBe(4);
    expect(await available(long.user.id)).toBe('9980');
    expect(await available(short.user.id)).toBe('10080');
    const first = await a!.fundingPayment.findMany({ where: { id: { in: payments.map((p) => p.id) } }, orderBy: { amount: 'asc' } });
    expect(first.map((p) => p.amount.toString())).toEqual(['-10', '40']);
  });
});
