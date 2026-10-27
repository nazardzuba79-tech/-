process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { adminWithdrawalsRouter } from '../adminWithdrawals';
import { walletDelegate } from '../../../test-utils/walletDelegate';

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
    user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }) },
    withdrawal: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

function withTransaction(prisma: any, opts: { balance?: any; withdrawal?: any } = {}) {
  const rows = new Map(opts.balance ? [['user-1:USDT', { ...opts.balance }]] : []);
  let withdrawal = opts.withdrawal ? { ...opts.withdrawal } : null;
  const tx = {
    balance: walletDelegate(rows),
    withdrawal: {
      findUnique: jest.fn(async ({ where }: any) => withdrawal?.id === where.id ? { ...withdrawal } : null),
      update: jest.fn(async ({ where, data }: any) => {
        if (withdrawal?.id !== where.id) throw new Error('Missing withdrawal fixture');
        Object.assign(withdrawal, data); return { ...withdrawal };
      }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]), // Actual row-lock semantics covered by disposable PostgreSQL tests.
    auditLog: { create: jest.fn() },
  };
  prisma.rows = rows;
  // Read before the transaction to find the request's owner; no simulated-sale proceeds, so no synthetic floor here.
  prisma.withdrawal = { ...prisma.withdrawal, findUnique: tx.withdrawal.findUnique };
  prisma.auditLog = { ...prisma.auditLog, findMany: jest.fn().mockResolvedValue([]) };
  prisma.$transaction = jest.fn(async (fn: any) => {
    const before = new Map([...rows].map(([key, row]) => [key, { ...row }]));
    const previousWithdrawal = withdrawal ? { ...withdrawal } : null;
    try { return await fn(tx); } catch (error) {
      rows.clear(); before.forEach((row, key) => rows.set(key, row));
      withdrawal = previousWithdrawal; throw error;
    }
  });
  return prisma;
}

describe('admin withdrawals routes', () => {
  describe('GET /admin/withdrawals', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
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

  describe('POST /admin/withdrawals/:id/approve', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app).post('/api/v1/admin/withdrawals/w1/approve').set('Authorization', authHeader('u1'));
      expect(res.status).toBe(403);
    });

    it('404s an unknown withdrawal id', async () => {
      const prisma = withTransaction(adminPrisma(), { withdrawal: null });
      const app = buildApp(prisma);
      const res = await request(app).post('/api/v1/admin/withdrawals/nope/approve').set('Authorization', authHeader('admin-1'));
      expect(res.status).toBe(400);
    });

    it('approves a pending withdrawal, leaving it locked', async () => {
      const prisma = withTransaction(adminPrisma(), {
        balance: { available: '60', locked: '40' },
        withdrawal: { id: 'w1', userId: 'user-1', asset: 'USDT', amount: '40', status: 'PENDING' },
      });
      const app = buildApp(prisma);
      const res = await request(app).post('/api/v1/admin/withdrawals/w1/approve').set('Authorization', authHeader('admin-1'));

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'APPROVED' });
      expect(prisma.rows.get('user-1:USDT')).toEqual({ available: '60', locked: '40' });
    });
  });

  describe('POST /admin/withdrawals/:id/mark-sent', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app)
        .post('/api/v1/admin/withdrawals/w1/mark-sent')
        .set('Authorization', authHeader('u1'))
        .send({ txHash: 'abc123' });
      expect(res.status).toBe(403);
    });

    it('rejects a missing txHash', async () => {
      const prisma = adminPrisma();
      const app = buildApp(prisma);
      const res = await request(app)
        .post('/api/v1/admin/withdrawals/w1/mark-sent')
        .set('Authorization', authHeader('admin-1'))
        .send({});
      expect(res.status).toBe(400);
    });

    it('marks an approved withdrawal sent and releases the lock', async () => {
      const prisma = withTransaction(adminPrisma(), {
        balance: { available: '60', locked: '40' },
        withdrawal: { id: 'w1', userId: 'user-1', asset: 'USDT', amount: '40', status: 'APPROVED' },
      });
      const app = buildApp(prisma);
      const res = await request(app)
        .post('/api/v1/admin/withdrawals/w1/mark-sent')
        .set('Authorization', authHeader('admin-1'))
        .send({ txHash: 'abc123' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'SENT', txHash: 'abc123' });
      expect(prisma.rows.get('user-1:USDT')).toEqual({ available: '60', locked: '0' });
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
      expect(prisma.rows.get('user-1:USDT')).toEqual({ available: '100', locked: '0' });
      const retry = await request(app).post('/api/v1/admin/withdrawals/w1/reject')
        .set('Authorization', authHeader('admin-1')).send({ reason: 'duplicate refund forbidden' });
      expect(retry.status).toBe(400);
      expect(prisma.rows.get('user-1:USDT')).toEqual({ available: '100', locked: '0' });
    });
  });
});

// Issue #617: an unheld (demo-valued) request is never approved or marked sent — whatever the demo switches, and also
// when it was filed before the fence existed. It can still be rejected.
describe('admin withdrawals: demo-valued requests are reject-only, permanently', () => {
  const unheld = (status: string) => ({ id: 'w1', userId: 'user-1', asset: 'USDT', amount: '300', status, balanceHeld: false });
  const SWITCHES = ['DEMO_SPOT_ENABLED', 'DEMO_WITHDRAWAL_GUARD_ENABLED', 'DEMO_LIQUIDITY_ENABLED'];
  const saved = Object.fromEntries(SWITCHES.map(key => [key, process.env[key]]));
  afterEach(() => { for (const key of SWITCHES) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
  it.each([['every demo switch off', [] as string[]], ['every demo switch on', SWITCHES]])('%s: not approved or marked sent (403), and can be rejected', async (_label, on) => {
    for (const key of SWITCHES) delete process.env[key];
    for (const key of on) process.env[key] = 'true';
    const pending = withTransaction(adminPrisma(), { withdrawal: unheld('PENDING') });
    const app = buildApp(pending);
    const approve = await request(app).post('/api/v1/admin/withdrawals/w1/approve').set('Authorization', authHeader('admin-1'));
    expect(approve.status).toBe(403); expect(approve.body).toEqual({ error: 'Demo funds are not withdrawable', code: 'DEMO_FUNDS_NOT_WITHDRAWABLE' });
    const approved = withTransaction(adminPrisma(), { withdrawal: unheld('APPROVED') });
    const sent = await request(buildApp(approved)).post('/api/v1/admin/withdrawals/w1/mark-sent').set('Authorization', authHeader('admin-1')).send({ txHash: '0xabc' });
    expect(sent.status).toBe(403); expect(sent.body.code).toBe('DEMO_FUNDS_NOT_WITHDRAWABLE');
    const reject = await request(app).post('/api/v1/admin/withdrawals/w1/reject').set('Authorization', authHeader('admin-1')).send({ reason: 'demo funds' });
    expect(reject.status).toBe(200); expect(reject.body).toMatchObject({ status: 'REJECTED' });
  });
});
