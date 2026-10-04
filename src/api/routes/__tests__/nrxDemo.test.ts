process.env.JWT_SECRET = 'test-secret-at-least-this-long';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { nrxDemoRouter } from '../nrxDemo';
import { demoTradingRouter } from '../demoTrading';
import { NrxDemoError } from '../../../services/testMarkets/NrxDemoSales';
const id = '91b4b181-2ba2-4e56-9ffb-f9ca5f72e41e';
const token = (user = 'owner') => `Bearer ${jwt.sign({ sub: user }, process.env.JWT_SECRET!)}`;
const prisma = (role = 'ADMIN') => ({ user: { findUnique: jest.fn().mockResolvedValue({ role }) } });
function build(role = 'ADMIN', sales: any = { snapshot: jest.fn(), operation: jest.fn(), sell: jest.fn() }) {
  const app = express(); app.use(express.json()); app.use('/api/v1', nrxDemoRouter(prisma(role) as any, sales)); return app;
}
test('NRX endpoints require auth/admin and bind identity to the session', async () => {
  const sales = { snapshot: jest.fn().mockResolvedValue({}), operation: jest.fn().mockResolvedValue({ receipt: null }), sell: jest.fn().mockResolvedValue({ id }) };
  const app = build('ADMIN', sales);
  expect((await request(app).post('/api/v1/demo/nrx/sell').send({ requestId: id, quantity: '1' })).status).toBe(401);
  expect((await request(build('USER', sales)).post('/api/v1/demo/nrx/sell').set('Authorization', token('customer')).send({ requestId: id, quantity: '1' })).status).toBe(403);
  for (const injection of [{ userId: 'victim' }, { price: '9999' }, { simulation: 'NRX' }, { side: 'BUY' }, { type: 'LIMIT' }]) {
    expect((await request(app).post('/api/v1/demo/nrx/sell').set('Authorization', token()).send({ requestId: id, quantity: '1', ...injection })).status).toBe(400);
  }
  expect(sales.sell).not.toHaveBeenCalled();
  expect((await request(app).post('/api/v1/demo/nrx/sell').set('Authorization', token()).send({ requestId: id, quantity: '1' })).status).toBe(200);
  expect(sales.sell).toHaveBeenCalledWith({ userId: 'owner', requestId: id, quantity: '1' });
  expect((await request(app).get(`/api/v1/demo/nrx/sales/${id}?userId=victim`).set('Authorization', token())).status).toBe(200);
  expect(sales.operation).toHaveBeenCalledWith('owner', id);
});
test('only definitive 400 refusals carry the rejected outcome', async () => {
  for (const status of [400, 403, 409, 429, 503]) {
    const app = build('ADMIN', { sell: jest.fn().mockRejectedValue(new NrxDemoError('fixture refusal', status)) });
    const result = await request(app).post('/api/v1/demo/nrx/sell').set('Authorization', token()).send({ requestId: id, quantity: '1' });
    expect(result.status).toBe(status);
    expect(result.body.simulationOutcome).toBe(status === 400 ? 'REJECTED' : undefined);
  }
});
test('production router sends NRX through the same deletion-gated sell method', async () => {
  const gated = { sell: jest.fn().mockResolvedValue({ id }) };
  const app = express(); app.use(express.json()); app.use('/api/v1', demoTradingRouter(prisma() as any, {} as any, gated as any));
  expect((await request(app).post('/api/v1/demo/nrx/sell').set('Authorization', token()).send({ requestId: id, quantity: '2.5' })).status).toBe(200);
  expect(gated.sell).toHaveBeenCalledWith({ userId: 'owner', requestId: id, quantity: '2.5', simulation: 'NRX' });
});
