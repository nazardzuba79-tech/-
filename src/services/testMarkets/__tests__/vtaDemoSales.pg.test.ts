import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { VtaDemoSales } from '../VtaDemoSales';
import { VOLTORA, testAssetPrivateQuoteAsset } from '../testAssetConfig';
import { publicTestAsset } from '../testMarketService';
import { DemoTradingService } from '../../DemoTradingService';
import { MatchingEngine } from '../../../matching-engine/MatchingEngine';

const url = process.env.VOLTEX_PG_TEST_URL;
const pg = url ? describe : describe.skip;
pg('private VOLTORA demo sale — real PostgreSQL', () => {
  let db: PrismaClient, owner: string, other: string;
  const users: string[] = [];
  const quantity = '4545454.54545454';
  const now = VOLTORA.listingAt + 60_000;
  const privateQuoteAsset = testAssetPrivateQuoteAsset(VOLTORA);
  const service = () => new VtaDemoSales(db, () => now);
  const topUp = () => new DemoTradingService(db, new MatchingEngine());
  const balance = async (asset: string) => (await db.demoBalance.findUnique({ where: { userId_asset: { userId: owner, asset } } }))?.available.toString() ?? '0';
  const privateProceeds = () => balance(privateQuoteAsset);
  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  beforeEach(async () => {
    owner = randomUUID(); other = randomUUID(); users.push(owner, other);
    await db.user.createMany({ data: [owner, other].map(id => ({ id, email: `${id}@vta-test.invalid`, referralCode: id, passwordHash: 'fixture-only', role: 'ADMIN' })) });
    await db.balance.create({ data: { userId: owner, asset: 'USDT', available: '50000', locked: '0' } });
  });
  afterAll(async () => {
    if (!db) return;
    await db.demoTrade.deleteMany({ where: { takerUserId: { in: users } } });
    await db.demoOrder.deleteMany({ where: { userId: { in: users } } });
    await db.demoBalance.deleteMany({ where: { userId: { in: users } } });
    await db.auditLog.deleteMany({ where: { userId: { in: users } } });
    await db.balance.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  });
  const credit = () => topUp().topUp({ userId: owner, asset: 'VTA', amount: quantity, performedByAdminId: owner });
  const sell = (q = quantity, requestId = randomUUID()) => service().sell({ userId: owner, quantity: q, requestId });

  test('credit only the acting admin, with audit and no USDT debit or real balance change', async () => {
    await credit();
    expect(await balance('VTA')).toBe(quantity);
    expect(await balance('USDT')).toBe('0');
    expect(await db.demoBalance.count({ where: { userId: other } })).toBe(0);
    expect((await db.balance.findMany({ where: { userId: owner } })).map(b => [b.asset, b.available.toString()])).toEqual([['USDT', '50000']]);
    expect(await db.auditLog.count({ where: { userId: owner, action: 'DEMO_BALANCE_ADJUSTED' } })).toBe(1);
    await expect(topUp().topUp({ userId: other, asset: 'VTA', amount: quantity, performedByAdminId: owner })).rejects.toThrow();
  });
  test('listing gate refuses before launch and when unarmed, without debit or order', async () => {
    await credit();
    await expect(new VtaDemoSales(db, () => VOLTORA.listingAt - 1).sell({ userId: owner, quantity, requestId: randomUUID() })).rejects.toThrow('листинга');
    const armed = VOLTORA.listingArmed;
    try { VOLTORA.listingArmed = false; await expect(sell()).rejects.toThrow('листинга'); }
    finally { VOLTORA.listingArmed = armed; }
    expect(await balance('VTA')).toBe(quantity);
    expect(await db.demoOrder.count({ where: { userId: owner } })).toBe(0);
  });
  test('full market sale uses server price, survives a fresh service and never reaches real ledgers', async () => {
    await credit();
    const result = await sell();
    const expectedPrice = new BigNumber(publicTestAsset(VOLTORA, now).state.lastPrice!).decimalPlaces(10, BigNumber.ROUND_DOWN);
    expect(result.price).toBe(expectedPrice.toFixed());
    expect(result.proceeds).toBe(expectedPrice.times(quantity).toFixed());
    expect(await balance('VTA')).toBe('0');
    expect(await privateProceeds()).toBe(result.proceeds);
    // Generic demo USDT backs the native Futures sandbox and must stay untouched.
    expect(await balance('USDT')).toBe('0');
    const snapshot = await service().snapshot(owner);
    expect(snapshot.balances.find(b => b.asset === 'USDT')?.available).toBe(result.proceeds);
    expect(snapshot.balances.some(b => b.asset === privateQuoteAsset)).toBe(false);
    expect(snapshot.sales).toHaveLength(1);
    expect(snapshot.sales[0]).toMatchObject(result);
    expect(await db.order.count({ where: { userId: owner } })).toBe(0);
    expect((await db.balance.findMany({ where: { userId: owner } })).map(b => [b.asset, b.available.toString()])).toEqual([['USDT', '50000']]);
    expect(await db.demoBalance.count({ where: { userId: other } })).toBe(0);
  });
  test('private quote proceeds use a pair-scoped row, never the native Futures USDT row', async () => {
    await credit();
    const result = await sell('250');
    expect(privateQuoteAsset).toBe('VTA_PRIVATE_USDT');
    expect(await privateProceeds()).toBe(result.proceeds);
    expect(await balance('USDT')).toBe('0');
    const rows = await db.demoBalance.findMany({ where: { userId: owner }, orderBy: { asset: 'asc' } });
    expect(rows.map(row => row.asset)).toEqual(['VTA', privateQuoteAsset].sort());
  });
  test('partial sales conserve remaining tokens and proceeds', async () => {
    await credit();
    const first = await sell('100.12345678');
    expect(await balance('VTA')).toBe(new BigNumber(quantity).minus(first.quantity).toFixed());
    expect(await privateProceeds()).toBe(first.proceeds);
    expect(await balance('USDT')).toBe('0');
  });
  test('sequential and concurrent identical retries commit one sale; changed quantity conflicts', async () => {
    await credit(); const id = randomUUID();
    const results = await Promise.all([sell('100', id), sell('100', id)]);
    expect(results[0]).toEqual(results[1]);
    expect(await sell('100', id)).toEqual(results[0]);
    await expect(sell('101', id)).rejects.toMatchObject({ status: 409 });
    expect(await db.demoOrder.count({ where: { userId: owner } })).toBe(1);
    expect(await db.demoTrade.count({ where: { takerUserId: owner } })).toBe(1);
    expect(await db.auditLog.count({ where: { userId: owner, action: 'VTA_DEMO_SOLD' } })).toBe(1);
    expect(await privateProceeds()).toBe(results[0].proceeds);
    expect(await balance('USDT')).toBe('0');
  });
  test('competing requests cannot oversell and failed debit rolls back its order', async () => {
    await credit();
    const results = await Promise.allSettled([sell(), sell()]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await balance('VTA')).toBe('0');
    expect(await db.demoOrder.count({ where: { userId: owner } })).toBe(1);
  });
  test('audit failure rolls back tokens, USDT, fill and order', async () => {
    await credit();
    const failing = new Proxy(db, { get(target, prop) {
      if (prop !== '$transaction') return Reflect.get(target, prop);
      return (fn: any) => db.$transaction(tx => fn(new Proxy(tx, { get(t, key) {
        return key === 'auditLog' ? { create: () => { throw new Error('audit fixture outage'); } } : Reflect.get(t, key);
      } })));
    } });
    await expect(new VtaDemoSales(failing, () => now).sell({ userId: owner, quantity, requestId: randomUUID() })).rejects.toThrow('audit fixture outage');
    expect(await balance('VTA')).toBe(quantity); expect(await privateProceeds()).toBe('0'); expect(await balance('USDT')).toBe('0');
    expect(await db.demoOrder.count({ where: { userId: owner } })).toBe(0);
    expect(await db.demoTrade.count({ where: { takerUserId: owner } })).toBe(0);
  });
  test.each(['0', '-1', 'NaN', 'Infinity', '0.000000001', '1000000000000000000'])('rejects invalid quantity %s', async q => {
    await expect(sell(q)).rejects.toThrow();
    expect(await db.demoOrder.count({ where: { userId: owner } })).toBe(0);
  });
  test.each(['blocked', 'customer'])('refuses %s account', async state => {
    await credit();
    await db.user.update({ where: { id: owner }, data: state === 'blocked' ? { blockedAt: new Date() } : { role: 'USER' } });
    await expect(sell()).rejects.toMatchObject({ status: 403 });
    await expect(credit()).rejects.toThrow('Admin access');
    expect(await balance('VTA')).toBe(quantity);
  });
});
