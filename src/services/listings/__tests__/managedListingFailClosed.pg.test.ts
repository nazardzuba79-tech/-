/**
 * Managed listings against a real (disposable, loopback) PostgreSQL.
 * Owner-required behaviour is pinned: a listing closed to new public orders
 * (tradable:false) keeps triggering existing conditional and OCO orders on its
 * model price (bot training), and those executions settle in the ordinary
 * Spot ledger (`balance`, `trade`), which is documented for review, not changed.
 * Fail closed: while Render cannot tell which pairs are managed listings, an
 * unknown, venue-unpriced pair is refused through the service and the REST
 * routes. Synthetic users and fixtures only.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'listing-fail-closed-fixture-secret';
process.env.API_KEY_ENCRYPTION_SECRET = process.env.API_KEY_ENCRYPTION_SECRET || '0'.repeat(64);

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { listingSimulationConfig, type ListingConfig } from '../listingConfig';
import { setManagedListingAssets } from '../managedSnapshot';
import { managedListingRegistry } from '../registry';
import { OrderService } from '../../OrderService';
import { PriceWatcherService } from '../../PriceWatcherService';
import { SPOT_PAIR_UNRESOLVED_MESSAGE } from '../../testMarkets/nrxSpot';
import { simulationFor } from '../../testMarkets/testMarketSimulation';
import { MatchingEngine } from '../../../matching-engine/MatchingEngine';
import { ordersRouter } from '../../../api/routes/orders';

const url = process.env.VOLTEX_LISTING_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_listing_test') throw new Error('Fail-closed tests require the disposable loopback voltex_listing_test database');
}
const pg = url ? describe : describe.skip;

const LISTING_AT = Date.parse('2026-10-01T12:00:00.000Z');
// The venue prices ordinary crypto only; a managed or Worker-only pair has no venue price.
const venue = { getTicker: jest.fn(async (pair: string) => (pair === 'BTC/USDT' ? { lastPrice: '60000' } : null)) };

pg('managed listings fail closed on disposable PostgreSQL', () => {
  let db: PrismaClient, engine: MatchingEngine, service: OrderService, watcher: PriceWatcherService;
  let seller: string, buyer: string, symbol: string, pair: string;
  // A published (already open) listing, as Render's registry would hold it.
  const listing = (tradable: boolean): ListingConfig => ({
    schemaVersion: 1, symbol, name: 'Fail-closed QA', logo: null, initialPrice: '0.25', listingAt: new Date(LISTING_AT).toISOString(),
    displayTimeZone: 'UTC', ownerAllocation: '0', seedMode: 'manual', seed: 'fail-closed-20261001-synthetic', tradable,
  });
  const publish = (tradable: boolean) => setManagedListingAssets([listingSimulationConfig(listing(tradable))]);
  const priceAt = (at: number) => new BigNumber(simulationFor(listingSimulationConfig(listing(true))).priceAt(at)!);
  const balances = async () => (await db.balance.findMany({ where: { userId: { in: [seller, buyer] } }, orderBy: [{ userId: 'asc' }, { asset: 'asc' }] }))
    .map(b => [b.userId, b.asset, b.available.toString(), b.locked.toString()]);
  const orders = async () => (await db.order.findMany({ where: { userId: { in: [seller, buyer] } }, orderBy: { id: 'asc' } })).map(o => [o.id, o.type, o.status, o.remainingQuantity.toString()]);
  const trades = () => db.trade.count({ where: { pair } });

  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  afterAll(async () => { setManagedListingAssets([]); await db.$disconnect(); });
  beforeEach(async () => {
    seller = randomUUID(); buyer = randomUUID();
    symbol = `F${randomUUID().replace(/[^A-Z]/gi, '').slice(0, 5).toUpperCase()}`;
    pair = `${symbol}/USDT`;
    await db.user.createMany({ data: [seller, buyer].map(id => ({ id, email: `${id}@failclosed.invalid`, referralCode: id, passwordHash: 'fixture', role: 'USER' })) });
    await db.balance.createMany({ data: [
      { userId: seller, asset: symbol, available: '10' },
      { userId: buyer, asset: 'USDT', available: '100000' },
    ] });
    engine = new MatchingEngine();
    service = new OrderService(db, engine, venue);
    watcher = new PriceWatcherService(db, service, venue);
  });
  afterEach(() => { jest.restoreAllMocks(); setManagedListingAssets([]); });

  test('owner-required: closed to new public orders, existing conditional and OCO orders still trigger on the model price; settlement is the ordinary Spot ledger', async () => {
    const placedAt = LISTING_AT + 2 * 3_600_000;
    jest.spyOn(Date, 'now').mockReturnValue(placedAt);
    publish(true);
    const p1 = priceAt(placedAt);
    // A resting bid far above the model price: whatever triggers fills against it.
    await service.placeOrder({ userId: buyer, pair, side: 'BUY', type: 'LIMIT', price: p1.times(3).decimalPlaces(8), quantity: new BigNumber(5) });
    const tp = await service.placeOrder({ userId: seller, pair, side: 'SELL', type: 'TAKE_PROFIT_LIMIT', price: p1.times(1.0001).decimalPlaces(10),
      triggerPrice: p1.times(1.0001).decimalPlaces(10), quantity: new BigNumber(1) });
    const oco = await service.placeOcoOrder({ userId: seller, pair, side: 'SELL', quantity: new BigNumber(1), takeProfitPrice: p1.times(1.0002).decimalPlaces(10),
      stopTriggerPrice: p1.times(0.9).decimalPlaces(10), stopLimitPrice: p1.times(0.89).decimalPlaces(10) });
    expect(tp.order.status).toBe('PENDING_TRIGGER');

    // A later moment where the model price passes both take-profit triggers.
    let firesAt = placedAt;
    while (priceAt(firesAt).lt(p1.times(1.0002))) { firesAt += 60_000; if (firesAt > placedAt + 7 * 86_400_000) throw new Error('fixture: no crossing found'); }
    (Date.now as jest.Mock).mockReturnValue(firesAt);

    // Closed to new public orders...
    publish(false);
    await expect(service.placeOrder({ userId: seller, pair, side: 'SELL', type: 'LIMIT', price: p1, quantity: new BigNumber(1) })).rejects.toThrow('Fail-closed QA is not available for trading.');
    // ...but the resting orders keep running on the model price, exactly as before.
    await expect(watcher.checkAndTrigger()).resolves.toBe(2);
    const after = await db.order.findMany({ where: { userId: seller } });
    expect(after.find(o => o.id === oco.stopOrderId)!.status).toBe('CANCELLED');
    expect(after.filter(o => o.status === 'FILLED')).toHaveLength(2);
    expect(await trades()).toBe(2);
    const base = (await db.balance.findMany({ where: { asset: symbol, userId: { in: [seller, buyer] } } }))
      .reduce((sum, b) => sum.plus(b.available.toString()).plus(b.locked.toString()), new BigNumber(0));
    expect(base.toString()).toBe('10');
    const sellerBase = await db.balance.findUnique({ where: { userId_asset: { userId: seller, asset: symbol } } });
    expect([sellerBase!.available.toString(), sellerBase!.locked.toString()]).toEqual(['8', '0']);
    // Ledger boundary, for review: the proceeds are USDT in the seller's ordinary Spot `balance` row
    // (the table deposits and withdrawals use), between two real user ids; nothing in DemoBalance.
    const sellerUsdt = await db.balance.findUnique({ where: { userId_asset: { userId: seller, asset: 'USDT' } } });
    expect(new BigNumber(sellerUsdt!.available.toString()).gt(0)).toBe(true);
    expect(await db.trade.count({ where: { pair, makerUserId: buyer, takerUserId: seller } })).toBe(2);
    expect(await db.demoBalance.count({ where: { userId: { in: [seller, buyer] } } })).toBe(0);
  });

  describe('while Render cannot tell which pairs are managed listings (cold start, failed or stale registry)', () => {
    const worker = 'VHX9/USDT';
    beforeEach(() => {
      jest.spyOn(managedListingRegistry, 'ensureFresh').mockResolvedValue(undefined);
      jest.spyOn(managedListingRegistry, 'resolved').mockReturnValue(false);
    });
    const authorized = (userId: string) => `Bearer ${jwt.sign({ sub: userId, sid: `fail-closed:${userId}` }, process.env.JWT_SECRET!)}`;
    const app = () => {
      // Real orders router and disposable database; only the session lookup is a fixture.
      const sessions = { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, userId: where.id.replace('fail-closed:', ''), revokedAt: null, lastSeenAt: new Date() }) };
      const prisma = new Proxy(db, { get: (target, key) => {
        if (key === 'session') return sessions;
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      } });
      return express().use(express.json()).use('/api/v1', ordersRouter(prisma, engine, venue));
    };

    test('service: an unknown, venue-unpriced pair is refused for LIMIT, conditional and OCO, before any lock or row', async () => {
      const before = await balances();
      await expect(service.placeOrder({ userId: buyer, pair: worker, side: 'BUY', type: 'LIMIT', price: new BigNumber(1), quantity: new BigNumber(1) })).rejects.toThrow(SPOT_PAIR_UNRESOLVED_MESSAGE);
      await expect(service.placeOrder({ userId: buyer, pair: worker, side: 'BUY', type: 'STOP_LIMIT', price: new BigNumber(1), triggerPrice: new BigNumber(1), quantity: new BigNumber(1) })).rejects.toThrow(SPOT_PAIR_UNRESOLVED_MESSAGE);
      await expect(service.placeOcoOrder({ userId: buyer, pair: worker, side: 'BUY', quantity: new BigNumber(1), takeProfitPrice: new BigNumber(1),
        stopTriggerPrice: new BigNumber(2), stopLimitPrice: new BigNumber(2) })).rejects.toThrow(SPOT_PAIR_UNRESOLVED_MESSAGE);
      expect(await db.order.count({ where: { userId: buyer } })).toBe(0);
      expect(await balances()).toEqual(before);
      // A legitimate venue pair is not rejected.
      await expect(service.placeOrder({ userId: buyer, pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(1000), quantity: new BigNumber('0.01') }))
        .resolves.toMatchObject({ order: expect.objectContaining({ pair: 'BTC/USDT' }) });
    });

    test('REST: POST /orders and /orders/oco answer 400 with the customer-safe refusal; nothing is written', async () => {
      const server = app();
      const order = await request(server).post('/api/v1/orders').set('Authorization', authorized(buyer)).send({ pair: worker, side: 'BUY', type: 'LIMIT', price: '1', quantity: '1' });
      expect(order.status).toBe(400);
      expect(order.body).toEqual({ error: SPOT_PAIR_UNRESOLVED_MESSAGE });
      const conditional = await request(server).post('/api/v1/orders').set('Authorization', authorized(buyer)).send({ pair: worker, side: 'BUY', type: 'STOP_MARKET', triggerPrice: '1', quantity: '1' });
      expect(conditional.status).toBe(400);
      const oco = await request(server).post('/api/v1/orders/oco').set('Authorization', authorized(buyer))
        .send({ pair: worker, side: 'BUY', quantity: '1', takeProfitPrice: '1', stopTriggerPrice: '2', stopLimitPrice: '2' });
      expect(oco.status).toBe(400);
      expect(oco.body).toEqual({ error: SPOT_PAIR_UNRESOLVED_MESSAGE });
      expect(await db.order.count({ where: { userId: buyer } })).toBe(0);
    });

    test('recovered: once the listings are known, an unknown pair is not a managed listing and its ordinary path is unchanged', async () => {
      (managedListingRegistry.resolved as jest.Mock).mockReturnValue(true);
      await expect(service.placeOrder({ userId: buyer, pair: worker, side: 'BUY', type: 'LIMIT', price: new BigNumber(1), quantity: new BigNumber(1) }))
        .resolves.toMatchObject({ order: expect.objectContaining({ pair: worker }) });
    });
  });
});
