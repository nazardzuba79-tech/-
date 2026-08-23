process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { adminWithdrawalsRouter } from '../adminWithdrawals';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', adminWithdrawalsRouter(prisma));
  return app;
}

function adminPrisma(overrides: any = {}) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue({ isAdmin: true }) },
    withdrawal: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

function withTransaction(prisma: any, opts: { balance?: any; withdrawal?: any } = {}) {
  const balanceState = opts.balance ? { ...opts.balance } : null;
  const tx = {
    balance: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(balanceState)),
      update: jest.fn().mockImplementation(({ data }: any) => {
        if (balanceState) Object.assign(balanceState, data);
        return Promise.resolve(balanceState);
      }),
    },
    withdrawal: {
      findUnique: jest.fn().mockResolvedValue(opts.withdrawal ?? null),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...opts.withdrawal, ...data })),
    },
    auditLog: { create: jest.fn() },
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(tx));
  return prisma;
}

describe('admin withdrawals routes', () => {
  describe('GET /admin/withdrawals', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ isAdmin: false }) } });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/withdrawals').set('Authorization', authHeader('u1'));
      expect(res.status).toBe(403);
    });

    it("lists every user's withdrawal requests with their email joined", async () => {
      const prisma = adminPrisma({
        withdrawal: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'w1',
              userId: 'user-1',
              user: { email: 'alice@team.com' },
              asset: 'USDT',
              network: 'TRC20',
              toAddress: 'Tabc',
              amount: { toString: () => '10' },
              status: 'PENDING',
              rejectionReason: null,
              createdAt: new Date('2026-01-01'),
            },
          ]),
        },
      });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/withdrawals').set('Authorization', authHeader('admin-1'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual([expect.objectContaining({ userEmail: 'alice@team.com', amount: '10', status: 'PENDING' })]);
    });
  });

  describe('POST /admin/withdrawals/:id/complete', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ isAdmin: false }) } });
      const app = buildApp(prisma);
      const res = await request(app).post('/api/v1/admin/withdrawals/w1/complete').set('Authorization', authHeader('u1'));
      expect(res.status).toBe(403);
    });

    it('404s an unknown withdrawal id', async () => {
      const prisma = withTransaction(adminPrisma(), { withdrawal: null });
      const app = buildApp(prisma);
      const res = await request(app).post('/api/v1/admin/withdrawals/nope/complete').set('Authorization', authHeader('admin-1'));
      expect(res.status).toBe(400);
    });

    it('completes a pending withdrawal', async () => {
      const prisma = withTransaction(adminPrisma(), {
        balance: { available: '60', locked: '40' },
        withdrawal: { id: 'w1', userId: 'user-1', asset: 'USDT', amount: '40', status: 'PENDING' },
      });
      const app = buildApp(prisma);
      const res = await request(app).post('/api/v1/admin/withdrawals/w1/complete').set('Authorization', authHeader('admin-1'));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'COMPLETED' });
    });
  });

  describe('POST /admin/withdrawals/:id/reject', () => {
    it('rejects a pending withdrawal and refunds the balance', async () => {
      const prisma = withTransaction(adminPrisma(), {
        balance: { available: '60', locked: '40' },
        withdrawal: { id: 'w1', userId: 'user-1', asset: 'USDT', amount: '40', status: 'PENDING' },
      });
      const app = buildApp(prisma);
      const res = await request(app)
        .post('/api/v1/admin/withdrawals/w1/reject')
        .set('Authorization', authHeader('admin-1'))
        .send({ reason: 'suspicious address' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'REJECTED' });
    });
  });
});
