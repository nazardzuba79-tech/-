process.env.JWT_SECRET = 'test-secret-at-least-this-long';
process.env.API_KEY_ENCRYPTION_SECRET = '0'.repeat(64);

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { ordersRouter } from '../orders';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any, engine: any = {}) {
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
