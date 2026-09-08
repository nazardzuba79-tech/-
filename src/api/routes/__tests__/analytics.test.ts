process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { analyticsRouter } from '../analytics';

/**
 * The access policy is the subject of this suite.
 *
 * `/analytics/overview` used to be admin-only, for two reasons: the page
 * was an admin placeholder, and the payload carried provider circuit
 * state. Analytics is now an ordinary exchange feature, so the gate moved
 * to where the sensitive data actually is rather than being dropped:
 *
 *   /analytics/overview     — any signed-in user, still never anonymous.
 *   /analytics/diagnostics  — ADMIN ONLY, provider health.
 *
 * Both halves are asserted below, including that a non-admin cannot reach
 * diagnostics and that the service is not even consulted when they try.
 */

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

const SNAPSHOT = {
  generatedAt: 1_800_000_000_000,
  contracts: ['BTC/USDT'],
  sections: {
    marketOverview: {
      available: true,
      source: 'coingecko',
      fetchedAt: 1_800_000_000_000,
      stale: false,
      value: { totalMarketCapUsd: 1, totalVolume24hUsd: 2, btcDominancePercent: 3, ethDominancePercent: 4, marketCapChangePercent24h: 5 },
    },
    sentiment: { available: false, reason: 'provider_unavailable', detail: 'unavailable' },
    derivatives: {
      available: true,
      source: 'voltex',
      fetchedAt: 1_800_000_000_000,
      stale: false,
      value: {
        scope: 'venue',
        intervalHours: 8,
        nextSettlementAt: 1_800_000_100_000,
        contracts: [
          { symbol: 'BTC/USDT', markPrice: '60000', indexPrice: '59990', openInterestBase: '0', openInterestUsd: '0', fundingRate: null, fundingAppliedAt: null },
        ],
      },
    },
  },
  unsupported: {
    liquidations: { available: false, reason: 'unsupported_metric', detail: 'no feed' },
  },
};

const DIAGNOSTICS = {
  providers: [{ provider: 'kraken', state: 'CLOSED', healthy: true, consecutiveFailures: 0, lastSuccessAt: 1, lastFailureAt: null, cooldownUntil: null, rateLimitHits: 0 }],
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
  function service() {
    return {
      getSnapshot: jest.fn().mockResolvedValue(SNAPSHOT),
      getDiagnostics: jest.fn().mockReturnValue(DIAGNOSTICS),
    } as any;
  }

  // ── /analytics/overview ────────────────────────────────────────────

  it('rejects an anonymous caller — Analytics is a signed-in feature, not public', async () => {
    const svc = service();
    const res = await request(buildApp(prismaFor('USER'), svc)).get('/api/v1/analytics/overview');
    expect(res.status).toBe(401);
    expect(svc.getSnapshot).not.toHaveBeenCalled();
  });

  it('serves an ordinary signed-in user — no longer admin-gated', async () => {
    const svc = service();
    const res = await request(buildApp(prismaFor('USER'), svc))
      .get('/api/v1/analytics/overview')
      .set('Authorization', authHeader('u1'));

    expect(res.status).toBe(200);
    expect(res.body.sections.marketOverview.available).toBe(true);
    expect(svc.getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('serves an admin the same payload — no privileged extras', async () => {
    const res = await request(buildApp(prismaFor('ADMIN'), service()))
      .get('/api/v1/analytics/overview')
      .set('Authorization', authHeader('a1'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(SNAPSHOT);
    expect(res.body).not.toHaveProperty('providers');
  });

  it('carries source and freshness on an available section', async () => {
    const res = await request(buildApp(prismaFor('USER'), service()))
      .get('/api/v1/analytics/overview')
      .set('Authorization', authHeader('u1'));

    expect(res.body.sections.marketOverview.source).toBe('coingecko');
    expect(typeof res.body.sections.marketOverview.fetchedAt).toBe('number');
    expect(res.body.sections.marketOverview.stale).toBe(false);
  });

  it('sends an unavailable section with NO value-carrying fields', async () => {
    const res = await request(buildApp(prismaFor('USER'), service()))
      .get('/api/v1/analytics/overview')
      .set('Authorization', authHeader('u1'));

    expect(Object.keys(res.body.sections.sentiment).sort()).toEqual(['available', 'detail', 'reason']);
    expect(res.body.sections.sentiment).not.toHaveProperty('value');
  });

  it('preserves a real zero through the wire', async () => {
    const res = await request(buildApp(prismaFor('USER'), service()))
      .get('/api/v1/analytics/overview')
      .set('Authorization', authHeader('u1'));

    const contract = res.body.sections.derivatives.value.contracts[0];
    // Real zero open interest survives as "0"...
    expect(contract.openInterestBase).toBe('0');
    // ...while an unsettled funding rate stays null rather than becoming 0.
    expect(contract.fundingRate).toBeNull();
  });

  it('labels derivatives as this venue only', async () => {
    const res = await request(buildApp(prismaFor('USER'), service()))
      .get('/api/v1/analytics/overview')
      .set('Authorization', authHeader('u1'));

    expect(res.body.sections.derivatives.value.scope).toBe('venue');
    expect(res.body.sections.derivatives.source).toBe('voltex');
  });

  it('does not leak internals when the snapshot itself fails', async () => {
    const svc = service();
    svc.getSnapshot.mockRejectedValue(new Error('secret internal detail'));
    const res = await request(buildApp(prismaFor('USER'), svc))
      .get('/api/v1/analytics/overview')
      .set('Authorization', authHeader('u1'));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });

  // ── /analytics/diagnostics ─────────────────────────────────────────

  it('keeps provider health admin-only', async () => {
    const svc = service();

    const anon = await request(buildApp(prismaFor('ADMIN'), svc)).get('/api/v1/analytics/diagnostics');
    expect(anon.status).toBe(401);

    const user = await request(buildApp(prismaFor('USER'), svc))
      .get('/api/v1/analytics/diagnostics')
      .set('Authorization', authHeader('u1'));
    expect(user.status).toBe(403);

    // Not merely filtered out of the response — never computed.
    expect(svc.getDiagnostics).not.toHaveBeenCalled();

    const admin = await request(buildApp(prismaFor('ADMIN'), svc))
      .get('/api/v1/analytics/diagnostics')
      .set('Authorization', authHeader('a1'));
    expect(admin.status).toBe(200);
    expect(admin.body.providers[0].provider).toBe('kraken');
  });

  it('never exposes rate-limit or cooldown internals on the user-facing route', async () => {
    const res = await request(buildApp(prismaFor('USER'), service()))
      .get('/api/v1/analytics/overview')
      .set('Authorization', authHeader('u1'));

    const body = JSON.stringify(res.body);
    expect(body).not.toContain('rateLimitHits');
    expect(body).not.toContain('cooldownUntil');
    expect(body).not.toContain('consecutiveFailures');
  });
});
