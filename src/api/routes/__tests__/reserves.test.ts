process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { reservesRouter } from '../reserves';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', reservesRouter(prisma));
  return app;
}

describe('GET /reserves', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV, JWT_SECRET: 'test-secret-at-least-this-long' };
    delete process.env.BITCOIN_TREASURY_ADDRESS;
    delete process.env.TRON_TREASURY_ADDRESS;
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('requires authentication', async () => {
    const prisma = { balance: { findMany: jest.fn() } } as any;
    const app = buildApp(prisma);
    const res = await request(app).get('/api/v1/reserves');
    expect(res.status).toBe(401);
  });

  it('returns an empty list when no treasury chains are configured', async () => {
    const prisma = { balance: { findMany: jest.fn() } } as any;
    const app = buildApp(prisma);
    const res = await request(app).get('/api/v1/reserves').set('Authorization', authHeader('user-1'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
