import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { OrderService } from '../../../services/OrderService';

process.env.API_KEY_ENCRYPTION_SECRET = '0'.repeat(64);
const { ordersRouter } = require('../orders') as typeof import('../orders');
const { balancesRouter } = require('../balances') as typeof import('../balances');

const bearer = () => `Bearer ${jwt.sign({ sub: 'spot-error-viewer', sid: 'spot-fixture-session' },
  process.env.JWT_SECRET!, { expiresIn: '1h' })}`;

function fixture() {
  const db = {
    session: { findUnique: jest.fn(async () => ({ id: 'spot-fixture-session', userId: 'spot-error-viewer',
      revokedAt: null, lastSeenAt: new Date() })) },
    apiKey: { findUnique: jest.fn() },
    balance: { findMany: jest.fn().mockResolvedValue([]) },
    order: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const engine = { getBook: jest.fn() };
  const errors: unknown[] = [];
  const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
    errors.push(err);
    res.status(500).json({ error: 'Internal server error' });
  };
  const app = express().use(express.json())
    .use('/api/v1', ordersRouter(db as any, engine as any, {} as any))
    .use('/api/v1', balancesRouter(db as any));
  app.use(handleError);
  app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });
  return { app, db, engine, errors };
}

afterEach(() => jest.restoreAllMocks());

const accountReads = [
  ['/balances', (f: ReturnType<typeof fixture>) => f.db.balance.findMany],
  ['/orders/me', (f: ReturnType<typeof fixture>) => f.db.order.findMany],
] as const;

it.each(accountReads)('forwards a rejected %s read after the real session check and keeps the API answering', async (path, reader) => {
  const f = fixture();
  const failure = new Error('fixture spot database unavailable: private diagnostic');
  reader(f).mockRejectedValueOnce(failure);
  const response = await request(f.app).get(`/api/v1${path}`).set('Authorization', bearer()).timeout({ deadline: 5_000 });
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ error: 'Internal server error' });
  expect(f.db.session.findUnique).toHaveBeenCalledTimes(1);
  expect(f.errors).toEqual([failure]);
  expect((await request(f.app).get('/health')).body).toEqual({ status: 'ok' });
});

it.each(accountReads)('forwards an API-key lookup rejection before %s without entering the account read', async (path, reader) => {
  const f = fixture();
  const failure = new Error('fixture API-key database unavailable');
  f.db.apiKey.findUnique.mockRejectedValueOnce(failure);
  const response = await request(f.app).get(`/api/v1${path}`).set('X-API-KEY', 'fixture-public-key')
    .set('X-API-TIMESTAMP', String(Date.now())).set('X-API-SIGNATURE', '0'.repeat(64)).timeout({ deadline: 5_000 });
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ error: 'Internal server error' });
  expect(reader(f)).not.toHaveBeenCalled();
  expect(f.errors).toEqual([failure]);
});

it.each(accountReads)('preserves auth refusal and unavailable-session responses for %s', async (path, reader) => {
  const f = fixture();
  expect((await request(f.app).get(`/api/v1${path}`)).status).toBe(401);
  f.db.session.findUnique.mockRejectedValueOnce(new Error('fixture session store unavailable'));
  const unavailable = await request(f.app).get(`/api/v1${path}`).set('Authorization', bearer());
  expect(unavailable.status).toBe(503);
  expect(unavailable.body).toEqual({ error: 'Authentication temporarily unavailable' });
  expect(reader(f)).not.toHaveBeenCalled();
  expect(f.errors).toEqual([]);
});

it('forwards the public async orderbook handler rejection', async () => {
  const f = fixture();
  const failure = new Error('fixture orderbook unavailable');
  f.engine.getBook.mockImplementationOnce(() => { throw failure; });
  const response = await request(f.app).get('/api/v1/orderbook/BTC%2FUSDT').timeout({ deadline: 5_000 });
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ error: 'Internal server error' });
  expect(f.errors).toEqual([failure]);
});

it('forwards a cancellation rejection once and preserves the existing missing-order response', async () => {
  const f = fixture();
  const failure = new Error('fixture cancellation unavailable');
  const cancel = jest.spyOn(OrderService.prototype, 'cancelOrder').mockRejectedValueOnce(failure).mockResolvedValueOnce(null);
  const failed = await request(f.app).delete('/api/v1/orders/fixture-order').set('Authorization', bearer()).timeout({ deadline: 5_000 });
  expect(failed.status).toBe(500);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(f.errors).toEqual([failure]);
  const missing = await request(f.app).delete('/api/v1/orders/fixture-order').set('Authorization', bearer());
  expect(missing.status).toBe(404);
  expect(missing.body).toEqual({ error: 'Order not found or not cancellable' });
  expect(cancel).toHaveBeenCalledTimes(2);
});

it('preserves the existing handled order rejection and validation without retrying execution', async () => {
  const f = fixture();
  const place = jest.spyOn(OrderService.prototype, 'placeOrder').mockRejectedValueOnce(new Error('fixture insufficient balance'));
  const rejected = await request(f.app).post('/api/v1/orders').set('Authorization', bearer())
    .send({ pair: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: '1' });
  expect(rejected.status).toBe(400);
  expect(rejected.body).toEqual({ error: 'fixture insufficient balance' });
  const invalid = await request(f.app).post('/api/v1/orders').set('Authorization', bearer()).send({ quantity: '-1' });
  expect(invalid.status).toBe(400);
  expect(place).toHaveBeenCalledTimes(1);
  expect(f.errors).toEqual([]);
});

it('preserves successful balance precision and caller-scoped order reads', async () => {
  const f = fixture();
  f.db.balance.findMany.mockResolvedValue([{ asset: 'BTC', available: '0.00000001', locked: '0.00000002' }]);
  const balances = await request(f.app).get('/api/v1/balances').set('Authorization', bearer());
  expect(balances.status).toBe(200);
  expect(balances.body).toEqual([{ asset: 'BTC', available: '0.00000001', locked: '0.00000002' }]);
  const orders = await request(f.app).get('/api/v1/orders/me?status=OPEN').set('Authorization', bearer());
  expect(orders.status).toBe(200);
  expect(orders.body).toEqual([]);
  expect(f.db.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { userId: 'spot-error-viewer', status: { in: ['OPEN'] } },
  }));
  expect(f.errors).toEqual([]);
});
