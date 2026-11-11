process.env.API_KEY_ENCRYPTION_SECRET = '0'.repeat(64);
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { orderTicketAllowed, requireOrderTicketTrader } from '../orderTicketAccess';
import { requireAuth } from '../auth';
import { orderTicketBoundary } from '../../routes/orderTicketBoundary';
import { ordersRouter } from '../../routes/orders';
import { futuresRouter } from '../../routes/futures';
import { demoTradingRouter } from '../../routes/demoTrading';
import { OrderService } from '../../../services/OrderService';

const OWNER = '10000000-0000-4000-8000-000000000001';
const TESTER = '10000000-0000-4000-8000-000000000002';
const VIEWER = '10000000-0000-4000-8000-000000000003';
const ADMIN = '10000000-0000-4000-8000-000000000004';
const secret = process.env.JWT_SECRET!;
const token = (id: string, sid: string | undefined = `s:${id}`, exp = 3600) => jwt.sign({ sub: id, ...(sid ? { sid } : {}) }, secret, { expiresIn: exp });
const auth = (id: string) => `Bearer ${token(id)}`;
const row = (id: string) => ({ id, role: [OWNER, ADMIN].includes(id) ? 'ADMIN' : 'USER', blockedAt: null });
function database() {
  return {
    user: { findUnique: jest.fn(async ({ where }: any) => row(where.id)) },
    session: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, userId: where.id.slice(2), revokedAt: null, lastSeenAt: new Date() })) },
    $queryRaw: jest.fn(async (_sql: unknown, sid: string, id: string) => [{ ...row(id), sessionUserId: sid.slice(2), revokedAt: null }]),
    auditLog: { findFirst: jest.fn(async () => ({ id: 'credited-fixture' })) },
    balance: { count: jest.fn(async () => 1) },
  } as any;
}
let saved: NodeJS.ProcessEnv;
beforeEach(() => {
  saved = { ...process.env };
  process.env.PRIVATE_TRADING_ENABLED = 'true';
  process.env.PRIVATE_TRADING_OWNER_ID = OWNER;
  process.env.PRIVATE_TRADING_TEST_USER_IDS = TESTER;
  process.env.DEMO_SPOT_ENABLED = 'true';
});
afterEach(() => { process.env = saved; jest.restoreAllMocks(); });
function capability(db = database()) {
  const app = express(); app.use(express.json());
  app.get('/access', requireAuth(db), async (req, res, next) => {
    try { res.json({ allowed: await orderTicketAllowed(db, req) }); } catch (e) { next(e); }
  });
  const execute = jest.fn((_req, res) => res.json({ executed: true }));
  app.post('/execute', requireAuth(db), requireOrderTicketTrader(db), execute);
  return { app, execute, db };
}

describe('two-identity ticket admission, independent of role/funding/client flags', () => {
  test.each([OWNER, TESTER])('existing pinned demo identity is admitted: %s', async id => {
    const { app, execute } = capability();
    expect((await request(app).get('/access').set('Authorization', auth(id))).body).toEqual({ allowed: true });
    expect((await request(app).post('/execute').set('Authorization', auth(id))).status).toBe(200);
    expect(execute).toHaveBeenCalledTimes(1);
  });
  test.each([VIEWER, ADMIN])('funded or ADMIN viewer cannot forge admission: %s', async id => {
    const { app, execute, db } = capability();
    expect((await request(app).get('/access').set('Authorization', auth(id))).body).toEqual({ allowed: false });
    expect((await request(app).post('/execute').set('Authorization', auth(id)).send({ userId: OWNER, role: 'ADMIN', admitted: true, demo: true })).status).toBe(403);
    expect(execute).not.toHaveBeenCalled(); expect(db.auditLog.findFirst).not.toHaveBeenCalled();
  });
  test.each(['', `${TESTER},${VIEWER}`, 'invalid'])('missing/ambiguous identity configuration fails closed', async configured => {
    process.env.PRIVATE_TRADING_TEST_USER_IDS = configured;
    expect((await request(capability().app).get('/access').set('Authorization', auth(OWNER))).body.allowed).toBe(false);
  });
  test('no legacy/sessionless token, expired token or cross-account session', async () => {
    const { app, execute } = capability();
    expect((await request(app).post('/execute')).status).toBe(401);
    expect((await request(app).post('/execute').set('Authorization', `Bearer ${token(OWNER, '')}`)).status).toBe(403);
    expect((await request(app).post('/execute').set('Authorization', `Bearer ${token(OWNER, `s:${OWNER}`, -1)}`)).status).toBe(401);
    expect((await request(app).post('/execute').set('Authorization', `Bearer ${token(OWNER, `s:${TESTER}`)}`)).status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });
  test('revocation/blocking and config change during authorization fail closed', async () => {
    for (const field of ['blockedAt', 'revokedAt']) {
      const db = database(); db.$queryRaw.mockResolvedValue([{ ...row(OWNER), sessionUserId: OWNER, [field]: new Date() }]);
      expect((await request(capability(db).app).post('/execute').set('Authorization', auth(OWNER))).status).toBe(403);
    }
    const db = database(); db.$queryRaw.mockImplementation(async () => {
      process.env.PRIVATE_TRADING_TEST_USER_IDS = VIEWER;
      return [{ ...row(OWNER), sessionUserId: OWNER, revokedAt: null }];
    });
    expect((await request(capability(db).app).post('/execute').set('Authorization', auth(OWNER))).status).toBe(403);
  });
  test('rechecking on each request does not retain a grant across sessions', async () => {
    const { app, execute } = capability();
    expect((await request(app).post('/execute').set('Authorization', auth(OWNER))).status).toBe(200);
    expect((await request(app).post('/execute').set('Authorization', auth(VIEWER))).status).toBe(403);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('real order routers reject forged viewer mutations before execution', () => {
  test.each([
    ['post', '/orders'], ['post', '/orders/oco'], ['patch', '/orders/o/trigger'], ['delete', '/orders/o'],
    ['post', '/demo/orders'], ['delete', '/demo/orders/o'], ['post', '/demo/vta/sell'],
    ['post', '/private-trading/native/command'], ['post', '/ORDERS/'], ['post', '/futures/orders'], ['delete', '/futures/orders/o'], ['post', '/futures/positions/p/close'],
    ['put', '/futures/positions/p/protection'], ['delete', '/futures/positions/p/protection'],
  ])('%s %s refuses non-allowlisted users before any service call', async (method, path) => {
    const db = database(), app = express(), called = jest.fn(() => { throw new Error('financial service reached'); });
    const spot = jest.spyOn(OrderService.prototype, 'placeOrder').mockImplementation(called);
    const engine = { placeOrder: called, cancelOrder: called } as any;
    app.use(express.json(), orderTicketBoundary(db), ordersRouter(db, engine, {} as any));
    app.use(demoTradingRouter(db, { placeOrder: called, cancelOrder: called } as any, { sell: called } as any));
    app.use(futuresRouter(db, engine, { placeOrder: called, closePosition: called } as any, {} as any, {} as any, {} as any));
    for (const id of [VIEWER, ADMIN]) expect((await (request(app) as any)[method](path).set('Authorization', auth(id)).send({ pair: 'ECLV/USDT', side: 'BUY', type: 'MARKET', quantity: '1' })).status).toBe(403);
    expect(called).not.toHaveBeenCalled(); expect(spot).not.toHaveBeenCalled();
  });
  test.each([OWNER, TESTER])('allowed identity reaches existing DemoTradingService only: %s', async id => {
    const db = database(), app = express();
    const placeOrder = jest.fn(async () => ({ order: { id: 'fixture', price: null, originalQuantity: '1', remainingQuantity: '1' }, trades: [] }));
    app.use(express.json(), orderTicketBoundary(db), demoTradingRouter(db, { placeOrder } as any, {} as any, { enabled: () => true, isSpotPair: async () => true }));
    expect((await request(app).post('/demo/orders').set('Authorization', auth(id)).send({ pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: '1' })).status).toBe(201);
    expect(placeOrder).toHaveBeenCalledWith(expect.objectContaining({ userId: id }));
  });
  test.each([OWNER, TESTER])('allowed demo identity cannot reach ordinary Balance BUY or OCO: %s', async id => {
    const spy = jest.spyOn(OrderService.prototype, 'placeOrder'); const app = express();
    const db = database(); app.use(express.json(), orderTicketBoundary(db), ordersRouter(db, {} as any, {} as any));
    expect((await request(app).post('/orders').set('Authorization', auth(id)).send({ pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: '1' })).body.code).toBe('DEMO_ROUTE_REQUIRED');
    expect((await request(app).post('/orders/oco').set('Authorization', auth(id)).send({})).body.code).toBe('DEMO_ROUTE_REQUIRED');
    expect(spy).not.toHaveBeenCalled();
  });
});
