import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import BigNumber from 'bignumber.js';

// The real API-key middleware requires a server encryption key at import.
// This fixture never decrypts a key or connects to a database/provider.
process.env.API_KEY_ENCRYPTION_SECRET = '0'.repeat(64);
const { futuresRouter } = require('../futures') as typeof import('../futures');

const bearer = () => `Bearer ${jwt.sign({ sub: 'async-error-viewer', sid: 'fixture-session' },
  process.env.JWT_SECRET!, { expiresIn: '1h' })}`;

function fixture() {
  const db = {
    session: { findUnique: jest.fn(async () => ({ id: 'fixture-session', userId: 'async-error-viewer',
      revokedAt: null, lastSeenAt: new Date() })) },
    apiKey: { findUnique: jest.fn() },
    futuresOrder: { findMany: jest.fn(async () => []) },
    futuresPosition: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null),
      aggregate: jest.fn(async () => ({ _sum: { size: null } })) },
    futuresBalance: { findMany: jest.fn(async () => []) },
    fundingRateRecord: { findMany: jest.fn(async () => []) },
  };
  const prices = { getMarkPrice: jest.fn(async () => new BigNumber('100')),
    getIndexPrice: jest.fn(async () => new BigNumber('100')) };
  const positions = { cancelOrder: jest.fn(async () => false), placeOrder: jest.fn() };
  const protection = { getProtection: jest.fn(async () => null),
    activeProtectionByPosition: jest.fn(async () => new Map()) };
  const errors: unknown[] = [];
  const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
    errors.push(err);
    res.status(500).json({ error: 'Internal server error' });
  };
  const app = express().use(express.json()).use('/api/v1', futuresRouter(
    db as any, {} as any, positions as any, prices as any,
    { list: () => ['BTC/USDT'], has: (symbol: string) => symbol === 'BTC/USDT' } as any, protection as any
  ));
  app.use(handleError);
  app.get('/health', (_req, res) => { res.json({ status: 'ok' }); });
  return { app, db, prices, positions, protection, errors };
}

const publicFailures = [
  ['/futures/funding-rate/BTC-USDT', (f: ReturnType<typeof fixture>) => f.db.fundingRateRecord.findMany],
  ['/futures/open-interest/BTC-USDT', (f: ReturnType<typeof fixture>) => f.db.futuresPosition.aggregate],
  ['/futures/mark-price/BTC-USDT', (f: ReturnType<typeof fixture>) => f.prices.getMarkPrice],
] as const;

it.each(publicFailures)('forwards a rejected public read at %s without killing or hanging the API', async (path, failingRead) => {
  const f = fixture();
  const failure = new Error('fixture provider/database failure: private diagnostic');
  failingRead(f).mockRejectedValueOnce(failure);
  const response = await request(f.app).get(`/api/v1${path}`).timeout({ deadline: 5_000 });
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ error: 'Internal server error' });
  expect(f.errors).toEqual([failure]);
  expect((await request(f.app).get('/health')).body).toEqual({ status: 'ok' });
});

const privateFailures = [
  ['/futures/orders/me', (f: ReturnType<typeof fixture>) => f.db.futuresOrder.findMany],
  ['/futures/positions', (f: ReturnType<typeof fixture>) => f.db.futuresPosition.findMany],
  ['/futures/positions/history', (f: ReturnType<typeof fixture>) => f.db.futuresPosition.findMany],
  ['/futures/positions/fixture-position/protection', (f: ReturnType<typeof fixture>) => f.protection.getProtection],
  ['/futures/balances', (f: ReturnType<typeof fixture>) => f.db.futuresBalance.findMany],
] as const;

it.each(privateFailures)('forwards a rejected authenticated read at %s after the real session check', async (path, failingRead) => {
  const f = fixture();
  const failure = new Error('fixture account database unavailable');
  failingRead(f).mockRejectedValueOnce(failure);
  const response = await request(f.app).get(`/api/v1${path}`).set('Authorization', bearer()).timeout({ deadline: 5_000 });
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ error: 'Internal server error' });
  expect(f.db.session.findUnique).toHaveBeenCalledTimes(1);
  expect(f.errors).toEqual([failure]);
});

it.each(['cancel', 'close'] as const)('forwards an unhandled %s lookup/service rejection without replaying the command', async (kind) => {
  const f = fixture();
  const failure = new Error('fixture operation unavailable');
  const failingRead = kind === 'cancel' ? f.positions.cancelOrder : f.db.futuresPosition.findUnique;
  failingRead.mockRejectedValueOnce(failure);
  const operation = kind === 'cancel'
    ? request(f.app).delete('/api/v1/futures/orders/fixture-order')
    : request(f.app).post('/api/v1/futures/positions/fixture-position/close');
  const response = await operation.set('Authorization', bearer()).timeout({ deadline: 5_000 });
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ error: 'Internal server error' });
  expect(failingRead).toHaveBeenCalledTimes(1);
  expect(f.positions.placeOrder).not.toHaveBeenCalled();
  expect(f.errors).toEqual([failure]);
});

it('also forwards an API-key database rejection before the route handler', async () => {
  const f = fixture();
  const failure = new Error('fixture API-key lookup unavailable');
  f.db.apiKey.findUnique.mockRejectedValueOnce(failure);
  const response = await request(f.app).get('/api/v1/futures/balances')
    .set('X-API-KEY', 'fixture-public-key').set('X-API-TIMESTAMP', String(Date.now()))
    .set('X-API-SIGNATURE', '0'.repeat(64)).timeout({ deadline: 5_000 });
  expect(response.status).toBe(500);
  expect(response.body).toEqual({ error: 'Internal server error' });
  expect(f.db.futuresBalance.findMany).not.toHaveBeenCalled();
  expect(f.errors).toEqual([failure]);
});

it('preserves missing-token 401 and unavailable-session 503 without entering an account read', async () => {
  const f = fixture();
  expect((await request(f.app).get('/api/v1/futures/balances')).status).toBe(401);
  f.db.session.findUnique.mockRejectedValueOnce(new Error('fixture session store unavailable'));
  const response = await request(f.app).get('/api/v1/futures/balances').set('Authorization', bearer());
  expect(response.status).toBe(503);
  expect(response.body).toEqual({ error: 'Authentication temporarily unavailable' });
  expect(f.db.futuresBalance.findMany).not.toHaveBeenCalled();
  expect(f.errors).toEqual([]);
});

it('preserves existing handled order errors and missing-position responses', async () => {
  const f = fixture();
  f.positions.placeOrder.mockRejectedValueOnce(new Error('fixture insufficient margin'));
  const placed = await request(f.app).post('/api/v1/futures/orders').set('Authorization', bearer())
    .send({ symbol: 'BTC/USDT', side: 'BUY', type: 'MARKET', quantity: '1', leverage: 2, marginType: 'ISOLATED' });
  expect(placed.status).toBe(400);
  expect(placed.body).toEqual({ error: 'fixture insufficient margin' });
  const closed = await request(f.app).post('/api/v1/futures/positions/fixture-position/close').set('Authorization', bearer());
  expect(closed.status).toBe(404);
  expect(closed.body).toEqual({ error: 'Position not found or not open' });
  expect(f.positions.placeOrder).toHaveBeenCalledTimes(1);
  expect(f.errors).toEqual([]);
});

it('preserves successful public and authenticated read payloads', async () => {
  const f = fixture();
  expect((await request(f.app).get('/api/v1/futures/funding-rate/BTC-USDT')).body)
    .toEqual({ symbol: 'BTC/USDT', history: [] });
  const balances = await request(f.app).get('/api/v1/futures/balances').set('Authorization', bearer());
  expect(balances.status).toBe(200);
  expect(balances.body).toEqual([]);
  expect(f.errors).toEqual([]);
});
