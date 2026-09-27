import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { randomUUID } from 'crypto';
import express from 'express';
import request from 'supertest';
import { LiquidationEngine } from '../futures/LiquidationEngine';
import { FuturesProtectionService } from '../futures/FuturesProtectionService';
import { FuturesPositionService } from '../futures/FuturesPositionService';
import { MarkPriceService } from '../futures/MarkPriceService';
import { MatchingEngine } from '../matching-engine/MatchingEngine';
import { OrderService } from '../services/OrderService';
import { PriceWatcherService } from '../services/PriceWatcherService';
import { CfdLiquidationEngine } from '../cfd/CfdLiquidationEngine';
import { CfdPositionService } from '../cfd/CfdPositionService';
import { NativeDemoService } from '../private-trading/native/service';
import { PrismaNativeRepository } from '../private-trading/native/store';
import { NativeLimitPass, nativeLimitTargets } from '../private-trading/native/limitPass';
import { nativeDemoRoutes } from '../private-trading/native/routes';
import { setup as nativeFixture } from '../private-trading/native/testing/liveFixture';
import type { PrivateTradingMarketData } from '../private-trading/marketData';
import type { OwnerSession } from '../private-trading/serviceTypes';

/**
 * SLEEPING WATCHERS against a REAL PostgreSQL: every loop goes quiet on an
 * empty database, wakes on the real mutation that creates its work, does
 * that work (liquidation checks, TP, SL, partial and full closes, spot
 * triggers, CFD, native demo limit execution), and goes back to sleep when
 * the last piece of work is gone — with no event needed after a restart.
 *
 * The loops run on real timers with short base intervals and no grace, so
 * each transition is visible within a second. "Asleep" is asserted twice:
 * by the loop's own state, and by the database itself — Prisma's query log
 * shows zero statements while the test itself is quiet.
 *
 * HOW TO RUN: point VOLTEX_PG_TEST_URL at a migrated, otherwise idle,
 * disposable database (see futuresBookLock.pg.test.ts). Without it the suite
 * is SKIPPED, never reported as passed.
 */
const URL = process.env.VOLTEX_PG_TEST_URL;
const describePg = URL ? describe : describe.skip;
const SLEEP = { sleep: { graceMs: 0 } };
const BASE_MS = 100;

let db: PrismaClient;
const queries: string[] = [];
const users: string[] = [];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean | Promise<boolean>, what: string, ms = 8_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await check()) return; await wait(25); }
  throw new Error(`timed out waiting for: ${what}`);
}
/** Statements the database received while this test issued none. */
async function quietFor(ms: number) {
  const before = queries.length;
  await wait(ms);
  return queries.slice(before);
}
function marks(initial: string) {
  const service = new MarkPriceService({} as any);
  let price = new BigNumber(initial);
  jest.spyOn(service, 'getMarkPrice').mockImplementation(async () => price);
  jest.spyOn(service, 'getIndexPrice').mockImplementation(async () => price);
  return { service, set: (p: string) => { price = new BigNumber(p); } };
}
async function user(role: 'USER' | 'ADMIN' = 'USER') {
  const id = randomUUID();
  await db.user.create({ data: { id, email: `sleep-${id}@localhost.invalid`, passwordHash: 'TEST_ONLY', referralCode: `SLP${id.slice(0, 8)}`, role } });
  users.push(id);
  return id;
}
async function futuresFunds(userId: string) {
  await db.futuresBalance.create({ data: { userId, asset: 'USDT', available: '1000000', locked: '0' } });
}

beforeAll(async () => {
  if (!URL) return;
  jest.spyOn(console, 'info').mockImplementation(() => {});
  db = new PrismaClient({ datasources: { db: { url: URL } }, log: [{ emit: 'event', level: 'query' }] });
  (db as any).$on('query', (e: { query: string }) => queries.push(e.query));
  await db.$queryRawUnsafe('SELECT 1');
  // These loops watch WHOLE tables, so the database must otherwise be idle.
  const busy = {
    futures: await db.futuresPosition.count({ where: { status: 'OPEN' } }),
    protection: await db.futuresPositionProtection.count({ where: { status: { in: ['PENDING', 'FAILED', 'TRIGGERING'] } } }),
    spot: await db.order.count({ where: { status: 'PENDING_TRIGGER' } }),
    cfd: await db.cfdPosition.count({ where: { status: 'OPEN' } }),
  };
  if (Object.values(busy).some((n) => n > 0)) throw new Error(`[serverWatcherSleep.pg] database is not idle: ${JSON.stringify(busy)}`);
});

afterAll(async () => {
  if (!URL) return;
  for (const userId of users) {
    await db.futuresPositionProtection.deleteMany({ where: { userId } });
    const positions = await db.futuresPosition.findMany({ where: { userId }, select: { id: true } });
    if (positions.length) {
      await db.insuranceFundLedger.deleteMany({ where: { positionId: { in: positions.map((p) => p.id) } } }).catch(() => {});
      await db.fundingPayment.deleteMany({ where: { positionId: { in: positions.map((p) => p.id) } } }).catch(() => {});
    }
    await db.futuresPosition.deleteMany({ where: { userId } });
    await db.futuresOrder.deleteMany({ where: { userId } });
    await db.futuresBalance.deleteMany({ where: { userId } });
    await db.cfdPosition.deleteMany({ where: { userId } });
    await db.trade.deleteMany({ where: { OR: [{ takerUserId: userId }, { makerUserId: userId }] } }).catch(() => {});
    await db.order.deleteMany({ where: { userId } });
    await db.balance.deleteMany({ where: { userId } });
    await db.nativeDemoRevision.deleteMany({ where: { userId } }).catch(() => {});
    await db.nativeDemoLiveProjection.deleteMany({ where: { userId } }).catch(() => {});
    await db.nativeDemoAccount.deleteMany({ where: { userId } }).catch(() => {});
    await db.demoBalance.deleteMany({ where: { userId } }).catch(() => {});
    await db.session.deleteMany({ where: { userId } }).catch(() => {});
    await db.user.delete({ where: { id: userId } }).catch(() => {});
  }
  await db.$disconnect();
});

describePg('sleeping background loops on a real PostgreSQL', () => {
  it('FUTURES: sleeps empty; wakes on the opening fill; TP, SL, partial and full close; sleeps again', async () => {
    const price = marks('60000');
    const engine = new MatchingEngine();
    let liquidation!: LiquidationEngine;
    const futures = new FuturesPositionService(db, engine, price.service, () => liquidation.wake());
    liquidation = new LiquidationEngine(db, price.service);
    const protection = new FuturesProtectionService(db, futures, price.service);
    liquidation.startScheduler(BASE_MS, SLEEP);
    protection.startScheduler(BASE_MS, SLEEP);
    try {
      // Start-up scan: nothing open, nothing armed → both asleep, and silent.
      await until(() => liquidation.asleep && protection.asleep, 'both futures loops asleep at start');
      expect(await quietFor(800)).toEqual([]);

      const [maker, trader, liquidity] = [await user(), await user(), await user()];
      for (const id of [maker, trader, liquidity]) await futuresFunds(id);
      const order = (userId: string, side: 'BUY' | 'SELL', type: 'LIMIT' | 'MARKET', quantity: string, px?: string, reduceOnly = false) =>
        futures.placeOrder({ userId, symbol: 'BTC/USDT', side, type, quantity: new BigNumber(quantity), price: px ? new BigNumber(px) : undefined, leverage: 10, marginType: 'ISOLATED', reduceOnly });

      // A resting order is not a position: the wake runs one sweep that finds
      // nothing, and the loop goes back to sleep.
      await order(maker, 'SELL', 'LIMIT', '2', '60000');
      await until(() => liquidation.asleep, 'liquidation asleep again after a resting order');

      // The opening fill: woken synchronously by the committed placement.
      await order(trader, 'BUY', 'MARKET', '2');
      expect(liquidation.asleep).toBe(false);
      const long = await db.futuresPosition.findFirstOrThrow({ where: { userId: trader, status: 'OPEN' } });
      const short = await db.futuresPosition.findFirstOrThrow({ where: { userId: maker, status: 'OPEN' } });
      // Active: sweeping at its base cadence while positions are open.
      const before = queries.filter((q) => q.includes('FROM "public"."FuturesPosition" WHERE "public"."FuturesPosition"."status"')).length;
      await wait(600);
      const sweeps = queries.filter((q) => q.includes('FROM "public"."FuturesPosition" WHERE "public"."FuturesPosition"."status"')).length - before;
      expect(sweeps).toBeGreaterThanOrEqual(3);
      expect(liquidation.asleep).toBe(false);

      // TP + SL armed on the LONG: the protection loop wakes on the commit.
      await protection.setProtection(trader, long.id, { takeProfit: new BigNumber('61000'), stopLoss: new BigNumber('59000') });
      expect(protection.asleep).toBe(false);

      // Partial close: half of the LONG into a resting bid.
      await order(liquidity, 'BUY', 'LIMIT', '1', '60000');
      await order(trader, 'SELL', 'MARKET', '1', undefined, true);
      expect((await db.futuresPosition.findUniqueOrThrow({ where: { id: long.id } })).size.toString()).toBe('1');

      // TP: liquidity at the target, then the mark reaches it.
      await order(liquidity, 'BUY', 'LIMIT', '1', '61000');
      price.set('61000');
      await until(async () => (await db.futuresPosition.findUniqueOrThrow({ where: { id: long.id } })).status === 'CLOSED', 'take-profit closed the LONG');
      // The trigger resolves its rows in the step after the close commits.
      const settled = async (positionId: string) => Object.fromEntries((await db.futuresPositionProtection.findMany({ where: { positionId } })).map((r) => [r.kind, r.status]));
      await until(async () => (await settled(long.id)).TAKE_PROFIT === 'EXECUTED', 'take-profit row resolved');
      expect(await settled(long.id)).toEqual({ TAKE_PROFIT: 'EXECUTED', STOP_LOSS: 'CANCELLED' });

      // SL on the SHORT (full close of both contracts).
      await protection.setProtection(maker, short.id, { takeProfit: new BigNumber('55000'), stopLoss: new BigNumber('62000') });
      await order(liquidity, 'SELL', 'LIMIT', '2', '62000');
      price.set('62000');
      await until(async () => (await db.futuresPosition.findUniqueOrThrow({ where: { id: short.id } })).status === 'CLOSED', 'stop-loss closed the SHORT');
      await until(async () => (await settled(short.id)).STOP_LOSS === 'EXECUTED', 'stop-loss row resolved');
      expect(await settled(short.id)).toEqual({ TAKE_PROFIT: 'CANCELLED', STOP_LOSS: 'EXECUTED' });

      // Nothing open, nothing armed: both loops fall asleep and stay silent.
      expect(await db.futuresPosition.count({ where: { status: 'OPEN' } })).toBe(0);
      await until(() => liquidation.asleep && protection.asleep, 'both futures loops asleep after the last close');
      expect(await quietFor(800)).toEqual([]);
    } finally {
      liquidation.stopScheduler();
      protection.stopScheduler();
    }
  }, 60_000);

  it('SPOT: a conditional order wakes the watcher, triggers, and the watcher sleeps; a cancelled one too', async () => {
    let last = '60000';
    const prices = { getTicker: async () => ({ lastPrice: last }) } as any;
    let watcher!: PriceWatcherService;
    const spot = new OrderService(db, new MatchingEngine(), prices, () => watcher.wake());
    watcher = new PriceWatcherService(db, spot, prices);
    watcher.startScheduler(BASE_MS, SLEEP);
    try {
      await until(() => watcher.asleep, 'price watcher asleep at start');
      expect(await quietFor(600)).toEqual([]);
      const trader = await user();
      await db.balance.create({ data: { userId: trader, asset: 'BTC', available: '10', locked: '0' } });

      const stop = await spot.placeOrder({ userId: trader, pair: 'BTC/USDT', side: 'SELL', type: 'STOP_LIMIT', triggerPrice: new BigNumber('55000'), price: new BigNumber('54900'), quantity: new BigNumber('1') });
      expect(watcher.asleep).toBe(false);
      last = '55000';
      await until(async () => (await db.order.findUniqueOrThrow({ where: { id: stop.order.id } })).status !== 'PENDING_TRIGGER', 'stop triggered');
      await until(() => watcher.asleep, 'price watcher asleep after the trigger');

      const tp = await spot.placeOrder({ userId: trader, pair: 'BTC/USDT', side: 'SELL', type: 'TAKE_PROFIT_LIMIT', triggerPrice: new BigNumber('65000'), price: new BigNumber('65000'), quantity: new BigNumber('1') });
      expect(watcher.asleep).toBe(false);
      await wait(400);
      expect(watcher.asleep).toBe(false); // still watching a resting conditional order
      await spot.cancelOrder(trader, tp.order.id);
      await until(() => watcher.asleep, 'price watcher asleep after the last conditional order was cancelled');
      expect(await quietFor(600)).toEqual([]);
      await spot.cancelOrder(trader, stop.order.id).catch(() => null);
    } finally {
      watcher.stopScheduler();
    }
  }, 60_000);

  it('CFD: an open position wakes the liquidation loop; closing it puts the loop to sleep', async () => {
    const quote = () => ({ provider: 'test', symbol: 'XAUUSD', providerSymbol: 'XAU/USD', bid: 2400, ask: 2400, last: 2400, mid: 2400, lastDecimal: '2400',
      providerTimestamp: Date.now(), fetchedAt: Date.now(), stale: false, status: 'live' as const, entitlementVerified: true, executionAllowed: true });
    const source = { isConfigured: () => true, maxQuoteAgeMs: 5_000, getQuotes: async () => [quote()], getFreshQuote: async () => quote() };
    let loop!: CfdLiquidationEngine;
    const cfd = new CfdPositionService(db, source, () => loop.wake());
    loop = new CfdLiquidationEngine(db, source);
    loop.startScheduler(BASE_MS, SLEEP);
    try {
      await until(() => loop.asleep, 'CFD loop asleep at start');
      const trader = await user();
      await futuresFunds(trader);
      const position = await cfd.open({ userId: trader, symbol: 'XAUUSD', side: 'BUY', quantity: new BigNumber('1'), leverage: 10 });
      expect(loop.asleep).toBe(false);
      await wait(400);
      expect(loop.asleep).toBe(false);
      await cfd.close({ userId: trader, positionId: position.id });
      await until(() => loop.asleep, 'CFD loop asleep after the close');
      expect(await quietFor(600)).toEqual([]);
    } finally {
      loop.stopScheduler();
    }
  }, 60_000);

  it('DEMO/NATIVE: the command route wakes the limit pass, the pass executes a limit, and sleeps when flat', async () => {
    const f = nativeFixture();
    const owner = await user('ADMIN');
    const sessionId = randomUUID();
    await db.session.create({ data: { id: sessionId, userId: owner } });
    await db.demoBalance.upsert({ where: { userId_asset: { userId: owner, asset: 'USDT' } }, create: { userId: owner, asset: 'USDT', available: '100000' }, update: { available: '100000' } });
    const actor: OwnerSession = { userId: owner, sessionId, expiresAt: Date.now() + 3_600_000 };
    const config = () => ({ enabled: true, ownerId: owner });
    const market = f.market as unknown as PrivateTradingMarketData;
    const routeService = new NativeDemoService(new PrismaNativeRepository(db, config), market, f.clock.now);
    const pass = new NativeLimitPass(new NativeDemoService(new PrismaNativeRepository(db, config, true), market, f.clock.now), () => nativeLimitTargets(db, config), f.clock.now, 200);
    const app = express();
    app.use(express.json());
    app.use('/native', nativeDemoRoutes(routeService, () => actor, () => pass.nudge()));
    app.use((err: any, _req: any, res: any, _next: any) => res.status(err?.status ?? 500).json({ error: err?.code ?? String(err) }));
    pass.start(SLEEP);
    try {
      await until(() => pass.asleep, 'limit pass asleep at start');
      await routeService.initialize(actor, `init-${randomUUID()}`);
      const command = (body: object) => request(app).post('/native/commands').send({ idempotencyKey: randomUUID(), ...body });

      // A position: the committed command's reply has work → the pass wakes.
      const opened = await command({ kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'MARKET', quantity: '0.1', leverage: '10' });
      if (opened.status !== 200) throw new Error(`OPEN refused: ${JSON.stringify(opened.body)}`);
      expect(pass.asleep).toBe(false);
      await wait(600);
      expect(pass.asleep).toBe(false); // an open position keeps it at its cadence

      // A resting limit below the market, then the market moves through it:
      // the PASS (no client command) executes it.
      const limit = await command({ kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'LIMIT', price: '49000', quantity: '0.1', leverage: '10' });
      expect(limit.status).toBe(200);
      const limitId = limit.body.orders.find((o: any) => o.status === 'OPEN')?.id;
      expect(limitId).toBeTruthy();
      f.market.price = '48900';
      f.step();
      await until(async () => {
        const live = await routeService.state(actor);
        return live.orders.find((o: any) => o.id === limitId)?.status === 'FILLED';
      }, 'the limit pass filled the resting order');

      // Close everything: flat → the pass sleeps.
      const state = await routeService.state(actor);
      for (const position of state.positions) {
        const closed = await command({ kind: 'CLOSE', positionId: position.id });
        expect(closed.status).toBe(200);
      }
      await until(() => pass.asleep, 'limit pass asleep when flat');
      expect(await quietFor(800)).toEqual([]);
    } finally {
      await pass.stop();
    }
  }, 90_000);

  it('RESTART: work left by a previous process is found by the start-up scan alone; an idle restart scans once and sleeps', async () => {
    // Work committed by "the previous process": no wake() will ever arrive.
    const trader = await user();
    await futuresFunds(trader);
    const position = await db.futuresPosition.create({ data: { userId: trader, symbol: 'BTC/USDT', side: 'LONG', size: '1', entryPrice: '60000', leverage: 10, marginType: 'ISOLATED', initialMargin: '6000', liquidationPrice: '54300', status: 'OPEN' } });
    await db.futuresPositionProtection.create({ data: { positionId: position.id, userId: trader, symbol: 'BTC/USDT', kind: 'STOP_LOSS', triggerPrice: '59000', status: 'PENDING' } });
    await db.balance.create({ data: { userId: trader, asset: 'BTC', available: '9', locked: '1' } });
    const conditional = await db.order.create({ data: { id: randomUUID(), userId: trader, pair: 'BTC/USDT', side: 'SELL', type: 'STOP_LIMIT', price: '54900', triggerPrice: '55000', lockedAmount: '1', lockedAsset: 'BTC', originalQuantity: '1', remainingQuantity: '1', status: 'PENDING_TRIGGER' } });
    await db.cfdPosition.create({ data: { userId: trader, symbol: 'XAUUSD', side: 'LONG', size: '1', entryPrice: '2400', leverage: 10, initialMargin: '240', liquidationPrice: '2170', status: 'OPEN' } });

    // "The new process": fresh loops, started exactly as production starts them.
    const price = marks('60000');
    const quote = () => ({ provider: 'test', symbol: 'XAUUSD', providerSymbol: 'XAU/USD', bid: 2400, ask: 2400, last: 2400, mid: 2400, lastDecimal: '2400',
      providerTimestamp: Date.now(), fetchedAt: Date.now(), stale: false, status: 'live' as const, entitlementVerified: true, executionAllowed: true });
    const cfdSource = { isConfigured: () => true, maxQuoteAgeMs: 5_000, getQuotes: async () => [quote()], getFreshQuote: async () => quote() };
    const liquidation = new LiquidationEngine(db, price.service);
    const protection = new FuturesProtectionService(db, new FuturesPositionService(db, new MatchingEngine(), price.service), price.service);
    const spotPrices = { getTicker: async () => ({ lastPrice: '60000' }) } as any;
    const watcher = new PriceWatcherService(db, new OrderService(db, new MatchingEngine(), spotPrices), spotPrices);
    const cfdLoop = new CfdLiquidationEngine(db, cfdSource);
    const loops = [liquidation, protection, watcher, cfdLoop];
    liquidation.startScheduler(BASE_MS, SLEEP); protection.startScheduler(BASE_MS, SLEEP);
    watcher.startScheduler(BASE_MS, SLEEP); cfdLoop.startScheduler(BASE_MS, SLEEP);
    try {
      await wait(800);
      // No event was sent; every loop found its work on its own start-up scan.
      for (const loop of loops) expect(loop.asleep).toBe(false);

      // Clear the work the way a trader would have; each loop then sleeps.
      await db.futuresPositionProtection.updateMany({ where: { positionId: position.id }, data: { status: 'CANCELLED', resolvedAt: new Date() } });
      await db.futuresPosition.update({ where: { id: position.id }, data: { status: 'CLOSED', closedAt: new Date() } });
      await db.order.update({ where: { id: conditional.id }, data: { status: 'CANCELLED' } });
      await db.cfdPosition.updateMany({ where: { userId: trader }, data: { status: 'CLOSED', closedAt: new Date() } });
      await until(() => loops.every((loop) => loop.asleep), `every loop asleep once the work is gone (${loops.map((l) => `${l.constructor.name}:${l.asleep}`).join(' ')})`);
    } finally {
      liquidation.stopScheduler(); protection.stopScheduler(); watcher.stopScheduler(); cfdLoop.stopScheduler();
    }

    // IDLE RESTART: one scan per loop, then nothing.
    const again = [new LiquidationEngine(db, price.service), new CfdLiquidationEngine(db, cfdSource)];
    const mark = queries.length;
    again[0].startScheduler(BASE_MS, SLEEP); again[1].startScheduler(BASE_MS, SLEEP);
    try {
      await until(() => again.every((loop) => loop.asleep), 'idle restart: asleep after one scan');
      const startupScan = queries.length - mark;
      expect(startupScan).toBeGreaterThanOrEqual(2);
      expect(startupScan).toBeLessThanOrEqual(4);
      expect(await quietFor(800)).toEqual([]);
    } finally {
      again[0].stopScheduler(); again[1].stopScheduler();
    }
  }, 60_000);
});
