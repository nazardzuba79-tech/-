/**
 * P0 (CTO, PR #553, 2026-10-19): a History20 private test asset must never
 * become real money because Render's listing registry is cold, stale, empty
 * or unreachable. Reported exploit, reproduced on a disposable loopback
 * PostgreSQL: with `setManagedListingAssets([])`, an owner holding a private
 * asset X sold it on `X/USDT` into an ordinary user's USDT bid (+50 real
 * USDT) and moved X to Futures.
 *
 * The guard must recognise the asset from the raw value alone — no registry,
 * cache, listing store, database or network: the reserved private tickers
 * (VHX01…VHX99, shared/history20PrivateSymbol) and the SIMUSDT unit, bare or
 * on either side of any pair, in every spelling. Ordinary pairs (BTC/USDT…), NRX and AITH keep
 * their behaviour. Synthetic users and balances only.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'h20-cold-registry-fixture-secret';
process.env.API_KEY_ENCRYPTION_SECRET = process.env.API_KEY_ENCRYPTION_SECRET || '0'.repeat(64);

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { buildHistoricalGrowthProgram, historicalGrowthMaxPrice, type HistoricalGrowthSourceRow } from '../../../shared/listingHistoricalGrowth';
import { defaultScenarioControls } from '../../../shared/listingScenarioControls';
import { checkPublishable, ListingValidationError, listingSimulationConfig, parseListingConfig } from '../listingConfig';
import { setManagedListingAssets } from '../managedSnapshot';
import { privateTestSimulationConfig } from '../privateTest';
import { assertSpotListing, spotPriceSource } from '../../testMarkets/nrxSpot';
import { isTestAssetPairOrSymbol, TEST_ASSET_NOT_TRADABLE_MESSAGE } from '../../testMarkets/testAssetConfig';
import { OrderService } from '../../OrderService';
import { WalletPortfolioService } from '../../WalletPortfolioService';
import { WithdrawalService } from '../../WithdrawalService';
import { DepositService } from '../../DepositService';
import { BalanceAdjustmentService } from '../../BalanceAdjustmentService';
import { DemoTradingService } from '../../DemoTradingService';
import { transferWalletBalance } from '../../WalletTransferService';
import { PurchaseService } from '../../PurchaseService';
import { BankingService } from '../../../banking/service';
import { BANKING_PROGRAMS } from '../../../banking/config';
import { withdrawalsRouter } from '../../../api/routes/withdrawals';
import { MatchingEngine } from '../../../matching-engine/MatchingEngine';

const url = process.env.VOLTEX_LISTING_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_listing_test') throw new Error('History20 cold-registry tests require the disposable loopback voltex_listing_test database');
}
const pg = url ? describe : describe.skip;

const DAY = 86_400_000;
const LISTING_AT = '2026-11-02T00:00:00.000Z', START = Date.parse(LISTING_AT), AT = START + 2 * DAY;
function walk(days: number): HistoricalGrowthSourceRow[] {
  let x = 31, price = 100;
  const random = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: days }, (_, d) => {
    const date = new Date(Date.UTC(2020, 0, 1) + d * DAY).toISOString().slice(0, 10);
    const open = d ? price * (1 + (random() - .5) * .004) : 100, close = open * Math.exp(Math.log(80) / days + (random() - .5) * .1);
    price = close;
    return { date, open, high: Math.max(open, close) * 1.02, low: Math.min(open, close) * .98, close };
  });
}
const growth = buildHistoricalGrowthProgram({ scenarioId: 'VHX-07-SOL', targetPeakGrowthPercent: '9348', rows: walk(40),
  source: { provider: 'Binance Vision', asset: 'SOL', quote: 'USDT', metric: 'spot daily OHLCV', dataKind: 'exchange_ohlcv', timeframe: '1d', sliceSha256: 'd'.repeat(64), license: 'CC-BY-NC-SA-4.0 plus Binance Vision Dataset Terms' } });
const window = (symbol: string, extra: Record<string, unknown> = {}) => ({
  schemaVersion: 1, symbol, name: 'History20 cold-registry QA', logo: null, initialPrice: '2', listingAt: LISTING_AT, displayTimeZone: 'UTC',
  ownerAllocation: '0', seedMode: 'manual', seed: `${symbol.toLowerCase()}-cold-registry-synthetic`, tradable: false,
  simulationProgram: { ...defaultScenarioControls('2', 'CALM'), stages: [], first24hGainPercent: '0', afterGrowth: 'range', growth: 'historical-window',
    historicalGrowth: growth, maxPrice: historicalGrowthMaxPrice('2', growth.targetPeakGrowthPercent) },
  ...extra,
});

const X = 'VHX07';
// Every spelling of every route from X to a withdrawable asset, on either side.
const OTHER_PAIRS = [`${X}/USDT`, `${X}/BTC`, `${X}/USDC`, `${X}/ETH`, `USDT/${X}`, `BTC/${X}`, `${X}-USDT`, `${X}_USDT`, `${X}USDT`, `vhx07/usdt`, ` ${X}/USDT `, 'VHX99/USDT'];

pg('History20 private asset with a cold, stale or empty registry: no real money, no Futures (disposable PostgreSQL)', () => {
  let db: PrismaClient, owner: string, tester: string, buyer: string, otherAdmin: string;
  // A venue that "knows" every pair: the guard may not lean on a missing venue price either.
  const venue = { getTicker: jest.fn(async (_pair: string) => ({ lastPrice: '5' })) };
  const saved: Record<string, string | undefined> = {};
  const ENV = ['PRIVATE_TRADING_ENABLED', 'PRIVATE_TRADING_OWNER_ID', 'PRIVATE_TRADING_TEST_USER_IDS', 'HISTORY20_PRIVATE_TEST', 'SIMULATION_SPOT_DEMO_SETTLEMENT_ENABLED'];
  const balance = async (userId: string, asset: string) => {
    const row = await db.balance.findUnique({ where: { userId_asset: { userId, asset } } });
    return row ? [row.available.toString(), row.locked.toString()] : null;
  };
  const registryStates = () => {
    const legacy = listingSimulationConfig(parseListingConfig({ schemaVersion: 1, symbol: 'QAX', name: 'QA Example', logo: null, initialPrice: '0.25', listingAt: LISTING_AT,
      displayTimeZone: 'UTC', ownerAllocation: '1000', seedMode: 'manual', seed: 'qax-cold-registry-synthetic', tradable: true }));
    const privateMarket = privateTestSimulationConfig(parseListingConfig(window(X, { privateTest: { settlement: 'SIMUSDT', funding: { base: '100', quote: '1000' } } })));
    return { empty: [], stale: [legacy], loaded: [legacy, privateMarket] } as const;
  };

  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  afterAll(async () => { setManagedListingAssets([]); await db.$disconnect(); });
  beforeEach(async () => {
    [owner, tester, buyer, otherAdmin] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const key of ENV) saved[key] = process.env[key];
    Object.assign(process.env, { PRIVATE_TRADING_ENABLED: 'true', PRIVATE_TRADING_OWNER_ID: owner, PRIVATE_TRADING_TEST_USER_IDS: tester, HISTORY20_PRIVATE_TEST: 'enabled', SIMULATION_SPOT_DEMO_SETTLEMENT_ENABLED: 'true' });
    await db.user.createMany({ data: ([[owner, 'ADMIN'], [tester, 'USER'], [buyer, 'USER'], [otherAdmin, 'ADMIN']] as const)
      .map(([id, role]) => ({ id, email: `${id}@h20-cold-registry.invalid`, referralCode: id, passwordHash: 'fixture', role })) });
    // FIXTURE: private inventory as funding and private fills would leave it, next to real money.
    await db.balance.createMany({ data: [
      { userId: owner, asset: X, available: '100' }, { userId: tester, asset: X, available: '100' }, { userId: tester, asset: 'VHX99', available: '100' },
      { userId: buyer, asset: 'USDT', available: '500' }, { userId: buyer, asset: 'BTC', available: '1' }, { userId: buyer, asset: 'USDC', available: '500' },
    ] });
    venue.getTicker.mockClear();
    jest.spyOn(Date, 'now').mockReturnValue(AT);
    setManagedListingAssets([]);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    setManagedListingAssets([]);
    for (const key of ENV) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  });

  test('the reported exploit, preserved: empty registry, X/USDT LIMIT SELL into a real USDT bid — refused, zero USDT credited', async () => {
    const orders = new OrderService(db, new MatchingEngine(), venue);
    await expect(orders.placeOrder({ userId: owner, pair: `${X}/USDT`, side: 'SELL', type: 'LIMIT', price: new BigNumber(5), quantity: new BigNumber(10) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    await expect(orders.placeOrder({ userId: buyer, pair: `${X}/USDT`, side: 'BUY', type: 'LIMIT', price: new BigNumber(5), quantity: new BigNumber(10) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    await expect(transferWalletBalance(db, owner, X, new BigNumber(1), 'TO_FUTURES')).rejects.toThrow('This asset cannot be transferred');
    expect(await balance(owner, 'USDT')).toBeNull();
    expect(await balance(owner, X)).toEqual(['100', '0']);
    expect(await balance(buyer, 'USDT')).toEqual(['500', '0']);
    expect(await db.trade.count({ where: { pair: `${X}/USDT` } })).toBe(0);
    expect(await db.futuresBalance.count({ where: { userId: owner } })).toBe(0);
  });

  test('every spelling and side of every other pair, for every holder and any registry state, is refused before any write — including a fresh engine (restart)', async () => {
    for (const [state, assets] of Object.entries(registryStates())) {
      setManagedListingAssets(assets);
      const orders = new OrderService(db, new MatchingEngine(), venue);
      for (const pair of OTHER_PAIRS) {
        expect([state, pair, isTestAssetPairOrSymbol(pair)]).toEqual([state, pair, true]);
        expect(() => assertSpotListing(pair, AT)).toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
        for (const userId of [owner, tester, otherAdmin]) {
          await expect(orders.placeOrder({ userId, pair, side: 'SELL', type: 'LIMIT', price: new BigNumber(5), quantity: new BigNumber(1) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
          await expect(orders.placeOrder({ userId, pair, side: 'SELL', type: 'MARKET', quantity: new BigNumber(1) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
        }
        await expect(orders.placeOrder({ userId: buyer, pair, side: 'BUY', type: 'LIMIT', price: new BigNumber(5), quantity: new BigNumber(1) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      }
    }
    expect(await db.order.count({ where: { userId: { in: [owner, tester, buyer, otherAdmin] } } })).toBe(0);
    expect(await db.trade.count({ where: { OR: [{ takerUserId: { in: [owner, tester, buyer] } }, { makerUserId: { in: [owner, tester, buyer] } }] } })).toBe(0);
    expect([await balance(buyer, 'USDT'), await balance(buyer, 'BTC'), await balance(owner, 'USDT'), await balance(owner, 'BTC')]).toEqual([['500', '0'], ['1', '0'], null, null]);
    // A modeled pair is never priced by the venue: no silent fallback for the private pair or its spellings.
    expect(venue.getTicker.mock.calls.some(([asked]) => /VHX/i.test(asked))).toBe(false);
    // Known to the registry, the private pair has its model price; cold, it has none — never the venue's.
    expect(await spotPriceSource(venue, () => AT).getTicker(`${X}/SIMUSDT`)).not.toBeNull();
    setManagedListingAssets([]);
    expect(await spotPriceSource(venue, () => AT).getTicker(`${X}/SIMUSDT`)).toBeNull();
    expect(venue.getTicker.mock.calls.some(([asked]) => /VHX/i.test(asked))).toBe(false);
  });

  test('a registry that wrongly lists a reserved ticker as an ordinary tradable USDT listing still never trades it', async () => {
    const forged = { ...listingSimulationConfig(parseListingConfig({ schemaVersion: 1, symbol: 'QAX', name: 'Forged', logo: null, initialPrice: '1', listingAt: LISTING_AT,
      displayTimeZone: 'UTC', ownerAllocation: '0', seedMode: 'manual', seed: 'forged-registry-synthetic', tradable: true })), symbol: X, pair: `${X}/USDT` };
    setManagedListingAssets([forged]);
    const orders = new OrderService(db, new MatchingEngine(), venue);
    await expect(orders.placeOrder({ userId: owner, pair: `${X}/USDT`, side: 'SELL', type: 'LIMIT', price: new BigNumber(5), quantity: new BigNumber(10) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    await expect(orders.placeOrder({ userId: owner, pair: `${X}/USDT`, side: 'SELL', type: 'MARKET', quantity: new BigNumber(1) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    await expect(orders.placeOrder({ userId: buyer, pair: `${X}/USDT`, side: 'BUY', type: 'LIMIT', price: new BigNumber(5), quantity: new BigNumber(10) })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
    expect(await balance(owner, 'USDT')).toBeNull();
    expect(await db.order.count({ where: { userId: { in: [owner, buyer] } } })).toBe(0);
  });

  test('no other exit with an empty registry: transfer, purchase, withdrawal, deposit, adjustment, demo, banking, valuation', async () => {
    for (const asset of [X, 'VHX99', 'vhx07']) {
      for (const direction of ['TO_FUTURES', 'TO_SPOT'] as const) await expect(transferWalletBalance(db, tester, asset, new BigNumber(1), direction)).rejects.toThrow('This asset cannot be transferred');
      const product = await db.product.create({ data: { name: 'Fixture private-asset product', description: 'fixture', priceAmount: '1', priceAsset: asset } });
      await expect(new PurchaseService(db).purchaseProduct(tester, product.id)).rejects.toThrow('This asset cannot be used for purchases');
      const withdrawals = new WithdrawalService(db);
      await expect(withdrawals.requestWithdrawal({ userId: tester, asset, amount: '1', network: 'TRC20', toAddress: 'TQ-synthetic-fixture' })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      await expect(withdrawals.requestUnheldWithdrawal({ userId: tester, asset, amount: '1', available: '100', network: 'TRC20', toAddress: 'TQ-synthetic-fixture' })).rejects.toMatchObject({ code: 'DEMO_FUNDS_NOT_WITHDRAWABLE', message: 'Demo funds are not withdrawable' });
      const deposits = new DepositService(db, {} as never);
      await expect(deposits.submitClaim({ userId: tester, txHash: `0x${randomUUID().replace(/-/g, '')}${'e'.repeat(32)}`, asset })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      await expect(deposits.recordObservation({ txHash: `0x${randomUUID().replace(/-/g, '')}${'f'.repeat(32)}`, asset, source: 'admin_check' })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      const adjustments = new BalanceAdjustmentService(db);
      await expect(adjustments.adjust({ userId: tester, asset, amount: '5', reason: 'fixture', performedByAdminId: otherAdmin })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      await expect(new DemoTradingService(db, new MatchingEngine()).topUp({ userId: tester, asset, amount: '5', performedByAdminId: otherAdmin })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      await expect(new BankingService(db).createPlacement(tester, { programId: BANKING_PROGRAMS[0].id, asset, amount: '1', idempotencyKey: randomUUID() })).rejects.toThrow('asset_unavailable');
    }
    // Not worth money either, even when a venue quotes a colliding ticker.
    const wallet = new WalletPortfolioService(db, { getTickers: jest.fn(async () => [{ pair: `${X}/USDT`, lastPrice: '5' }, { pair: 'VHX99/USDT', lastPrice: '5' }, { pair: 'BTC/USDT', lastPrice: '60000' }]) } as never, { isConfigured: () => false } as never);
    const prices = await wallet.pricesFor([X, 'VHX99', 'BTC']);
    expect([prices.get(X) ?? null, prices.get('VHX99') ?? null, prices.get('BTC')]).toEqual([null, null, 60000]);
    const app = express(); app.use('/api/v1', withdrawalsRouter(db));
    const options = await request(app).get('/api/v1/withdrawals/options').set('Authorization', `Bearer ${jwt.sign({ sub: tester }, process.env.JWT_SECRET!)}`);
    expect(JSON.stringify(options.body)).not.toMatch(/VHX/);
    expect([await balance(tester, X), await balance(tester, 'VHX99')]).toEqual([['100', '0'], ['100', '0']]);
    expect(await db.futuresBalance.count({ where: { userId: tester } })).toBe(0);
    expect(await db.withdrawal.count({ where: { userId: tester } })).toBe(0);
    expect(await db.purchase.count({ where: { userId: tester } })).toBe(0);
  });

  test('the reserved tickers belong to private tests only: no ordinary listing is published there; a private test must use one', () => {
    const code = (input: unknown) => { try { checkPublishable(parseListingConfig(input), null, START - DAY); return null; } catch (error) { return (error as ListingValidationError).code; } };
    const legacyShape = { schemaVersion: 1, name: 'Collision check', logo: null, initialPrice: '1', listingAt: LISTING_AT, displayTimeZone: 'UTC',
      ownerAllocation: '10', seedMode: 'manual', seed: 'collision-check-synthetic', tradable: true };
    // A draft may carry such a name (it trades nowhere); an ordinary listing is never published under it.
    expect(parseListingConfig({ ...legacyShape, symbol: 'VHX07' }).symbol).toBe('VHX07');
    for (const symbol of ['VHX07', 'VHX01', 'VHX20', 'VHX99']) expect([symbol, code({ ...legacyShape, symbol })]).toEqual([symbol, 'RESERVED_TICKER']);
    expect(code({ ...legacyShape, symbol: 'QAX' })).toBeNull();
    // The same window, public: refused by the rights gate first, as before.
    expect(code(window(X))).toBe('HISTORICAL_RIGHTS_UNVERIFIED');
    // As a private test it is accepted, and only under a reserved ticker.
    const privateTest = { settlement: 'SIMUSDT', funding: { base: '100', quote: '1000' } };
    expect(code(window('VHX07', { privateTest }))).toBeNull();
    for (const symbol of ['VHX7', 'VHX07B', 'PVX07', 'QAX', 'SIMUSDT']) expect([symbol, code(window(symbol, { privateTest }))]).not.toEqual([symbol, null]);
  });

  test('ordinary pairs, NRX and AITH keep their behaviour under the same empty registry', async () => {
    const orders = new OrderService(db, new MatchingEngine(), venue);
    await expect(orders.placeOrder({ userId: buyer, pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: new BigNumber(1), quantity: new BigNumber(1) })).resolves.toMatchObject({ order: { status: 'OPEN' } });
    for (const value of ['USDT', 'BTC', 'BTC/USDT', 'ETH/USDT', 'VHX', 'VHXA/USDT', 'XVHX07/USDT']) expect([value, isTestAssetPairOrSymbol(value)]).toEqual([value, false]);
    for (const value of ['NRX', 'NRX/USDT', 'AITH', 'AITH/USDT', 'VTA/USDT', 'SIMUSDT']) expect([value, isTestAssetPairOrSymbol(value)]).toEqual([value, true]);
    expect(() => assertSpotListing('AITH/USDT', AT)).toThrow('Aitheron AI is not available for trading.');
    expect(await balance(buyer, 'USDT')).toEqual(['499', '1']);
  });
});
