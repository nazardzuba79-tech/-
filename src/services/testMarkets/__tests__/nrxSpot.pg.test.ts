import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { allocateNrxOwner } from '../nrxAllocation';
import { NEURIX } from '../neurix';
import { OrderService } from '../../OrderService';
import { MatchingEngine } from '../../../matching-engine/MatchingEngine';

const url = process.env.VOLTEX_NRX_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_nrx_test') throw new Error('NRX tests require disposable loopback voltex_nrx_test database');
}
const pg = url ? describe : describe.skip;
pg('NRX normal Spot ledger on disposable PostgreSQL', () => {
  const users: string[] = [];
  let db: PrismaClient, owner: string, other: string, engine: MatchingEngine, service: OrderService;
  const source = { getTicker: jest.fn().mockRejectedValue(new Error('No external price for NRX')) };
  const balance = (userId: string, asset: string) => db.balance.findUnique({ where: { userId_asset: { userId, asset } } });
  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NEURIX.listingAt + 60_000);
    owner = randomUUID(); other = randomUUID(); users.push(owner, other);
    await db.user.createMany({ data: [owner, other].map((id, i) => ({ id, email: `${id}@nrx.invalid`, referralCode: id, passwordHash: 'fixture', role: i ? 'USER' : 'ADMIN' })) });
    await db.balance.create({ data: { userId: owner, asset: 'USDT', available: '1000' } });
    engine = new MatchingEngine(); service = new OrderService(db, engine, source);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await db.auditLog.deleteMany({ where: { userId: { in: users } } });
  });
  afterAll(async () => { await db.$disconnect(); }); // whole disposable cluster is removed by the runner
  const place = (side: 'BUY' | 'SELL', userId = owner, type: 'LIMIT' | 'MARKET' = 'LIMIT') => service.placeOrder({ userId, pair: NEURIX.pair, side, type, price: new BigNumber('.8'), quantity: new BigNumber(1) });

  test('exact owner 6,250 NRX, no USDT debit, public airdrop or DemoBalance write', async () => {
    const usdt = await balance(owner, 'USDT');
    expect(await allocateNrxOwner(db, owner)).toMatchObject({ applied: true, quantity: '6250' });
    expect((await balance(owner, 'NRX'))!.available.toString()).toBe('6250');
    expect(await balance(owner, 'USDT')).toEqual(usdt);
    expect(await balance(other, 'NRX')).toBeNull();
    expect(await db.demoBalance.count()).toBe(0);
  });
  test('concurrent/repeated allocation credits once, even after trading reduces inventory', async () => {
    const results = await Promise.all([allocateNrxOwner(db, owner), allocateNrxOwner(db, owner)]);
    expect(results.filter(r => r.applied)).toHaveLength(1);
    await db.balance.update({ where: { userId_asset: { userId: owner, asset: 'NRX' } }, data: { available: '6000' } });
    expect((await allocateNrxOwner(db, owner)).applied).toBe(false);
    expect((await balance(owner, 'NRX'))!.available.toString()).toBe('6000');
  });
  test('unknown/non-admin owner and unexplained prior inventory fail closed', async () => {
    await expect(allocateNrxOwner(db, other)).rejects.toThrow('ADMIN');
    await expect(allocateNrxOwner(db, randomUUID())).rejects.toThrow('ADMIN');
    await db.balance.create({ data: { userId: owner, asset: 'NRX', available: '1' } });
    await expect(allocateNrxOwner(db, owner)).rejects.toThrow('manual review');
    expect((await balance(owner, 'NRX'))!.available.toString()).toBe('1');
  });

  test('a retired NRX market rejects both sides and all alternate pairs before any account write', async () => {
    await allocateNrxOwner(db, owner);
    const initialNrx = (await balance(owner, 'NRX'))!.available.toString();
    const initialUsdt = (await balance(owner, 'USDT'))!.available.toString();
    const count = await db.order.count({ where: { userId: owner } });
    for (const pair of ['NRX/USDT', 'NRX-USDT', 'NRX/BTC', 'BTC/NRX', 'NRX/SIMUSDT', 'NRXSIMUSDT']) {
      for (const side of ['BUY', 'SELL'] as const) {
        await expect(service.placeOrder({ userId: owner, pair, side, type: 'LIMIT',
          price: new BigNumber('0.8'), quantity: new BigNumber('1') }))
          .rejects.toThrow('NRX is no longer available');
      }
    }
    expect((await balance(owner, 'NRX'))!.available.toString()).toBe(initialNrx);
    expect((await balance(owner, 'USDT'))!.available.toString()).toBe(initialUsdt);
    expect(await db.order.count({ where: { userId: owner } })).toBe(count);
    expect(await db.trade.count({ where: { takerUserId: owner } })).toBe(0);
    expect(source.getTicker).not.toHaveBeenCalled();
  });

  test('a service restart does not restore retired NRX trading or change owner inventory', async () => {
    await allocateNrxOwner(db, owner);
    const before = await balance(owner, 'NRX');
    const restarted = new OrderService(db, new MatchingEngine(), source);
    await expect(restarted.placeOrder({ userId: owner, pair: NEURIX.pair, side: 'SELL',
      type: 'MARKET', quantity: new BigNumber('1') })).rejects.toThrow('NRX is no longer available');
    expect((await balance(owner, 'NRX'))!.available.toString()).toBe(before!.available.toString());
    expect(await db.order.count({ where: { userId: owner } })).toBe(0);
  });
});
