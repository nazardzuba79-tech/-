process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { demoTradingRouter } from '../demoTrading';
import { DemoTradingError } from '../../../services/DemoTradingService';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any, demoTrading: any, vtaDemo?: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', demoTradingRouter(prisma, demoTrading, vtaDemo));
  return app;
}

function adminPrisma(role: 'ADMIN' | 'USER' = 'ADMIN') {
  return { user: { findUnique: jest.fn().mockResolvedValue({ role }) } };
}

describe('demo trading routes', () => {
  it('VTA receipt lookup is read-only, admin-only and scoped to the authenticated account', async () => {
    const id = '91b4b181-2ba2-4e56-9ffb-f9ca5f72e41e';
    const vta = { operation: jest.fn().mockResolvedValue({ receipt: null }), sell: jest.fn() };
    const app = buildApp(adminPrisma(), {}, vta);
    expect((await request(app).get(`/api/v1/demo/vta/sales/${id}`)).status).toBe(401);
    expect((await request(buildApp(adminPrisma('USER'), {}, vta)).get(`/api/v1/demo/vta/sales/${id}`).set('Authorization', authHeader('customer'))).status).toBe(403);
    expect((await request(app).get('/api/v1/demo/vta/sales/not-a-uuid').set('Authorization', authHeader('owner'))).status).toBe(400);
    const result = await request(app).get(`/api/v1/demo/vta/sales/${id}?userId=victim`).set('Authorization', authHeader('owner'));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ receipt: null });
    expect(vta.operation).toHaveBeenCalledTimes(1);
    expect(vta.operation).toHaveBeenCalledWith('owner', id);
    expect(vta.sell).not.toHaveBeenCalled();
  });
  it('VTA sale is admin-only and binds the debit to the authenticated account', async () => {
    const vta = { sell: jest.fn().mockResolvedValue({ id: 'receipt' }) };
    const body = { requestId: '91b4b181-2ba2-4e56-9ffb-f9ca5f72e41e', quantity: '2.5' };
    expect((await request(buildApp(adminPrisma('USER'), {}, vta)).post('/api/v1/demo/vta/sell').set('Authorization', authHeader('customer')).send(body)).status).toBe(403);
    expect(vta.sell).not.toHaveBeenCalled();
    const app = buildApp(adminPrisma(), {}, vta);
    expect((await request(app).post('/api/v1/demo/vta/sell').send(body)).status).toBe(401);
    for (const injected of [{ userId: 'victim' }, { price: '999' }, { side: 'BUY' }, { type: 'LIMIT' }]) {
      expect((await request(app).post('/api/v1/demo/vta/sell').set('Authorization', authHeader('owner')).send({ ...body, ...injected })).status).toBe(400);
    }
    expect((await request(app).post('/api/v1/demo/vta/sell').set('Authorization', authHeader('owner')).send(body)).status).toBe(200);
    expect(vta.sell).toHaveBeenCalledTimes(1);
    expect(vta.sell).toHaveBeenCalledWith({ userId: 'owner', ...body });
  });
  it('requires an admin account for placing a demo order', async () => {
    const demoTrading = { placeOrder: jest.fn() };
    const app = buildApp(adminPrisma('USER'), demoTrading);

    const res = await request(app)
      .post('/api/v1/demo/orders')
      .set('Authorization', authHeader('u1'))
      .send({ pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: '60000', quantity: '1' });

    expect(res.status).toBe(403);
    expect(demoTrading.placeOrder).not.toHaveBeenCalled();
  });

  it('places a demo order for an admin account and returns the order + trades', async () => {
    const demoTrading = {
      placeOrder: jest.fn().mockResolvedValue({
        order: { id: 'o1', status: 'OPEN', price: { toString: () => '60000' }, originalQuantity: { toString: () => '1' }, remainingQuantity: { toString: () => '1' } },
        trades: [],
      }),
    };
    const app = buildApp(adminPrisma('ADMIN'), demoTrading);

    const res = await request(app)
      .post('/api/v1/demo/orders')
      .set('Authorization', authHeader('admin-1'))
      .send({ pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: '60000', quantity: '1' });

    expect(res.status).toBe(201);
    expect(demoTrading.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-1', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT' })
    );
  });

  it('maps a DemoTradingError to a 400', async () => {
    const demoTrading = { placeOrder: jest.fn().mockRejectedValue(new DemoTradingError('Insufficient demo BTC balance')) };
    const app = buildApp(adminPrisma('ADMIN'), demoTrading);

    const res = await request(app)
      .post('/api/v1/demo/orders')
      .set('Authorization', authHeader('admin-1'))
      .send({ pair: 'BTC/USDT', side: 'SELL', type: 'LIMIT', price: '60000', quantity: '1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Insufficient demo BTC balance');
  });

  it('requires an admin account for reading the demo order book', async () => {
    const demoTrading = { getOrderBook: jest.fn() };
    const app = buildApp(adminPrisma('USER'), demoTrading);

    const res = await request(app).get('/api/v1/demo/orderbook/BTC-USDT').set('Authorization', authHeader('u1'));
    expect(res.status).toBe(403);
  });

  it('returns the demo order book snapshot for an admin account', async () => {
    const demoTrading = {
      getOrderBook: jest.fn().mockReturnValue({
        pair: 'BTC/USDT',
        bids: [{ price: { toString: () => '59000' }, quantity: { toString: () => '0.5' }, orderCount: 1 }],
        asks: [],
        timestamp: 123,
      }),
    };
    const app = buildApp(adminPrisma('ADMIN'), demoTrading);

    const res = await request(app).get('/api/v1/demo/orderbook/BTC%2FUSDT').set('Authorization', authHeader('admin-1'));

    expect(res.status).toBe(200);
    expect(res.body.bids).toEqual([{ price: '59000', quantity: '0.5', orders: 1 }]);
  });

  it('cancels a demo order for an admin account', async () => {
    const demoTrading = { cancelOrder: jest.fn().mockResolvedValue({ id: 'o1' }) };
    const app = buildApp(adminPrisma('ADMIN'), demoTrading);

    const res = await request(app).delete('/api/v1/demo/orders/o1').set('Authorization', authHeader('admin-1'));
    expect(res.status).toBe(204);
    expect(demoTrading.cancelOrder).toHaveBeenCalledWith('admin-1', 'o1');
  });

  it('404s cancelling an order that is not cancellable', async () => {
    const demoTrading = { cancelOrder: jest.fn().mockResolvedValue(null) };
    const app = buildApp(adminPrisma('ADMIN'), demoTrading);

    const res = await request(app).delete('/api/v1/demo/orders/nope').set('Authorization', authHeader('admin-1'));
    expect(res.status).toBe(404);
  });
});

describe('demo Spot for admin-credited USER accounts (Issue #592)', () => {
  const order = { pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: '100', quantity: '1' };
  const placed = { order: { id: 'o1', price: { toString: () => '100' }, originalQuantity: { toString: () => '1' }, remainingQuantity: { toString: () => '1' }, status: 'OPEN' }, trades: [] };
  function accounts(rows: Record<string, { role: 'ADMIN' | 'USER'; blockedAt?: Date | null; credited?: boolean }>) {
    return {
      user: { findUnique: jest.fn(async ({ where: { id } }: any) => rows[id] ? { id, role: rows[id].role, blockedAt: rows[id].blockedAt ?? null } : null) },
      auditLog: { findFirst: jest.fn(async ({ where }: any) => rows[where.userId]?.credited && where.action === 'DEMO_BALANCE_ADJUSTED' ? { id: 'credit' } : null) },
    };
  }
  const people = { admin: { role: 'ADMIN' as const }, tester: { role: 'USER' as const, credited: true }, unfunded: { role: 'USER' as const },
    blocked: { role: 'USER' as const, credited: true, blockedAt: new Date() } };
  function app(enabled: boolean, demoTrading: any = { placeOrder: jest.fn().mockResolvedValue(placed) }, isSpotPair = jest.fn(async (pair: string) => pair === 'BTC/USDT')) {
    const server = express(); server.use(express.json());
    server.use('/api/v1', demoTradingRouter(accounts(people) as any, demoTrading, {} as any, { enabled: () => enabled, isSpotPair }));
    return { server, demoTrading, isSpotPair };
  }
  const post = (server: express.Express, who: string, body: object = order) => request(server).post('/api/v1/demo/orders').set('Authorization', authHeader(who)).send(body);

  it('flag OFF: unchanged — every non-admin is refused exactly as before, the admin keeps the sandbox', async () => {
    const { server, demoTrading } = app(false);
    for (const who of ['tester', 'unfunded', 'blocked']) {
      const res = await post(server, who);
      expect(res.status).toBe(403); expect(res.body).toEqual({ error: 'Admin access required' });
    }
    expect((await post(server, 'admin')).status).toBe(201);
    expect(demoTrading.placeOrder).toHaveBeenCalledTimes(1);
    expect((await request(server).get('/api/v1/demo/spot/access').set('Authorization', authHeader('tester'))).body).toEqual({ enabled: false, admitted: false });
  });

  it('flag ON: an admin-credited USER trades on the demo ledger under their own identity', async () => {
    const { server, demoTrading } = app(true);
    const res = await post(server, 'tester', { ...order, userId: 'someone-else' });
    expect(res.status).toBe(201);
    expect(demoTrading.placeOrder).toHaveBeenCalledWith(expect.objectContaining({ userId: 'tester', pair: 'BTC/USDT' }));
    expect((await request(server).get('/api/v1/demo/spot/access').set('Authorization', authHeader('tester'))).body).toEqual({ enabled: true, admitted: true });
  });

  it('flag ON: no admin credit, a blocked account or no session is refused before the ledger is reached', async () => {
    const { server, demoTrading } = app(true);
    for (const who of ['unfunded', 'blocked', 'ghost']) {
      const res = await post(server, who);
      expect([401, 403]).toContain(res.status);
      if (res.status === 403) expect(res.body.code).toBe('DEMO_ACCESS_DENIED');
    }
    expect((await request(server).post('/api/v1/demo/orders').send(order)).status).toBe(401);
    for (const path of ['/demo/balances', '/demo/orders/open', '/demo/orders/history']) {
      expect((await request(server).get('/api/v1' + path).set('Authorization', authHeader('unfunded'))).status).toBe(403);
    }
    expect((await request(server).delete('/api/v1/demo/orders/o1').set('Authorization', authHeader('unfunded'))).status).toBe(403);
    expect(demoTrading.placeOrder).not.toHaveBeenCalled();
    expect((await request(server).get('/api/v1/demo/spot/access').set('Authorization', authHeader('unfunded'))).body).toEqual({ enabled: true, admitted: false });
    expect((await request(server).get('/api/v1/demo/spot/access').set('Authorization', authHeader('blocked'))).body).toEqual({ enabled: true, admitted: false });
  });

  it('flag ON: a tester may trade only pairs the real Spot terminal lists; the admin sandbox is unchanged', async () => {
    const { server, demoTrading, isSpotPair } = app(true);
    const res = await post(server, 'tester', { ...order, pair: 'FAKE/USDT' });
    expect(res.status).toBe(400); expect(res.body.code).toBe('PAIR_NOT_SUPPORTED');
    expect(demoTrading.placeOrder).not.toHaveBeenCalled();
    isSpotPair.mockClear();
    expect((await post(server, 'admin', { ...order, pair: 'FAKE/USDT' })).status).toBe(201);
    expect(isSpotPair).not.toHaveBeenCalled();
  });

  it('a refusal from the ledger keeps its code: the client can say «not enough funds» without guessing', async () => {
    const { server } = app(true, { placeOrder: jest.fn().mockRejectedValue(new DemoTradingError('Insufficient USDT balance', 'INSUFFICIENT_BALANCE')) });
    const res = await post(server, 'tester');
    expect(res.status).toBe(400); expect(res.body).toEqual({ error: 'Insufficient USDT balance', code: 'INSUFFICIENT_BALANCE' });
  });

  it('VTA routes stay admin-only with the flag on', async () => {
    const { server } = app(true);
    expect((await request(server).get('/api/v1/demo/vta').set('Authorization', authHeader('tester'))).status).toBe(403);
  });
});

describe('demo order request ID (Issue #592 review)', () => {
  const body = { pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: '100', quantity: '1' };
  const order = { id: 'o1', price: { toString: () => '100' }, originalQuantity: { toString: () => '1' }, remainingQuantity: { toString: () => '1' }, status: 'OPEN' };
  it('passes a UUID request ID through; a replay answers 200 with the same order; a conflict is 409; a malformed ID is 400', async () => {
    const demoTrading = { placeOrder: jest.fn()
      .mockResolvedValueOnce({ order, trades: [] })
      .mockResolvedValueOnce({ order, trades: [], replayed: true })
      .mockRejectedValueOnce(new DemoTradingError('This request was already used for a different order', 'REQUEST_CONFLICT')) };
    const app = buildApp(adminPrisma('ADMIN'), demoTrading);
    const requestId = '6b0f6f1e-8c1d-4c7a-9d0e-1f2a3b4c5d6e';
    const send = (extra: object) => request(app).post('/api/v1/demo/orders').set('Authorization', authHeader('admin-1')).send({ ...body, ...extra });
    expect((await send({ requestId })).status).toBe(201);
    const replay = await send({ requestId });
    expect(replay.status).toBe(200); expect(replay.body.order.id).toBe('o1');
    expect((await send({ requestId, price: '101' })).status).toBe(409);
    expect((await send({ requestId: 'not-a-uuid' })).status).toBe(400);
    expect(demoTrading.placeOrder).toHaveBeenCalledTimes(3);
    expect(demoTrading.placeOrder).toHaveBeenNthCalledWith(1, expect.objectContaining({ userId: 'admin-1', requestId }));
  });
});
