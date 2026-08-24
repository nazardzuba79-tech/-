process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { portfolioRouter } from '../portfolio';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', portfolioRouter(prisma));
  return app;
}

describe('portfolio routes', () => {
  describe('POST /wallet/portfolio-snapshot', () => {
    it('requires authentication', async () => {
      const app = buildApp({ portfolioSnapshot: { findFirst: jest.fn(), create: jest.fn() } });
      const res = await request(app).post('/api/v1/wallet/portfolio-snapshot').send({ totalValueUsd: '1000' });
      expect(res.status).toBe(401);
    });

    it('rejects a non-numeric totalValueUsd', async () => {
      const app = buildApp({ portfolioSnapshot: { findFirst: jest.fn(), create: jest.fn() } });
      const res = await request(app)
        .post('/api/v1/wallet/portfolio-snapshot')
        .set('Authorization', authHeader('u1'))
        .send({ totalValueUsd: 'not-a-number' });
      expect(res.status).toBe(400);
    });

    it('records a snapshot when none exists yet', async () => {
      const create = jest.fn();
      const app = buildApp({ portfolioSnapshot: { findFirst: jest.fn().mockResolvedValue(null), create } });

      const res = await request(app)
        .post('/api/v1/wallet/portfolio-snapshot')
        .set('Authorization', authHeader('u1'))
        .send({ totalValueUsd: '1234.56' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ recorded: true });
      expect(create).toHaveBeenCalledWith({ data: { userId: 'u1', totalValueUsd: '1234.56' } });
    });

    it('does not record a second snapshot the same UTC day', async () => {
      const create = jest.fn();
      const now = new Date();
      const app = buildApp({
        portfolioSnapshot: { findFirst: jest.fn().mockResolvedValue({ createdAt: now }), create },
      });

      const res = await request(app)
        .post('/api/v1/wallet/portfolio-snapshot')
        .set('Authorization', authHeader('u1'))
        .send({ totalValueUsd: '999' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ recorded: false });
      expect(create).not.toHaveBeenCalled();
    });

    it('records a new snapshot once the UTC day has rolled over', async () => {
      const create = jest.fn();
      const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const app = buildApp({
        portfolioSnapshot: { findFirst: jest.fn().mockResolvedValue({ createdAt: yesterday }), create },
      });

      const res = await request(app)
        .post('/api/v1/wallet/portfolio-snapshot')
        .set('Authorization', authHeader('u1'))
        .send({ totalValueUsd: '999' });

      expect(res.body.recorded).toBe(true);
      expect(create).toHaveBeenCalled();
    });
  });

  describe('GET /wallet/portfolio-history', () => {
    it('requires authentication', async () => {
      const app = buildApp({ portfolioSnapshot: { findMany: jest.fn() } });
      const res = await request(app).get('/api/v1/wallet/portfolio-history');
      expect(res.status).toBe(401);
    });

    it('rejects an invalid range', async () => {
      const app = buildApp({ portfolioSnapshot: { findMany: jest.fn() } });
      const res = await request(app)
        .get('/api/v1/wallet/portfolio-history?range=1y')
        .set('Authorization', authHeader('u1'));
      expect(res.status).toBe(400);
    });

    it('returns the points for the requested range, scoped to the caller', async () => {
      const findMany = jest.fn().mockResolvedValue([
        { createdAt: new Date('2026-08-01'), totalValueUsd: { toString: () => '1000' } },
        { createdAt: new Date('2026-08-02'), totalValueUsd: { toString: () => '1050' } },
      ]);
      const app = buildApp({ portfolioSnapshot: { findMany } });

      const res = await request(app).get('/api/v1/wallet/portfolio-history?range=7d').set('Authorization', authHeader('u1'));

      expect(res.status).toBe(200);
      expect(res.body.points).toEqual([
        { date: '2026-08-01T00:00:00.000Z', totalValueUsd: '1000' },
        { date: '2026-08-02T00:00:00.000Z', totalValueUsd: '1050' },
      ]);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'u1' }), orderBy: { createdAt: 'asc' } })
      );
    });

    it('defaults to 30d when no range is given', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const app = buildApp({ portfolioSnapshot: { findMany } });

      const res = await request(app).get('/api/v1/wallet/portfolio-history').set('Authorization', authHeader('u1'));

      expect(res.status).toBe(200);
      expect(findMany).toHaveBeenCalled();
    });
  });
});
