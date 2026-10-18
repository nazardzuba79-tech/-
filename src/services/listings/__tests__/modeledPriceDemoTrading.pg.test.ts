/**
 * Owner-required demo trading on a model price, pinned on the existing Spot
 * path of a managed listing against a real (disposable, loopback) PostgreSQL.
 * Nothing new is built: the established OrderService / PriceWatcherService
 * flow and its `balance` rows are what manual Buy/Sell and bots use today.
 *
 * - a buy reserves and spends exactly, a sell credits exactly;
 * - an insufficient balance is refused before any lock or row;
 * - a cancel releases the reservation, once, however often it is retried;
 * - STOP / TAKE_PROFIT trigger on the model price, once, under concurrent sweeps;
 * - an OCO reserve is released once when both legs are cancelled at the same time;
 * - the model price is served without a venue call; Futures and DemoBalance rows are untouched.
 *
 * Synthetic users and fixtures only.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'modeled-demo-trading-fixture-secret';
process.env.API_KEY_ENCRYPTION_SECRET = process.env.API_KEY_ENCRYPTION_SECRET || '0'.repeat(64);

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { listingSimulationConfig, type ListingConfig } from '../listingConfig';
import { setManagedListingAssets } from '../managedSnapshot';
import { OrderService } from '../../OrderService';
import { PriceWatcherService } from '../../PriceWatcherService';
import { simulationFor } from '../../testMarkets/testMarketSimulation';
import { MatchingEngine } from '../../../matching-engine/MatchingEngine';

const url = process.env.VOLTEX_LISTING_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_listing_test') throw new Error('Modeled-price demo trading tests require the disposable loopback voltex_listing_test database');
}
const pg = url ? describe : describe.skip;

const LISTING_AT = Date.parse('2026-10-01T12:00:00.000Z');
const PLACED_AT = LISTING_AT + 2 * 3_600_000;
const venue = { getTicker: jest.fn(async (pair: string) => (pair === 'BTC/USDT' ? { lastPrice: '60000' } : null)) };
const dec = (v: { toString(): string }) => new BigNumber(v.toString());

pg('demo trading on a model price, existing Spot path, disposable PostgreSQL', () => {
  let db: PrismaClient, engine: MatchingEngine, service: OrderService;
  let seller: string, buyer: string, symbol: string, pair: string;
  const listing = (): ListingConfig => ({
    schemaVersion: 1, symbol, name: 'Modeled demo QA', logo: null, initialPrice: '0.25', listingAt: new Date(LISTING_AT).toISOString(),
    displayTimeZone: 'UTC', ownerAllocation: '0', seedMode: 'manual', seed: 'modeled-demo-20261001-synthetic', tradable: true,
  });
  let model: ReturnType<typeof simulationFor> | null = null;
  const priceAt = (at: number) => new BigNumber((model ??= simulationFor(listingSimulationConfig(listing()))).priceAt(at)!);
  const balance = async (userId: string, asset: string) => {
    const row = await db.balance.findUnique({ where: { userId_asset: { userId, asset } } });
    return row ? [row.available.toString(), row.locked.toString()] : null;
  };
  const untouched = async () => [
    (await db.futuresBalance.findMany({ where: { userId: { in: [seller, buyer] } }, orderBy: { userId: 'asc' } })).map(b => [b.userId, b.asset, b.available.toString(), b.locked.toString(), b.updatedAt.toISOString()]),
    await db.demoBalance.count({ where: { userId: { in: [seller, buyer] } } }),
  ];
  const firstTime = (from: number, hit: (price: BigNumber) => boolean) => {
    for (let at = from; at <= from + 14 * 86_400_000; at += 60_000) if (hit(priceAt(at))) return at;
    throw new Error('fixture: no crossing found');
  };

  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  afterAll(async () => { setManagedListingAssets([]); await db.$disconnect(); });
  beforeEach(async () => {
    seller = randomUUID(); buyer = randomUUID();
    symbol = `M${randomUUID().replace(/[^A-Z]/gi, '').slice(0, 5).toUpperCase()}`;
    pair = `${symbol}/USDT`;
    model = null;
    await db.user.createMany({ data: [seller, buyer].map(id => ({ id, email: `${id}@modeled-demo.invalid`, referralCode: id, passwordHash: 'fixture', role: 'USER' })) });
    await db.balance.createMany({ data: [
      { userId: seller, asset: symbol, available: '10' },
      { userId: buyer, asset: 'USDT', available: '1000' },
    ] });
    // An existing Futures account must come out of every Spot demo trade unchanged.
    await db.futuresBalance.createMany({ data: [{ userId: buyer, asset: 'USDT', available: '321.5', locked: '12.25' }, { userId: seller, asset: 'USDT', available: '7' }] });
    engine = new MatchingEngine();
    service = new OrderService(db, engine, venue);
    venue.getTicker.mockClear();
    jest.spyOn(Date, 'now').mockReturnValue(PLACED_AT);
    setManagedListingAssets([listingSimulationConfig(listing())]);
  });
  afterEach(() => { jest.restoreAllMocks(); setManagedListingAssets([]); });

  test('manual Buy/Sell at the model price: exact reserve, spend and credit; insufficient balance refused; cancel releases once, also when retried concurrently', async () => {
    const futuresBefore = await untouched();
    const p = priceAt(PLACED_AT).decimalPlaces(8);

    const bid = await service.placeOrder({ userId: buyer, pair, side: 'BUY', type: 'LIMIT', price: p, quantity: new BigNumber(4) });
    expect(bid.order.status).toBe('OPEN');
    expect(await balance(buyer, 'USDT')).toEqual([new BigNumber(1000).minus(p.times(4)).toString(), p.times(4).toString()]);

    // The sell crosses the resting bid: 3 fill at the bid's price.
    const ask = await service.placeOrder({ userId: seller, pair, side: 'SELL', type: 'LIMIT', price: p, quantity: new BigNumber(3) });
    expect(ask.order.status).toBe('FILLED');
    const trades = await db.trade.findMany({ where: { pair } });
    expect(trades.map(t => [dec(t.price).toString(), dec(t.quantity).toString(), t.makerUserId, t.takerUserId])).toEqual([[p.toString(), '3', buyer, seller]]);
    expect(await balance(buyer, 'USDT')).toEqual([new BigNumber(1000).minus(p.times(4)).toString(), p.toString()]);
    expect(await balance(buyer, symbol)).toEqual(['3', '0']);
    expect(await balance(seller, symbol)).toEqual(['7', '0']);
    expect(await balance(seller, 'USDT')).toEqual([p.times(3).toString(), '0']);

    // Insufficient balance: refused before any lock or row.
    const ordersBefore = await db.order.count({ where: { userId: { in: [seller, buyer] } } });
    const before = [await balance(buyer, 'USDT'), await balance(seller, symbol)];
    await expect(service.placeOrder({ userId: buyer, pair, side: 'BUY', type: 'LIMIT', price: p, quantity: new BigNumber(1000).div(p).integerValue(BigNumber.ROUND_CEIL) })).rejects.toThrow();
    await expect(service.placeOrder({ userId: seller, pair, side: 'SELL', type: 'LIMIT', price: p, quantity: new BigNumber(8) })).rejects.toThrow();
    await expect(service.placeOrder({ userId: buyer, pair, side: 'BUY', type: 'TAKE_PROFIT_LIMIT', price: p.times(0.999).decimalPlaces(8), triggerPrice: p.times(0.999).decimalPlaces(8), quantity: new BigNumber(100000) })).rejects.toThrow();
    expect(await db.order.count({ where: { userId: { in: [seller, buyer] } } })).toBe(ordersBefore);
    expect([await balance(buyer, 'USDT'), await balance(seller, symbol)]).toEqual(before);

    // Cancel releases the remaining reservation; a retry is a no-op.
    expect(await service.cancelOrder(buyer, bid.order.id)).not.toBeNull();
    expect(await balance(buyer, 'USDT')).toEqual([new BigNumber(1000).minus(p.times(3)).toString(), '0']);
    expect(await service.cancelOrder(buyer, bid.order.id)).toBeNull();
    expect(await service.cancelOrder(seller, ask.order.id)).toBeNull();

    // The same cancel sent three times at once releases once.
    const low = p.times(0.5).decimalPlaces(8);
    const resting = await service.placeOrder({ userId: buyer, pair, side: 'BUY', type: 'LIMIT', price: low, quantity: new BigNumber(2) });
    const conditional = await service.placeOrder({ userId: buyer, pair, side: 'BUY', type: 'TAKE_PROFIT_LIMIT', price: low, triggerPrice: low, quantity: new BigNumber(2) });
    expect(conditional.order.status).toBe('PENDING_TRIGGER');
    expect(await balance(buyer, 'USDT')).toEqual([new BigNumber(1000).minus(p.times(3)).minus(low.times(4)).toString(), low.times(4).toString()]);
    const cancels = await Promise.all([...Array(3)].flatMap(() => [service.cancelOrder(buyer, resting.order.id), service.cancelOrder(buyer, conditional.order.id)]));
    expect(cancels.filter(Boolean)).toHaveLength(2);
    expect(await balance(buyer, 'USDT')).toEqual([new BigNumber(1000).minus(p.times(3)).toString(), '0']);

    // Model price, not a venue price; the Futures account is untouched.
    expect(venue.getTicker.mock.calls.some(([asked]) => asked === pair)).toBe(false);
    expect(await untouched()).toEqual(futuresBefore);
  });

  test('STOP and TAKE_PROFIT trigger on the model price once under concurrent sweeps; an OCO reserve is released once', async () => {
    const futuresBefore = await untouched();
    const p = priceAt(PLACED_AT);
    const up = p.times(1.0001).decimalPlaces(10), down = p.times(0.9995).decimalPlaces(10);
    // A resting bid far above the model price: whatever triggers fills against it, at the bid.
    const bidPrice = p.times(3).decimalPlaces(8);
    await service.placeOrder({ userId: buyer, pair, side: 'BUY', type: 'LIMIT', price: bidPrice, quantity: new BigNumber(5) });
    const tp = await service.placeOrder({ userId: seller, pair, side: 'SELL', type: 'TAKE_PROFIT_LIMIT', price: up, triggerPrice: up, quantity: new BigNumber(1) });
    const stop = await service.placeOrder({ userId: seller, pair, side: 'SELL', type: 'STOP_LIMIT', price: p.times(0.999).decimalPlaces(10), triggerPrice: down, quantity: new BigNumber(1) });
    const oco = await service.placeOcoOrder({ userId: seller, pair, side: 'SELL', quantity: new BigNumber(1), takeProfitPrice: p.times(1000).decimalPlaces(8),
      stopTriggerPrice: p.times(0.001).decimalPlaces(10), stopLimitPrice: p.times(0.001).decimalPlaces(10) });
    expect([tp.order.status, stop.order.status]).toEqual(['PENDING_TRIGGER', 'PENDING_TRIGGER']);
    expect(await balance(seller, symbol)).toEqual(['7', '3']);

    // Two watcher instances sweep at the same moments (two Render instances, or a restart overlap).
    const watchers = [new PriceWatcherService(db, service, venue), new PriceWatcherService(db, service, venue)];
    const sweep = async (at: number) => {
      (Date.now as jest.Mock).mockReturnValue(at);
      return (await Promise.all(watchers.flatMap(w => [w.checkAndTrigger(), w.checkAndTrigger()]))).reduce((a, b) => a + b, 0);
    };
    const events = [
      { id: tp.order.id, at: firstTime(PLACED_AT, price => price.gte(up)) },
      { id: stop.order.id, at: firstTime(PLACED_AT, price => price.lte(down)) },
    ].sort((a, b) => a.at - b.at);
    for (const [index, event] of events.entries()) {
      expect(await sweep(event.at)).toBe(1);
      expect((await db.order.findUnique({ where: { id: event.id } }))!.status).toBe('FILLED');
      expect(await db.trade.count({ where: { pair } })).toBe(index + 1);
      expect(await sweep(event.at)).toBe(0);
    }
    const fills = await db.trade.findMany({ where: { pair } });
    expect(fills.every(t => dec(t.price).eq(bidPrice) && dec(t.quantity).eq(1) && t.makerUserId === buyer && t.takerUserId === seller)).toBe(true);
    expect(await balance(seller, symbol)).toEqual(['7', '1']);
    expect(await balance(seller, 'USDT')).toEqual([bidPrice.times(2).toString(), '0']);
    expect(await balance(buyer, symbol)).toEqual(['2', '0']);
    expect(await balance(buyer, 'USDT')).toEqual([new BigNumber(1000).minus(bidPrice.times(5)).toString(), bidPrice.times(3).toString()]);

    // Both OCO legs cancelled at the same time: the shared reserve comes back once.
    const cancels = await Promise.all([service.cancelOrder(seller, oco.takeProfitOrderId), service.cancelOrder(seller, oco.stopOrderId),
      service.cancelOrder(seller, oco.takeProfitOrderId), service.cancelOrder(seller, oco.stopOrderId)]);
    expect(cancels.filter(Boolean)).toHaveLength(1);
    expect((await db.order.findMany({ where: { ocoGroupId: oco.ocoGroupId } })).map(o => o.status)).toEqual(['CANCELLED', 'CANCELLED']);
    expect(await balance(seller, symbol)).toEqual(['8', '0']);
    const base = (await db.balance.findMany({ where: { asset: symbol } })).reduce((sum, b) => sum.plus(b.available.toString()).plus(b.locked.toString()), new BigNumber(0));
    expect(base.toString()).toBe('10');

    expect(venue.getTicker.mock.calls.some(([asked]) => asked === pair)).toBe(false);
    expect(await untouched()).toEqual(futuresBefore);
  });
});
