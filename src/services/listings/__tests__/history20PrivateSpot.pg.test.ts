/**
 * History20 private Spot test mode (owner decision 2026-10-19; wired on #553) on the EXISTING
 * Spot accounts, orders and matching engine and a real (disposable, loopback)
 * PostgreSQL. A private listing is quoted in the restricted SIMUSDT unit,
 * traded by the verified owner and the allowlisted testers only, funded once
 * per account, and leaves through no money path. Synthetic windows, users and
 * fixtures only; no venue, chain or broker call is answered.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'history20-private-fixture-secret';
process.env.API_KEY_ENCRYPTION_SECRET = process.env.API_KEY_ENCRYPTION_SECRET || '0'.repeat(64);

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { buildHistoricalGrowthProgram, historicalGrowthMaxPrice, type HistoricalGrowthSourceRow } from '../../../shared/listingHistoricalGrowth';
import { defaultScenarioControls } from '../../../shared/listingScenarioControls';
import { listingSimulationConfig, parseListingConfig, type ListingConfig, type PublishedListing } from '../listingConfig';
import { setManagedListingAssets } from '../managedSnapshot';
import { fundPrivateTestAccount, privateTestFundingReceiptId } from '../privateTestFunding';
import { spotPriceSource, assertSpotListing } from '../../testMarkets/nrxSpot';
import { TestMarketSimulation } from '../../testMarkets/testMarketSimulation';
import { isTestAssetPairOrSymbol, TEST_ASSET_NOT_TRADABLE_MESSAGE } from '../../testMarkets/testAssetConfig';
import { OrderService } from '../../OrderService';
import { PriceWatcherService } from '../../PriceWatcherService';
import { WalletPortfolioService } from '../../WalletPortfolioService';
import { WithdrawalService } from '../../WithdrawalService';
import { DepositService } from '../../DepositService';
import { BalanceAdjustmentService } from '../../BalanceAdjustmentService';
import { transferWalletBalance } from '../../WalletTransferService';
import { PurchaseService } from '../../PurchaseService';
import { CardApplicationService } from '../../CardApplicationService';
import { MatchingEngine } from '../../../matching-engine/MatchingEngine';
import { OTC_ASSETS } from '../../../otc/policy';
import { testMarketsRouter } from '../../../api/routes/testMarkets';
import { candlesRouter } from '../../../api/routes/candles';
import { ordersRouter } from '../../../api/routes/orders';
import { privateTestMarketsRouter } from '../../../api/routes/privateTestMarkets';

const url = process.env.VOLTEX_LISTING_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_listing_test') throw new Error('History20 private Spot tests require the disposable loopback voltex_listing_test database');
}
const pg = url ? describe : describe.skip;

const DAY = 86_400_000, MINUTE = 60_000;
const LISTING_AT = '2026-11-02T00:00:00.000Z', START = Date.parse(LISTING_AT), AT = START + 2 * DAY;
function walk(days: number, seed: number): HistoricalGrowthSourceRow[] {
  let x = seed, price = 100;
  const random = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: days }, (_, d) => {
    const date = new Date(Date.UTC(2020, 0, 1) + d * DAY).toISOString().slice(0, 10);
    const open = d ? price * (1 + (random() - .5) * .004) : 100, close = open * Math.exp(Math.log(80) / days + (random() - .5) * .1);
    price = close;
    return { date, open, high: Math.max(open, close) * 1.02, low: Math.min(open, close) * .98, close };
  });
}
const growth = buildHistoricalGrowthProgram({ scenarioId: 'VHX-07-SOL', targetPeakGrowthPercent: '9348', rows: walk(40, 9),
  source: { provider: 'Binance Vision', asset: 'SOL', quote: 'USDT', metric: 'spot daily OHLCV', dataKind: 'exchange_ohlcv', timeframe: '1d', sliceSha256: 'b'.repeat(64), license: 'CC-BY-NC-SA-4.0 plus Binance Vision Dataset Terms' } });
const ENV = ['PRIVATE_TRADING_ENABLED', 'PRIVATE_TRADING_OWNER_ID', 'PRIVATE_TRADING_TEST_USER_IDS', 'HISTORY20_PRIVATE_TEST'] as const;

pg('History20 private Spot test mode in SIMUSDT (disposable PostgreSQL)', () => {
  let db: PrismaClient, owner: string, tester: string, otherAdmin: string, user: string, symbol: string, pair: string, slug: string;
  let config: ListingConfig, published: PublishedListing, legacy: ListingConfig;
  const saved: Partial<Record<(typeof ENV)[number], string | undefined>> = {};
  const venue = { getTicker: jest.fn(async (_pair: string) => ({ lastPrice: '60000' })) };
  const one = new BigNumber(1);
  const randomSymbol = (prefix: string) => `${prefix}${randomUUID().replace(/[^A-F]/gi, '').slice(0, 5).toUpperCase()}`;
  // A reserved private ticker (VHX01…VHX99), different from the ones this test already uses.
  const privateSymbol = (taken: string[] = []) => {
    for (;;) { const s = `VHX${String(1 + Math.floor(Math.random() * 99)).padStart(2, '0')}`; if (!taken.includes(s)) return s; }
  };
  // The disposable database outlives a run: an earlier test's resting order on the same private pair is retired first.
  const retire = (pairs: string[]) => db.order.updateMany({ where: { pair: { in: pairs }, status: { in: ['OPEN', 'PARTIALLY_FILLED', 'PENDING_TRIGGER'] } }, data: { status: 'CANCELLED' } });
  const privateConfig = (sym: string, extra: Record<string, unknown> = {}) => parseListingConfig({
    schemaVersion: 1, symbol: sym, name: 'History20 private check', logo: null, initialPrice: '2', listingAt: LISTING_AT, displayTimeZone: 'UTC',
    ownerAllocation: '0', seedMode: 'manual', seed: `${sym.toLowerCase()}-private-synthetic`, tradable: false,
    simulationProgram: { ...defaultScenarioControls('2', 'CALM'), stages: [], first24hGainPercent: '0', afterGrowth: 'range', growth: 'historical-window',
      historicalGrowth: growth, maxPrice: historicalGrowthMaxPrice('2', growth.targetPeakGrowthPercent) },
    privateTest: { settlement: 'SIMUSDT', funding: { base: '100', quote: '1000' } },
    ...extra,
  });
  const listing = (c: ListingConfig): PublishedListing => ({ id: `h20-private-${c.symbol.toLowerCase()}`, version: 1, publishedAt: LISTING_AT, config: c });
  const balance = async (userId: string, asset: string) => {
    const row = await db.balance.findUnique({ where: { userId_asset: { userId, asset } } });
    return row ? [row.available.toString(), row.locked.toString()] : null;
  };
  const total = async (asset: string, users: string[]) => (await db.balance.findMany({ where: { asset, userId: { in: users } } }))
    .reduce((sum, row) => sum.plus(row.available.toString()).plus(row.locked.toString()), new BigNumber(0));
  const at = (ms: number) => jest.spyOn(Date, 'now').mockReturnValue(ms);
  const modelPrice = (ms: number) => new BigNumber(new TestMarketSimulation(listingSimulationConfig(config)).priceAt(ms)!);
  const closed = 'History20 private check is not available for trading.';

  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  afterAll(async () => { setManagedListingAssets([]); await db.$disconnect(); });
  beforeEach(async () => {
    [owner, tester, otherAdmin, user] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const key of ENV) saved[key] = process.env[key];
    Object.assign(process.env, { PRIVATE_TRADING_ENABLED: 'true', PRIVATE_TRADING_OWNER_ID: owner, PRIVATE_TRADING_TEST_USER_IDS: tester, HISTORY20_PRIVATE_TEST: 'enabled' });
    symbol = privateSymbol(); pair = `${symbol}/SIMUSDT`; slug = `${symbol}-SIMUSDT`;
    await retire([pair]);
    config = privateConfig(symbol); published = listing(config);
    legacy = parseListingConfig({ schemaVersion: 1, symbol: randomSymbol('L'), name: 'Legacy USDT listing', logo: null, initialPrice: '0.25', listingAt: LISTING_AT,
      displayTimeZone: 'UTC', ownerAllocation: '1000', seedMode: 'manual', seed: 'legacy-usdt-synthetic', tradable: true });
    setManagedListingAssets([listingSimulationConfig(config), listingSimulationConfig(legacy)]);
    await db.user.createMany({ data: ([[owner, 'ADMIN'], [tester, 'USER'], [otherAdmin, 'ADMIN'], [user, 'USER']] as const)
      .map(([id, role]) => ({ id, email: `${id}@history20-private.invalid`, referralCode: id, passwordHash: 'fixture', role })) });
    // Real deposited USDT next to the test, for every account: it must never move.
    await db.balance.createMany({ data: [owner, tester, otherAdmin, user].map((userId) => ({ userId, asset: 'USDT', available: '500' })) });
    venue.getTicker.mockReset().mockImplementation(async () => ({ lastPrice: '60000' }));
    at(AT);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of ENV) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  });
  const usdtUntouched = async () => { for (const id of [owner, tester, otherAdmin, user]) expect(await balance(id, 'USDT')).toEqual(['500', '0']); };

  test('admission: the owner and the allowlisted tester only; another ADMIN, an ordinary user, the switch off and before the listing are refused before any row', async () => {
    await fundPrivateTestAccount(db, published, owner);
    await fundPrivateTestAccount(db, published, tester);
    const orders = new OrderService(db, new MatchingEngine(), venue);
    await expect(orders.placeOrder({ userId: owner, pair, side: 'BUY', type: 'LIMIT', price: one, quantity: one })).resolves.toMatchObject({ order: { status: 'OPEN' } });
    await expect(orders.placeOrder({ userId: tester, pair, side: 'SELL', type: 'LIMIT', price: new BigNumber(1000), quantity: one })).resolves.toMatchObject({ order: { status: 'OPEN' } });
    for (const outsider of [otherAdmin, user]) {
      await expect(orders.placeOrder({ userId: outsider, pair, side: 'BUY', type: 'LIMIT', price: one, quantity: one })).rejects.toThrow(closed);
      await expect(orders.placeOrder({ userId: outsider, pair, side: 'SELL', type: 'MARKET', quantity: one })).rejects.toThrow(closed);
      await expect(orders.placeOcoOrder({ userId: outsider, pair, side: 'SELL', quantity: one, takeProfitPrice: new BigNumber(1000), stopTriggerPrice: one, stopLimitPrice: new BigNumber('0.9') })).rejects.toThrow(closed);
    }
    expect(() => assertSpotListing(pair, AT)).toThrow(closed);
    delete process.env.HISTORY20_PRIVATE_TEST;
    await expect(orders.placeOrder({ userId: owner, pair, side: 'BUY', type: 'LIMIT', price: one, quantity: one })).rejects.toThrow(closed);
    process.env.HISTORY20_PRIVATE_TEST = 'enabled';
    // The owner is the owner only while private trading is enabled; the tester is an allowlist entry.
    process.env.PRIVATE_TRADING_ENABLED = 'false';
    await expect(orders.placeOrder({ userId: owner, pair, side: 'BUY', type: 'LIMIT', price: one, quantity: one })).rejects.toThrow(closed);
    await expect(orders.placeOrder({ userId: tester, pair, side: 'BUY', type: 'LIMIT', price: one, quantity: one })).resolves.toBeTruthy();
    process.env.PRIVATE_TRADING_ENABLED = 'true';
    at(START - MINUTE);
    await expect(orders.placeOrder({ userId: owner, pair, side: 'BUY', type: 'LIMIT', price: one, quantity: one })).rejects.toThrow('Trading has not started yet');
    expect(await db.order.count({ where: { userId: { in: [otherAdmin, user] } } })).toBe(0);
    expect(venue.getTicker).not.toHaveBeenCalled();
    await usdtUntouched();
  });

  test('funding: once per (listing, account), bounded, the base and SIMUSDT only, never USDT; concurrent calls credit once', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => fundPrivateTestAccount(db, published, owner)));
    expect(results.filter((r) => r.applied)).toHaveLength(1);
    expect(await balance(owner, symbol)).toEqual(['100', '0']);
    expect(await balance(owner, 'SIMUSDT')).toEqual(['1000', '0']);
    await expect(fundPrivateTestAccount(db, published, owner)).resolves.toMatchObject({ applied: false, baseQuantity: '100', quoteQuantity: '1000' });
    await expect(fundPrivateTestAccount(db, published, tester)).resolves.toMatchObject({ applied: true });
    for (const outsider of [otherAdmin, user]) await expect(fundPrivateTestAccount(db, published, outsider)).rejects.toThrow('not admitted');
    // A public (non-private) window has no test funding.
    const { privateTest: _t, ...publicConfig } = config;
    await expect(fundPrivateTestAccount(db, listing(publicConfig as ListingConfig), owner)).rejects.toThrow('Only a History20 private test listing');
    // A second private listing adds its own bounded amount to the shared SIMUSDT unit.
    const second = listing(privateConfig(privateSymbol([symbol])));
    await fundPrivateTestAccount(db, second, owner);
    expect(await balance(owner, 'SIMUSDT')).toEqual(['2000', '0']);
    expect(await balance(owner, second.config.symbol)).toEqual(['100', '0']);
    // Switched off: nobody is funded.
    delete process.env.HISTORY20_PRIVATE_TEST;
    await expect(fundPrivateTestAccount(db, second, tester)).rejects.toThrow('not admitted');
    process.env.HISTORY20_PRIVATE_TEST = 'enabled';
    // Unexplained base inventory and a receipt that disagrees with the listing fail closed.
    await db.balance.create({ data: { userId: tester, asset: second.config.symbol, available: '5' } });
    await expect(fundPrivateTestAccount(db, second, tester)).rejects.toThrow('inventory requires manual review');
    await db.auditLog.update({ where: { id: privateTestFundingReceiptId(published.id, owner) }, data: { metadata: { listingId: published.id, base: symbol, quote: 'SIMUSDT', baseQuantity: '100', quoteQuantity: '999999' } } });
    await expect(fundPrivateTestAccount(db, published, owner)).rejects.toThrow('conflicts');
    const receipts = await db.auditLog.findMany({ where: { action: 'HISTORY20_PRIVATE_TEST_FUNDING', userId: { in: [owner, tester] } } });
    expect(receipts).toHaveLength(3);
    expect(receipts.every((r) => (r.metadata as Record<string, unknown>).usdtCredit === '0' || r.id === privateTestFundingReceiptId(published.id, owner))).toBe(true);
    expect(await db.futuresBalance.count({ where: { userId: { in: [owner, tester] } } })).toBe(0);
    expect(await db.demoBalance.count({ where: { userId: { in: [owner, tester] } } })).toBe(0);
    await usdtUntouched();
  });

  test('owner and tester trade in SIMUSDT on the existing book: fill, cancel, double spend and concurrent takers; totals are conserved', async () => {
    await fundPrivateTestAccount(db, published, owner);
    await fundPrivateTestAccount(db, published, tester);
    const orders = new OrderService(db, new MatchingEngine(), venue), price = new BigNumber('2.5');
    const ask = await orders.placeOrder({ userId: tester, pair, side: 'SELL', type: 'LIMIT', price, quantity: new BigNumber(10) });
    const fill = await orders.placeOrder({ userId: owner, pair, side: 'BUY', type: 'LIMIT', price, quantity: new BigNumber(4) });
    expect(fill.trades).toHaveLength(1);
    expect(await balance(owner, symbol)).toEqual(['104', '0']);
    expect(await balance(owner, 'SIMUSDT')).toEqual(['990', '0']);
    expect(await balance(tester, symbol)).toEqual(['90', '6']);
    expect(await balance(tester, 'SIMUSDT')).toEqual(['1010', '0']);

    // Cancel releases exactly the lock.
    const resting = await orders.placeOrder({ userId: owner, pair, side: 'BUY', type: 'LIMIT', price: one, quantity: new BigNumber(10) });
    expect(await balance(owner, 'SIMUSDT')).toEqual(['980', '10']);
    await orders.cancelOrder(owner, resting.order.id);
    expect(await balance(owner, 'SIMUSDT')).toEqual(['990', '0']);

    // Double spend: two concurrent bids for 600 SIMUSDT each against 990 available.
    const bids = await Promise.allSettled([0, 1].map(() => orders.placeOrder({ userId: owner, pair, side: 'BUY', type: 'LIMIT', price: one, quantity: new BigNumber(600) })));
    expect(bids.filter((b) => b.status === 'fulfilled')).toHaveLength(1);
    expect(await balance(owner, 'SIMUSDT')).toEqual(['390', '600']);
    await orders.cancelOrder(owner, (bids.find((b) => b.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<OrderService['placeOrder']>>>).value.order.id);

    // Two concurrent takers for the remaining 6: exactly 6 change hands.
    const takers = await Promise.all([0, 1].map(() => orders.placeOrder({ userId: owner, pair, side: 'BUY', type: 'LIMIT', price, quantity: new BigNumber(6) })));
    expect(takers.flatMap((t) => t.trades).reduce((sum, t) => sum.plus(t.quantity), new BigNumber(0)).toFixed()).toBe('6');
    expect((await db.order.findUnique({ where: { id: ask.order.id } }))!.status).toBe('FILLED');
    expect(await balance(tester, symbol)).toEqual(['90', '0']);
    expect((await total(symbol, [owner, tester])).toFixed()).toBe('200');
    expect((await total('SIMUSDT', [owner, tester])).toFixed()).toBe('2000');
    expect(await db.trade.count({ where: { pair, takerUserId: { in: [owner, tester] }, makerUserId: { startsWith: 'simulation:' } } })).toBe(0);
    expect(venue.getTicker).not.toHaveBeenCalled();
    await usdtUntouched();
  });

  test('restart: a resting private order survives a new engine and service and is matched from the committed book', async () => {
    await fundPrivateTestAccount(db, published, owner);
    await fundPrivateTestAccount(db, published, tester);
    const before = await new OrderService(db, new MatchingEngine(), venue).placeOrder({ userId: tester, pair, side: 'SELL', type: 'LIMIT', price: new BigNumber(3), quantity: new BigNumber(3) });
    const after = await new OrderService(db, new MatchingEngine(), venue).placeOrder({ userId: owner, pair, side: 'BUY', type: 'LIMIT', price: new BigNumber(3), quantity: new BigNumber(3) });
    expect(after.trades.map((t) => t.makerOrderId)).toEqual([before.order.id]);
    expect(await balance(owner, 'SIMUSDT')).toEqual(['991', '0']);
    expect(await balance(tester, 'SIMUSDT')).toEqual(['1009', '0']);
    await usdtUntouched();
  });

  test('TP/SL and OCO validate and trigger on the model price; one leg, one refund; the venue is never asked about the pair', async () => {
    await fundPrivateTestAccount(db, published, owner);
    await fundPrivateTestAccount(db, published, tester);
    const engine = new MatchingEngine(), orders = new OrderService(db, engine, venue);
    const p = modelPrice(AT);
    // Direction is checked against the model price.
    await expect(orders.placeOrder({ userId: owner, pair, side: 'SELL', type: 'STOP_LIMIT', price: p.times(1.1).dp(8), triggerPrice: p.times(1.05).dp(8), quantity: one }))
      .rejects.toThrow('Trigger price must be below the current price');
    const oco = await orders.placeOcoOrder({ userId: owner, pair, side: 'SELL', quantity: new BigNumber(5),
      takeProfitPrice: p.times(1.2).dp(8), stopTriggerPrice: p.times(0.9).dp(8), stopLimitPrice: p.times(0.89).dp(8) });
    expect(await balance(owner, symbol)).toEqual(['95', '5']);
    await orders.cancelOrder(owner, oco.stopOrderId);
    expect((await db.order.findMany({ where: { ocoGroupId: oco.ocoGroupId } })).map((o) => o.status)).toEqual(['CANCELLED', 'CANCELLED']);
    expect(await balance(owner, symbol)).toEqual(['100', '0']);

    // A take-profit fires when the model price reaches it and fills against the tester's bid, in SIMUSDT.
    const trigger = p.times(1.003).dp(8);
    let firesAt = AT;
    while (modelPrice(firesAt).lt(trigger)) { firesAt += 10_000; if (firesAt > AT + 3 * DAY) throw new Error('fixture: no crossing'); }
    const tp = await orders.placeOrder({ userId: owner, pair, side: 'SELL', type: 'TAKE_PROFIT_LIMIT', price: trigger, triggerPrice: trigger, quantity: new BigNumber(2) });
    await orders.placeOrder({ userId: tester, pair, side: 'BUY', type: 'LIMIT', price: trigger, quantity: new BigNumber(2) });
    const watcher = new PriceWatcherService(db, orders, venue);
    at(firesAt - 10_000);
    await watcher.checkAndTrigger();
    expect((await db.order.findUnique({ where: { id: tp.order.id } }))!.status).toBe('PENDING_TRIGGER');
    at(firesAt + 1_000);
    await watcher.checkAndTrigger();
    expect((await db.order.findUnique({ where: { id: tp.order.id } }))!.status).toBe('FILLED');
    expect(new BigNumber((await balance(owner, 'SIMUSDT'))![0]).eq(trigger.times(2).plus(1000))).toBe(true);
    expect(await balance(owner, symbol)).toEqual(['98', '0']);
    expect(venue.getTicker.mock.calls.some(([asked]) => asked === pair)).toBe(false);
    await usdtUntouched();
  });

  test('orders placed before the registry drops: nothing fills, triggers or prices off the venue while it is cold; cancel still refunds', async () => {
    await fundPrivateTestAccount(db, published, owner);
    await fundPrivateTestAccount(db, published, tester);
    const orders = new OrderService(db, new MatchingEngine(), venue), p = modelPrice(AT);
    const ask = await orders.placeOrder({ userId: owner, pair, side: 'SELL', type: 'LIMIT', price: new BigNumber(3), quantity: new BigNumber(4) });
    const trigger = p.times(1.003).dp(8);
    const tp = await orders.placeOrder({ userId: tester, pair, side: 'SELL', type: 'TAKE_PROFIT_LIMIT', price: trigger, triggerPrice: trigger, quantity: new BigNumber(2) });
    // Restart with a cold registry: Render has not loaded the private listing yet.
    setManagedListingAssets([]);
    const cold = new OrderService(db, new MatchingEngine(), venue);
    await expect(cold.placeOrder({ userId: tester, pair, side: 'BUY', type: 'LIMIT', price: new BigNumber(3), quantity: new BigNumber(4) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    await expect(cold.placeOrder({ userId: owner, pair, side: 'SELL', type: 'MARKET', quantity: one })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    let firesAt = AT;
    while (modelPrice(firesAt).lt(trigger)) { firesAt += 10_000; if (firesAt > AT + 3 * DAY) throw new Error('fixture: no crossing'); }
    at(firesAt + 1_000);
    await new PriceWatcherService(db, cold, venue).checkAndTrigger();
    expect((await db.order.findUnique({ where: { id: tp.order.id } }))!.status).toBe('PENDING_TRIGGER');
    expect((await db.order.findUnique({ where: { id: ask.order.id } }))!.status).toBe('OPEN');
    expect(venue.getTicker.mock.calls.some(([asked]) => asked === pair)).toBe(false);
    // Releasing what is locked never needs the registry.
    await cold.cancelOrder(owner, ask.order.id);
    await cold.cancelOrder(tester, tp.order.id);
    expect([await balance(owner, symbol), await balance(tester, symbol)]).toEqual([['100', '0'], ['100', '0']]);
    expect(await db.trade.count({ where: { pair, OR: [{ takerUserId: { in: [owner, tester] } }, { makerUserId: { in: [owner, tester] } }] } })).toBe(0);
    await usdtUntouched();
  });

  test('synthetic MARKET SELL credits SIMUSDT only, at the model price; another ADMIN, the switch off and a legacy USDT listing stay refused', async () => {
    await fundPrivateTestAccount(db, published, owner);
    await fundPrivateTestAccount(db, published, tester);
    const orders = new OrderService(db, new MatchingEngine(), venue), p = modelPrice(AT);
    const sold = await orders.placeOrder({ userId: owner, pair, side: 'SELL', type: 'MARKET', quantity: new BigNumber(5) });
    expect(sold.trades[0]).toMatchObject({ makerUserId: `simulation:${symbol}` });
    expect(sold.trades[0].price.eq(p)).toBe(true);
    expect(await balance(owner, symbol)).toEqual(['95', '0']);
    expect(new BigNumber((await balance(owner, 'SIMUSDT'))![0]).eq(p.times(5).plus(1000))).toBe(true);
    const audit = await db.auditLog.findFirst({ where: { userId: owner, action: 'HISTORY20_PRIVATE_SIMULATION_SOLD' } });
    expect(audit?.metadata).toMatchObject({ pair, quote: 'SIMUSDT', counterparty: `simulation:${symbol}` });
    await expect(orders.placeOrder({ userId: tester, pair, side: 'SELL', type: 'MARKET', quantity: one })).resolves.toMatchObject({ order: { status: 'FILLED' } });

    await db.balance.create({ data: { userId: otherAdmin, asset: symbol, available: '5' } }); // FIXTURE: inventory an outsider should never have
    await expect(orders.placeOrder({ userId: otherAdmin, pair, side: 'SELL', type: 'MARKET', quantity: one })).rejects.toThrow(closed);
    delete process.env.HISTORY20_PRIVATE_TEST;
    await expect(orders.placeOrder({ userId: owner, pair, side: 'SELL', type: 'MARKET', quantity: one })).rejects.toThrow(closed);
    process.env.HISTORY20_PRIVATE_TEST = 'enabled';
    // #551 stays: a USDT managed listing's synthetic sale would credit withdrawable USDT and stops.
    const legacyPair = `${legacy.symbol}/USDT`;
    await db.balance.create({ data: { userId: owner, asset: legacy.symbol, available: '10' } });
    await expect(orders.placeOrder({ userId: owner, pair: legacyPair, side: 'SELL', type: 'MARKET', quantity: one })).rejects.toThrow('Simulation Spot sale is not available for this listing');
    expect(await balance(owner, legacy.symbol)).toEqual(['10', '0']);
    expect(await balance(otherAdmin, symbol)).toEqual(['5', '0']);
    expect(await db.auditLog.count({ where: { userId: { in: [owner, tester] }, action: 'TEAM_SPOT_SIMULATION_SOLD' } })).toBe(0);
    expect(venue.getTicker).not.toHaveBeenCalled();
    await usdtUntouched();
  });

  test('no route out: withdrawal, deposit, adjustment, transfer, purchase, OTC, other pairs, valuation and card volume all refuse SIMUSDT and the private base', async () => {
    await fundPrivateTestAccount(db, published, owner);
    await fundPrivateTestAccount(db, published, tester);
    const withdrawals = new WithdrawalService(db);
    for (const asset of ['SIMUSDT', symbol]) {
      await expect(withdrawals.requestWithdrawal({ userId: owner, asset, network: 'TRC20', toAddress: 'TQ-synthetic-fixture', amount: '1' })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      await expect(withdrawals.requestUnheldWithdrawal({ userId: owner, asset, network: 'TRC20', toAddress: 'TQ-synthetic-fixture', amount: '1', available: '100' })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      await expect(new DepositService(db, { type: 'evm', chain: 'ETH' } as never).recordObservation({ txHash: `0x${randomUUID().replace(/-/g, '')}`, asset, source: 'admin_check' })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      await expect(new BalanceAdjustmentService(db).adjust({ userId: owner, asset, amount: '100', reason: 'fixture', performedByAdminId: otherAdmin })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      for (const direction of ['TO_FUTURES', 'TO_SPOT'] as const) await expect(transferWalletBalance(db, owner, asset, new BigNumber(1), direction)).rejects.toThrow('This asset cannot be transferred');
      const product = await db.product.create({ data: { name: 'Fixture product', description: 'fixture', priceAmount: '1', priceAsset: asset } });
      await expect(new PurchaseService(db).purchaseProduct(owner, product.id)).rejects.toThrow('This asset cannot be used for purchases');
      expect(Object.keys(OTC_ASSETS)).not.toContain(asset);
    }
    // Conversion through any other pair: no book, no synthetic counterparty, for anyone.
    const orders = new OrderService(db, new MatchingEngine(), venue);
    for (const other of [`${symbol}/USDT`, `${symbol}/BTC`, `${symbol}/USDC`, 'SIMUSDT/USDT', 'USDT/SIMUSDT', 'BTC/SIMUSDT', `${legacy.symbol}/SIMUSDT`]) {
      expect(isTestAssetPairOrSymbol(other)).toBe(true);
      await expect(orders.placeOrder({ userId: owner, pair: other, side: 'SELL', type: 'LIMIT', price: one, quantity: one })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      await expect(orders.placeOrder({ userId: owner, pair: other, side: 'SELL', type: 'MARKET', quantity: one })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      await expect(orders.placeOrder({ userId: user, pair: other, side: 'BUY', type: 'LIMIT', price: one, quantity: one })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    }
    // Not withdrawable-wallet equity: neither is valued.
    const wallet = new WalletPortfolioService(db, { getTickers: jest.fn(async () => [{ pair: `${symbol}/USDT`, lastPrice: '9' }, { pair: 'BTC/USDT', lastPrice: '60000' }]) } as never, { isConfigured: () => false } as never);
    const prices = await wallet.pricesFor([symbol, 'SIMUSDT', 'USDT']);
    expect([prices.get(symbol) ?? null, prices.get('SIMUSDT') ?? null, prices.get('USDT')]).toEqual([null, null, 1]);
    // A real owner/tester fill in SIMUSDT is simulation, not card trading volume, and not an unpriced gap.
    await orders.placeOrder({ userId: tester, pair, side: 'SELL', type: 'LIMIT', price: new BigNumber(50), quantity: new BigNumber(10) });
    await orders.placeOrder({ userId: owner, pair, side: 'BUY', type: 'LIMIT', price: new BigNumber(50), quantity: new BigNumber(10) });
    const card = await new CardApplicationService(db, wallet).getSnapshot(owner);
    expect(card.eligibility).toMatchObject({ qualifyingTradingVolumeUsd: 0, tradingVolumeValuationComplete: true, tradingVolumeEligible: false });
    expect(await db.withdrawal.count({ where: { userId: owner } })).toBe(0);
    expect(await db.purchase.count({ where: { userId: owner } })).toBe(0);
    expect(await db.futuresBalance.count({ where: { userId: owner } })).toBe(0);
    expect(await balance(owner, 'SIMUSDT')).toEqual(['500', '0']);
    expect(venue.getTicker).not.toHaveBeenCalled();
    await usdtUntouched();
  });

  test('public reads never answer for the private pair; the private reads serve the owner and the tester only, at the server clock', async () => {
    await fundPrivateTestAccount(db, published, tester);
    const engine = new MatchingEngine();
    await new OrderService(db, engine, venue).placeOrder({ userId: tester, pair, side: 'SELL', type: 'LIMIT', price: new BigNumber(7), quantity: new BigNumber(2) });
    const registry = { ensureFresh: async () => {}, snapshot: () => [listing(legacy), published] };
    const app = express();
    app.use(testMarketsRouter(() => AT), candlesRouter(db), ordersRouter(db, engine, venue), privateTestMarketsRouter(db, engine, registry, () => AT));
    const token = (id: string) => `Bearer ${jwt.sign({ sub: id }, process.env.JWT_SECRET!)}`;
    for (const path of [`/market/test-assets/${slug}`, `/market/test-assets/${slug}/candles`, `/market/external/candles/${slug}`, `/market/ticker/${slug}`,
      `/market/external/orderbook/${slug}`, `/orderbook/${slug}`, `/orderbook/${encodeURIComponent(pair)}`, `/candles/${slug}`, `/candles/${encodeURIComponent(pair)}`]) {
      const response = await request(app).get(path);
      expect([path, response.status]).toEqual([path, 404]);
    }
    expect((await request(app).get('/market/test-assets')).body.assets.map((a: { pair: string }) => a.pair)).not.toContain(pair);

    for (const id of [owner, tester]) {
      const markets = await request(app).get('/private-test/markets').set('Authorization', token(id));
      expect(markets.status).toBe(200);
      expect(markets.body.assets).toHaveLength(1);
      expect(markets.body.assets[0]).toMatchObject({ pair, quote: 'SIMUSDT', provenance: { mode: 'HISTORY20_PRIVATE_TEST', settlement: 'SIMUSDT', withdrawable: false,
        rights: 'HISTORICAL_RIGHTS_UNVERIFIED', clock: 'REAL_TIME', scenarioId: 'VHX-07-SOL' } });
      expect(JSON.stringify(markets.body)).not.toContain(config.seed);
    }
    for (const id of [otherAdmin, user]) expect((await request(app).get('/private-test/markets').set('Authorization', token(id))).status).toBe(404);
    expect((await request(app).get('/private-test/markets')).status).toBe(401);

    const ticker = await request(app).get(`/private-test/markets/${slug}/ticker`).set('Authorization', token(owner));
    expect(ticker.body.ticker).toMatchObject({ pair, lastPrice: (await spotPriceSource(venue, () => AT).getTicker(pair))!.lastPrice, askPrice: '7', bidPrice: null });
    const candles = await request(app).get(`/private-test/markets/${slug}/candles?interval=5m&limit=5`).set('Authorization', token(owner));
    expect(candles.body.candles.at(-1).close).toBe(modelPrice(AT).toNumber());
    expect(candles.body.candles.every((c: { time: number }) => c.time * (c.time < 1e12 ? 1000 : 1) <= AT)).toBe(true);
    // No preview parameter reaches the private reads: never a candle after now.
    const preview = await request(app).get(`/private-test/markets/${slug}/candles?interval=5m&limit=5&simulationPreviewTime=${AT + DAY}`).set('Authorization', token(owner));
    expect(preview.body.candles).toEqual(candles.body.candles);
    const book = await request(app).get(`/private-test/markets/${slug}/orderbook`).set('Authorization', token(tester));
    expect(book.body.asks).toEqual([{ price: '7', quantity: '2', orders: 1 }]);
    expect((await request(app).get(`/private-test/markets/${legacy.symbol}-USDT/ticker`).set('Authorization', token(owner))).status).toBe(404);
    delete process.env.HISTORY20_PRIVATE_TEST;
    expect((await request(app).get('/private-test/markets').set('Authorization', token(owner))).status).toBe(404);
    expect(venue.getTicker).not.toHaveBeenCalled();
  // Many HTTP reads with model candles: ~4 s alone, at Jest's default limit under a full run.
  }, 30_000);

  test('legacy unchanged: a USDT managed listing, a public History20 window, VTA, NRX and AITH keep their gate and guard results', async () => {
    const orders = new OrderService(db, new MatchingEngine(), venue), legacyPair = `${legacy.symbol}/USDT`;
    // The tradable USDT listing trades as before, for an ordinary user and the owner.
    await expect(orders.placeOrder({ userId: user, pair: legacyPair, side: 'BUY', type: 'LIMIT', price: new BigNumber('0.2'), quantity: one })).resolves.toMatchObject({ order: { status: 'OPEN' } });
    expect(await balance(user, 'USDT')).toEqual(['499.8', '0.2']);
    // The same History20 window without privateTest is the existing non-tradable demo for everyone, owner included.
    const publicWindow = privateConfig(randomSymbol('W'), { privateTest: undefined });
    setManagedListingAssets([listingSimulationConfig(config), listingSimulationConfig(legacy), listingSimulationConfig(publicWindow as ListingConfig)]);
    for (const id of [owner, tester, user]) {
      await expect(orders.placeOrder({ userId: id, pair: `${publicWindow.symbol}/USDT`, side: 'BUY', type: 'LIMIT', price: one, quantity: one })).rejects.toThrow(closed);
    }
    for (const v of ['VTA', 'VTA/USDT', 'NRX', 'NRX/USDT', 'AITH', 'AITH/USDT', legacy.symbol, legacyPair]) expect(isTestAssetPairOrSymbol(v)).toBe(true);
    for (const v of ['USDT', 'BTC', 'BTC/USDT', 'ETH/USDT']) expect(isTestAssetPairOrSymbol(v)).toBe(false);
    expect(() => assertSpotListing('AITH/USDT', AT, true)).toThrow('Aitheron AI is not available for trading.');
    expect(() => assertSpotListing('VTA/USDT', AT, true)).toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    // The legacy listing is valued at its model price as before.
    const wallet = new WalletPortfolioService(db, { getTickers: jest.fn(async () => []) } as never, { isConfigured: () => false } as never);
    expect((await wallet.pricesFor([legacy.symbol])).get(legacy.symbol)).toBe(new TestMarketSimulation(listingSimulationConfig(legacy)).priceAt(AT));
  });
});
