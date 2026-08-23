process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { adminAuditLogRouter } from '../adminAuditLog';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', adminAuditLogRouter(prisma));
  return app;
}

function adminPrisma(overrides: any = {}) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }), findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

describe('admin audit log route', () => {
  it('requires an admin account', async () => {
    const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
    const app = buildApp(prisma);
    const res = await request(app).get('/api/v1/admin/audit-log').set('Authorization', authHeader('u1'));
    expect(res.status).toBe(403);
  });

  it('resolves the affected user and acting admin to emails', async () => {
    const prisma = adminPrisma({
      auditLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'log-1',
            userId: 'user-1',
            action: 'WITHDRAWAL_REJECTED',
            metadata: { withdrawalId: 'w1', performedByAdminId: 'admin-1', reason: 'suspicious' },
            createdAt: new Date('2026-02-01'),
          },
          {
            id: 'log-2',
            userId: 'user-1',
            action: 'KYC_APPROVED',
            metadata: { submissionId: 's1', reviewedBy: 'admin-1' },
            createdAt: new Date('2026-01-15'),
          },
        ]),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'user-1', email: 'alice@team.com' },
          { id: 'admin-1', email: 'voltex.crypto@gmail.com' },
        ]),
      },
    });
    const app = buildApp(prisma);
    const res = await request(app).get('/api/v1/admin/audit-log').set('Authorization', authHeader('admin-1'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        id: 'log-1',
        userEmail: 'alice@team.com',
        action: 'WITHDRAWAL_REJECTED',
        performedByAdminEmail: 'voltex.crypto@gmail.com',
      }),
      expect.objectContaining({
        id: 'log-2',
        userEmail: 'alice@team.com',
        action: 'KYC_APPROVED',
        performedByAdminEmail: 'voltex.crypto@gmail.com',
      }),
    ]);
  });

  it('filters by action and userId query params', async () => {
    const prisma = adminPrisma();
    const app = buildApp(prisma);
    await request(app)
      .get('/api/v1/admin/audit-log?action=BALANCE_ADJUSTED&userId=user-1')
      .set('Authorization', authHeader('admin-1'));

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { action: 'BALANCE_ADJUSTED', userId: 'user-1' } })
    );
  });

  it('returns an empty list without querying users when there are no entries', async () => {
    const prisma = adminPrisma();
    const app = buildApp(prisma);
    const res = await request(app).get('/api/v1/admin/audit-log').set('Authorization', authHeader('admin-1'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
