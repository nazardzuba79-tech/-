/**
 * The owner/test-account Spot simulation sale (SELL + MARKET) of a published
 * managed listing, against a real (disposable, loopback) PostgreSQL: it is
 * priced by the same server model the pair's Spot ticker, chart and
 * conditional triggers use, never by the venue. Everything else is the
 * existing path, unchanged: the listing gates, the server-side account check,
 * the atomic debit/credit and the explicit synthetic counterparty (no book
 * liquidity). NRX and ordinary pairs keep their price sources.
 *
 * Synthetic users, listings and fixtures only; no venue or broker order.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'managed-sale-fixture-secret';
process.env.API_KEY_ENCRYPTION_SECRET = process.env.API_KEY_ENCRYPTION_SECRET || '0'.repeat(64);

import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { defaultScenarioControls } from '../../../shared/listingScenarioControls';
import { listingSimulationConfig, parseListingConfig, type ListingConfig, type PublishedListing } from '../listingConfig';
import { managedListingAssets, setManagedListingAssets } from '../managedSnapshot';
import { ManagedListingRegistry, REFRESH_MS } from '../registry';
import type { ListingStore } from '../store';
import { allocateListingOwner } from '../ownerAllocation';
import { NEURIX } from '../../testMarkets/neurix';
import { spotPriceSource } from '../../testMarkets/nrxSpot';
import { simulationFor } from '../../testMarkets/testMarketSimulation';
import { testMarketCandles } from '../../testMarkets/testMarketService';
import { OrderService } from '../../OrderService';
import { MatchingEngine } from '../../../matching-engine/MatchingEngine';

const url = process.env.VOLTEX_LISTING_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_listing_test') throw new Error('Managed listing sale tests require the disposable loopback voltex_listing_test database');
}
const pg = url ? describe : describe.skip;

const HOUR = 3_600_000;
const LISTING_AT = Date.parse('2026-10-01T12:00:00.000Z');
const AT = LISTING_AT + 2 * HOUR + 17_000;
const dec = (v: { toString(): string }) => new BigNumber(v.toString());

pg('managed listing simulation sale on the model price (disposable PostgreSQL)', () => {
  let db: PrismaClient, engine: MatchingEngine, service: OrderService;
  let admin: string, tester: string, plain: string, symbol: string, pair: string;
  // A venue that would price anything: a modeled pair must never be asked.
  const anything = async (asked: string) => ({ lastPrice: asked === 'ETH/USDT' ? '2500' : '60000' }) as { lastPrice: string } | null;
  const venue = { getTicker: jest.fn(anything) };
  const config = (over: Record<string, unknown> = {}): ListingConfig => parseListingConfig({
    schemaVersion: 1, symbol, name: 'Managed sale QA', logo: null, initialPrice: '0.25', listingAt: new Date(LISTING_AT).toISOString(),
    displayTimeZone: 'UTC', ownerAllocation: '1000', seedMode: 'manual', seed: 'managed-sale-20261019-synthetic', tradable: true, ...over,
  });
  const published = (c: ListingConfig): PublishedListing => ({ id: `managed-sale-${symbol.toLowerCase()}`, version: 1, publishedAt: new Date(LISTING_AT).toISOString(), config: c });
  const balance = async (userId: string, asset: string) => {
    const row = await db.balance.findUnique({ where: { userId_asset: { userId, asset } } });
    return row ? [row.available.toString(), row.locked.toString()] : null;
  };
  const writes = async (userId: string) => [
    await db.order.count({ where: { userId } }),
    await db.trade.count({ where: { takerUserId: userId } }),
    await db.auditLog.count({ where: { userId, action: { in: ['TEAM_SPOT_SIMULATION_SOLD', 'NRX_SIMULATION_SOLD'] } } }),
  ];
  const sell = (userId: string, quantity: BigNumber.Value, onPair = pair) => service.placeOrder({ userId, pair: onPair, side: 'SELL', type: 'MARKET', quantity: new BigNumber(quantity) });
  const askedFor = (asked: string) => venue.getTicker.mock.calls.some(([p]) => p === asked);
  let savedTesters: string | undefined;

  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  afterAll(async () => { setManagedListingAssets([]); await db.$disconnect(); });
  beforeEach(async () => {
    admin = randomUUID(); tester = randomUUID(); plain = randomUUID();
    symbol = `S${randomUUID().replace(/[^A-Z]/gi, '').slice(0, 5).toUpperCase()}`;
    pair = `${symbol}/USDT`;
    savedTesters = process.env.PRIVATE_TRADING_TEST_USER_IDS;
    process.env.PRIVATE_TRADING_TEST_USER_IDS = tester;
    await db.user.createMany({ data: ([[admin, 'ADMIN'], [tester, 'USER'], [plain, 'USER']] as const).map(([id, role]) => ({ id, email: `${id}@managed-sale.invalid`, referralCode: id, passwordHash: 'fixture', role })) });
    await db.balance.createMany({ data: [admin, tester, plain].map(userId => ({ userId, asset: 'USDT', available: '500' })) });
    engine = new MatchingEngine();
    service = new OrderService(db, engine, venue);
    venue.getTicker.mockReset().mockImplementation(anything);
    jest.spyOn(Date, 'now').mockReturnValue(AT);
    setManagedListingAssets([listingSimulationConfig(config())]);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    setManagedListingAssets([]);
    if (savedTesters === undefined) delete process.env.PRIVATE_TRADING_TEST_USER_IDS;
    else process.env.PRIVATE_TRADING_TEST_USER_IDS = savedTesters;
  });

  test('the owner and an allowlisted tester sell at the model price the ticker, triggers and chart serve; the venue is never asked; no book liquidity', async () => {
    const asset = listingSimulationConfig(config()), model = simulationFor(asset);
    await expect(allocateListingOwner(db, published(config()), admin)).resolves.toMatchObject({ applied: true, quantity: '1000' });
    await db.balance.create({ data: { userId: tester, asset: symbol, available: '50' } });

    const price = new BigNumber(model.priceAt(AT)!);
    const sold = await sell(admin, 10);
    expect([sold.order.status, sold.trades.length]).toEqual(['FILLED', 1]);
    expect(sold.trades[0]).toMatchObject({ pair, takerUserId: admin, makerUserId: `simulation:${symbol}`, side: 'SELL' });
    expect(dec(sold.trades[0].price).eq(price)).toBe(true);
    // One model everywhere: the Spot ticker/trigger source and the public chart at the same instant.
    expect((await spotPriceSource(venue, () => AT).getTicker(pair))!.lastPrice).toBe(price.toString());
    expect(testMarketCandles(asset, '5m', AT, 3).at(-1)!.close).toBe(price.toNumber());
    // Exact atomic debit and credit; nothing locked.
    expect(await balance(admin, symbol)).toEqual(['990', '0']);
    expect(dec((await balance(admin, 'USDT'))![0]).eq(price.times(10).plus(500))).toBe(true);
    const audit = await db.auditLog.findFirstOrThrow({ where: { userId: admin, action: 'TEAM_SPOT_SIMULATION_SOLD' } });
    expect(audit.metadata).toMatchObject({ pair, price: price.toFixed(), quantity: '10', counterparty: `simulation:${symbol}` });

    const later = AT + 41 * 60_000;
    (Date.now as jest.Mock).mockReturnValue(later);
    const testerPrice = new BigNumber(model.priceAt(later)!);
    const testerSold = await sell(tester, '2.5');
    expect(dec(testerSold.trades[0].price).eq(testerPrice)).toBe(true);
    expect(await balance(tester, symbol)).toEqual(['47.5', '0']);
    expect(dec((await balance(tester, 'USDT'))![0]).eq(testerPrice.times('2.5').plus(500))).toBe(true);

    expect(askedFor(pair)).toBe(false);
    // The synthetic counterparty is explicit; nothing rests on or comes from the book.
    expect(engine.getBook(pair).bestBid()).toBeUndefined();
    expect(engine.getBook(pair).bestAsk()).toBeUndefined();
    expect(await db.trade.count({ where: { pair, makerUserId: { not: `simulation:${symbol}` } } })).toBe(0);
    expect(await db.futuresBalance.count({ where: { userId: { in: [admin, tester] } } })).toBe(0);
    expect(await db.demoBalance.count({ where: { userId: { in: [admin, tester] } } })).toBe(0);
  });

  test('refused before any write: before the listing time, a non-tradable listing, a scenario listing, more than the available balance', async () => {
    await allocateListingOwner(db, published(config()), admin);
    const unchanged = async () => {
      expect(await balance(admin, symbol)).toEqual(['1000', '0']);
      expect(await balance(admin, 'USDT')).toEqual(['500', '0']);
      expect(await writes(admin)).toEqual([0, 0, 0]);
    };

    (Date.now as jest.Mock).mockReturnValue(LISTING_AT - 60_000);
    await expect(sell(admin, 1)).rejects.toThrow('Trading has not started yet');
    await unchanged();
    (Date.now as jest.Mock).mockReturnValue(AT);

    setManagedListingAssets([listingSimulationConfig(config({ tradable: false }))]);
    await expect(sell(admin, 1)).rejects.toThrow('Managed sale QA is not available for trading.');
    await unchanged();

    // A bounded scenario (the kind a History20 window is) is never tradable (DEMO_ONLY).
    setManagedListingAssets([listingSimulationConfig(config({ tradable: false, simulationProgram: defaultScenarioControls('0.25', 'CALM') }))]);
    await expect(sell(admin, 1)).rejects.toThrow('Managed sale QA is not available for trading.');
    await unchanged();

    setManagedListingAssets([listingSimulationConfig(config())]);
    await expect(sell(admin, 1001)).rejects.toThrow();
    await unchanged();
    expect(askedFor(pair)).toBe(false);
  });

  test('accounts outside the simulation policy get no synthetic fill: an ordinary user and a blocked admin keep the normal book path', async () => {
    await db.balance.createMany({ data: [{ userId: plain, asset: symbol, available: '5' }] });
    await db.user.update({ where: { id: admin }, data: { blockedAt: new Date(AT - HOUR) } });
    await db.balance.create({ data: { userId: admin, asset: symbol, available: '5' } });
    for (const userId of [plain, admin]) {
      const result = await sell(userId, 1);
      expect([result.order.status, result.trades.length]).toEqual(['CANCELLED', 0]);
      expect(await balance(userId, symbol)).toEqual(['5', '0']);
      expect(await balance(userId, 'USDT')).toEqual(['500', '0']);
    }
    expect(await db.trade.count({ where: { pair, makerUserId: `simulation:${symbol}` } })).toBe(0);
    expect(askedFor(pair)).toBe(false);
  });

  test('a stale snapshot (failed refresh) keeps the last good listing: the sale keeps the price the chart and triggers serve', async () => {
    setManagedListingAssets([]);
    let clock = AT, failing = false;
    const store = { published: jest.fn(async () => {
      if (failing) throw new Error('store unreachable');
      return { revision: 'r1', listings: [published(config())] };
    }) } as unknown as ListingStore;
    const registry = new ManagedListingRegistry(store, () => clock);
    await registry.ensureFresh();
    expect(managedListingAssets().map(a => a.symbol)).toEqual([symbol]);
    failing = true; clock += REFRESH_MS + 1;
    await registry.ensureFresh();
    expect((store.published as jest.Mock).mock.calls).toHaveLength(2);
    expect(managedListingAssets().map(a => a.symbol)).toEqual([symbol]);

    await db.balance.create({ data: { userId: admin, asset: symbol, available: '3' } });
    const price = new BigNumber(simulationFor(managedListingAssets()[0]).priceAt(AT)!);
    const sold = await sell(admin, 1);
    expect(dec(sold.trades[0].price).eq(price)).toBe(true);
    expect((await spotPriceSource(venue, () => AT).getTicker(pair))!.lastPrice).toBe(price.toString());
    expect(askedFor(pair)).toBe(false);
  });

  test('a pair the server does not know and the venue cannot price is refused before any write', async () => {
    setManagedListingAssets([]);
    venue.getTicker.mockImplementation(async (asked: string) => (asked === pair ? null : { lastPrice: '60000' }));
    await db.balance.create({ data: { userId: admin, asset: symbol, available: '3' } });
    await expect(sell(admin, 1)).rejects.toThrow('Simulation price is temporarily unavailable');
    expect(await balance(admin, symbol)).toEqual(['3', '0']);
    expect(await balance(admin, 'USDT')).toEqual(['500', '0']);
    expect(await writes(admin)).toEqual([0, 0, 0]);
  });

  test('an ordinary pair keeps the venue price and NRX its canonical model price', async () => {
    await db.balance.createMany({ data: [{ userId: admin, asset: 'ETH', available: '2' }, { userId: admin, asset: 'NRX', available: '4' }] });
    const eth = await sell(admin, '1.25', 'ETH/USDT');
    expect(dec(eth.trades[0].price).eq(2500)).toBe(true);
    expect(askedFor('ETH/USDT')).toBe(true);

    const nrxAt = NEURIX.listingAt + 60_000;
    (Date.now as jest.Mock).mockReturnValue(nrxAt);
    const nrxPrice = new BigNumber(simulationFor(NEURIX).priceAt(nrxAt)!);
    const nrx = await sell(admin, 1, NEURIX.pair);
    expect(nrx.trades[0]).toMatchObject({ makerUserId: 'simulation:NRX' });
    expect(dec(nrx.trades[0].price).eq(nrxPrice)).toBe(true);
    expect(askedFor(NEURIX.pair)).toBe(false);
    expect(await db.auditLog.count({ where: { userId: admin, action: 'NRX_SIMULATION_SOLD' } })).toBe(1);
    expect(dec((await balance(admin, 'USDT'))![0]).eq(nrxPrice.plus(3125).plus(500))).toBe(true);
  });
});
