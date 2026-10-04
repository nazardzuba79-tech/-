import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { randomUUID } from 'crypto';
import { NrxDemoSales } from '../NrxDemoSales';
import { NEURIX } from '../neurix';
import { publicTestAsset } from '../testMarketService';

const url = process.env.NRX_DEMO_TEST_DATABASE_URL;
if (url) { const u = new URL(url); if (u.hostname !== '127.0.0.1' || u.pathname !== '/voltex_nrx_demo_test') throw new Error('Disposable loopback NRX demo database required'); }
const pg = url ? describe : describe.skip;
pg('NRX isolated simulation on real disposable PostgreSQL', () => {
  let db: PrismaClient, actor: string, other: string;
  const now = NEURIX.listingAt + 60_000;
  const service = () => new NrxDemoSales(db, () => now);
  const balance = (asset: string) => db.demoBalance.findUnique({ where: { userId_asset: { userId: actor, asset } } });
  const real = async () => ({
    balances: await db.balance.findMany({ where: { userId: actor }, orderBy: { asset: 'asc' } }),
    orders: await db.order.findMany({ where: { userId: actor } }),
    trades: await db.trade.findMany({ where: { OR: [{ takerUserId: actor }, { makerUserId: actor }] } }),
  });
  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  beforeEach(async () => {
    actor = randomUUID(); other = randomUUID();
    await db.user.createMany({ data: [actor, other].map((id, i) => ({ id, email: `${id}@demo.invalid`, referralCode: id, passwordHash: 'fixture', role: i ? 'USER' : 'ADMIN' })) });
    await db.balance.createMany({ data: [{ userId: actor, asset: 'NRX', available: '31250', locked: '1' }, { userId: actor, asset: 'USDT', available: '123', locked: '7' }] });
    await db.demoBalance.createMany({ data: [{ userId: actor, asset: 'NRX', available: '10', locked: '2' }, { userId: actor, asset: 'USDT', available: '25' }, { userId: actor, asset: 'VTA', available: '13' }] });
  });
  afterAll(async () => { await db.$disconnect(); });

  test('fills at server simulation price without a book; writes only demo balances and receipts', async () => {
    const before = await real();
    const result = await service().sell({ userId: actor, requestId: randomUUID(), quantity: '2.5' });
    const price = new BigNumber(publicTestAsset(NEURIX, now).state.lastPrice!).decimalPlaces(10, BigNumber.ROUND_DOWN);
    expect(result.price).toBe(price.toFixed());
    expect(result.proceeds).toBe(price.times('2.5').toFixed());
    expect((await balance('NRX'))!.available.toString()).toBe('7.5');
    expect((await balance('NRX'))!.locked.toString()).toBe('2');
    expect(new BigNumber((await balance('USDT'))!.available.toString()).eq(new BigNumber(25).plus(result.proceeds))).toBe(true);
    expect((await balance('VTA'))!.available.toString()).toBe('13');
    expect(await real()).toEqual(before);
    expect(await db.demoTrade.findUnique({ where: { id: result.id } })).toMatchObject({ makerUserId: 'simulation:NRX', takerUserId: actor });
    expect(await db.auditLog.count({ where: { userId: actor, action: 'NRX_DEMO_SOLD' } })).toBe(1);
  });

  test('same key replays once across concurrent requests and service restart', async () => {
    const params = { userId: actor, requestId: randomUUID(), quantity: '3' };
    const results = await Promise.all([service().sell(params), service().sell(params)]);
    expect(results[1]).toEqual(results[0]);
    expect(await service().sell(params)).toEqual(results[0]);
    expect((await balance('NRX'))!.available.toString()).toBe('7');
    expect(await db.demoOrder.count({ where: { userId: actor, pair: NEURIX.pair } })).toBe(1);
    expect(await db.demoTrade.count({ where: { takerUserId: actor, pair: NEURIX.pair } })).toBe(1);
    expect((await service().operation(actor, params.requestId)).receipt?.id).toBe(results[0].id);
    await expect(service().sell({ ...params, quantity: '4' })).rejects.toMatchObject({ status: 409 });
  });

  test('different concurrent requests cannot oversell or consume locked tokens', async () => {
    const before = await real();
    const results = await Promise.allSettled([1, 2].map(() => service().sell({ userId: actor, requestId: randomUUID(), quantity: '7' })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await balance('NRX'))!.available.toString()).toBe('3');
    expect((await balance('NRX'))!.locked.toString()).toBe('2');
    expect(await db.demoOrder.count({ where: { userId: actor } })).toBe(1);
    expect(await real()).toEqual(before);
  });

  test('snapshot and failed sell never copy legacy ordinary NRX into the simulation', async () => {
    await db.demoBalance.delete({ where: { userId_asset: { userId: actor, asset: 'NRX' } } });
    const before = await real();
    const snapshot = await service().snapshot(actor);
    expect(snapshot.account.active).toBe(false);
    expect(snapshot.balances.find(b => b.asset === 'NRX')?.available).toBe('0');
    await expect(service().sell({ userId: actor, requestId: randomUUID(), quantity: '1' })).rejects.toMatchObject({ status: 400 });
    expect(await real()).toEqual(before);
    expect(await db.demoOrder.count({ where: { userId: actor } })).toBe(0);
    expect(await balance('NRX')).toBeNull();
  });

  test('transaction rolls back order, inventory and cash when audit persistence fails', async () => {
    const before = await real();
    const beforeDemo = await db.demoBalance.findMany({ where: { userId: actor }, orderBy: { asset: 'asc' } });
    const broken = new Proxy(db, { get(target, key) {
      if (key === '$transaction') return (run: any) => target.$transaction(tx => run(new Proxy(tx, { get(t, k) {
        if (k === 'auditLog') return { create: () => { throw new Error('fixture audit failure'); } };
        const value = Reflect.get(t, k); return typeof value === 'function' ? value.bind(t) : value;
      } })));
      const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await expect(new NrxDemoSales(broken, () => now).sell({ userId: actor, requestId: randomUUID(), quantity: '2' })).rejects.toThrow('fixture audit failure');
    expect(await db.demoOrder.count({ where: { userId: actor } })).toBe(0);
    expect(await db.demoBalance.findMany({ where: { userId: actor }, orderBy: { asset: 'asc' } })).toEqual(beforeDemo);
    expect(await real()).toEqual(before);
  });

  test('authorization, prelisting and invalid quantities fail before successful writes', async () => {
    await expect(service().snapshot(other)).rejects.toMatchObject({ status: 403 });
    await expect(service().sell({ userId: other, requestId: randomUUID(), quantity: '1' })).rejects.toMatchObject({ status: 403 });
    await expect(new NrxDemoSales(db, () => NEURIX.listingAt - 1).sell({ userId: actor, requestId: randomUUID(), quantity: '1' })).rejects.toMatchObject({ status: 400 });
    for (const quantity of ['NaN', 'Infinity', '-1', '0', '0.123456789', '1000000000000000000']) {
      await expect(service().sell({ userId: actor, requestId: randomUUID(), quantity })).rejects.toMatchObject({ status: 400 });
    }
    expect(await db.demoOrder.count({ where: { userId: actor } })).toBe(0);
    await db.user.update({ where: { id: actor }, data: { blockedAt: new Date() } });
    await expect(service().snapshot(actor)).rejects.toMatchObject({ status: 403 });
  });
});
