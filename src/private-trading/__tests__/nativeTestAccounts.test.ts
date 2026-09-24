import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import { privateTradingRouter } from '../../api/routes/privateTrading';
import { futuresRouter } from '../../api/routes/futures';
import { requireAuth } from '../../api/middleware/auth';
import { requireAdmin } from '../../api/middleware/admin';
import { assertOwner, isSimulationOnlyUser } from '../access';
import { assertNativeTrader } from '../native/testAccess';
import { isNativeTestAccount, nativeTestAccountIds } from '../native/testAccounts';
import { NATIVE_DEMO_MODEL } from '../native/engine';

const TESTER = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const OWNER = 'owner';
const OTHER = '33333333-3333-4333-8333-333333333333';
const saved = { enabled: process.env.PRIVATE_TRADING_ENABLED, owner: process.env.PRIVATE_TRADING_OWNER_ID, testers: process.env.PRIVATE_TRADING_TEST_USER_IDS };

jest.mock('../../api/middleware/apiKeyAuth', () => ({
  requireAuthOrApiKey: () => (req: any, _res: any, next: any) => { req.userId = req.headers['x-test-user']; next(); },
  requireTradePermission: (_req: any, _res: any, next: any) => next(),
}));

function fixture() {
  const users: any = Object.fromEntries([OWNER, TESTER, SECOND, OTHER].map(id => [id, { id, role: id === OWNER ? 'ADMIN' : 'USER', blockedAt: null }]));
  const sessions: any = Object.fromEntries(Object.keys(users).map(id => ['s-' + id, { id: 's-' + id, userId: id, revokedAt: null, lastSeenAt: new Date() }]));
  const holdings: any[] = [
    { userId: TESTER, asset: 'USDT', available: new Prisma.Decimal('10000'), locked: new Prisma.Decimal(0) },
    { userId: TESTER, asset: 'BTC', available: new Prisma.Decimal('2'), locked: new Prisma.Decimal(0) },
    { userId: SECOND, asset: 'USDT', available: new Prisma.Decimal('7'), locked: new Prisma.Decimal(0) },
    { userId: OWNER, asset: 'USDT', available: new Prisma.Decimal('900000'), locked: new Prisma.Decimal(0) },
  ];
  const accounts = new Map<string, any>();
  const revisions: any[] = [];
  const forbidden = jest.fn(() => { throw new Error('Real persistence or legacy engine reached'); });
  const nativeRead = jest.fn(async ({ where }: any) => accounts.get(where.userId) ?? null);
  const db: any = {
    user: { findUnique: jest.fn(async ({ where }: any) => users[where.id]), update: forbidden },
    session: { findUnique: jest.fn(async ({ where }: any) => sessions[where.id]), update: jest.fn(async () => ({})) },
    demoBalance: {
      findMany: jest.fn(async ({ where }: any) => holdings.filter(h => h.userId === where.userId)),
      findUnique: jest.fn(async ({ where }: any) => holdings.find(h => h.userId === where.userId_asset.userId && h.asset === where.userId_asset.asset) ?? null),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const h = holdings.find(h => h.userId === where.userId && h.asset === where.asset);
        if (!h || !h.available.gte(where.available.gte)) return { count: 0 };
        h.available = h.available.minus(data.available.decrement);
        return { count: 1 };
      }),
    },
    nativeDemoAccount: {
      findUnique: nativeRead,
      create: jest.fn(async ({ data }: any) => { if (accounts.has(data.userId)) throw new Error('duplicate account'); accounts.set(data.userId, data); return data; }),
    },
    nativeDemoRevision: {
      findUnique: jest.fn(async ({ where }: any) => {
        const q = where.userId_requestKey ?? where.userId_revision;
        return revisions.find(r => r.userId === q.userId && (q.requestKey ? r.requestKey === q.requestKey : r.revision === q.revision)) ?? null;
      }),
      create: jest.fn(async ({ data }: any) => { revisions.push(data); return data; }),
    },
    nativeDemoLiveProjection: {
      upsert: jest.fn(async ({ create }: any) => ({ userId: create.userId })),
    },
    $queryRaw: jest.fn(async (parts: TemplateStringsArray, ...values: string[]) => {
      if (parts.join('?').includes('FROM "User" u LEFT JOIN "Session" s')) {
        const [sessionId, userId] = values;
        const user = users[userId], session = sessions[sessionId];
        return user ? [{ role: user.role, blockedAt: user.blockedAt,
          sessionUserId: session?.userId ?? null, revokedAt: session?.revokedAt ?? null }] : [];
      }
      return [];
    }),
    $transaction: jest.fn(async (run: any) => run(db)),
    balance: new Proxy({}, { get: () => forbidden }),
    futuresBalance: new Proxy({}, { get: () => forbidden }),
    withdrawal: new Proxy({}, { get: () => forbidden }),
    order: new Proxy({}, { get: () => forbidden }),
  };
  const config = () => ({ enabled: process.env.PRIVATE_TRADING_ENABLED === 'true', ownerId: process.env.PRIVATE_TRADING_OWNER_ID ?? '' });
  const market: any = {
    freshQuote: jest.fn(async (symbol: string) => {
      if (symbol !== 'BTCUSDT') throw new Error('fixture has no price for that asset');
      return { symbol, markPrice: '50000', markProviderTimestamp: Date.now(), fetchedAt: Date.now() };
    }),
    chartCandles: jest.fn(async (input: any) => ({ source: 'BYBIT_LINEAR', symbol: input.symbol, interval: input.interval, candles: [], fetchedAt: Date.now() })),
    instrument: forbidden, history: forbidden,
  };
  const service: any = { store: { config, authorized: (actor: any) => assertOwner(db, actor, config), allocate: forbidden }, market, state: forbidden, preview: forbidden };
  const app = express(); app.use(express.json());
  app.use('/api/v1', privateTradingRouter(db, service));
  app.get('/admin/probe', requireAuth(db), requireAdmin(db), (_req, res) => { forbidden(); res.json({}); });
  app.use(futuresRouter(db, {} as any, { placeOrder: forbidden, cancelOrder: forbidden, closePosition: forbidden, transfer: forbidden } as any,
    { getMarkPrice: async () => null } as any, { list: () => ['BTC/USDT'], has: () => true } as any,
    { setProtection: forbidden, clearProtection: forbidden, activeProtectionByPosition: async () => new Map() } as any));
  const token = (id = TESTER, extra: any = {}, expiresIn: any = '1h') => jwt.sign({ sub: id, sid: 's-' + id, ...extra }, process.env.JWT_SECRET!, { expiresIn });
  const actor = (id = TESTER) => ({ userId: id, sessionId: 's-' + id, expiresAt: Date.now() + 3600000 });
  return { app, token, actor, users, sessions, accounts, holdings, revisions, db, market, config, forbidden };
}

beforeEach(() => {
  process.env.PRIVATE_TRADING_ENABLED = 'true'; process.env.PRIVATE_TRADING_OWNER_ID = OWNER;
  process.env.PRIVATE_TRADING_TEST_USER_IDS = `${TESTER},${SECOND}`;
});
afterAll(() => {
  for (const [key, value] of Object.entries({ PRIVATE_TRADING_ENABLED: saved.enabled, PRIVATE_TRADING_OWNER_ID: saved.owner, PRIVATE_TRADING_TEST_USER_IDS: saved.testers })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

describe('explicit native test identities, without admin permissions', () => {
  test('UUID allowlist is exact, default empty, rejects wildcard/email/malformed values', () => {
    expect(isNativeTestAccount(TESTER)).toBe(true); expect(isNativeTestAccount(OTHER)).toBe(false);
    expect(isNativeTestAccount(undefined)).toBe(false); expect(isNativeTestAccount(TESTER + 'x')).toBe(false);
    for (const raw of ['', '*', 'tester@example.com', TESTER + ',bad-id']) {
      process.env.PRIVATE_TRADING_TEST_USER_IDS = raw;
      expect(nativeTestAccountIds().size).toBe(0);
    }
  });
  test('allowed USER is native-only; legacy assertOwner still rejects it', async () => {
    const f = fixture();
    await expect(assertNativeTrader(f.db, f.actor(), f.config)).resolves.toBeUndefined();
    await expect(assertOwner(f.db, f.actor(), f.config)).rejects.toMatchObject({ status: 403 });
    expect((await request(f.app).get('/admin/probe').auth(f.token(), { type: 'bearer' })).status).toBe(403);
    expect(f.users[TESTER].role).toBe('USER'); expect(f.forbidden).not.toHaveBeenCalled();
  });
  test('primary owner keeps mandatory ADMIN requirement', async () => {
    const f = fixture(); f.users[OWNER].role = 'USER';
    await expect(assertNativeTrader(f.db, f.actor(OWNER), f.config)).rejects.toMatchObject({ status: 403 });
  });
  test('revocation, blocked account and wrong-session owner fail closed', async () => {
    const f = fixture();
    f.users[TESTER].blockedAt = new Date();
    await expect(assertNativeTrader(f.db, f.actor(), f.config)).rejects.toMatchObject({ status: 403 });
    f.users[TESTER].blockedAt = null; f.sessions['s-' + TESTER].revokedAt = new Date();
    await expect(assertNativeTrader(f.db, f.actor(), f.config)).rejects.toMatchObject({ status: 403 });
    f.sessions['s-' + TESTER].revokedAt = null; f.sessions['s-' + TESTER].userId = SECOND;
    await expect(assertNativeTrader(f.db, f.actor(), f.config)).rejects.toMatchObject({ status: 403 });
  });
  test('allowlist removed during awaited authorization is rechecked', async () => {
    const f = fixture();
    const read = f.db.$queryRaw.getMockImplementation();
    f.db.$queryRaw.mockImplementation(async (...args: unknown[]) => {
      const result = await read(...args); process.env.PRIVATE_TRADING_TEST_USER_IDS = SECOND; return result;
    });
    await expect(assertNativeTrader(f.db, f.actor(), f.config)).rejects.toMatchObject({ status: 403 });
  });
  test('test native access denied when feature off but real-Futures fence remains', async () => {
    const f = fixture(); process.env.PRIVATE_TRADING_ENABLED = 'false';
    await expect(assertNativeTrader(f.db, f.actor(), f.config)).rejects.toMatchObject({ status: 403 });
    expect(isSimulationOnlyUser(TESTER)).toBe(true);
    const r = await request(f.app).post('/futures/orders').set('x-test-user', TESTER).send({});
    expect(r.status).toBe(403); expect(f.forbidden).not.toHaveBeenCalled();
  });
  test.each([
    ['post', '/futures/orders'], ['delete', '/futures/orders/anything'],
    ['post', '/futures/positions/anything/close'], ['put', '/futures/positions/anything/protection'],
    ['delete', '/futures/positions/anything/protection'], ['post', '/futures/transfer'],
  ])('tester cannot enter real execution: %s %s', async (method, path) => {
    const f = fixture(); const r = await (request(f.app) as any)[method](path).set('x-test-user', TESTER).send({});
    expect(r.status).toBe(403); expect(f.forbidden).not.toHaveBeenCalled();
  });
  test('authenticated tester access, own state and candles work; legacy paths do not', async () => {
    const f = fixture();
    const get = (path: string) => request(f.app).get('/api/v1/private-trading' + path).auth(f.token(), { type: 'bearer' });
    expect((await get('/access')).body).toMatchObject({ allowed: true, nativeAvailable: true, simulationOnly: true });
    expect((await get('/native/state')).body).toMatchObject({ initialized: false, demoAvailable: '10000' });
    expect((await get('/candles?symbol=BTC%2FUSDT&source=BYBIT_LINEAR&interval=1h&limit=100')).status).toBe(200);
    expect(f.market.chartCandles).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'BTCUSDT' }));
    expect((await get('/state')).status).toBe(403);
    expect((await request(f.app).post('/api/v1/private-trading/allocate').auth(f.token(), { type: 'bearer' }).send({ amount: '1', idempotencyKey: 'test-key' })).status).toBe(403);
    expect((await request(f.app).post('/api/v1/private-trading/previews').auth(f.token(), { type: 'bearer' }).send({})).status).toBe(403);
    expect(f.forbidden).not.toHaveBeenCalled();
  });
  test('unlisted, expired and missing sessions cannot read native holdings', async () => {
    const f = fixture(); const path = '/api/v1/private-trading/native/wallet';
    expect((await request(f.app).get(path)).status).toBe(401);
    expect((await request(f.app).get(path).auth(f.token(TESTER, {}, -1), { type: 'bearer' })).status).toBe(401);
    expect((await request(f.app).get(path).auth(f.token(OTHER), { type: 'bearer' })).status).toBe(403);
    expect(f.db.demoBalance.findMany).not.toHaveBeenCalled();
  });
  test('credited holdings visible before initialize; GET never writes or doubles credit', async () => {
    const f = fixture();
    for (let i = 0; i < 2; i++) {
      const r = await request(f.app).get('/api/v1/private-trading/native/wallet').auth(f.token(), { type: 'bearer' });
      expect(r.status).toBe(200); expect(r.body.initialized).toBe(false);
      expect(r.body.account.equity).toBe('110000'); // 10000 USDT + 2 BTC * fixture 50000.
      expect(r.body.rows.find((x: any) => x.asset === 'USDT').total).toBe('10000');
      expect(r.body.rows.find((x: any) => x.asset === 'BTC').total).toBe('2');
      expect(r.headers['cache-control']).toBe('private, no-store');
    }
    expect(f.db.demoBalance.updateMany).not.toHaveBeenCalled(); expect(f.db.nativeDemoAccount.create).not.toHaveBeenCalled();
    expect(f.db.nativeDemoRevision.create).not.toHaveBeenCalled(); expect(f.forbidden).not.toHaveBeenCalled();
  });
  test('second tester sees only its own holdings even with a forged query identity', async () => {
    const f = fixture();
    const r = await request(f.app).get('/api/v1/private-trading/native/wallet?userId=' + TESTER).auth(f.token(SECOND), { type: 'bearer' });
    expect(r.status).toBe(200); expect(r.body.account.equity).toBe('7');
    expect(r.body.rows.some((x: any) => x.asset === 'BTC')).toBe(false);
    expect(f.db.demoBalance.findMany.mock.calls.every(([q]: any) => q.where.userId === SECOND)).toBe(true);
  });
  test('initialize twice uses existing credited USDT once; Wallet total is preserved', async () => {
    const f = fixture();
    const body = { acceptedModel: NATIVE_DEMO_MODEL.version, idempotencyKey: 'initialize-test-ledger' };
    for (let i = 0; i < 2; i++) {
      const r = await request(f.app).post('/api/v1/private-trading/native/initialize').auth(f.token(), { type: 'bearer' }).send(body);
      expect(r.status).toBe(200); expect(r.body.initialized).toBe(true); expect(r.body.account.equity).toBe('110000');
    }
    const w = await request(f.app).get('/api/v1/private-trading/native/wallet').auth(f.token(), { type: 'bearer' });
    expect(w.status).toBe(200); expect(w.body.account.equity).toBe('110000');
    expect(w.body.rows.find((x: any) => x.asset === 'USDT').total).toBe('10000');
    expect(f.db.demoBalance.updateMany).toHaveBeenCalledTimes(1); expect(f.db.nativeDemoAccount.create).toHaveBeenCalledTimes(1);
    expect(f.db.nativeDemoRevision.create).toHaveBeenCalledTimes(1); expect(f.users[TESTER].role).toBe('USER');
    expect(f.forbidden).not.toHaveBeenCalled();
  });
});
