process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { portfolioRouter } from '../portfolio';
import { ADMIN_PROFILE_EMAIL } from '../../../services/AdminPortfolioProfile';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

const OVERVIEW = {
  real: { spot: [], futures: [], spotValueUsd: 0, futuresValueUsd: 0, totalValueUsd: 0 },
  presentation: null,
  displayTotalUsd: 0,
  btcPriceUsd: 1,
};

function buildApp(prisma: any, service: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', portfolioRouter(prisma, service));
  return app;
}

function prismaFor(user: { role: string; email: string } | null) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(user ? { id: 'u1', ...user } : null) },
    session: { findUnique: jest.fn().mockResolvedValue({ revokedAt: null }) },
  } as any;
}

function serviceStub() {
  return {
    overview: jest.fn().mockResolvedValue(OVERVIEW),
    performance: jest.fn().mockResolvedValue({ periods: {}, ageDays: 0, startedOn: null }),
  } as any;
}

describe('wallet portfolio routes — access', () => {
  for (const path of ['/api/v1/wallet/overview', '/api/v1/wallet/performance']) {
    it(`refuses an anonymous caller on ${path}`, async () => {
      const service = serviceStub();
      const res = await request(buildApp(prismaFor({ role: 'ADMIN', email: ADMIN_PROFILE_EMAIL }), service)).get(path);
      expect(res.status).toBe(401);
      expect(service.overview).not.toHaveBeenCalled();
      expect(service.performance).not.toHaveBeenCalled();
    });
  }

  it('serves a signed-in ordinary user their own overview', async () => {
    const service = serviceStub();
    const res = await request(buildApp(prismaFor({ role: 'USER', email: 'trader@example.com' }), service))
      .get('/api/v1/wallet/overview')
      .set('Authorization', authHeader('u1'));
    expect(res.status).toBe(200);
    expect(res.body.presentation).toBeNull();
  });

  it('reads role and email from the database, never from the token', async () => {
    const service = serviceStub();
    // A token that *claims* to be the profile account changes nothing: the
    // row the server loads is what is passed to the service.
    const forged = `Bearer ${jwt.sign({ sub: 'u1', role: 'ADMIN', email: ADMIN_PROFILE_EMAIL }, process.env.JWT_SECRET!)}`;
    await request(buildApp(prismaFor({ role: 'USER', email: 'trader@example.com' }), service))
      .get('/api/v1/wallet/overview')
      .set('Authorization', forged);
    expect(service.overview).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'USER', email: 'trader@example.com' })
    );
  });

  it('401s when the authenticated id no longer resolves to an account', async () => {
    const service = serviceStub();
    const prisma = prismaFor(null);
    // requireAuth itself rejects a vanished user; either way nothing is served.
    const res = await request(buildApp(prisma, service))
      .get('/api/v1/wallet/overview')
      .set('Authorization', authHeader('u-gone'));
    expect(res.status).toBe(401);
    expect(service.overview).not.toHaveBeenCalled();
  });

  it('reports the service missing rather than guessing when it is not wired', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/v1', portfolioRouter(prismaFor({ role: 'USER', email: 'a@b.c' })));
    const res = await request(app).get('/api/v1/wallet/overview').set('Authorization', authHeader('u1'));
    expect(res.status).toBe(503);
  });
});
