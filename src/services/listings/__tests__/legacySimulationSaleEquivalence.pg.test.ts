/**
 * Legacy simulation sales, before and after #551 (CTO review on PR #551,
 * 2026-10-19): the owner's MARKET SELL on AITH (valid lease, approved owner
 * access), on an older published tradable managed listing, and on NRX.
 *
 * The same file runs unchanged against `main` and against this branch. Each
 * scenario records a normalised outcome (refusal text, rows written, balances,
 * fill price); with LEGACY_SALE_SNAPSHOT_OUT set the outcomes are written as
 * JSON so the two runs can be diffed. The assertions here hold on both.
 *
 * The venue is realistic: it prices only real venue pairs (BTC, ETH), never a
 * managed listing — except in the explicit "venue collision" scenario, where
 * the venue later lists a pair with the same name as a managed listing.
 *
 * Synthetic users, listings and balances on a disposable loopback database.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'legacy-sale-fixture-secret';
process.env.API_KEY_ENCRYPTION_SECRET = process.env.API_KEY_ENCRYPTION_SECRET || '0'.repeat(64);

import { writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import BigNumber from 'bignumber.js';
import { listingSimulationConfig, parseListingConfig, type ListingConfig, type PublishedListing } from '../listingConfig';
import { setManagedListingAssets } from '../managedSnapshot';
import { allocateListingOwner } from '../ownerAllocation';
import { NEURIX } from '../../testMarkets/neurix';
import { simulationFor } from '../../testMarkets/testMarketSimulation';
import { OrderService } from '../../OrderService';
import { MatchingEngine } from '../../../matching-engine/MatchingEngine';

const url = process.env.VOLTEX_LISTING_TEST_URL;
if (url) {
  const parsed = new URL(url);
  if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_listing_test') throw new Error('Legacy sale tests require the disposable loopback voltex_listing_test database');
}
const pg = url ? describe : describe.skip;

const HOUR = 3_600_000;
const LISTING_AT = Date.parse('2026-10-01T12:00:00.000Z');
const AT = LISTING_AT + 2 * HOUR + 17_000;

type Outcome = { refused: string | null; status?: string; fills?: number; price?: string | null; writes: number[]; balances: Record<string, string[] | null> };
const outcomes: Record<string, Outcome> = {};

pg('legacy simulation sales: AITH, an older managed listing and NRX (disposable PostgreSQL)', () => {
  let db: PrismaClient, service: OrderService;
  let owner: string, plain: string, symbol: string, pair: string;
  const realVenue = (pairsPriced: Record<string, string>) => ({ getTicker: jest.fn(async (asked: string) => (asked in pairsPriced ? { lastPrice: pairsPriced[asked] } : null)) });
  let venue = realVenue({ 'BTC/USDT': '60000', 'ETH/USDT': '2500' });
  const config = (over: Record<string, unknown> = {}): ListingConfig => parseListingConfig({
    schemaVersion: 1, symbol, name: 'Legacy listing QA', logo: null, initialPrice: '0.25', listingAt: new Date(LISTING_AT).toISOString(),
    displayTimeZone: 'UTC', ownerAllocation: '1000', seedMode: 'manual', seed: 'legacy-sale-20261019-synthetic', tradable: true, ...over,
  });
  const published = (c: ListingConfig): PublishedListing => ({ id: `legacy-sale-${c.symbol.toLowerCase()}`, version: 1, publishedAt: new Date(LISTING_AT).toISOString(), config: c });
  const balance = async (userId: string, asset: string) => {
    const row = await db.balance.findUnique({ where: { userId_asset: { userId, asset } } });
    return row ? [row.available.toString(), row.locked.toString()] : null;
  };
  const writes = async (userId: string) => [
    await db.order.count({ where: { userId } }),
    await db.trade.count({ where: { OR: [{ takerUserId: userId }, { makerUserId: userId }] } }),
    await db.auditLog.count({ where: { userId, action: { in: ['TEAM_SPOT_SIMULATION_SOLD', 'NRX_SIMULATION_SOLD'] } } }),
  ];
  /** Run one order and record its normalised outcome; never throws. */
  const record = async (name: string, userId: string, onPair: string, assets: string[], params: { type?: 'MARKET' | 'LIMIT'; quantity: BigNumber.Value; price?: BigNumber.Value }) => {
    let outcome: Outcome;
    try {
      const result = await service.placeOrder({ userId, pair: onPair, side: 'SELL', type: params.type ?? 'MARKET', quantity: new BigNumber(params.quantity),
        ...(params.price !== undefined ? { price: new BigNumber(params.price) } : {}) });
      outcome = { refused: null, status: result.order.status, fills: result.trades.length, price: result.trades[0] ? new BigNumber(result.trades[0].price).toFixed() : null, writes: [], balances: {} };
    } catch (error) {
      outcome = { refused: error instanceof Error ? error.message : String(error), writes: [], balances: {} };
    }
    outcome.writes = await writes(userId);
    for (const asset of assets) outcome.balances[asset] = await balance(userId, asset);
    outcomes[name] = outcome;
    return outcome;
  };

  let saved: Record<string, string | undefined>;
  beforeAll(() => { db = new PrismaClient({ datasources: { db: { url } } }); });
  afterAll(async () => {
    setManagedListingAssets([]);
    await db.$disconnect();
    if (process.env.LEGACY_SALE_SNAPSHOT_OUT) writeFileSync(process.env.LEGACY_SALE_SNAPSHOT_OUT, `${JSON.stringify(outcomes, null, 2)}\n`);
  });
  beforeEach(async () => {
    owner = randomUUID(); plain = randomUUID();
    symbol = `L${randomUUID().replace(/[^A-Z]/gi, '').slice(0, 5).toUpperCase()}`;
    pair = `${symbol}/USDT`;
    saved = { enabled: process.env.PRIVATE_TRADING_ENABLED, ownerId: process.env.PRIVATE_TRADING_OWNER_ID, testers: process.env.PRIVATE_TRADING_TEST_USER_IDS };
    // Approved owner access: the configured private-trading owner, an ADMIN.
    process.env.PRIVATE_TRADING_ENABLED = 'true';
    process.env.PRIVATE_TRADING_OWNER_ID = owner;
    delete process.env.PRIVATE_TRADING_TEST_USER_IDS;
    await db.user.createMany({ data: ([[owner, 'ADMIN'], [plain, 'USER']] as const).map(([id, role]) => ({ id, email: `${id}@legacy-sale.invalid`, referralCode: id, passwordHash: 'fixture', role })) });
    await db.balance.createMany({ data: [owner, plain].map(userId => ({ userId, asset: 'USDT', available: '500' })) });
    venue = realVenue({ 'BTC/USDT': '60000', 'ETH/USDT': '2500' });
    service = new OrderService(db, new MatchingEngine(), venue);
    jest.spyOn(Date, 'now').mockReturnValue(AT);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    setManagedListingAssets([]);
    for (const [key, env] of [['enabled', 'PRIVATE_TRADING_ENABLED'], ['ownerId', 'PRIVATE_TRADING_OWNER_ID'], ['testers', 'PRIVATE_TRADING_TEST_USER_IDS']] as const) {
      if (saved[key] === undefined) delete process.env[env]; else process.env[env] = saved[key];
    }
  });

  test('AITH under a valid read lease: the owner\'s MARKET and LIMIT sell are refused at the listing gate, before any write', async () => {
    const aith = listingSimulationConfig(parseListingConfig({
      schemaVersion: 1, symbol: 'AITH', name: 'Aitheron AI', logo: null, initialPrice: '2', listingAt: new Date(LISTING_AT).toISOString(),
      displayTimeZone: 'UTC', ownerAllocation: '0', seedMode: 'manual', seed: 'aith-legacy-sale-synthetic', tradable: true,
    }));
    setManagedListingAssets([aith], AT + 60_000);
    await db.balance.create({ data: { userId: owner, asset: 'AITH', available: '100' } });
    for (const [name, params] of [['aith.market', { quantity: 10 }], ['aith.limit', { type: 'LIMIT' as const, quantity: 10, price: 2 }]] as const) {
      const outcome = await record(name, owner, 'AITH/USDT', ['AITH', 'USDT'], params);
      expect(outcome).toMatchObject({ refused: 'Aitheron AI is not available for trading.', writes: [0, 0, 0], balances: { AITH: ['100', '0'], USDT: ['500', '0'] } });
    }
    expect(venue.getTicker).not.toHaveBeenCalled();
  });

  test('an older published tradable managed listing: the owner\'s synthetic sale never executes and writes nothing (main and this branch)', async () => {
    const listing = config();
    setManagedListingAssets([listingSimulationConfig(listing)]);
    await allocateListingOwner(db, published(listing), owner);
    const outcome = await record('managed.ownerMarketSell', owner, pair, [symbol, 'USDT'], { quantity: 10 });
    expect(outcome.refused).not.toBeNull();
    expect(outcome).toMatchObject({ writes: [0, 0, 0], balances: { [symbol]: ['1000', '0'], USDT: ['500', '0'] } });
    outcomes['managed.ownerMarketSell'].balances = { listingAsset: outcome.balances[symbol], USDT: outcome.balances.USDT };
  });

  test('an ordinary user on that listing keeps the normal book path (no synthetic counterparty) on both', async () => {
    setManagedListingAssets([listingSimulationConfig(config())]);
    await db.balance.create({ data: { userId: plain, asset: symbol, available: '5' } });
    const outcome = await record('managed.ordinaryMarketSell', plain, pair, [symbol, 'USDT'], { quantity: 1 });
    expect(outcome).toMatchObject({ refused: null, status: 'CANCELLED', fills: 0, balances: { [symbol]: ['5', '0'], USDT: ['500', '0'] } });
    expect(await db.trade.count({ where: { pair, makerUserId: `simulation:${symbol}` } })).toBe(0);
    outcomes['managed.ordinaryMarketSell'].balances = { listingAsset: outcome.balances[symbol], USDT: outcome.balances.USDT };
  });

  test('venue collision (the venue later lists a pair with the managed ticker): recorded, not asserted — the two versions differ here', async () => {
    const listing = config();
    setManagedListingAssets([listingSimulationConfig(listing)]);
    await allocateListingOwner(db, published(listing), owner);
    venue = realVenue({ 'BTC/USDT': '60000', [pair]: '0.5' });
    service = new OrderService(db, new MatchingEngine(), venue);
    const outcome = await record('managed.venueCollision', owner, pair, [symbol, 'USDT'], { quantity: 10 });
    outcomes['managed.venueCollision'].balances = { listingAsset: outcome.balances[symbol], USDT: outcome.balances.USDT };
  });

  test('NRX: the owner\'s legacy sale at the canonical model price, USDT credited, one audit row', async () => {
    const nrxAt = NEURIX.listingAt + 60_000;
    (Date.now as jest.Mock).mockReturnValue(nrxAt);
    await db.balance.create({ data: { userId: owner, asset: 'NRX', available: '4' } });
    const price = new BigNumber(simulationFor(NEURIX).priceAt(nrxAt)!);
    const outcome = await record('nrx.ownerMarketSell', owner, NEURIX.pair, ['NRX', 'USDT'], { quantity: 1 });
    expect(outcome).toMatchObject({ refused: null, status: 'FILLED', fills: 1, price: price.toFixed(), writes: [1, 1, 1], balances: { NRX: ['3', '0'] } });
    expect(new BigNumber(outcome.balances.USDT![0]).eq(price.plus(500))).toBe(true);
    const trade = await db.trade.findFirst({ where: { takerUserId: owner } });
    expect(trade).toMatchObject({ makerUserId: 'simulation:NRX', makerOrderId: 'simulation:NRX', side: 'SELL' });
    const audit = await db.auditLog.findFirst({ where: { userId: owner, action: 'NRX_SIMULATION_SOLD' } });
    expect(audit?.metadata).toMatchObject({ pair: 'NRX/USDT', asset: 'NRX', quote: 'USDT', quantity: '1', price: price.toFixed(), source: 'NEURIX canonical simulation' });
    expect(venue.getTicker).not.toHaveBeenCalledWith('NRX/USDT');
  });

  test('an ordinary venue pair: the owner\'s synthetic sale at the venue price, unchanged', async () => {
    await db.balance.create({ data: { userId: owner, asset: 'ETH', available: '2' } });
    const outcome = await record('venue.ownerMarketSell', owner, 'ETH/USDT', ['ETH', 'USDT'], { quantity: '1.25' });
    expect(outcome).toMatchObject({ refused: null, status: 'FILLED', fills: 1, price: '2500', writes: [1, 1, 1], balances: { ETH: ['0.75', '0'], USDT: ['3625', '0'] } });
  });
});
