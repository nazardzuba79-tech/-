process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { adminRouter } from '../admin';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', adminRouter(prisma));
  return app;
}

describe('GET /admin/clients', () => {
  it('requires an admin account', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } } as any;
    const app = buildApp(prisma);

    const res = await request(app).get('/api/v1/admin/clients').set('Authorization', authHeader('user-1'));

    expect(res.status).toBe(403);
  });

  it('returns every client, each paired with their latest KYC submission', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'user-1', email: 'verified@team.com', role: 'USER', kycStatus: 'APPROVED', createdAt: new Date('2026-01-01') },
          { id: 'user-2', email: 'new@team.com', role: 'USER', kycStatus: 'NOT_STARTED', createdAt: new Date('2026-02-01') },
        ]),
      },
      kycSubmission: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'sub-2',
            userId: 'user-1',
            country: 'UA',
            fullName: 'Alice',
            dateOfBirth: new Date('1990-01-01'),
            documentType: 'PASSPORT',
            documentNumber: 'AA1',
            status: 'APPROVED',
            rejectionReason: null,
            createdAt: new Date('2026-01-05'),
          },
          {
            id: 'sub-1',
            userId: 'user-1',
            country: 'UA',
            fullName: 'Alice',
            dateOfBirth: new Date('1990-01-01'),
            documentType: 'PASSPORT',
            documentNumber: 'AA1',
            status: 'REJECTED',
            rejectionReason: 'Blurry',
            createdAt: new Date('2026-01-02'),
          },
        ]),
      },
    } as any;
    const app = buildApp(prisma);

    const res = await request(app).get('/api/v1/admin/clients').set('Authorization', authHeader('admin-1'));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const alice = res.body.find((c: any) => c.id === 'user-1');
    expect(alice.latestKyc.id).toBe('sub-2');
    expect(alice.latestKyc.status).toBe('APPROVED');

    const noKyc = res.body.find((c: any) => c.id === 'user-2');
    expect(noKyc.latestKyc).toBeNull();
  });
});
