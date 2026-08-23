process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { adminUsersRouter } from '../adminUsers';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', adminUsersRouter(prisma));
  return app;
}

function adminPrisma(overrides: any = {}) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }), findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    balance: { findMany: jest.fn().mockResolvedValue([]) },
    deposit: { findMany: jest.fn().mockResolvedValue([]) },
    withdrawal: { findMany: jest.fn().mockResolvedValue([]) },
    order: { findMany: jest.fn().mockResolvedValue([]) },
    purchase: { findMany: jest.fn().mockResolvedValue([]) },
    kycSubmission: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

describe('admin users routes', () => {
  describe('GET /admin/users', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/users').set('Authorization', authHeader('u1'));
      expect(res.status).toBe(403);
    });

    it('lists every user with their registration IP and balances joined', async () => {
      const prisma = adminPrisma({
        user: {
          findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }),
          findMany: jest.fn().mockResolvedValue([
            { id: 'user-1', email: 'alice@team.com', role: 'USER', kycStatus: 'APPROVED', createdAt: new Date('2026-01-01') },
          ]),
        },
        auditLog: {
          findMany: jest.fn().mockResolvedValue([
            { userId: 'user-1', action: 'USER_REGISTERED', metadata: { ip: '1.2.3.4' }, createdAt: new Date('2026-01-01') },
          ]),
          findFirst: jest.fn(),
        },
        balance: {
          findMany: jest.fn().mockResolvedValue([
            { userId: 'user-1', asset: 'BTC', available: { toString: () => '0.5' }, locked: { toString: () => '0' } },
          ]),
        },
      });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/users').set('Authorization', authHeader('admin-1'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        expect.objectContaining({
          email: 'alice@team.com',
          registrationIp: '1.2.3.4',
          balances: [{ asset: 'BTC', available: '0.5', locked: '0' }],
        }),
      ]);
    });

    it('passes the search query through as a case-insensitive email filter', async () => {
      const prisma = adminPrisma();
      const app = buildApp(prisma);
      await request(app).get('/api/v1/admin/users?search=alice').set('Authorization', authHeader('admin-1'));

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: { contains: 'alice', mode: 'insensitive' } } })
      );
    });
  });

  describe('GET /admin/users/:id', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/users/user-1').set('Authorization', authHeader('u1'));
      expect(res.status).toBe(403);
    });

    it('404s an unknown user id', async () => {
      const prisma = adminPrisma({
        user: { findUnique: jest.fn().mockResolvedValueOnce({ role: 'ADMIN' }).mockResolvedValueOnce(null) },
      });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/users/nope').set('Authorization', authHeader('admin-1'));
      expect(res.status).toBe(404);
    });

    it("returns the full client history: balances, deposits, withdrawals, orders, purchases, KYC", async () => {
      const prisma = adminPrisma({
        user: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce({ role: 'ADMIN' })
            .mockResolvedValueOnce({ id: 'user-1', email: 'alice@team.com', role: 'USER', kycStatus: 'APPROVED', createdAt: new Date('2026-01-01') }),
        },
        auditLog: { findFirst: jest.fn().mockResolvedValue({ metadata: { ip: '5.6.7.8' } }) },
        balance: { findMany: jest.fn().mockResolvedValue([{ asset: 'USDT', available: { toString: () => '100' }, locked: { toString: () => '0' } }]) },
        deposit: { findMany: jest.fn().mockResolvedValue([{ id: 'd1', asset: 'BTC', chain: 'bitcoin', txHash: 'a'.repeat(64), amount: { toString: () => '0.1' }, confirmations: 3, status: 'CREDITED', createdAt: new Date() }]) },
        withdrawal: { findMany: jest.fn().mockResolvedValue([{ id: 'w1', asset: 'USDT', network: 'TRC20', toAddress: 'T1', amount: { toString: () => '50' }, status: 'SENT', txHash: 'tx1', rejectionReason: null, createdAt: new Date() }]) },
        order: { findMany: jest.fn().mockResolvedValue([{ id: 'o1', pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', price: { toString: () => '50000' }, originalQuantity: { toString: () => '1' }, remainingQuantity: { toString: () => '0' }, status: 'FILLED', createdAt: new Date() }]) },
        purchase: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', product: { name: 'VIP Card' }, amount: { toString: () => '10' }, asset: 'USDT', status: 'FULFILLED', createdAt: new Date() }]) },
        kycSubmission: { findMany: jest.fn().mockResolvedValue([{ id: 'k1', country: 'UA', fullName: 'Alice', dateOfBirth: new Date('1990-01-01'), documentType: 'PASSPORT', documentNumber: 'AA1', status: 'APPROVED', rejectionReason: null, reviewedBy: 'admin-1', reviewedAt: new Date(), createdAt: new Date() }]) },
      });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/users/user-1').set('Authorization', authHeader('admin-1'));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        email: 'alice@team.com',
        registrationIp: '5.6.7.8',
        balances: [{ asset: 'USDT', available: '100', locked: '0' }],
        deposits: [expect.objectContaining({ id: 'd1', asset: 'BTC' })],
        withdrawals: [expect.objectContaining({ id: 'w1', status: 'SENT', txHash: 'tx1' })],
        orders: [expect.objectContaining({ id: 'o1', pair: 'BTC/USDT' })],
        purchases: [expect.objectContaining({ productName: 'VIP Card' })],
        kycSubmissions: [expect.objectContaining({ id: 'k1', fullName: 'Alice' })],
      });
    });
  });
});
