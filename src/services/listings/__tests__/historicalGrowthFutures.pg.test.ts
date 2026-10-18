/**
 * History20 growth windows against a real (disposable, loopback) PostgreSQL:
 * the existing Futures account — balances, open / closed / liquidated
 * positions, SL/TP protections, orders, funding records and payments, the
 * native Futures TEST account's state, revisions and live projection
 * (including a HISTORICAL_DEMO deal), and what /futures/balances,
 * /futures/orders/me and /futures/positions/history serve — stays
 * byte-for-byte as it was while every growth-window path runs
 * (v1 and v2, reference and OHLC: draft, preview, simulation, observation and
 * every refused real-money entry). Synthetic users and fixtures only.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'history20-futures-fixture-secret';
process.env.API_KEY_ENCRYPTION_SECRET = process.env.API_KEY_ENCRYPTION_SECRET || '0'.repeat(64);

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import {
  buildHistoricalGrowthProgram, historicalGrowthMaxPrice, historicalGrowthObservation, type HistoricalGrowthProgram, type HistoricalGrowthSourceRow,
} from '../../../shared/listingHistoricalGrowth';
import { defaultScenarioControls } from '../../../shared/listingScenarioControls';
import { checkPublishable, listingSimulationConfig, parseListingConfig, type ListingConfig } from '../listingConfig';
import { listingScenarioPreview } from '../listingPreview';
import { setManagedListingAssets } from '../managedSnapshot';
import { allocateListingOwner } from '../ownerAllocation';
import { HISTORICAL_DEMO_MESSAGE } from '../simulationContour';
import { TEST_ASSET_NOT_TRADABLE_MESSAGE } from '../../testMarkets/testAssetConfig';
import { controlledScenarioHour } from '../../testMarkets/simulationScenarioControls';
import { TestMarketSimulation } from '../../testMarkets/testMarketSimulation';
import { OrderService } from '../../OrderService';
import { DemoTradingService } from '../../DemoTradingService';
import { WalletPortfolioService } from '../../WalletPortfolioService';
import { MatchingEngine } from '../../../matching-engine/MatchingEngine';
import { collateralMarket } from '../../../private-trading/native/service';
import { futuresRouter } from '../../../api/routes/futures';

const url = process.env.VOLTEX_LISTING_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_listing_test') throw new Error('History20 Futures tests require the disposable loopback voltex_listing_test database');
}
const pg = url ? describe : describe.skip;

const DAY = 86_400_000, HOUR = 3_600_000;
const LISTING_AT = '2026-11-02T00:00:00.000Z';
function walk(days: number, ohlc: boolean): HistoricalGrowthSourceRow[] {
  let x = 5, price = 100;
  const random = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: days }, (_, d) => {
    const date = new Date(Date.UTC(2020, 0, 1) + d * DAY).toISOString().slice(0, 10);
    const open = d ? price * (1 + (random() - .5) * .004) : 100, close = open * Math.exp(Math.log(80) / days + (random() - .5) * .1);
    price = close;
    return ohlc ? { date, open, high: Math.max(open, close) * 1.02, low: Math.min(open, close) * .98, close } : { date, close };
  });
}
const SOURCES = {
  reference: { provider: 'Coin Metrics', asset: 'BTC', quote: 'USD', metric: 'PriceUSD', dataKind: 'daily_reference', timeframe: '1d', sliceSha256: 'a'.repeat(64), license: 'CC-BY-NC-4.0' },
  ohlc: { provider: 'Binance Vision', asset: 'SOL', quote: 'USDT', metric: 'spot daily OHLCV', dataKind: 'exchange_ohlcv', timeframe: '1d', sliceSha256: 'b'.repeat(64), license: 'CC-BY-NC-SA-4.0 plus Binance Vision Dataset Terms' },
} as const;

pg('History20 growth windows leave the Futures account exactly as it was', () => {
  let db: PrismaClient, user: string, admin: string, symbol: string;
  let openPosition: string, closedPosition: string, liquidatedPosition: string;
  const fundingRecords: string[] = [];
  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  afterAll(async () => { setManagedListingAssets([]); await db.$disconnect(); });
  afterEach(() => { jest.restoreAllMocks(); setManagedListingAssets([]); });

  beforeEach(async () => {
    user = randomUUID(); admin = randomUUID();
    symbol = `G${randomUUID().replace(/[^A-Z]/gi, '').slice(0, 5).toUpperCase()}`;
    await db.user.createMany({ data: [user, admin].map((id, i) => ({ id, email: `${id}@history20-futures.invalid`, referralCode: id, passwordHash: 'fixture', role: i ? 'ADMIN' : 'USER' })) });
    await db.balance.createMany({ data: [{ userId: user, asset: 'USDT', available: '500' }, { userId: admin, asset: 'USDT', available: '1000' }] });
    await db.demoBalance.create({ data: { userId: admin, asset: 'USDT', available: '100' } });
    // A Futures account with history: margin, an open LONG with SL/TP, a closed SHORT, a liquidation, orders and funding.
    await db.futuresBalance.create({ data: { userId: user, asset: 'USDT', available: '1234.5', locked: '100' } });
    openPosition = randomUUID(); closedPosition = randomUUID(); liquidatedPosition = randomUUID();
    await db.futuresPosition.createMany({ data: [
      { id: openPosition, userId: user, symbol: 'BTC/USDT', side: 'LONG', size: '0.01', entryPrice: '60000', leverage: 10, marginType: 'ISOLATED', initialMargin: '60', liquidationPrice: '54300', openedAt: new Date('2026-10-10T10:00:00Z') },
      { id: closedPosition, userId: user, symbol: 'ETH/USDT', side: 'SHORT', size: '0.5', entryPrice: '3000', leverage: 5, marginType: 'CROSS', initialMargin: '300', liquidationPrice: '3550',
        status: 'CLOSED', realizedPnl: '42.125', openedAt: new Date('2026-10-01T09:00:00Z'), closedAt: new Date('2026-10-03T09:00:00Z') },
      { id: liquidatedPosition, userId: user, symbol: 'SOL/USDT', side: 'LONG', size: '2', entryPrice: '150', leverage: 20, marginType: 'ISOLATED', initialMargin: '15', liquidationPrice: '143',
        status: 'LIQUIDATED', realizedPnl: '-15', openedAt: new Date('2026-10-04T09:00:00Z'), closedAt: new Date('2026-10-04T12:00:00Z') },
    ] });
    await db.futuresPositionProtection.createMany({ data: [
      { positionId: openPosition, userId: user, symbol: 'BTC/USDT', kind: 'STOP_LOSS', triggerPrice: '57000' },
      { positionId: openPosition, userId: user, symbol: 'BTC/USDT', kind: 'TAKE_PROFIT', triggerPrice: '66000' },
    ] });
    await db.futuresOrder.createMany({ data: [
      { userId: user, symbol: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: '58000', originalQuantity: '0.01', remainingQuantity: '0.01', status: 'OPEN', leverage: 10, marginType: 'ISOLATED' },
      { userId: user, symbol: 'ETH/USDT', side: 'SELL', type: 'MARKET', originalQuantity: '0.5', remainingQuantity: '0', status: 'FILLED', leverage: 5, marginType: 'CROSS' },
      { userId: user, symbol: 'ETH/USDT', side: 'BUY', type: 'MARKET', originalQuantity: '0.5', remainingQuantity: '0', status: 'FILLED', reduceOnly: true, leverage: 5, marginType: 'CROSS' },
    ] });
    // The native Futures TEST account: opaque engine state with a historical deal (a fixture, not engine-valid).
    const deal = { symbol: 'BTCUSDT', side: 'LONG', executionMode: 'HISTORICAL_DEMO', entryTimestamp: Date.parse('2026-09-01T00:00:00Z'), entryPrice: '57123.4', quantity: '0.02', realizedPnl: '12.5' };
    await db.nativeDemoAccount.create({ data: { userId: user, revision: 2, payload: { fixture: true, balances: { USDT: '10000' }, history: [deal] } } });
    await db.nativeDemoRevision.createMany({ data: [1, 2].map(revision => ({ userId: user, revision, requestKey: `h20f-${revision}`, requestHash: String(revision).repeat(64).slice(0, 64), payload: { fixture: true, revision, deal } })) });
    await db.nativeDemoLiveProjection.create({ data: { userId: user, revision: 2, payload: { fixture: true, positions: [deal] }, digest: 'f'.repeat(64) } });
    const record = randomUUID(); fundingRecords.push(record);
    await db.fundingRateRecord.create({ data: { id: record, symbol: 'BTC/USDT', rate: '0.0001', markPrice: '60100', indexPrice: '60095', appliedAt: new Date('2026-10-11T08:00:00Z') } });
    await db.fundingPayment.createMany({ data: [
      { positionId: openPosition, userId: user, symbol: 'BTC/USDT', amount: '-0.0601', rate: '0.0001', createdAt: new Date('2026-10-11T08:00:00Z') },
      { positionId: closedPosition, userId: user, symbol: 'ETH/USDT', amount: '0.15', rate: '0.0001', createdAt: new Date('2026-10-02T08:00:00Z') },
    ] });
  });

  /** Every Futures row of these users, the seeded funding records, and the Spot / demo rows beside them. */
  async function futuresLedger() {
    const ids = [user, admin], mine = { where: { userId: { in: ids } }, orderBy: { id: 'asc' as const } };
    return JSON.stringify(await Promise.all([
      db.futuresBalance.findMany(mine), db.futuresOrder.findMany(mine), db.futuresPosition.findMany(mine),
      db.futuresPositionProtection.findMany(mine), db.fundingPayment.findMany(mine),
      db.fundingRateRecord.findMany({ where: { id: { in: fundingRecords } }, orderBy: { id: 'asc' } }),
      db.nativeDemoAccount.findMany({ where: { userId: { in: ids } }, orderBy: { userId: 'asc' } }),
      db.nativeDemoRevision.findMany({ where: { userId: { in: ids } }, orderBy: [{ userId: 'asc' }, { revision: 'asc' }] }),
      db.nativeDemoLiveProjection.findMany({ where: { userId: { in: ids } }, orderBy: { userId: 'asc' } }),
      db.balance.findMany(mine), db.order.findMany(mine), db.demoBalance.findMany(mine),
      db.balance.count({ where: { asset: symbol } }), db.futuresPosition.count({ where: { symbol: { startsWith: symbol } } }),
    ]));
  }
  /** What the account's own Futures screens serve (real router; only the session lookup is a fixture). */
  async function futuresViews() {
    const sessions = { findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, userId: where.id.replace('h20f:', ''), revokedAt: null, lastSeenAt: new Date() }) };
    const prisma = new Proxy(db, { get: (target, key) => {
      if (key === 'session') return sessions;
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const none = {} as never;
    const app = express().use(express.json()).use('/api/v1', futuresRouter(prisma, new MatchingEngine(), none, none, none, none));
    const auth = `Bearer ${jwt.sign({ sub: user, sid: `h20f:${user}` }, process.env.JWT_SECRET!)}`;
    const views: unknown[] = [];
    for (const path of ['/api/v1/futures/balances', '/api/v1/futures/orders/me', '/api/v1/futures/positions/history']) {
      const res = await request(app).get(path).set('Authorization', auth);
      expect(res.status).toBe(200);
      views.push(res.body);
    }
    return views;
  }
  const windowConfig = (growth: HistoricalGrowthProgram): ListingConfig => parseListingConfig({
    schemaVersion: 1, symbol, name: 'History20 Futures check', logo: null, initialPrice: '2', listingAt: LISTING_AT, displayTimeZone: 'UTC',
    ownerAllocation: '0', seedMode: 'manual', seed: 'h20-futures-synthetic', tradable: false,
    simulationProgram: { ...defaultScenarioControls('2', 'CALM'), stages: [], first24hGainPercent: '0', afterGrowth: 'range', growth: 'historical-window',
      historicalGrowth: growth, maxPrice: historicalGrowthMaxPrice('2', growth.targetPeakGrowthPercent) },
  });

  test('every History20 path runs (v1 and v2, reference and OHLC) and the Futures account is byte-for-byte unchanged', async () => {
    const [beforeLedger, beforeViews] = [await futuresLedger(), await futuresViews()];
    expect((beforeViews[2] as unknown[]).length).toBe(2); // closed + liquidated history is really served

    for (const kind of ['reference', 'ohlc'] as const) for (const intrabarVersion of [1, 2] as const) {
      const growth = buildHistoricalGrowthProgram({ scenarioId: kind === 'ohlc' ? 'VHX-03-SOL' : 'VHX-01-BTC', source: SOURCES[kind],
        targetPeakGrowthPercent: kind === 'ohlc' ? '9348' : '11872.45', rows: walk(kind === 'ohlc' ? 40 : 41, kind === 'ohlc'), intrabarVersion });
      const config = windowConfig(growth), asset = listingSimulationConfig(config), start = Date.parse(LISTING_AT);
      // Draft gate, previews, the simulation and a bot observation: pure computation.
      expect(() => checkPublishable(config, null, start - 30 * DAY)).toThrow();
      expect(listingScenarioPreview(config, '5m', 'first24h').candles.length).toBeGreaterThan(0);
      expect(listingScenarioPreview(config, '4h', 'window', { fromDay: 10 }).candles.length).toBeGreaterThan(0);
      const scheduled = asset.scheduledScenario as Parameters<typeof controlledScenarioHour>[0];
      for (let hour = 0; hour < 48; hour++) controlledScenarioHour(scheduled, config.seed, hour);
      new TestMarketSimulation(asset).candles5m(start + 3 * DAY, start);
      historicalGrowthObservation(growth, '2', config.seed, start, start + 5 * DAY + 7 * HOUR);

      // As if the catalogue ever carried it: every real-money entry refuses, Futures collateral included.
      setManagedListingAssets([asset]);
      jest.spyOn(Date, 'now').mockReturnValue(start + 2 * DAY);
      const pair = `${symbol}/USDT`, one = new BigNumber(1);
      const orders = new OrderService(db, new MatchingEngine(), { getTicker: jest.fn(async () => ({ lastPrice: '1' })) });
      await expect(orders.placeOrder({ userId: user, pair, side: 'BUY', type: 'LIMIT', price: new BigNumber(5), quantity: one })).rejects.toThrow(HISTORICAL_DEMO_MESSAGE);
      await expect(orders.placeOrder({ userId: admin, pair, side: 'SELL', type: 'MARKET', quantity: one })).rejects.toThrow(HISTORICAL_DEMO_MESSAGE);
      await expect(orders.placeOcoOrder({ userId: user, pair, side: 'SELL', quantity: one, takeProfitPrice: new BigNumber(9), stopTriggerPrice: new BigNumber(3), stopLimitPrice: new BigNumber('2.9') })).rejects.toThrow(HISTORICAL_DEMO_MESSAGE);
      await expect(new DemoTradingService(db, new MatchingEngine()).placeOrder({ userId: admin, pair, side: 'BUY', type: 'LIMIT', price: new BigNumber(5), quantity: one })).rejects.toThrow(TEST_ASSET_NOT_TRADABLE_MESSAGE);
      await expect(allocateListingOwner(db, { id: 'h20f-1', version: 1, publishedAt: LISTING_AT, config: { ...config, ownerAllocation: '1000' } }, admin)).rejects.toThrow();
      expect(collateralMarket(symbol)).toBeNull();
      const wallet = new WalletPortfolioService(db, { getTickers: jest.fn(async () => [{ pair: 'BTC/USDT', lastPrice: '60000' }]) } as never, { isConfigured: () => false } as never);
      expect((await wallet.pricesFor([symbol])).get(symbol)).toBeNull();
      jest.restoreAllMocks(); setManagedListingAssets([]);
    }

    expect(await futuresLedger()).toBe(beforeLedger);
    expect(await futuresViews()).toEqual(beforeViews);
  });
});
