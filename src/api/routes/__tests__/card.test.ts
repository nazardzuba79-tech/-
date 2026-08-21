process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { cardRouter } from '../card';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', cardRouter(prisma));
  return app;
}

describe('GET /card/waitlist/me', () => {
  it('reports not joined for a user who has not joined', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ cardWaitlistJoinedAt: null, kycStatus: 'NOT_STARTED' }) } } as any;
    const app = buildApp(prisma);

    const res = await request(app).get('/api/v1/card/waitlist/me').set('Authorization', authHeader('user-1'));

    expect(res.status).toBe(200);
    expect(res.body.joined).toBe(false);
  });
});

describe('POST /card/waitlist/join', () => {
  it('rejects joining without approved KYC', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', kycStatus: 'PENDING', cardWaitlistJoinedAt: null }) } } as any;
    const app = buildApp(prisma);

    const res = await request(app).post('/api/v1/card/waitlist/join').set('Authorization', authHeader('user-1'));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/approved identity verification/i);
  });

  it('joins the waitlist for a KYC-approved user', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1', kycStatus: 'APPROVED', cardWaitlistJoinedAt: null }),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    } as any;
    const app = buildApp(prisma);

    const res = await request(app).post('/api/v1/card/waitlist/join').set('Authorization', authHeader('user-1'));

    expect(res.status).toBe(200);
    expect(res.body.joined).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } })
    );
  });

  it('is idempotent: joining twice does not re-write the timestamp', async () => {
    const existingJoinedAt = new Date('2026-01-01');
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1', kycStatus: 'APPROVED', cardWaitlistJoinedAt: existingJoinedAt }),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    } as any;
    const app = buildApp(prisma);

    const res = await request(app).post('/api/v1/card/waitlist/join').set('Authorization', authHeader('user-1'));

    expect(res.status).toBe(200);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
