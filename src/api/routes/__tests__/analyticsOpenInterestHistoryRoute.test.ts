process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { analyticsRouter } from '../analytics';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function prismaFor(role: string | null) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(role ? { role } : null) },
    session: { findUnique: jest.fn().mockResolvedValue({ revokedAt: null }) },
  } as any;
}

function app(role: string | null) {
  const server = express();
  server.use(express.json());
  server.use('/api/v1', analyticsRouter(prismaFor(role), {
    getSnapshot: jest.fn(),
    getDiagnostics: jest.fn(),
  } as any));
  return server;
}

describe('analytics open-interest history route', () => {
  test('is authenticated like the rest of user Analytics', async () => {
    const res = await request(app('USER')).get('/api/v1/analytics/open-interest-history?asset=BTC');
    expect(res.status).toBe(401);
  });

  test('rejects an authenticated request without an asset before touching a provider', async () => {
    const res = await request(app('USER'))
      .get('/api/v1/analytics/open-interest-history')
      .set('Authorization', authHeader('u1'));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'asset is required' });
  });
});
