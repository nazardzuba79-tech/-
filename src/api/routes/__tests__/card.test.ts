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
  app.use('/api/v1', cardRouter(prisma, { pricesFor: async () => new Map() }));
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
  it('retires legacy joining without mutating KYC-pending accounts', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', kycStatus: 'PENDING', cardWaitlistJoinedAt: null }) } } as any;
    const app = buildApp(prisma);

    const res = await request(app).post('/api/v1/card/waitlist/join').set('Authorization', authHeader('user-1'));

    expect(res.status).toBe(410);
    expect(res.body.error).toBe('CARD_APPLICATION_REQUIRED');
  });

  it('does not create new waitlist entries even for KYC-approved users', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1', kycStatus: 'APPROVED', cardWaitlistJoinedAt: null }),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    } as any;
    const app = buildApp(prisma);

    const res = await request(app).post('/api/v1/card/waitlist/join').set('Authorization', authHeader('user-1'));

    expect(res.status).toBe(410);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
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

    expect(res.status).toBe(410);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
