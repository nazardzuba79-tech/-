import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { allocateNrxOwner } from '../nrxAllocation';
import { NEURIX } from '../neurix';
import { OrderService } from '../../OrderService';
import { PriceWatcherService } from '../../PriceWatcherService';
import { simulationFor } from '../testMarketSimulation';
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

  test('exact owner 31,250 NRX, no USDT debit, public airdrop or DemoBalance write', async () => {
    const usdt = await balance(owner, 'USDT');
    expect(await allocateNrxOwner(db, owner)).toMatchObject({ applied: true, quantity: '31250' });
    expect((await balance(owner, 'NRX'))!.available.toString()).toBe('31250');
    expect(await balance(owner, 'USDT')).toEqual(usdt);
    expect(await balance(other, 'NRX')).toBeNull();
    expect(await db.demoBalance.count()).toBe(0);
  });
  test('concurrent/repeated allocation credits once, even after trading reduces inventory', async () => {
    const results = await Promise.all([allocateNrxOwner(db, owner), allocateNrxOwner(db, owner)]);
    expect(results.filter(r => r.applied)).toHaveLength(1);
    await db.balance.update({ where: { userId_asset: { userId: owner, asset: 'NRX' } }, data: { available: '30000' } });
    expect((await allocateNrxOwner(db, owner)).applied).toBe(false);
    expect((await balance(owner, 'NRX'))!.available.toString()).toBe('30000');
  });
  test('unknown/non-admin owner and unexplained prior inventory fail closed', async () => {
    await expect(allocateNrxOwner(db, other)).rejects.toThrow('ADMIN');
    await expect(allocateNrxOwner(db, randomUUID())).rejects.toThrow('ADMIN');
    await db.balance.create({ data: { userId: owner, asset: 'NRX', available: '1' } });
    await expect(allocateNrxOwner(db, owner)).rejects.toThrow('manual review');
    expect((await balance(owner, 'NRX'))!.available.toString()).toBe('1');
  });
  test('normal insufficient funds for BUY/SELL, no order or balance created', async () => {
    await expect(place('BUY', other)).rejects.toThrow('Insufficient USDT balance');
    await expect(place('SELL', other)).rejects.toThrow('Insufficient NRX balance');
    expect(await db.order.count({ where: { userId: other } })).toBe(0);
    expect(await db.balance.count({ where: { userId: other } })).toBe(0);
  });
  test('owner MARKET SELL executes immediately against the explicit NRX simulation counterparty', async () => {
    await allocateNrxOwner(db, owner);
    const beforeUsdt = new BigNumber((await balance(owner, 'USDT'))!.available.toString());
    const expectedPrice = new BigNumber(simulationFor(NEURIX).priceAt(Date.now())!);

    const result = await place('SELL', owner, 'MARKET');

    expect(result.order.status).toBe('FILLED');
    expect(result.order.remainingQuantity.toString()).toBe('0');
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      pair: NEURIX.pair,
      takerUserId: owner,
      makerUserId: 'simulation:NRX',
      side: 'SELL',
    });
    expect(result.trades[0].price.eq(expectedPrice)).toBe(true);
    expect((await balance(owner, 'NRX'))!.available.toString()).toBe('31249');
    expect(new BigNumber((await balance(owner, 'USDT'))!.available.toString()).eq(beforeUsdt.plus(expectedPrice))).toBe(true);
    expect(await db.trade.count({ where: { makerUserId: 'simulation:NRX' } })).toBe(1);
    expect(await db.auditLog.count({ where: { userId: owner, action: 'NRX_SIMULATION_SOLD' } })).toBe(1);
    expect(await balance(other, 'NRX')).toBeNull();
  });

  test('a non-admin account that owns NRX can MARKET SELL against simulation liquidity', async () => {
    await db.balance.create({ data: { userId: other, asset: 'NRX', available: '1' } });
    const beforeUsdt = new BigNumber((await balance(other, 'USDT'))?.available.toString() ?? '0');
    const result = await place('SELL', other, 'MARKET');
    expect(result.order.status).toBe('FILLED');
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ makerUserId: 'simulation:NRX', takerUserId: other, side: 'SELL' });
    expect((await balance(other, 'NRX'))!.available.toString()).toBe('0');
    expect(new BigNumber((await balance(other, 'USDT'))!.available.toString()).gt(beforeUsdt)).toBe(true);
  });

  test('standard SELL rests, ordinary BUY fills real counterparties; display depth adds no trades', async () => {
    await allocateNrxOwner(db, owner);
    await place('SELL');
    expect(await db.trade.count({ where: { makerUserId: owner } })).toBe(0);
    await db.balance.create({ data: { userId: other, asset: 'USDT', available: '10' } });
    await place('BUY', other, 'MARKET');
    expect(await db.trade.count({ where: { makerUserId: owner } })).toBe(1);
    expect((await balance(owner, 'NRX'))!.available.toString()).toBe('31249');
    expect((await balance(other, 'NRX'))!.available.toNumber()).toBeGreaterThan(0);
    expect(source.getTicker).not.toHaveBeenCalled();
  });
  test('prelisting placement fails before account/order writes', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(NEURIX.listingAt - 1);
    const usdt = await balance(owner, 'USDT');
    await expect(place('BUY')).rejects.toThrow('not started');
    expect(await balance(owner, 'USDT')).toEqual(usdt);
    expect(await db.order.count({ where: { userId: owner } })).toBe(0);
  });
  test('all conditional order families use canonical server price, normal ledger and cancellation', async () => {
    for (const type of ['STOP_LIMIT', 'STOP_MARKET', 'TAKE_PROFIT_LIMIT', 'TAKE_PROFIT_MARKET'] as const) {
      const order = await service.placeOrder({ userId: owner, pair: NEURIX.pair, side: 'BUY', type,
        quantity: new BigNumber(1), price: new BigNumber('.8'), triggerPrice: new BigNumber(type.startsWith('STOP') ? '1.5' : '.4') });
      expect(order.order.status).toBe('PENDING_TRIGGER');
      await service.cancelOrder(owner, order.order.id);
    }
    expect((await balance(owner, 'USDT'))!.available.toString()).toBe('1000');
    const oco = await service.placeOcoOrder({ userId: owner, pair: NEURIX.pair, side: 'BUY', quantity: new BigNumber(1),
      takeProfitPrice: new BigNumber('.4'), stopTriggerPrice: new BigNumber('1.5'), stopLimitPrice: new BigNumber('1.6') });
    await service.cancelOrder(owner, oco.takeProfitOrderId);
    expect((await balance(owner, 'USDT'))!.available.toString()).toBe('1000');
    expect(source.getTicker).not.toHaveBeenCalled();
  });
  test('existing conditional watcher triggers from canonical NRX, fills only a real resting counterparty', async () => {
    await allocateNrxOwner(db, owner);
    const triggerPrice = new BigNumber(simulationFor(NEURIX).priceAt(Date.now())!).times('1.1');
    await service.placeOrder({ userId: owner, pair: NEURIX.pair, side: 'SELL', type: 'TAKE_PROFIT_MARKET', triggerPrice, quantity: new BigNumber(1) });
    await db.balance.create({ data: { userId: other, asset: 'USDT', available: '10' } });
    await service.placeOrder({ userId: other, pair: NEURIX.pair, side: 'BUY', type: 'LIMIT', price: new BigNumber(3), quantity: new BigNumber(1) });
    const watcher = new PriceWatcherService(db, service, source);
    expect(await watcher.checkAndTrigger()).toBe(0);
    jest.spyOn(Date, 'now').mockReturnValue(NEURIX.listingAt + 6 * 3600000);
    expect(await watcher.checkAndTrigger()).toBe(1);
    expect(await db.trade.count({ where: { takerUserId: owner } })).toBe(1);
    expect(source.getTicker).not.toHaveBeenCalled();
  });
});
