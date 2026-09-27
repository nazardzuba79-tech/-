import { readFileSync } from 'fs';
import { resolve } from 'path';
import express from 'express';
import request from 'supertest';
import BigNumber from 'bignumber.js';
import { FuturesMarketRegistry } from '../futures/FuturesMarketRegistry';
import { FuturesProtectionService } from '../futures/FuturesProtectionService';
import { MIN_PERP_24H_QUOTE_VOLUME } from '../config/futuresConfig';
import { nativeDemoRoutes, nativeReplyHasWork } from '../private-trading/native/routes';
import { PrivateTradingService } from '../private-trading/service';
import { PrivateTradingError } from '../private-trading/serviceTypes';
import { bestEffortWake } from '../services/IdleBackoffScheduler';
import { BackgroundWorkCoordinator } from '../services/BackgroundWorkCoordinator';

/**
 * The wakes a sleeping backend depends on, and the reads it no longer makes.
 * A sleeping loop runs again only when something wakes it, so every path
 * that creates its work is pinned here — behaviourally where it can be run
 * without a database, by source where the wiring lives in index.ts.
 */
const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('index.ts wires every work-creating path to its loop', () => {
  const index = src('index.ts');
  it('spot orders placed over HTTP wake the price watcher', () => {
    expect(index).toContain("ordersRouter(prisma, engine, marketDataService, bestEffortWake(() => priceWatcherService.wake(), 'spot-conditional'))");
  });
  it('futures placements wake liquidation; CFD opens wake CFD liquidation', () => {
    expect(index).toContain("new FuturesPositionService(prisma, futuresEngine, markPriceService, bestEffortWake(() => liquidationEngine.wake(), 'futures-liquidation'))");
    expect(index).toContain("new CfdPositionService(prisma, cfdDataService, bestEffortWake(() => cfdLiquidationEngine.wake(), 'cfd-liquidation'))");
  });
  it('native demo commands nudge the limit pass', () => {
    expect(index).toContain("privateTradingRouter(prisma, privateTradingService, bestEffortWake(() => nativeLimitPass?.nudge(), 'native-limit-pass'))");
  });
  it('the loops start through createServerBackground, with the activity net mounted before the routes', () => {
    expect(index).toContain('background.start();');
    const net = index.indexOf('app.use(background.activityMiddleware());');
    const firstRoute = index.indexOf("app.use('/api/v1'");
    expect(net).toBeGreaterThan(0);
    expect(net).toBeLessThan(firstRoute);
    for (const old of ['liquidationEngine.startScheduler()', 'priceWatcherService.startScheduler(', 'nativeLimitPass?.start()', 'privateTradingService.start()']) {
      expect(index).not.toContain(old);
    }
  });
  it('every post-commit wake handed out by index.ts is best effort', () => {
    const handed = index.match(/\(\) => [a-zA-Z]+\??\.(wake|nudge)\(\)/g) ?? [];
    const wrapped = index.match(/bestEffortWake\(\(\) => [a-zA-Z]+\??\.(wake|nudge)\(\)/g) ?? [];
    expect(handed.length).toBe(5);
    expect(wrapped.length).toBe(handed.length);
  });
  it('the orders router hands its wake to the OrderService it builds', () => {
    expect(src('api/routes/orders.ts')).toContain('new OrderService(prisma, engine, priceSource, onConditionalOrderCommitted)');
  });
  it('every successful legacy private write nudges the owner-account pass', () => {
    expect(src('api/routes/privateTrading.ts')).toContain("if (req.method !== 'GET') bestEffortWake(() => service.nudge?.(), 'private-owner-pass')();");
  });
  it('both native mounts pass the wake through', () => {
    expect(src('api/routes/privateTrading.ts')).toContain("nativeDemoRoutes(native, actor, onNativeWork)");
    expect(src('api/routes/privateTrading.ts')).toContain('nativeTestAccountRoutes(prisma, service, onNativeWork)');
    expect(src('private-trading/native/testRoutes.ts')).toContain("nativeDemoRoutes(native, actor, onNativeWork)");
  });
});

describe('post-commit wakes are best effort', () => {
  it('bestEffortWake swallows (and logs) a failing wake', () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const calls: string[] = [];
    bestEffortWake(() => { calls.push('ran'); throw new Error('boom'); }, 'test')();
    expect(calls).toEqual(['ran']);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
  it('a watcher whose nudge throws does not affect a successful write\'s response', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const co = new BackgroundWorkCoordinator([{ name: 'broken', asleep: true, nudge: () => { throw new Error('boom'); } }], { activityCooldownMs: 0 });
    co.start();
    const a = express();
    a.use(co.middleware());
    a.post('/write', (_req, res) => res.status(201).json({ ok: true }));
    const reply = await request(a).post('/write');
    expect(reply.status).toBe(201);
    co.stop();
    error.mockRestore();
  });
});

describe('native command route: wakes the limit pass only after a committed command that leaves work', () => {
  const view = (positions: { status: string }[], orders: { status: string }[]) => ({ positions, orders });
  it('work = an open position or a working order; anything unrecognised counts as work', () => {
    expect(nativeReplyHasWork(view([], []))).toBe(false);
    expect(nativeReplyHasWork(view([{ status: 'OPEN' }], []))).toBe(true);
    expect(nativeReplyHasWork(view([], [{ status: 'PARTIALLY_FILLED' }]))).toBe(true);
    expect(nativeReplyHasWork(view([], [{ status: 'FILLED' }, { status: 'CANCELLED' }]))).toBe(false);
    expect(nativeReplyHasWork(null)).toBe(true);
    expect(nativeReplyHasWork({ revision: 3 })).toBe(true);
  });

  function app(reply: unknown, fail = false) {
    const wakes: string[] = [];
    const service = {
      command: jest.fn(async () => { if (fail) throw new PrivateTradingError('refused', 'refused', 409); return reply; }),
      repository: { activate: jest.fn(async () => {}) },
    } as any;
    const a = express();
    a.use(express.json());
    a.use('/n', nativeDemoRoutes(service, () => ({ userId: 'u', sessionId: 's', expiresAt: Date.now() + 60_000 }), () => wakes.push('wake')));
    a.use((err: any, _req: any, res: any, _next: any) => res.status(err?.status ?? 500).json({ error: err?.code }));
    return { a, wakes };
  }
  const open = { kind: 'OPEN', symbol: 'BTCUSDT', side: 'LONG', type: 'LIMIT', price: '49000', quantity: '0.1', leverage: '10', idempotencyKey: '11111111-1111-4111-8111-111111111111' };

  it('a command that leaves a working order wakes it', async () => {
    const { a, wakes } = app({ positions: [], orders: [{ status: 'OPEN' }] });
    expect((await request(a).post('/n/commands').send(open)).status).toBe(200);
    expect(wakes).toEqual(['wake']);
  });
  it('a command that leaves the account flat does not', async () => {
    const { a, wakes } = app({ positions: [], orders: [] });
    await request(a).post('/n/commands').send({ kind: 'REFRESH', idempotencyKey: '22222222-2222-4222-8222-222222222222' });
    expect(wakes).toEqual([]);
  });
  it('a refused command does not', async () => {
    const { a, wakes } = app(null, true);
    expect((await request(a).post('/n/commands').send(open)).status).toBe(409);
    expect(wakes).toEqual([]);
  });
  it('a wake that throws never turns the committed command into an error', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const service = { command: jest.fn(async () => ({ positions: [{ status: 'OPEN' }], orders: [] })), repository: { activate: jest.fn(async () => {}) } } as any;
    const a = express();
    a.use(express.json());
    a.use('/n', nativeDemoRoutes(service, () => ({ userId: 'u', sessionId: 's', expiresAt: Date.now() + 60_000 }), () => { throw new Error('wake broke'); }));
    const reply = await request(a).post('/n/commands').send(open);
    expect(reply.status).toBe(200);
    expect(reply.body.positions).toEqual([{ status: 'OPEN' }]);
    expect((await request(a).post('/n/execution-session')).status).toBe(200);
    (console.error as jest.Mock).mockRestore();
  });
  it('a session admission always does: it is what lets the pass act for a renewed session', async () => {
    const { a, wakes } = app(null);
    expect((await request(a).post('/n/execution-session')).status).toBe(200);
    expect(wakes).toEqual(['wake']);
  });
});

describe('owner-account pass (legacy private trading): what it counts as work', () => {
  const OWNER = 'owner-1';
  function service(account: unknown, opts: { authorized?: () => Promise<void>; running?: unknown[] } = {}) {
    const db = {
      privateTradingAccount: { findUnique: jest.fn(async () => account) },
      privateTradingPreview: { findMany: jest.fn(async () => opts.running ?? []) },
    };
    const store = { db, config: () => ({ enabled: true, ownerId: OWNER }), authorized: jest.fn(opts.authorized ?? (async () => {})) } as any;
    return new PrivateTradingService(store, null);
  }
  const session = { userId: OWNER, sessionId: 's', expiresAt: Date.now() + 60_000 };
  const outcome = (s: PrivateTradingService) => (s as any).lastOutcome;

  it('no account, no session, nothing open → idle', async () => {
    const none = service(null); await none.tick(); expect(outcome(none)).toBe('idle');
    const noSession = service({ state: { session: null, positions: [], orders: [] } }); await noSession.tick(); expect(outcome(noSession)).toBe('idle');
    const flat = service({ state: { session, positions: [], orders: [] } }); await flat.tick(); expect(outcome(flat)).toBe('idle');
  });
  it('a RUNNING preview is work', async () => {
    const s = service({ state: { session, positions: [], orders: [] } }, { running: [{ id: 'p1' }] });
    (s as any).runPreview = jest.fn(async () => {});
    await s.tick();
    expect(outcome(s)).toBe('found-work');
  });
  it('an expired or refused session is not an error to retry but nothing to do until the owner acts', async () => {
    jest.useFakeTimers();
    try {
      const s = service({ state: { session, positions: [{ status: 'OPEN', symbol: 'BTCUSDT' }], orders: [] } }, {
        authorized: async () => { throw new PrivateTradingError('session_expired', 'expired', 401); },
      });
      s.start({ sleep: { graceMs: 0 } });
      await jest.advanceTimersByTimeAsync(3_000);
      expect(s.asleep).toBe(true);
      s.stop();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('futures listing refresh: positions are re-read only when a contract would be delisted', () => {
  const BIG = String(MIN_PERP_24H_QUOTE_VOLUME * 10);
  const t = (pair: string) => ({ pair, lastPrice: '1', quoteVolume24h: BIG }) as any;
  function make(tickers: () => any[], inFlight: string[] = [], fail = false) {
    const prisma = {
      futuresPosition: { findMany: jest.fn(async () => { if (fail) throw new Error('db down'); return inFlight.map((symbol) => ({ symbol })); }) },
      futuresOrder: { findMany: jest.fn(async () => []) },
    } as any;
    return { registry: new FuturesMarketRegistry({ getTickers: jest.fn(async () => tickers()) } as any, prisma, null), prisma };
  }
  beforeAll(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
  afterAll(() => jest.restoreAllMocks());

  it('the first refresh after a start always reads, and keeps a pre-restart position listed', async () => {
    const { registry, prisma } = make(() => [t('BTC/USDT'), t('ETH/USDT'), t('SOL/USDT')], ['OLD/USDT']);
    expect(await registry.refresh()).toContain('OLD/USDT');
    expect(prisma.futuresPosition.findMany).toHaveBeenCalledTimes(1);
  });

  it('a refresh that keeps every listed contract reads nothing', async () => {
    const { registry, prisma } = make(() => [t('BTC/USDT'), t('ETH/USDT'), t('SOL/USDT'), t('XRP/USDT')]);
    await registry.refresh();
    await registry.refresh();
    await registry.refresh();
    expect(prisma.futuresPosition.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.futuresOrder.findMany).toHaveBeenCalledTimes(1);
  });

  it('a refresh that would drop a contract reads, and keeps it while a position is open on it', async () => {
    let feed = [t('BTC/USDT'), t('ETH/USDT'), t('SOL/USDT'), t('XRP/USDT')];
    const { registry, prisma } = make(() => feed, ['XRP/USDT']);
    await registry.refresh();
    feed = [t('BTC/USDT'), t('ETH/USDT'), t('SOL/USDT')]; // XRP falls out of the feed
    expect(await registry.refresh()).toContain('XRP/USDT');
    expect(prisma.futuresPosition.findMany).toHaveBeenCalledTimes(2);
  });

  it('a failed read never licenses skipping: the next refresh reads again', async () => {
    const { registry, prisma } = make(() => [t('BTC/USDT'), t('ETH/USDT'), t('SOL/USDT')], [], true);
    await registry.refresh();
    await registry.refresh();
    expect(prisma.futuresPosition.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('TP/SL loop: a trigger left mid-flight by a crash keeps the loop awake until it is reclaimed', () => {
  function service(rows: { status: string }[]) {
    const prisma = {
      futuresPositionProtection: {
        updateMany: jest.fn(async () => ({ count: 0 })),
        findMany: jest.fn(async ({ where }: any) => rows.filter((r) => (where.status?.in ? where.status.in.includes(r.status) : r.status === where.status))),
      },
    } as any;
    return new FuturesProtectionService(prisma, {} as any, { getMarkPrice: async () => new BigNumber('1') } as any);
  }
  it('nothing armed and nothing TRIGGERING → idle', async () => {
    const s = service([{ status: 'EXECUTED' }, { status: 'CANCELLED' }]);
    await s.checkAndTrigger();
    expect(s.sweepOutcome).toBe('idle');
  });
  it('a TRIGGERING row too fresh to reclaim → still work, so the loop does not sleep on it', async () => {
    const s = service([{ status: 'TRIGGERING' }]);
    await s.checkAndTrigger();
    expect(s.sweepOutcome).toBe('found-work');
  });
});
