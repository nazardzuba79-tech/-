process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { adminUsersRouter } from '../adminUsers';
import { encryptAdminPassword } from '../../../services/AdminPasswordVault';
import { walletDelegate } from '../../../test-utils/walletDelegate';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId, sid: 'sid:' + userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any, demoTrading: any = { topUp: jest.fn().mockResolvedValue({ asset: 'BTC', available: '272', locked: '0' }) }) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', adminUsersRouter(prisma, demoTrading));
  return app;
}

function adminPrisma(overrides: any = {}) {
  return {
    session: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, userId: where.id.slice(4), lastSeenAt: new Date(), revokedAt: null })), groupBy: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    user: {
      findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      delete: jest.fn(),
    },
    auditLog: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      groupBy: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
    balance: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn(), deleteMany: jest.fn() },
    demoBalance: { findMany: jest.fn().mockResolvedValue([]) },
    deposit: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    withdrawal: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    order: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    futuresOrder: { count: jest.fn().mockResolvedValue(0) },
    futuresPosition: { count: jest.fn().mockResolvedValue(0) },
    futuresBalance: { deleteMany: jest.fn() },
    purchase: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    kycSubmission: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
    apiKey: { deleteMany: jest.fn() },
    wallet: { deleteMany: jest.fn() },
    supportConversation: { updateMany: jest.fn() },
    $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    ...overrides,
  };
}

function withBalanceTransaction(prisma: any, opts: { balance?: { available: string; locked: string } | null } = {}) {
  const rows = new Map(opts.balance ? [['user-1:USDT', { ...opts.balance }]] : []);
  const audits: any[] = [];
  const tx = {
    balance: walletDelegate(rows),
    auditLog: { create: jest.fn(async ({ data }: any) => { audits.push(data); return data; }) },
  };
  prisma.$transaction = jest.fn(async (fn: any) => {
    const before = new Map([...rows].map(([key, row]) => [key, { ...row }]));
    const auditCount = audits.length;
    try { return await fn(tx); } catch (error) {
      rows.clear(); before.forEach((row, key) => rows.set(key, row));
      audits.length = auditCount;
      throw error;
    }
  });
  return { prisma, tx, rows, audits };
}

describe('admin users routes', () => {
  describe('GET /admin/users', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/users').set('Authorization', authHeader('u1'));
      expect(res.status).toBe(403);
    });

    it('lists customers with balances and does not expose infrastructure IP', async () => {
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
          groupBy: jest.fn().mockResolvedValue([]),
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
          registrationIp: null,
          balances: [{ asset: 'BTC', available: '0.5', locked: '0' }],
        }),
      ]);
    });

    it('passes the search query through as a case-insensitive email filter', async () => {
      const prisma = adminPrisma();
      const app = buildApp(prisma);
      await request(app).get('/api/v1/admin/users?search=alice').set('Authorization', authHeader('admin-1'));

      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { role: 'USER', email: { contains: 'alice', mode: 'insensitive' } } })
      );
    });

    it('returns stored passwords only to the configured owner, with no ciphertext or cache', async () => {
      const previousOwner = process.env.PRIVATE_TRADING_OWNER_ID;
      const previousKey = process.env.API_KEY_ENCRYPTION_SECRET;
      process.env.PRIVATE_TRADING_OWNER_ID = 'owner-admin';
      process.env.API_KEY_ENCRYPTION_SECRET = '1'.repeat(64);
      try {
        const encryptedPassword = encryptAdminPassword('ExampleTestPassword123', 'alice@team.com');
        const prisma = adminPrisma({
          user: {
            findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }),
            findMany: jest.fn().mockResolvedValue([
              { id: 'new-user', email: 'alice@team.com', role: 'USER', createdAt: new Date(), kycStatus: 'NOT_STARTED' },
              { id: 'old-user', email: 'old@team.com', role: 'USER', createdAt: new Date(), kycStatus: 'NOT_STARTED' },
            ]),
          },
          adminPasswordVault: {
            findMany: jest.fn().mockResolvedValue([{ userId: 'new-user', encryptedPassword }]),
          },
        });
        const app = buildApp(prisma);
        const owner = await request(app).get('/api/v1/admin/users').set('Authorization', authHeader('owner-admin'));
        expect(owner.status).toBe(200);
        expect(owner.headers['cache-control']).toContain('no-store');
        expect(owner.body.map((row: any) => row.password)).toEqual(['ExampleTestPassword123', null]);
        expect(JSON.stringify(owner.body)).not.toContain(encryptedPassword);
        const other = await request(app).get('/api/v1/admin/users').set('Authorization', authHeader('other-admin'));
        expect(other.status).toBe(200);
        expect(other.body.map((row: any) => row.password)).toEqual([null, null]);
        expect(prisma.adminPasswordVault.findMany).toHaveBeenCalledTimes(1);
      } finally {
        if (previousOwner === undefined) delete process.env.PRIVATE_TRADING_OWNER_ID;
        else process.env.PRIVATE_TRADING_OWNER_ID = previousOwner;
        if (previousKey === undefined) delete process.env.API_KEY_ENCRYPTION_SECRET;
        else process.env.API_KEY_ENCRYPTION_SECRET = previousKey;
      }
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
        kycSubmission: { findMany: jest.fn().mockResolvedValue([{ id: 'k1', country: 'UA', fullName: 'Alice', dateOfBirth: new Date('1990-01-01'), documentType: 'PASSPORT', status: 'APPROVED', rejectionReason: null, reviewedBy: 'admin-1', reviewedAt: new Date(), createdAt: new Date() }]) },
      });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/users/user-1').set('Authorization', authHeader('admin-1'));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        email: 'alice@team.com',
        registrationIp: null,
        balances: [{ asset: 'USDT', available: '100', locked: '0' }],
        deposits: [expect.objectContaining({ id: 'd1', asset: 'BTC' })],
        withdrawals: [expect.objectContaining({ id: 'w1', status: 'SENT', txHash: 'tx1' })],
        orders: [expect.objectContaining({ id: 'o1', pair: 'BTC/USDT' })],
        purchases: [expect.objectContaining({ productName: 'VIP Card' })],
        kycSubmissions: [expect.objectContaining({ id: 'k1', fullName: 'Alice' })],
      });
    });
  });

  describe('POST /admin/users/:id/adjust-balance', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app)
        .post('/api/v1/admin/users/user-1/adjust-balance')
        .set('Authorization', authHeader('u1'))
        .send({ asset: 'USDT', amount: '10', reason: 'test' });
      expect(res.status).toBe(403);
    });

    it('rejects a missing reason', async () => {
      const prisma = adminPrisma();
      const app = buildApp(prisma);
      const res = await request(app)
        .post('/api/v1/admin/users/user-1/adjust-balance')
        .set('Authorization', authHeader('admin-1'))
        .send({ asset: 'USDT', amount: '10' });
      expect(res.status).toBe(400);
    });

    it('applies the adjustment and returns the new balance', async () => {
      const prisma = adminPrisma();
      withBalanceTransaction(prisma, { balance: { available: '100', locked: '0' } });
      const app = buildApp(prisma);

      const res = await request(app)
        .post('/api/v1/admin/users/user-1/adjust-balance')
        .set('Authorization', authHeader('admin-1'))
        .send({ asset: 'USDT', amount: '25', reason: 'Reconciliation credit' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ asset: 'USDT', available: '125', locked: '0' });
    });

    it('400s when the adjustment would push the balance negative', async () => {
      const prisma = adminPrisma();
      const { tx, rows, audits } = withBalanceTransaction(prisma, { balance: { available: '10', locked: '0' } });
      const app = buildApp(prisma);

      const res = await request(app)
        .post('/api/v1/admin/users/user-1/adjust-balance')
        .set('Authorization', authHeader('admin-1'))
        .send({ asset: 'USDT', amount: '-50', reason: 'oops' });

      expect(res.status).toBe(400);
      expect(rows.get('user-1:USDT')).toEqual({ available: '10', locked: '0' });
      expect(await tx.balance.updateMany.mock.results[0].value).toEqual({ count: 0 });
      expect(audits).toEqual([]);
    });

    it('creates a missing balance and reads back the exact credit', async () => {
      const { prisma, rows, audits } = withBalanceTransaction(adminPrisma());
      const res = await request(buildApp(prisma)).post('/api/v1/admin/users/user-1/adjust-balance')
        .set('Authorization', authHeader('admin-1')).send({ asset: 'USDT', amount: '0.25', reason: 'fixture credit' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ asset: 'USDT', available: '0.25', locked: '0' });
      expect(rows.get('user-1:USDT')).toEqual({ available: '0.25', locked: '0' });
      expect(audits).toHaveLength(1);
      expect(audits[0].metadata.newAvailable).toBe('0.25');
    });

    it('applies successive deltas without overwriting locked funds or another account', async () => {
      const { prisma, tx, rows } = withBalanceTransaction(adminPrisma(), { balance: { available: '100', locked: '40' } });
      rows.set('other:USDT', { available: '7', locked: '9' });
      const app = buildApp(prisma);
      for (const [amount, expected] of [['25', '125'], ['-20', '105'], ['-105', '0']]) {
        const res = await request(app).post('/api/v1/admin/users/user-1/adjust-balance')
          .set('Authorization', authHeader('admin-1')).send({ asset: 'USDT', amount, reason: 'fixture delta' });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ asset: 'USDT', available: expected, locked: '40' });
        expect(rows.get('user-1:USDT')).toEqual({ available: expected, locked: '40' });
      }
      expect(rows.get('other:USDT')).toEqual({ available: '7', locked: '9' });
      expect(await tx.balance.updateMany.mock.results[1].value).toEqual({ count: 1 });
      const denied = await request(app).post('/api/v1/admin/users/user-1/adjust-balance')
        .set('Authorization', authHeader('admin-1')).send({ asset: 'USDT', amount: '-1', reason: 'cannot spend locked' });
      expect(denied.status).toBe(400);
      expect(rows.get('user-1:USDT')).toEqual({ available: '0', locked: '40' });
    });

    it('does not create a missing row on an unsuccessful debit', async () => {
      const { prisma, rows, audits } = withBalanceTransaction(adminPrisma());
      const res = await request(buildApp(prisma)).post('/api/v1/admin/users/user-1/adjust-balance')
        .set('Authorization', authHeader('admin-1')).send({ asset: 'USDT', amount: '-1', reason: 'fixture debit' });
      expect(res.status).toBe(400);
      expect(rows.size).toBe(0);
      expect(audits).toEqual([]);
    });

    it.each([null, { available: '100', locked: '40' }])('rolls back the balance if audit persistence fails (%j)', async balance => {
      const { prisma, tx, rows, audits } = withBalanceTransaction(adminPrisma(), { balance });
      tx.auditLog.create.mockImplementationOnce(async ({ data }: any) => { audits.push(data); throw new Error('fixture audit failure'); });
      const log = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const res = await request(buildApp(prisma)).post('/api/v1/admin/users/user-1/adjust-balance')
          .set('Authorization', authHeader('admin-1')).send({ asset: 'USDT', amount: '25', reason: 'fixture rollback' });
        expect(res.status).toBe(500);
        expect(rows.get('user-1:USDT')).toEqual(balance ?? undefined);
        expect(audits).toEqual([]);
      } finally { log.mockRestore(); }
    });
  });

  describe('POST /admin/users/:id/demo-topup', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app)
        .post('/api/v1/admin/users/user-1/demo-topup')
        .set('Authorization', authHeader('u1'))
        .send({ asset: 'BTC', amount: '272' });
      expect(res.status).toBe(403);
    });

    it('rejects a missing amount', async () => {
      const prisma = adminPrisma();
      const app = buildApp(prisma);
      const res = await request(app)
        .post('/api/v1/admin/users/user-1/demo-topup')
        .set('Authorization', authHeader('admin-1'))
        .send({ asset: 'BTC' });
      expect(res.status).toBe(400);
    });

    it('credits the demo balance via DemoTradingService.topUp, scoped to exactly the one target user', async () => {
      const demoTrading = { topUp: jest.fn().mockResolvedValue({ asset: 'BTC', available: '272', locked: '0' }) };
      const prisma = adminPrisma();
      const app = buildApp(prisma, demoTrading);

      const res = await request(app)
        .post('/api/v1/admin/users/user-1/demo-topup')
        .set('Authorization', authHeader('admin-1'))
        .send({ asset: 'btc', amount: '272' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ asset: 'BTC', available: '272', locked: '0' });
      expect(demoTrading.topUp).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', asset: 'BTC', amount: '272', performedByAdminId: 'admin-1' })
      );
    });

    it('does not touch any user other than the one named in the URL', async () => {
      const demoTrading = { topUp: jest.fn().mockResolvedValue({ asset: 'USDT', available: '7000000', locked: '0' }) };
      const prisma = adminPrisma();
      const app = buildApp(prisma, demoTrading);

      await request(app)
        .post('/api/v1/admin/users/only-this-user/demo-topup')
        .set('Authorization', authHeader('admin-1'))
        .send({ asset: 'USDT', amount: '7000000' });

      expect(demoTrading.topUp).toHaveBeenCalledTimes(1);
      expect(demoTrading.topUp.mock.calls[0][0].userId).toBe('only-this-user');
    });
  });

  describe('POST /admin/users/:id/block', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app).post('/api/v1/admin/users/user-1/block').set('Authorization', authHeader('u1')).send({ reason: 'spam' });
      expect(res.status).toBe(403);
    });

    it('rejects a missing reason', async () => {
      const prisma = adminPrisma();
      const app = buildApp(prisma);
      const res = await request(app).post('/api/v1/admin/users/user-1/block').set('Authorization', authHeader('admin-1')).send({});
      expect(res.status).toBe(400);
    });

    it('404s an unknown user id', async () => {
      const prisma = adminPrisma({
        user: { findUnique: jest.fn().mockResolvedValueOnce({ role: 'ADMIN' }).mockResolvedValueOnce(null) },
      });
      const app = buildApp(prisma);
      const res = await request(app).post('/api/v1/admin/users/nope/block').set('Authorization', authHeader('admin-1')).send({ reason: 'spam' });
      expect(res.status).toBe(404);
    });

    it('refuses to block an admin account', async () => {
      const prisma = adminPrisma({
        user: { findUnique: jest.fn().mockResolvedValueOnce({ role: 'ADMIN' }).mockResolvedValueOnce({ id: 'user-1', role: 'ADMIN' }) },
      });
      const app = buildApp(prisma);
      const res = await request(app).post('/api/v1/admin/users/user-1/block').set('Authorization', authHeader('admin-1')).send({ reason: 'spam' });
      expect(res.status).toBe(400);
    });

    it('sets blockedAt/blockedReason and writes an audit log entry', async () => {
      const prisma = adminPrisma({
        user: { findUnique: jest.fn().mockResolvedValueOnce({ role: 'ADMIN' }).mockResolvedValueOnce({ id: 'user-1', role: 'USER' }), update: jest.fn() },
      });
      const app = buildApp(prisma);
      const res = await request(app)
        .post('/api/v1/admin/users/user-1/block')
        .set('Authorization', authHeader('admin-1'))
        .send({ reason: 'Нарушение правил' });

      expect(res.status).toBe(200);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { blockedAt: expect.any(Date), blockedReason: 'Нарушение правил' },
      });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1', action: 'USER_BLOCKED' }) })
      );
    });
  });

  describe('POST /admin/users/:id/unblock', () => {
    it('clears blockedAt/blockedReason', async () => {
      const prisma = adminPrisma({
        user: { findUnique: jest.fn().mockResolvedValueOnce({ role: 'ADMIN' }).mockResolvedValueOnce({ id: 'user-1', role: 'USER' }), update: jest.fn() },
      });
      const app = buildApp(prisma);
      const res = await request(app).post('/api/v1/admin/users/user-1/unblock').set('Authorization', authHeader('admin-1'));

      expect(res.status).toBe(200);
      expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { blockedAt: null, blockedReason: null } });
    });
  });

  describe('DELETE /admin/users/:id', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const res = await request(buildApp(prisma)).delete('/api/v1/admin/users/user-1').set('Authorization', authHeader('u1'));
      expect(res.status).toBe(403);
    });
    it('fails closed without the coordinated deletion service', async () => {
      const res = await request(buildApp(adminPrisma())).delete('/api/v1/admin/users/user-1').set('Authorization', authHeader('admin-1'));
      expect(res.status).toBe(503);
    });
    // Real deletion, permissions, retention, races and rollback are exercised
    // by scripts/qa-admin-user-deletion.cjs against disposable PostgreSQL.
  });
});
