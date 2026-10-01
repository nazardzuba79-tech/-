process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { adminUsersRouter } from '../adminUsers';
import { adminDepositsRouter } from '../adminDeposits';
import { DepositQueueService } from '../../../services/deposits/DepositQueueService';

/** Synthetic repository honoring the Prisma predicates; real routers and auth middleware. */
function fixture() {
  const now = new Date();
  const users = [
    { id: 'admin', email: 'service@example.invalid', role: 'ADMIN', kycStatus: 'PENDING', createdAt: now, blockedAt: null },
    { id: 'new', email: 'customer@example.invalid', role: 'USER', kycStatus: 'PENDING', createdAt: now, blockedAt: null },
    { id: 'old', email: 'old@example.invalid', role: 'USER', kycStatus: 'APPROVED', createdAt: new Date('2020-01-01'), blockedAt: null },
    { id: 'blocked', email: 'blocked@example.invalid', role: 'USER', kycStatus: 'NOT_STARTED', createdAt: new Date('2020-01-01'), blockedAt: now },
  ];
  const matchesUser = (u: any, w: any = {}): boolean => (!w.role || u.role === w.role)
    && (!w.kycStatus || u.kycStatus === w.kycStatus)
    && (!w.createdAt?.gte || u.createdAt >= w.createdAt.gte)
    && (!w.email?.contains || u.email.toLowerCase().includes(w.email.contains.toLowerCase()));
  const deposit = (id: string, userId: string | null, confirmed = true, credited = false) => ({
    id, userId, user: users.find(u => u.id === userId) ?? null,
    chain: 'tron', asset: 'USDT', txHash: id.padEnd(64, 'a'), amount: '400',
    status: credited ? 'CREDITED' : 'PENDING', confirmations: confirmed ? 30 : 0,
    verifiedAt: now, finalized: confirmed, verifyError: null, batchId: null, revision: 1,
    recipientAddress: 'test-only', blockTimestamp: null, createdAt: now,
    creditedAt: credited ? now : null, source: 'watcher', ignoredAt: null, deletedUserId: null,
  });
  const deposits = [deposit('admin-ready', 'admin'), deposit('customer-ready', 'new'),
    deposit('admin-pending', 'admin', false), deposit('customer-pending', 'new', false),
    deposit('unmatched', null), deposit('admin-credit', 'admin', true, true)];
  const matchesDeposit = (d: any, w: any = {}): boolean =>
    (!w.status || (typeof w.status === 'string' ? d.status === w.status : d.status !== w.status.not))
    && (w.deletedUserId === undefined || d.deletedUserId === w.deletedUserId)
    && (!w.OR || w.OR.some((c: any) => c.userId === null ? d.userId === null : d.user && matchesUser(d.user, c.user.is ?? c.user)));
  const prisma: any = {
    user: { findUnique: jest.fn(async ({ where }: any) => users.find(u => u.id === where.id) ?? null),
      findMany: jest.fn(async ({ where }: any = {}) => users.filter(u => matchesUser(u, where))),
      count: jest.fn(async ({ where }: any = {}) => users.filter(u => matchesUser(u, where)).length),
      update: jest.fn(), delete: jest.fn() },
    session: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, userId: where.id.slice(4), lastSeenAt: now, revokedAt: null })),
      groupBy: jest.fn(async () => users.map(u => ({ userId: u.id, _max: { createdAt: now } }))), update: jest.fn() },
    balance: { findMany: jest.fn(async () => users.map(u => ({ userId: u.id, asset: 'USDT', available: '50', locked: '2' }))), update: jest.fn() },
    deposit: { findMany: jest.fn(async ({ where, take }: any) => deposits.filter(d => matchesDeposit(d, where)).slice(0, take)),
      count: jest.fn(async ({ where }: any) => deposits.filter(d => matchesDeposit(d, where)).length), update: jest.fn(), delete: jest.fn() },
    depositClaim: { findMany: jest.fn(async () => []) },
    auditLog: { create: jest.fn() },
  };
  const prices: any = { getTicker: jest.fn(async () => null) };
  const app = express(); app.use(express.json());
  app.use('/api/v1', adminUsersRouter(prisma, {} as any), adminDepositsRouter(prisma, prices));
  const auth = (id = 'admin') => `Bearer ${jwt.sign({ sub: id, sid: 'sid:' + id }, process.env.JWT_SECRET!)}`;
  return { prisma, app, auth, users, deposits, prices };
}

test('customer list excludes ADMIN in the database query, preserving customer balances, KYC, block and login fields', async () => {
  const { app, prisma, auth } = fixture();
  const res = await request(app).get('/api/v1/admin/users').set('Authorization', auth());
  expect(res.status).toBe(200);
  expect(res.body.map((u: any) => u.id)).toEqual(['new', 'old', 'blocked']);
  expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { role: 'USER' }, orderBy: { createdAt: 'desc' } });
  expect(res.body[0]).toMatchObject({ role: 'USER', isAdmin: false, kycStatus: 'PENDING', balances: [{ asset: 'USDT', available: '50', locked: '2' }] });
  expect(res.body[0].lastLoginAt).toBeTruthy();
  expect(res.body[2].isBlocked).toBe(true);
});

test.each([[' SERVICE ', []], ['CUSTOMER', ['new']], ['example.invalid', ['new', 'old', 'blocked']]])('search %s cannot bypass customer role scope', async (search, expected) => {
  const { app, auth } = fixture();
  const res = await request(app).get('/api/v1/admin/users').query({ search }).set('Authorization', auth());
  expect(res.status).toBe(200);
  expect(res.body.map((u: any) => u.id)).toEqual(expected);
});

test('customer KPIs and activity omit admin packages while the general deposit queue/history retain them', async () => {
  const { app, auth, prisma, prices, deposits } = fixture();
  const before = JSON.stringify(deposits);
  const res = await request(app).get('/api/v1/admin/user-activity').set('Authorization', auth());
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ totalUsers: 3, newUsers24h: 1, pendingKyc: 1 });
  expect(prisma.user.count.mock.calls.map((c: any) => c[0].where.role)).toEqual(['USER', 'USER', 'USER']);
  expect(res.body.packages.map((p: any) => p.userId)).toEqual(['new']);
  expect(res.body.awaitingConfirmationsByUser).toEqual({ new: 1 });
  expect(res.body.counts).toMatchObject({ UNATTRIBUTED: 1, READY: 0, AWAITING_CONFIRMATIONS: 1, uncreditedTotal: 3 });
  const all = await new DepositQueueService(prisma, prices).load({ creditedLimit: 0 });
  expect(all.packages.map(p => p.userId)).toEqual(['admin', 'new']);
  expect(all.counts).toMatchObject({ UNATTRIBUTED: 1, READY: 0, AWAITING_CONFIRMATIONS: 2, uncreditedTotal: 5, CREDITED: 1 });
  const history = await request(app).get('/api/v1/admin/deposits').set('Authorization', auth());
  expect(history.status).toBe(200);
  expect(history.body.some((d: any) => d.id === 'admin-credit')).toBe(true);
  expect(JSON.stringify(deposits)).toBe(before);
  expect(prisma.deposit.update).not.toHaveBeenCalled();
  expect(prisma.deposit.delete).not.toHaveBeenCalled();
});

test('admin session remains valid after list/activity reads; no role, balance or audit mutations', async () => {
  const { app, auth, prisma, users } = fixture();
  const before = JSON.stringify(users);
  for (const route of ['users', 'user-activity', 'users']) {
    expect((await request(app).get('/api/v1/admin/' + route).set('Authorization', auth())).status).toBe(200);
  }
  expect(JSON.stringify(users)).toBe(before);
  for (const mutation of [prisma.user.update, prisma.user.delete, prisma.balance.update, prisma.auditLog.create]) expect(mutation).not.toHaveBeenCalled();
  expect((await request(app).get('/api/v1/admin/users').set('Authorization', auth('new'))).status).toBe(403);
});
