/** Explicitly opted-in, real statements on the dedicated disposable TEST PostgreSQL (see private-trading workflow). */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { fundingTermsAt, NATIVE_FUNDING_INTERVAL_MS } from '../native/fundingModel';
import { pinNativeFundingSchedule } from '../native/store';

/**
 * THE FUNDING VERSION IS PINNED ONCE, IN THE DATABASE, AND NEVER MOVES.
 *
 * Two processes starting together must agree on one start boundary; a
 * restart must read the same row; and the row itself refuses UPDATE and
 * DELETE, so nobody can re-price settlements after the fact by editing it.
 * Each run uses its own version name: the rows are immutable by design.
 */
const enabled = process.env.PRIVATE_TRADING_DB_TESTS === '1';
if (enabled) {
  require('dotenv').config();
  const hostname = new URL(process.env.DATABASE_URL ?? '').hostname;
  if (!['localhost', '127.0.0.1'].includes(hostname)) throw new Error('Native funding DB tests run only against a disposable loopback TEST database');
}
const dbDescribe = enabled ? describe : describe.skip;
const F = NATIVE_FUNDING_INTERVAL_MS;
const T = 1_728_000_000_000;
const terms = (version: string) => ({ version, longCashflow: '-0.0001', shortCashflow: '0.0004' });

dbDescribe('native funding model on real TEST PostgreSQL', () => {
  let db: PrismaClient, secondProcessDb: PrismaClient;
  beforeAll(async () => { db = new PrismaClient(); secondProcessDb = new PrismaClient(); await Promise.all([db.$connect(), secondProcessDb.$connect()]); }, 20000);
  afterAll(async () => { await Promise.all([db?.$disconnect(), secondProcessDb?.$disconnect()]); });

  test('two processes starting together pin ONE boundary, and a restart reads it back', async () => {
    const model = terms(`TEST_${randomUUID().replace(/-/g, '')}`);
    const [a, b] = await Promise.all([
      pinNativeFundingSchedule(db, model, () => T + 3_600_000),
      pinNativeFundingSchedule(secondProcessDb, model, () => T + 2 * F - 1),
    ]);
    expect(a).toEqual(b);
    const start = fundingTermsAt(a, Number.MAX_SAFE_INTEGER).effectiveFrom;
    expect([T + F, T + 2 * F]).toContain(start);
    const restarted = await pinNativeFundingSchedule(db, model, () => T + 100 * F);
    expect(restarted).toEqual(a);
    expect(await db.nativeFundingModel.count({ where: { version: model.version } })).toBe(1);
  });

  test('the pinned row refuses UPDATE and DELETE', async () => {
    const model = terms(`TEST_${randomUUID().replace(/-/g, '')}`);
    const version = model.version;
    await pinNativeFundingSchedule(db, model, () => T);
    await expect(db.nativeFundingModel.update({ where: { version }, data: { longCashflow: '0.0001' } })).rejects.toThrow();
    await expect(db.$executeRaw`UPDATE "NativeFundingModel" SET "effectiveFrom" = now() WHERE version = ${version}`).rejects.toThrow();
    await expect(db.$executeRaw`DELETE FROM "NativeFundingModel" WHERE version = ${version}`).rejects.toThrow();
    expect(await db.nativeFundingModel.findUnique({ where: { version } })).toMatchObject({ longCashflow: '-0.0001', shortCashflow: '0.0004', effectiveFrom: new Date(T + F) });
  });

  test('different rates under a pinned version are refused, never applied', async () => {
    const model = terms(`TEST_${randomUUID().replace(/-/g, '')}`);
    await pinNativeFundingSchedule(db, model, () => T);
    await expect(pinNativeFundingSchedule(db, { ...model, longCashflow: '0.0001' }, () => T)).rejects.toThrow('FUNDING_MODEL_CONFLICT');
    await expect(pinNativeFundingSchedule(db, { ...model, shortCashflow: '0.004' }, () => T)).rejects.toThrow('FUNDING_MODEL_CONFLICT');
  });
});
