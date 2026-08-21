process.env.JWT_SECRET = 'test-secret-at-least-this-long';
process.env.API_KEY_ENCRYPTION_SECRET = '0'.repeat(64);

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { tradesRouter } from '../trades';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', tradesRouter(prisma));
  return app;
}

describe('GET /trades/me', () => {
  it("returns the caller's own trades, serialized as strings", async () => {
    const trade = {
      id: 'trade-1',
      pair: 'BTC/USDT',
      takerUserId: 'user-1',
      makerUserId: 'user-2',
      side: 'BUY',
      price: { toString: () => '60000' },
      quantity: { toString: () => '0.5' },
      executedAt: new Date('2026-01-01'),
    };
    const prisma = { trade: { findMany: jest.fn().mockResolvedValue([trade]) } } as any;
    const app = buildApp(prisma);

    const res = await request(app).get('/api/v1/trades/me').set('Authorization', authHeader('user-1'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({ id: 'trade-1', side: 'BUY', price: '60000', quantity: '0.5' }),
    ]);
    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ takerUserId: 'user-1' }, { makerUserId: 'user-1' }] } })
    );
  });

  it("flips the side for the maker leg of a trade", async () => {
    const trade = {
      id: 'trade-2',
      pair: 'BTC/USDT',
      takerUserId: 'other-user',
      makerUserId: 'user-1',
      side: 'BUY', // taker bought, so the maker (us) sold
      price: { toString: () => '60000' },
      quantity: { toString: () => '0.5' },
      executedAt: new Date('2026-01-01'),
    };
    const prisma = { trade: { findMany: jest.fn().mockResolvedValue([trade]) } } as any;
    const app = buildApp(prisma);

    const res = await request(app).get('/api/v1/trades/me').set('Authorization', authHeader('user-1'));

    expect(res.body[0].side).toBe('SELL');
  });

  it('filters by pair when provided', async () => {
    const prisma = { trade: { findMany: jest.fn().mockResolvedValue([]) } } as any;
    const app = buildApp(prisma);

    await request(app).get('/api/v1/trades/me?pair=BTC/USDT').set('Authorization', authHeader('user-1'));

    expect(prisma.trade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ takerUserId: 'user-1' }, { makerUserId: 'user-1' }], pair: 'BTC/USDT' },
      })
    );
  });

  it('requires authentication', async () => {
    const app = buildApp({ trade: { findMany: jest.fn() } } as any);
    const res = await request(app).get('/api/v1/trades/me');
    expect(res.status).toBe(401);
  });
});
