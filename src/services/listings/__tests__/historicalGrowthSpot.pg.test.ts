/**
 * A History20 growth window as the price path of an ordinary managed Spot
 * scenario listing, on the EXISTING Spot mechanism and a real (disposable,
 * loopback) PostgreSQL: the Spot price source, the public listing chart and
 * the Admin preview are one model; admission, owner allocation, wallet
 * valuation and conditional triggers follow the rules every scenario listing
 * already has. Publication itself stays refused (HISTORICAL_RIGHTS_UNVERIFIED),
 * so this is the state after a licence-approved publish, set up in Render's
 * registry by the test. Synthetic window, users and fixtures only.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'history20-spot-fixture-secret';
process.env.API_KEY_ENCRYPTION_SECRET = process.env.API_KEY_ENCRYPTION_SECRET || '0'.repeat(64);

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { buildHistoricalGrowthProgram, historicalGrowthMaxPrice, type HistoricalGrowthSourceRow } from '../../../shared/listingHistoricalGrowth';
import { defaultScenarioControls } from '../../../shared/listingScenarioControls';
import { checkPublishable, listingSimulationConfig, parseListingConfig, type ListingConfig } from '../listingConfig';
import { listingScenarioPreview } from '../listingPreview';
import { setManagedListingAssets } from '../managedSnapshot';
import { allocateListingOwner } from '../ownerAllocation';
import { spotPriceSource } from '../../testMarkets/nrxSpot';
import { TestMarketSimulation } from '../../testMarkets/testMarketSimulation';
import { testMarketCandles } from '../../testMarkets/testMarketService';
import { OrderService } from '../../OrderService';
import { PriceWatcherService } from '../../PriceWatcherService';
import { WalletPortfolioService } from '../../WalletPortfolioService';
import { MatchingEngine } from '../../../matching-engine/MatchingEngine';

const url = process.env.VOLTEX_LISTING_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_listing_test') throw new Error('History20 Spot tests require the disposable loopback voltex_listing_test database');
}
const pg = url ? describe : describe.skip;

const DAY = 86_400_000, HOUR = 3_600_000, MINUTE = 60_000;
const LISTING_AT = '2026-11-02T00:00:00.000Z', START = Date.parse(LISTING_AT);
function walk(days: number): HistoricalGrowthSourceRow[] {
  let x = 9, price = 100;
  const random = () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
  return Array.from({ length: days }, (_, d) => {
    const date = new Date(Date.UTC(2020, 0, 1) + d * DAY).toISOString().slice(0, 10);
    const open = d ? price * (1 + (random() - .5) * .004) : 100, close = open * Math.exp(Math.log(80) / days + (random() - .5) * .1);
    price = close;
    return { date, open, high: Math.max(open, close) * 1.02, low: Math.min(open, close) * .98, close };
  });
}
const growth = buildHistoricalGrowthProgram({ scenarioId: 'VHX-03-SOL', targetPeakGrowthPercent: '9348', rows: walk(40),
  source: { provider: 'Binance Vision', asset: 'SOL', quote: 'USDT', metric: 'spot daily OHLCV', dataKind: 'exchange_ohlcv', timeframe: '1d', sliceSha256: 'b'.repeat(64), license: 'CC-BY-NC-SA-4.0 plus Binance Vision Dataset Terms' } });

pg('History20 window on the existing Spot scenario-listing mechanism (disposable PostgreSQL)', () => {
  let db: PrismaClient, admin: string, user: string, symbol: string, pair: string;
  const config = (): ListingConfig => parseListingConfig({
    schemaVersion: 1, symbol, name: 'History20 Spot check', logo: null, initialPrice: '2', listingAt: LISTING_AT, displayTimeZone: 'UTC',
    ownerAllocation: '1000', seedMode: 'manual', seed: 'h20-spot-synthetic', tradable: false,
    simulationProgram: { ...defaultScenarioControls('2', 'CALM'), stages: [], first24hGainPercent: '0', afterGrowth: 'range', growth: 'historical-window',
      historicalGrowth: growth, maxPrice: historicalGrowthMaxPrice('2', growth.targetPeakGrowthPercent) },
  });
  const venue = { getTicker: jest.fn(async (_pair: string) => ({ lastPrice: '60000' })) };
  const balance = async (userId: string, asset: string) => {
    const row = await db.balance.findUnique({ where: { userId_asset: { userId, asset } } });
    return row ? [row.available.toString(), row.locked.toString()] : null;
  };

  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  afterAll(async () => { setManagedListingAssets([]); await db.$disconnect(); });
  beforeEach(async () => {
    admin = randomUUID(); user = randomUUID();
    symbol = `H${randomUUID().replace(/[^A-Z]/gi, '').slice(0, 5).toUpperCase()}`;
    pair = `${symbol}/USDT`;
    await db.user.createMany({ data: ([[admin, 'ADMIN'], [user, 'USER']] as const).map(([id, role]) => ({ id, email: `${id}@history20-spot.invalid`, referralCode: id, passwordHash: 'fixture', role })) });
    await db.balance.createMany({ data: [{ userId: admin, asset: 'USDT', available: '500' }, { userId: user, asset: 'USDT', available: '500' }] });
    venue.getTicker.mockClear();
  });
  afterEach(() => { jest.restoreAllMocks(); setManagedListingAssets([]); });

  test('one model everywhere: Spot price source, public listing chart and Admin preview; the venue is never asked', async () => {
    const c = config(), asset = listingSimulationConfig(c), model = new TestMarketSimulation(asset);
    // Production stays closed: the window cannot be published until its rights are cleared.
    expect(() => checkPublishable(c, null, START - 30 * DAY)).toThrow(expect.objectContaining({ code: 'HISTORICAL_RIGHTS_UNVERIFIED' }));
    setManagedListingAssets([asset]);
    for (const at of [START + 5 * MINUTE, START + 2 * DAY + 7 * HOUR + 41_000, START + 9 * DAY]) {
      const ticker = await spotPriceSource(venue, () => at).getTicker(pair);
      expect(ticker).toEqual({ lastPrice: String(model.priceAt(at)) });
      expect(testMarketCandles(asset, '5m', at, 3).at(-1)!.close).toBe(model.priceAt(at));
    }
    // The Admin preview of the first day is the chart the published market serves for it.
    const preview = listingScenarioPreview(c, '1h', 'first24h').candles;
    const served = testMarketCandles(asset, '1h', START + DAY, 25);
    expect(preview.map(p => [p.time, p.open, p.close])).toEqual(served.map(s => [s.time, s.open, s.close]));
    expect(venue.getTicker).not.toHaveBeenCalled();
  });

  test('admission, owner allocation and wallet value follow the existing scenario-listing rules; nothing else is written', async () => {
    const c = config(), asset = listingSimulationConfig(c), at = START + 2 * DAY;
    setManagedListingAssets([asset]);
    jest.spyOn(Date, 'now').mockReturnValue(at);
    const orders = new OrderService(db, new MatchingEngine(), venue), one = new BigNumber(1);
    // A scenario listing is never tradable (DEMO_ONLY): the existing refusal, for the user and the owner alike.
    const closed = 'History20 Spot check is not available for trading.';
    await expect(orders.placeOrder({ userId: user, pair, side: 'BUY', type: 'LIMIT', price: new BigNumber(3), quantity: one })).rejects.toThrow(closed);
    await expect(orders.placeOrder({ userId: admin, pair, side: 'SELL', type: 'MARKET', quantity: one })).rejects.toThrow(closed);
    await expect(orders.placeOcoOrder({ userId: user, pair, side: 'SELL', quantity: one, takeProfitPrice: new BigNumber(9), stopTriggerPrice: new BigNumber(1), stopLimitPrice: new BigNumber('0.9') })).rejects.toThrow(closed);
    expect(await db.order.count({ where: { userId: { in: [admin, user] } } })).toBe(0);

    // The listing's own owner allocation, credited once to the verified ADMIN, no USDT moved.
    const published = { id: `h20-spot-${symbol.toLowerCase()}`, version: 1, publishedAt: LISTING_AT, config: c };
    await expect(allocateListingOwner(db, published, admin)).resolves.toMatchObject({ applied: true, asset: symbol, quantity: '1000' });
    await expect(allocateListingOwner(db, published, admin)).resolves.toMatchObject({ applied: false, quantity: '1000' });
    await expect(allocateListingOwner(db, published, user)).rejects.toThrow();
    expect(await balance(admin, symbol)).toEqual(['1000', '0']);
    expect(await balance(admin, 'USDT')).toEqual(['500', '0']);
    expect(await balance(user, symbol)).toBeNull();
    expect(await db.demoBalance.count({ where: { userId: { in: [admin, user] } } })).toBe(0);
    expect(await db.futuresBalance.count({ where: { userId: { in: [admin, user] } } })).toBe(0);

    // The wallet values the holding at the model price, as it does any managed listing.
    const wallet = new WalletPortfolioService(db, { getTickers: jest.fn(async () => [{ pair: 'BTC/USDT', lastPrice: '60000' }]) } as never, { isConfigured: () => false } as never);
    expect((await wallet.pricesFor([symbol])).get(symbol)).toBe(new TestMarketSimulation(asset).priceAt(at));
  });

  test('model triggers are not suppressed: a resting take-profit fires when the model price reaches it', async () => {
    const c = config(), asset = listingSimulationConfig(c), model = new TestMarketSimulation(asset);
    setManagedListingAssets([asset]);
    const placedAt = START + 2 * DAY, price = new BigNumber(model.priceAt(placedAt)!), trigger = price.times(1.003).decimalPlaces(8);
    let firesAt = placedAt;
    while (new BigNumber(model.priceAt(firesAt)!).lt(trigger)) { firesAt += 10_000; if (firesAt > placedAt + 3 * DAY) throw new Error('fixture: no crossing'); }
    await allocateListingOwner(db, { id: `h20-spot-${symbol.toLowerCase()}`, version: 1, publishedAt: LISTING_AT, config: c }, admin);
    // FIXTURE: a take-profit that already rests on the book (a scenario listing admits no new ones),
    // with its base asset locked the way OrderService locks it.
    const order = randomUUID();
    await db.$transaction([
      db.order.create({ data: { id: order, userId: admin, pair, side: 'SELL', type: 'TAKE_PROFIT_LIMIT', price: trigger.toFixed(), triggerPrice: trigger.toFixed(),
        lockedAmount: '1', lockedAsset: symbol, originalQuantity: '1', remainingQuantity: '1', status: 'PENDING_TRIGGER' } }),
      db.balance.update({ where: { userId_asset: { userId: admin, asset: symbol } }, data: { available: '999', locked: '1' } }),
    ]);
    const watcher = new PriceWatcherService(db, new OrderService(db, new MatchingEngine(), venue), venue);
    jest.spyOn(Date, 'now').mockReturnValue(firesAt - 10_000);
    await watcher.checkAndTrigger();
    expect((await db.order.findUnique({ where: { id: order } }))!.status).toBe('PENDING_TRIGGER');
    (Date.now as jest.Mock).mockReturnValue(firesAt + 1_000);
    await watcher.checkAndTrigger();
    const fired = (await db.order.findUnique({ where: { id: order } }))!;
    expect([fired.status, fired.type]).toEqual(['OPEN', 'LIMIT']);
    // It rests at its own limit; nobody's money moved and the base stays reserved for it.
    expect(await balance(admin, symbol)).toEqual(['999', '1']);
    expect(await db.trade.count({ where: { pair } })).toBe(0);
    expect(venue.getTicker.mock.calls.some(([asked]) => asked === pair)).toBe(false);
  });
});
