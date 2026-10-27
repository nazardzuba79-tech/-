/**
 * History20 private Spot test: the non-withdrawable settlement spike
 * (docs/HISTORY20_PRIVATE_SPOT_SETTLEMENT.md; CTO review on PR #551), on a
 * disposable loopback PostgreSQL with synthetic users, balances and window.
 *
 * 1. The restricted unit. An account holding real USDT and SIMUSDT: every
 *    withdrawal, deposit, adjustment, transfer, demo, banking, purchase,
 *    valuation and card path refuses SIMUSDT, and what can be withdrawn in USDT is exactly
 *    the real USDT — no more. Every pair that names SIMUSDT is refused while
 *    no such market exists (today: always).
 * 2. Settlement. With a SIMUSDT-quoted History20 market set up in Render's
 *    registry by the test and the private test switched on, every path
 *    — the owner's simulation sale, a book fill, a conditional fill, a
 *    cancel, concurrent sales — moves only the window asset and SIMUSDT;
 *    no USDT row moves and the venue is never asked. The window asset never
 *    trades on another pair (`X/USDT`, `USDT/X`…), transfers, pays, or leaves.
 * 3. Admission: exactly the verified owner and allowlisted testers, and only
 *    while HISTORY20_PRIVATE_TEST=enabled (default off).
 *
 * HISTORICAL_RIGHTS_UNVERIFIED still refuses every public publication.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'h20-simusdt-fixture-secret';
process.env.API_KEY_ENCRYPTION_SECRET = process.env.API_KEY_ENCRYPTION_SECRET || '0'.repeat(64);

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { buildHistoricalGrowthProgram, historicalGrowthMaxPrice, type HistoricalGrowthSourceRow } from '../../../shared/listingHistoricalGrowth';
import { defaultScenarioControls } from '../../../shared/listingScenarioControls';
import { checkPrivateTestable, checkPublishable, ListingValidationError, listingSimulationConfig, parseListingConfig, type ListingConfig } from '../listingConfig';
import { setManagedListingAssets } from '../managedSnapshot';
import { allocateListingOwner } from '../ownerAllocation';
import { isPrivateTestParticipant, privateTestAdmitted, privateTestPair, privateTestSimulationConfig, SIMULATION_QUOTE } from '../privateTest';
import * as nrxSpot from '../../testMarkets/nrxSpot';
import { spotPriceSource } from '../../testMarkets/nrxSpot';
import { TestMarketSimulation } from '../../testMarkets/testMarketSimulation';
import { testMarketCandles } from '../../testMarkets/testMarketService';
import { isSimulationSettled, isTestAssetPairOrSymbol, TEST_ASSET_NOT_TRADABLE_MESSAGE } from '../../testMarkets/testAssetConfig';
import { OrderService } from '../../OrderService';
import { PriceWatcherService } from '../../PriceWatcherService';
import { WalletPortfolioService } from '../../WalletPortfolioService';
import { WithdrawalService } from '../../WithdrawalService';
import { DepositService } from '../../DepositService';
import { BalanceAdjustmentService } from '../../BalanceAdjustmentService';
import { DemoTradingService } from '../../DemoTradingService';
import { transferWalletBalance } from '../../WalletTransferService';
import { PurchaseService } from '../../PurchaseService';
import { CardApplicationService } from '../../CardApplicationService';
import { BankingService } from '../../../banking/service';
import { BANKING_PROGRAMS } from '../../../banking/config';
import { withdrawalsRouter } from '../../../api/routes/withdrawals';
import { MatchingEngine } from '../../../matching-engine/MatchingEngine';
import { OTC_ASSETS } from '../../../otc/policy';

const url = process.env.VOLTEX_LISTING_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_listing_test') throw new Error('History20 settlement tests require the disposable loopback voltex_listing_test database');
}
const pg = url ? describe : describe.skip;

const DAY = 86_400_000;
const LISTING_AT = '2026-11-02T00:00:00.000Z', START = Date.parse(LISTING_AT);
const AT = START + 2 * DAY + 17_000;
function walk(days: number): HistoricalGrowthSourceRow[] {
  let x = 21, price = 100;
  const random = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: days }, (_, d) => {
    const date = new Date(Date.UTC(2020, 0, 1) + d * DAY).toISOString().slice(0, 10);
    const open = d ? price * (1 + (random() - .5) * .004) : 100, close = open * Math.exp(Math.log(80) / days + (random() - .5) * .1);
    price = close;
    return { date, open, high: Math.max(open, close) * 1.02, low: Math.min(open, close) * .98, close };
  });
}
// Synthetic source rows (a seeded walk), labelled like an OHLC window; no licensed data.
const growth = buildHistoricalGrowthProgram({ scenarioId: 'VHX-03-SOL', targetPeakGrowthPercent: '9348', rows: walk(40),
  source: { provider: 'Binance Vision', asset: 'SOL', quote: 'USDT', metric: 'spot daily OHLCV', dataKind: 'exchange_ohlcv', timeframe: '1d', sliceSha256: 'c'.repeat(64), license: 'CC-BY-NC-SA-4.0 plus Binance Vision Dataset Terms' } });

const windowConfigFor = (symbol: string): ListingConfig => parseListingConfig({
  schemaVersion: 1, symbol, name: 'History20 private QA', logo: null, initialPrice: '2', listingAt: LISTING_AT, displayTimeZone: 'UTC',
  ownerAllocation: '1000', seedMode: 'manual', seed: 'h20-simusdt-synthetic', tradable: false,
  simulationProgram: { ...defaultScenarioControls('2', 'CALM'), stages: [], first24hGainPercent: '0', afterGrowth: 'range', growth: 'historical-window',
    historicalGrowth: growth, maxPrice: historicalGrowthMaxPrice('2', growth.targetPeakGrowthPercent) },
});

describe('History20 SIMUSDT-settled value: recognition without the registry (no database)', () => {
  test('the unit and the reserved History20 tickers (VHX01…VHX99), bare or on either side of any pair, separated or compact', () => {
    for (const value of ['SIMUSDT', 'simusdt', ' SIMUSDT ', 'VHX01/SIMUSDT', 'VHX01-SIMUSDT', 'VHX01_SIMUSDT', 'VHX01SIMUSDT', 'SIMUSDT/USDT', 'USDT/SIMUSDT', 'BTC/SIMUSDT',
      'VHX01', 'vhx99', 'VHX07/USDT', 'VHX07USDT', 'VHX07-USDT', 'USDT/VHX07', 'VHX07/BTC']) expect([value, isSimulationSettled(value)]).toEqual([value, true]);
    for (const value of ['USDT', 'USDC', 'BTC', 'BTC/USDT', 'BTCUSDT', 'ETH/USDT', 'NRX', 'NRX/USDT', 'VTA/USDT', 'AITH/USDT', 'SIM', 'SIM/USDT', 'SIMUSD',
      'VHX', 'VHX1', 'VHX001', 'XVHX01', 'VHXAB', '', null, undefined]) expect([value, isSimulationSettled(value)]).toEqual([value, false]);
  });

  test('the restricted-asset guard keeps every legacy result and adds only SIMUSDT-settled value', () => {
    for (const value of ['USDT', 'USDC', 'BTC', 'BTC/USDT', 'BTCUSDT', 'ETH/USDT']) expect([value, isTestAssetPairOrSymbol(value)]).toEqual([value, false]);
    for (const value of ['VTA', 'VTA/USDT', 'NRX', 'NRX/USDT', 'AITH', 'AITH/USDT', 'SIMUSDT', 'VHX01', 'VHX01/USDT']) expect([value, isTestAssetPairOrSymbol(value)]).toEqual([value, true]);
  });

  test('second line: a SIMUSDT-quoted market in the registry restricts its base even outside the reserved tickers', () => {
    // Built by hand, bypassing privateTestSimulationConfig (which refuses this ticker).
    setManagedListingAssets([{ ...privateTestSimulationConfig(windowConfigFor('VHX07')), symbol: 'SOLX', pair: 'SOLX/SIMUSDT' }]);
    try {
      for (const value of ['SOLX', 'SOLX/USDT', 'USDT/SOLX', 'SOLXUSDT']) expect([value, isSimulationSettled(value)]).toEqual([value, true]);
    } finally { setManagedListingAssets([]); }
    expect(isSimulationSettled('SOLX/USDT')).toBe(false);
  });

  test('a private SIMUSDT market can only be built for a reserved ticker', () => {
    const outside = windowConfigFor('SOLX');
    const code = (run: () => unknown) => { try { run(); return null; } catch (error) { return (error as ListingValidationError).code; } };
    expect(code(() => privateTestSimulationConfig(outside))).toBe('PRIVATE_TEST_SYMBOL');
    expect(code(() => checkPrivateTestable(outside, null, START - DAY))).toBe('PRIVATE_TEST_SYMBOL');
    expect(code(() => privateTestSimulationConfig(windowConfigFor('VHX07')))).toBeNull();
    expect(code(() => checkPrivateTestable(windowConfigFor('VHX07'), null, START - DAY))).toBeNull();
  });
});

pg('History20 private Spot test: SIMUSDT, the non-withdrawable settlement unit (disposable PostgreSQL)', () => {
  let db: PrismaClient;
  let owner: string, tester: string, plain: string, otherAdmin: string, symbol: string;
  const venue = { getTicker: jest.fn(async (asked: string) => (asked === 'BTC/USDT' ? { lastPrice: '60000' } : asked === 'ETH/USDT' ? { lastPrice: '2500' } : null)) };
  const windowConfig = (): ListingConfig => windowConfigFor(symbol);
  const balance = async (userId: string, asset: string) => {
    const row = await db.balance.findUnique({ where: { userId_asset: { userId, asset } } });
    return row ? [row.available.toString(), row.locked.toString()] : null;
  };
  const usdtRows = async () => db.balance.findMany({ where: { userId: { in: [owner, tester, plain, otherAdmin] }, asset: 'USDT' }, orderBy: { userId: 'asc' } })
    .then(rows => rows.map(r => `${r.userId}:${r.available.toString()}:${r.locked.toString()}`));
  const token = (userId: string) => jwt.sign({ sub: userId }, process.env.JWT_SECRET!);
  const app = () => { const a = express(); a.use(express.json()); a.use('/api/v1', withdrawalsRouter(db)); return a; };
  const withdrawable = async (userId: string) => (await request(app()).get('/api/v1/withdrawals/options').set('Authorization', `Bearer ${token(userId)}`)).body;

  let saved: Record<string, string | undefined>;
  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  afterAll(async () => { setManagedListingAssets([]); await db.$disconnect(); });
  beforeEach(async () => {
    owner = randomUUID(); tester = randomUUID(); plain = randomUUID(); otherAdmin = randomUUID();
    // A reserved History20 private ticker (VHX01…VHX99). Counts below are scoped to this test's users.
    symbol = `VHX${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;
    saved = { enabled: process.env.PRIVATE_TRADING_ENABLED, ownerId: process.env.PRIVATE_TRADING_OWNER_ID, testers: process.env.PRIVATE_TRADING_TEST_USER_IDS, privateTest: process.env.HISTORY20_PRIVATE_TEST };
    delete process.env.HISTORY20_PRIVATE_TEST;
    process.env.PRIVATE_TRADING_ENABLED = 'true';
    process.env.PRIVATE_TRADING_OWNER_ID = owner;
    process.env.PRIVATE_TRADING_TEST_USER_IDS = tester;
    await db.user.createMany({ data: ([[owner, 'ADMIN'], [tester, 'USER'], [plain, 'USER'], [otherAdmin, 'ADMIN']] as const)
      .map(([id, role]) => ({ id, email: `${id}@h20-simusdt.invalid`, referralCode: id, passwordHash: 'fixture', role })) });
    // Real, deposited USDT for everyone.
    await db.balance.createMany({ data: [owner, tester, plain, otherAdmin].map(userId => ({ userId, asset: 'USDT', available: '500' })) });
    venue.getTicker.mockClear();
    jest.spyOn(Date, 'now').mockReturnValue(AT);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    setManagedListingAssets([]);
    for (const [key, env] of [['enabled', 'PRIVATE_TRADING_ENABLED'], ['ownerId', 'PRIVATE_TRADING_OWNER_ID'], ['testers', 'PRIVATE_TRADING_TEST_USER_IDS'], ['privateTest', 'HISTORY20_PRIVATE_TEST']] as const) {
      if (saved[key] === undefined) delete process.env[env]; else process.env[env] = saved[key];
    }
  });

  test('restricted unit: an account with real USDT and SIMUSDT — every outflow refuses SIMUSDT and USDT withdrawable stays the real 500', async () => {
    await db.balance.create({ data: { userId: owner, asset: SIMULATION_QUOTE, available: '1000' } });
    const before = await usdtRows();
    // OTC cash takes only its own assets (the route's enum mirrors them).
    expect(Object.keys(OTC_ASSETS)).not.toContain('SIMUSDT');
    expect(Object.keys(OTC_ASSETS)).not.toContain(symbol);

    // Withdrawals: held (Spot) and unheld (trading account) requests, and the options the Wallet shows.
    const withdrawals = new WithdrawalService(db);
    const to = { network: 'TRC20', toAddress: 'TQ-synthetic-fixture' };
    await expect(withdrawals.requestWithdrawal({ userId: owner, asset: 'SIMUSDT', amount: '10', ...to })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    await expect(withdrawals.requestUnheldWithdrawal({ userId: owner, asset: 'SIMUSDT', amount: '10', available: '1000', ...to })).rejects.toMatchObject({ code: 'DEMO_FUNDS_NOT_WITHDRAWABLE', message: 'Demo funds are not withdrawable' });
    expect(await withdrawable(owner)).toEqual({ source: 'SPOT', assets: [{ asset: 'USDT', available: '500' }], futures: [] });
    await expect(withdrawals.requestWithdrawal({ userId: owner, asset: 'USDT', amount: '500.00000001', ...to })).rejects.toThrow('Insufficient USDT balance');
    expect(await db.withdrawal.count({ where: { userId: owner } })).toBe(0);

    // Deposits (claim and observation), admin adjustments (both entry points), demo top-up.
    const deposits = new DepositService(db, {} as never);
    await expect(deposits.submitClaim({ userId: owner, txHash: '0x' + 'a'.repeat(64), asset: 'SIMUSDT' })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    await expect(deposits.recordObservation({ txHash: '0x' + 'b'.repeat(64), asset: 'SIMUSDT', source: 'admin_check' })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    const adjustments = new BalanceAdjustmentService(db);
    await expect(adjustments.adjust({ userId: owner, asset: 'SIMUSDT', amount: '5', reason: 'fixture', performedByAdminId: otherAdmin })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    await expect(adjustments.adjustOnce({ userId: owner, asset: 'SIMUSDT', amount: '5', reason: 'fixture', performedByAdminId: otherAdmin, idempotencyKey: randomUUID() } as never)).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    await expect(new DemoTradingService(db, new MatchingEngine()).topUp({ userId: owner, asset: 'SIMUSDT', amount: '5', performedByAdminId: otherAdmin })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);

    // Transfers to the Futures wallet (and back), banking placements.
    await expect(transferWalletBalance(db, owner, 'SIMUSDT', new BigNumber(1), 'TO_FUTURES')).rejects.toThrow('This asset cannot be transferred');
    await expect(transferWalletBalance(db, owner, 'SIMUSDT', new BigNumber(1), 'TO_SPOT')).rejects.toThrow('This asset cannot be transferred');
    await expect(new BankingService(db).createPlacement(owner, { programId: BANKING_PROGRAMS[0].id, asset: 'SIMUSDT', amount: '10', idempotencyKey: randomUUID() })).rejects.toThrow('asset_unavailable');
    // An ordinary USDT transfer is unchanged.
    await transferWalletBalance(db, plain, 'USDT', new BigNumber(10), 'TO_FUTURES');
    await transferWalletBalance(db, plain, 'USDT', new BigNumber(10), 'TO_SPOT');
    // Product purchases (the price asset is set by an admin): SIMUSDT pays for nothing; a USDT product is unchanged.
    const purchases = new PurchaseService(db);
    const simProduct = await db.product.create({ data: { name: 'Fixture SIMUSDT product', description: 'fixture', priceAmount: '10', priceAsset: 'SIMUSDT' } });
    await expect(purchases.purchaseProduct(owner, simProduct.id)).rejects.toThrow('This asset cannot be used for purchases');
    const usdtProduct = await db.product.create({ data: { name: 'Fixture USDT product', description: 'fixture', priceAmount: '10', priceAsset: 'USDT' } });
    const buyer = randomUUID();
    await db.user.create({ data: { id: buyer, email: `${buyer}@h20-simusdt.invalid`, referralCode: buyer, passwordHash: 'fixture', role: 'USER' } });
    await db.balance.create({ data: { userId: buyer, asset: 'USDT', available: '25' } });
    await purchases.purchaseProduct(buyer, usdtProduct.id);
    expect(await balance(buyer, 'USDT')).toEqual(['15', '0']);
    expect(await db.purchase.count({ where: { userId: owner } })).toBe(0);

    // Valuation and the card's trading-volume test: SIMUSDT is worth nothing in USD.
    const wallet = new WalletPortfolioService(db, { getTickers: jest.fn(async () => [{ pair: 'BTC/USDT', lastPrice: '60000' }]) } as never, { isConfigured: () => false } as never);
    const prices = await wallet.pricesFor(['SIMUSDT', 'USDT']);
    expect([prices.get('SIMUSDT'), prices.get('USDT')]).toEqual([null, 1]);
    await db.trade.create({ data: { id: randomUUID(), pair: `${symbol}/SIMUSDT`, takerOrderId: randomUUID(), makerOrderId: randomUUID(), takerUserId: owner, makerUserId: tester,
      price: '1000', quantity: '1000', side: 'BUY', executedAt: new Date(AT) } });
    const card = await new CardApplicationService(db, wallet).getSnapshot(owner);
    // A SIMUSDT fill is simulation, not trading volume: not counted, and not an unpriced gap either.
    expect(card.eligibility).toMatchObject({ tradingVolumeEligible: false, qualifyingTradingVolumeUsd: 0, tradingVolumeValuationComplete: true });

    // No pair that names SIMUSDT trades while no such market exists — for anyone, before any write.
    const orders = new OrderService(db, new MatchingEngine(), venue);
    for (const userId of [owner, tester, plain, otherAdmin]) {
      for (const [pair, side] of [['SIMUSDT/USDT', 'SELL'], ['BTC/SIMUSDT', 'BUY'], [`${symbol}/SIMUSDT`, 'BUY']] as const) {
        for (const type of ['MARKET', 'LIMIT'] as const) {
          await expect(orders.placeOrder({ userId, pair, side, type, quantity: new BigNumber(1), ...(type === 'LIMIT' ? { price: new BigNumber(1) } : {}) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
        }
      }
    }
    expect(await db.order.count({ where: { userId: { in: [owner, tester, plain, otherAdmin] } } })).toBe(0);
    expect(venue.getTicker).not.toHaveBeenCalled();
    expect(await balance(owner, 'SIMUSDT')).toEqual(['1000', '0']);
    expect(await usdtRows()).toEqual(before);
    expect(await db.futuresBalance.count({ where: { userId: owner } })).toBe(0);
    expect(await db.demoBalance.count({ where: { userId: owner } })).toBe(0);
  });

  test('settlement: on a SIMUSDT-quoted History20 market (set up by the test) the owner sale, book and conditional fills, cancel and concurrent sales move only the asset and SIMUSDT', async () => {
    const config = windowConfig(), pair = privateTestPair(symbol);
    // The private market stays NOT tradable: the simulation applies a scenario path only to a
    // non-tradable listing (testMarketSimulation.ts), so admission must be its own gate.
    const market = privateTestSimulationConfig(config);
    expect(market.isTradable).toBe(false);
    setManagedListingAssets([market]);
    const model = new TestMarketSimulation(market);
    // The same window, the same prices and candles as its USDT listing config (the chart and preview source).
    const reference = new TestMarketSimulation(listingSimulationConfig(config));
    for (const t of [START + 3_600_000, START + DAY, AT, AT + DAY]) expect(model.priceAt(t)).toBe(reference.priceAt(t));
    expect(testMarketCandles(market, '1h', AT, 24)).toEqual(testMarketCandles(listingSimulationConfig(config), '1h', AT, 24));
    // The real gate: the private test switched on, the owner and the tester verified participants.
    process.env.HISTORY20_PRIVATE_TEST = 'enabled';
    const before = await usdtRows();
    await allocateListingOwner(db, { id: `h20-simusdt-${symbol.toLowerCase()}-${owner}`, version: 1, publishedAt: LISTING_AT, config }, owner);
    await db.balance.create({ data: { userId: tester, asset: SIMULATION_QUOTE, available: '1000' } });
    const orders = new OrderService(db, new MatchingEngine(), venue);

    // The owner's simulation sale: the canonical model price (= Spot ticker/trigger source = chart close), proceeds in SIMUSDT.
    const price = new BigNumber(model.priceAt(AT)!);
    expect((await spotPriceSource(venue, () => AT).getTicker(pair))!.lastPrice).toBe(price.toFixed());
    expect(testMarketCandles(market, '5m', AT, 3).at(-1)!.close).toBe(price.toNumber());
    const sale = await orders.placeOrder({ userId: owner, pair, side: 'SELL', type: 'MARKET', quantity: new BigNumber(10) });
    expect(sale.trades[0]).toMatchObject({ makerUserId: `simulation:${symbol}` });
    expect(new BigNumber(sale.trades[0].price).eq(price)).toBe(true);
    expect(await balance(owner, symbol)).toEqual(['990', '0']);
    expect(new BigNumber((await balance(owner, 'SIMUSDT'))![0]).eq(price.times(10))).toBe(true);
    expect((await db.auditLog.findFirst({ where: { userId: owner, action: 'HISTORY20_PRIVATE_SIMULATION_SOLD' } }))?.metadata).toMatchObject({ pair, quote: 'SIMUSDT' });

    // A book fill between two participants: the tester buys from the owner in SIMUSDT.
    const fillPrice = price.decimalPlaces(8);
    await orders.placeOrder({ userId: owner, pair, side: 'SELL', type: 'LIMIT', price: fillPrice, quantity: new BigNumber(5) });
    const buy = await orders.placeOrder({ userId: tester, pair, side: 'BUY', type: 'LIMIT', price: fillPrice, quantity: new BigNumber(5) });
    expect(buy.trades).toHaveLength(1);
    expect(await balance(tester, symbol)).toEqual(['5', '0']);
    expect(new BigNumber((await balance(tester, 'SIMUSDT'))![0]).eq(new BigNumber(1000).minus(fillPrice.times(5)))).toBe(true);

    // A cancel releases the SIMUSDT lock exactly.
    const resting = await orders.placeOrder({ userId: tester, pair, side: 'BUY', type: 'LIMIT', price: new BigNumber('0.01'), quantity: new BigNumber(100) });
    expect((await balance(tester, 'SIMUSDT'))![1]).toBe('1');
    await orders.cancelOrder(tester, resting.order.id);
    expect((await balance(tester, 'SIMUSDT'))![1]).toBe('0');

    // A conditional fill: the tester's take-profit fires on the model price and fills against the owner's bid, in SIMUSDT.
    const trigger = price.times(1.003).decimalPlaces(8);
    let firesAt = AT;
    while (new BigNumber(model.priceAt(firesAt)!).lt(trigger)) { firesAt += 10_000; if (firesAt > AT + 3 * DAY) throw new Error('fixture: no crossing'); }
    const takeProfit = await orders.placeOrder({ userId: tester, pair, side: 'SELL', type: 'TAKE_PROFIT_LIMIT', triggerPrice: trigger, price: trigger, quantity: new BigNumber(2) });
    await orders.placeOrder({ userId: owner, pair, side: 'BUY', type: 'LIMIT', price: trigger, quantity: new BigNumber(2) });
    const watcher = new PriceWatcherService(db, orders, venue);
    const tradesBefore = await db.trade.count({ where: { pair } });
    (Date.now as jest.Mock).mockReturnValue(firesAt + 1_000);
    await watcher.checkAndTrigger();
    // Every trade shares the mocked clock, so the fill is located by its order, not by time.
    expect(await db.trade.count({ where: { pair } })).toBe(tradesBefore + 1);
    const fired = await db.trade.findFirst({ where: { pair, takerOrderId: takeProfit.order.id, takerUserId: tester, makerUserId: owner } });
    expect(fired).not.toBeNull();
    expect(new BigNumber(fired!.price.toString()).eq(trigger)).toBe(true);
    expect(await balance(tester, symbol)).toEqual(['3', '0']);

    // Concurrent owner sales: each settles in SIMUSDT, none in USDT.
    const ownerSimBefore = new BigNumber((await balance(owner, 'SIMUSDT'))![0]);
    const concurrent = await Promise.allSettled([1, 2, 3].map(() => orders.placeOrder({ userId: owner, pair, side: 'SELL', type: 'MARKET', quantity: new BigNumber(1) })));
    const filled = concurrent.filter(r => r.status === 'fulfilled').length;
    expect(filled).toBeGreaterThan(0);
    expect(new BigNumber((await balance(owner, 'SIMUSDT'))![0]).gt(ownerSimBefore)).toBe(true);

    // Indirect cash-out: the window asset bought with SIMUSDT never trades on any other pair (USDT,
    // another quote, or as the quote), for participants or anyone else, before any write.
    const ordersBefore = await db.order.count();
    for (const other of [`${symbol}/USDT`, `${symbol}/BTC`, `USDT/${symbol}`, `${symbol}-USDT`]) {
      for (const [userId, side] of [[tester, 'SELL'], [owner, 'SELL'], [plain, 'BUY']] as const) {
        await expect(orders.placeOrder({ userId, pair: other, side, type: 'LIMIT', price: new BigNumber(1), quantity: new BigNumber(1) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      }
      expect(isTestAssetPairOrSymbol(other)).toBe(true);
    }
    expect(await db.order.count()).toBe(ordersBefore);

    // The window asset itself: no transfer to Futures, purchase, withdrawal or deposit.
    await expect(transferWalletBalance(db, tester, symbol, new BigNumber(1), 'TO_FUTURES')).rejects.toThrow('This asset cannot be transferred');
    const windowProduct = await db.product.create({ data: { name: 'Fixture window-asset product', description: 'fixture', priceAmount: '1', priceAsset: symbol } });
    await expect(new PurchaseService(db).purchaseProduct(tester, windowProduct.id)).rejects.toThrow('This asset cannot be used for purchases');
    await expect(new DepositService(db, {} as never).submitClaim({ userId: tester, txHash: '0x' + 'c'.repeat(64), asset: symbol })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    expect(await db.futuresBalance.count({ where: { userId: { in: [owner, tester] } } })).toBe(0);

    // After every path: no USDT row moved, SIMUSDT cannot be withdrawn, USDT withdrawable is still the real 500.
    expect(await usdtRows()).toEqual(before);
    const withdrawals = new WithdrawalService(db);
    for (const userId of [owner, tester]) {
      for (const asset of ['SIMUSDT', symbol]) {
        await expect(withdrawals.requestWithdrawal({ userId, asset, amount: '1', network: 'TRC20', toAddress: 'TQ-synthetic-fixture' })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      }
      expect(await withdrawable(userId)).toEqual({ source: 'SPOT', assets: [{ asset: 'USDT', available: '500' }], futures: [] });
    }
    expect(await db.withdrawal.count({ where: { userId: { in: [owner, tester] } } })).toBe(0);
    expect(await db.trade.count({ where: { pair: `${symbol}/USDT` } })).toBe(0);
    expect(venue.getTicker.mock.calls.some(([asked]) => asked === pair)).toBe(false);
    // The window asset is not valued in USD either (it is quoted in SIMUSDT).
    const wallet = new WalletPortfolioService(db, { getTickers: jest.fn(async () => []) } as never, { isConfigured: () => false } as never);
    expect((await wallet.pricesFor([symbol])).get(symbol)).toBeNull();
  });

  test('switched off (the default), the real gate refuses the private market for everyone, before any write; switched on, still for non-participants', async () => {
    const config = windowConfig(), pair = privateTestPair(symbol);
    setManagedListingAssets([privateTestSimulationConfig(config)]);
    await allocateListingOwner(db, { id: `h20-closed-${symbol.toLowerCase()}-${owner}`, version: 1, publishedAt: LISTING_AT, config }, owner);
    await db.balance.create({ data: { userId: tester, asset: SIMULATION_QUOTE, available: '10' } });
    const orders = new OrderService(db, new MatchingEngine(), venue);
    for (const userId of [owner, tester, plain, otherAdmin]) {
      await expect(orders.placeOrder({ userId, pair, side: 'SELL', type: 'MARKET', quantity: new BigNumber(1) })).rejects.toThrow('History20 private QA is not available for trading.');
      await expect(orders.placeOrder({ userId, pair, side: 'BUY', type: 'LIMIT', price: new BigNumber(1), quantity: new BigNumber(1) })).rejects.toThrow('History20 private QA is not available for trading.');
    }
    process.env.HISTORY20_PRIVATE_TEST = 'enabled';
    for (const userId of [plain, otherAdmin]) {
      await expect(orders.placeOrder({ userId, pair, side: 'SELL', type: 'MARKET', quantity: new BigNumber(1) })).rejects.toThrow('History20 private QA is not available for trading.');
      await expect(orders.placeOrder({ userId, pair, side: 'BUY', type: 'LIMIT', price: new BigNumber(1), quantity: new BigNumber(1) })).rejects.toThrow('History20 private QA is not available for trading.');
    }
    expect(await db.order.count({ where: { pair, userId: { in: [owner, tester, plain, otherAdmin] } } })).toBe(0);
    expect(await balance(owner, symbol)).toEqual(['1000', '0']);
    expect(await balance(tester, SIMULATION_QUOTE)).toEqual(['10', '0']);
  });

  test('fail closed without the registry: a reserved History20 ticker stays restricted while its listing is cold, withheld or unpublished', async () => {
    // FIXTURE rows: holdings left from an earlier private test after the listing left Render's registry.
    setManagedListingAssets([]);
    await db.balance.createMany({ data: [{ userId: tester, asset: symbol, available: '100' }, { userId: tester, asset: SIMULATION_QUOTE, available: '50' }] });
    const before = await usdtRows();
    const orders = new OrderService(db, new MatchingEngine(), venue);
    for (const other of [`${symbol}/USDT`, `${symbol}/BTC`, `USDT/${symbol}`, `${symbol}/SIMUSDT`]) {
      expect([other, isTestAssetPairOrSymbol(other)]).toEqual([other, true]);
      await expect(orders.placeOrder({ userId: tester, pair: other, side: 'SELL', type: 'LIMIT', price: new BigNumber(1), quantity: new BigNumber(1) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      await expect(orders.placeOrder({ userId: plain, pair: other, side: 'BUY', type: 'LIMIT', price: new BigNumber(1), quantity: new BigNumber(1) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      await expect(orders.placeOrder({ userId: owner, pair: other, side: 'SELL', type: 'MARKET', quantity: new BigNumber(1) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      // A cold registry (Render has not loaded the listings yet) refuses the same way, before asking the venue.
      await expect(nrxSpot.assertSpotListingReady(other, venue, AT, { ensureFresh: async () => undefined, resolved: () => false })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    }
    expect(venue.getTicker).not.toHaveBeenCalled();
    expect(await db.order.count({ where: { userId: { in: [owner, tester, plain] } } })).toBe(0);

    // Every other way out of the Spot ledger, for the window asset and SIMUSDT alike.
    const withdrawals = new WithdrawalService(db);
    const to = { network: 'TRC20', toAddress: 'TQ-synthetic-fixture' };
    for (const asset of [symbol, SIMULATION_QUOTE]) {
      await expect(withdrawals.requestWithdrawal({ userId: tester, asset, amount: '1', ...to })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      await expect(withdrawals.requestUnheldWithdrawal({ userId: tester, asset, amount: '1', available: '100', ...to })).rejects.toMatchObject({ code: 'DEMO_FUNDS_NOT_WITHDRAWABLE', message: 'Demo funds are not withdrawable' });
      await expect(transferWalletBalance(db, tester, asset, new BigNumber(1), 'TO_FUTURES')).rejects.toThrow('This asset cannot be transferred');
      await expect(new DepositService(db, {} as never).submitClaim({ userId: tester, txHash: '0x' + 'd'.repeat(64), asset })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      await expect(new BalanceAdjustmentService(db).adjust({ userId: tester, asset, amount: '5', reason: 'fixture', performedByAdminId: otherAdmin })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      await expect(new DemoTradingService(db, new MatchingEngine()).topUp({ userId: tester, asset, amount: '5', performedByAdminId: otherAdmin })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      const product = await db.product.create({ data: { name: `Fixture ${asset} product`, description: 'fixture', priceAmount: '1', priceAsset: asset } });
      await expect(new PurchaseService(db).purchaseProduct(tester, product.id)).rejects.toThrow('This asset cannot be used for purchases');
    }
    expect(await withdrawable(tester)).toEqual({ source: 'SPOT', assets: [{ asset: 'USDT', available: '500' }], futures: [] });
    expect([await balance(tester, symbol), await balance(tester, SIMULATION_QUOTE)]).toEqual([['100', '0'], ['50', '0']]);
    expect(await usdtRows()).toEqual(before);
    expect(await db.futuresBalance.count({ where: { userId: tester } })).toBe(0);
    expect(await db.withdrawal.count({ where: { userId: tester } })).toBe(0);
    expect(await db.purchase.count({ where: { userId: tester } })).toBe(0);
  });

  test('the same market quoted in USDT (any published managed listing today): the owner\'s synthetic sale stays stopped before any write (#551)', async () => {
    // An ordinary ticker: a reserved one is refused even earlier, by the gate (below).
    const usdtSymbol = `QW${randomUUID().replace(/[^A-F]/gi, '').slice(0, 4).toUpperCase()}`;
    const config = windowConfigFor(usdtSymbol);
    setManagedListingAssets([{ ...listingSimulationConfig(config), isTradable: true }]);
    await allocateListingOwner(db, { id: `h20-usdt-${usdtSymbol.toLowerCase()}-${owner}`, version: 1, publishedAt: LISTING_AT, config }, owner);
    const orders = new OrderService(db, new MatchingEngine(), venue);
    await expect(orders.placeOrder({ userId: owner, pair: `${usdtSymbol}/USDT`, side: 'SELL', type: 'MARKET', quantity: new BigNumber(10) })).rejects.toThrow('Simulation Spot sale is not available for this listing');
    expect(await balance(owner, 'USDT')).toEqual(['500', '0']);
    expect(await balance(owner, usdtSymbol)).toEqual(['1000', '0']);
    // The same market under a reserved ticker, even marked private by a forged registry entry: refused by the gate itself.
    setManagedListingAssets([{ ...privateTestSimulationConfig(windowConfig()), quote: 'USDT', pair: `${symbol}/USDT`, isTradable: true }]);
    process.env.HISTORY20_PRIVATE_TEST = 'enabled';
    await expect(orders.placeOrder({ userId: owner, pair: `${symbol}/USDT`, side: 'SELL', type: 'MARKET', quantity: new BigNumber(10) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    expect(await balance(owner, 'USDT')).toEqual(['500', '0']);
    expect(await db.order.count({ where: { userId: owner } })).toBe(0);
  });

  test('admission: exactly the verified owner and the allowlisted testers, and only while the private test is on', async () => {
    const blocked = randomUUID();
    await db.user.create({ data: { id: blocked, email: `${blocked}@h20-simusdt.invalid`, referralCode: blocked, passwordHash: 'fixture', role: 'USER', blockedAt: new Date(AT) } });
    process.env.PRIVATE_TRADING_TEST_USER_IDS = `${tester},${blocked}`;
    expect(await Promise.all([owner, tester, plain, otherAdmin, blocked, null].map(id => isPrivateTestParticipant(db, id)))).toEqual([true, true, false, false, false, false]);
    // The owner only while private trading is enabled, and only as an ADMIN.
    process.env.PRIVATE_TRADING_ENABLED = 'false';
    expect(await isPrivateTestParticipant(db, owner)).toBe(false);
    process.env.PRIVATE_TRADING_ENABLED = 'true';
    await db.user.update({ where: { id: owner }, data: { role: 'ADMIN' } });
    expect(await privateTestAdmitted(db, owner)).toBe(false); // switched off by default
    process.env.HISTORY20_PRIVATE_TEST = 'enabled';
    expect(await Promise.all([owner, tester, plain, otherAdmin, blocked].map(id => privateTestAdmitted(db, id)))).toEqual([true, true, false, false, false]);
    process.env.HISTORY20_PRIVATE_TEST = 'on'; // anything but exactly `enabled` is off
    expect(await privateTestAdmitted(db, owner)).toBe(false);
    await db.user.update({ where: { id: owner }, data: { role: 'USER' } });
    expect(await isPrivateTestParticipant(db, owner)).toBe(false);
  });

  test('the rights gate is unchanged: a window is never published', () => {
    expect(() => checkPublishable(windowConfig(), null, START - DAY)).toThrow(ListingValidationError);
    try { checkPublishable(windowConfig(), null, START - DAY); } catch (error) { expect((error as ListingValidationError).code).toBe('HISTORICAL_RIGHTS_UNVERIFIED'); }
  });
});
