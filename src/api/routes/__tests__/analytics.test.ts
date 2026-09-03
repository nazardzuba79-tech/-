process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { analyticsRouter } from '../analytics';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

const SNAPSHOT = {
  generatedAt: 1_800_000_000_000,
  sections: {
    marketOverview: { available: true, totalMarketCapUsd: 1, totalVolume24hUsd: 2, btcDominancePercent: 3, ethDominancePercent: 4, marketCapChangePercent24h: 5, source: 'coingecko' },
    liquidations: { available: false, reason: 'unsupported_metric', detail: 'no feed' },
  },
  providers: [{ provider: 'kraken', state: 'CLOSED', healthy: true, lastSuccessAt: 1, rateLimitHits: 0 }],
};

function buildApp(prisma: any, service: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', analyticsRouter(prisma, service));
  return app;
}

function prismaFor(role: string | null) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(role ? { role } : null) },
    session: { findUnique: jest.fn().mockResolvedValue({ revokedAt: null }) },
  } as any;
}

describe('analytics route', () => {
  const service = { getSnapshot: jest.fn().mockResolvedValue(SNAPSHOT) } as any;

  beforeEach(() => service.getSnapshot.mockClear());

  it('rejects an unauthenticated caller — analytics data is never public', async () => {
    const res = await request(buildApp(prismaFor('ADMIN'), service)).get('/api/v1/analytics/overview');
    expect(res.status).toBe(401);
    expect(service.getSnapshot).not.toHaveBeenCalled();
  });

  it('rejects an ordinary signed-in user, matching the page\'s own admin gate', async () => {
    const res = await request(buildApp(prismaFor('USER'), service))
      .get('/api/v1/analytics/overview')
      .set('Authorization', authHeader('u1'));

    expect(res.status).toBe(403);
    expect(service.getSnapshot).not.toHaveBeenCalled();
  });

  it('returns the snapshot, availability metadata included, for an admin', async () => {
    const res = await request(buildApp(prismaFor('ADMIN'), service))
      .get('/api/v1/analytics/overview')
      .set('Authorization', authHeader('admin-1'));

    expect(res.status).toBe(200);
    expect(res.body.sections.marketOverview.available).toBe(true);
    expect(res.body.sections.liquidations).toMatchObject({ available: false, reason: 'unsupported_metric' });
  });

  it('does not leak internals when the snapshot itself fails', async () => {
    const failing = { getSnapshot: jest.fn().mockRejectedValue(new Error('secret internal detail')) } as any;
    const res = await request(buildApp(prismaFor('ADMIN'), failing))
      .get('/api/v1/analytics/overview')
      .set('Authorization', authHeader('admin-1'));

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret internal detail');
  });
});
