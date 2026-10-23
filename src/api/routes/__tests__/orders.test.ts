process.env.JWT_SECRET = 'test-secret-at-least-this-long';
process.env.API_KEY_ENCRYPTION_SECRET = '0'.repeat(64);

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { ordersRouter } from '../orders';
import { OrderService, OrderRequestConflict } from '../../../services/OrderService';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId, sid: `test-session:${userId}` }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any, engine: any = {}) {
  // Route fixtures model the persisted sessions issued by the current login flow.
  prisma = { session: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, userId: where.id.replace('test-session:', ''), revokedAt: null, lastSeenAt: new Date() })) }, ...prisma };
  const app = express();
  app.use(express.json());
  const priceSource = { getTicker: async () => ({ lastPrice: '60000' }) };
  app.use('/api/v1', ordersRouter(prisma, engine, priceSource));
  return app;
}

describe('GET /orders/me', () => {
  it('returns the caller\'s own orders, serialized as strings', async () => {
    const order = {
      id: 'order-1',
      pair: 'BTC/USDT',
      side: 'BUY',
      type: 'LIMIT',
      price: { toString: () => '60000' },
      originalQuantity: { toString: () => '1' },
      remainingQuantity: { toString: () => '0.5' },
      status: 'PARTIALLY_FILLED',
      createdAt: new Date('2026-01-01'),
    };
    const prisma = { order: { findMany: jest.fn().mockResolvedValue([order]) } } as any;
    const app = buildApp(prisma);

    const res = await request(app).get('/api/v1/orders/me').set('Authorization', authHeader('user-1'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        id: 'order-1',
        price: '60000',
        originalQuantity: '1',
        remainingQuantity: '0.5',
        status: 'PARTIALLY_FILLED',
      }),
    ]);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } })
    );
  });

  it('filters by a single status when provided', async () => {
    const prisma = { order: { findMany: jest.fn().mockResolvedValue([]) } } as any;
    const app = buildApp(prisma);

    await request(app).get('/api/v1/orders/me?status=OPEN').set('Authorization', authHeader('user-1'));

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', status: { in: ['OPEN'] } } })
    );
  });

  it('filters by a comma-separated list of statuses', async () => {
    const prisma = { order: { findMany: jest.fn().mockResolvedValue([]) } } as any;
    const app = buildApp(prisma);

    await request(app)
      .get('/api/v1/orders/me?status=OPEN,PARTIALLY_FILLED')
      .set('Authorization', authHeader('user-1'));

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', status: { in: ['OPEN', 'PARTIALLY_FILLED'] } } })
    );
  });

  it('requires authentication', async () => {
    const app = buildApp({ order: { findMany: jest.fn() } } as any);
    const res = await request(app).get('/api/v1/orders/me');
    expect(res.status).toBe(401);
  });
});

describe('POST /orders and /orders/oco — optional request ID (Issue #592 review)', () => {
  // The service is the authority (see scripts/test-demo-trading-postgres.cjs for the real ledger);
  // here only the route's contract: pass-through, 200 for a replay, 409 for other terms, 400 for a malformed ID.
  afterEach(() => jest.restoreAllMocks());
  const body = { pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: '100', quantity: '1' };
  const order = { id: 'o1', price: { toString: () => '100' }, originalQuantity: { toString: () => '1' }, remainingQuantity: { toString: () => '1' }, status: 'OPEN' };
  const requestId = '6b0f6f1e-8c1d-4c7a-9d0e-1f2a3b4c5d6e';

  it('/orders: passes the ID through; a replay answers 200 with the same order; other terms 409; malformed 400', async () => {
    const place = jest.spyOn(OrderService.prototype, 'placeOrder')
      .mockResolvedValueOnce({ order, trades: [] } as any)
      .mockResolvedValueOnce({ order, trades: [], replayed: true } as any)
      .mockRejectedValueOnce(new OrderRequestConflict('This request was already used for a different order'));
    const app = buildApp({});
    const send = (extra: object) => request(app).post('/api/v1/orders').set('Authorization', authHeader('user-1')).send({ ...body, ...extra });
    expect((await send({ requestId })).status).toBe(201);
    const replay = await send({ requestId });
    expect(replay.status).toBe(200); expect(replay.body.order.id).toBe('o1'); expect(replay.body).not.toHaveProperty('replayed');
    const conflict = await send({ requestId, price: '101' });
    expect(conflict.status).toBe(409); expect(conflict.body.code).toBe('REQUEST_CONFLICT');
    expect((await send({ requestId: 'not-a-uuid' })).status).toBe(400);
    expect(place).toHaveBeenCalledTimes(3);
    expect(place).toHaveBeenNthCalledWith(1, expect.objectContaining({ userId: 'user-1', requestId }));
    // Without an ID the call is exactly as before.
    place.mockResolvedValueOnce({ order, trades: [] } as any);
    expect((await send({})).status).toBe(201);
    expect(place.mock.calls[3][0]).not.toHaveProperty('requestId');
  });

  it('/orders/oco: a replay answers 200 with the same pair and no extra field', async () => {
    const pair = { ocoGroupId: 'g', takeProfitOrderId: 'tp', stopOrderId: 'st' };
    jest.spyOn(OrderService.prototype, 'placeOcoOrder').mockResolvedValueOnce(pair as any).mockResolvedValueOnce({ ...pair, replayed: true } as any);
    const app = buildApp({});
    const oco = { pair: 'BTC/USDT', side: 'SELL', quantity: '1', takeProfitPrice: '120', stopTriggerPrice: '90', stopLimitPrice: '89', requestId };
    const first = await request(app).post('/api/v1/orders/oco').set('Authorization', authHeader('user-1')).send(oco);
    const again = await request(app).post('/api/v1/orders/oco').set('Authorization', authHeader('user-1')).send(oco);
    expect(first.status).toBe(201); expect(again.status).toBe(200); expect(again.body).toEqual(pair);
  });
});
