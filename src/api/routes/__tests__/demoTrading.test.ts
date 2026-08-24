process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { demoTradingRouter } from '../demoTrading';
import { DemoTradingError } from '../../../services/DemoTradingService';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any, demoTrading: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', demoTradingRouter(prisma, demoTrading));
  return app;
}

function adminPrisma(role: 'ADMIN' | 'USER' = 'ADMIN') {
  return { user: { findUnique: jest.fn().mockResolvedValue({ role }) } };
}

describe('demo trading routes', () => {
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
