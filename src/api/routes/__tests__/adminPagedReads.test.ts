process.env.JWT_SECRET = 'admin-page-fixture-secret-no-production';

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { adminUsersRouter } from '../adminUsers';

function fixture() {
  const admin = { id: 'admin', role: 'ADMIN', email: 'admin@example.invalid' };
  const customer = { id: 'u21', email: 'customer@example.invalid', role: 'USER', kycStatus: 'PENDING', createdAt: new Date('2026-01-01'), blockedAt: null, blockedReason: null };
  const prisma: any = {
    user: { findUnique: jest.fn(async ({ where }: any) => where.id === 'admin' ? admin : where.id === 'missing' ? null : customer), findMany: jest.fn(async () => [customer]), count: jest.fn(async () => 41) },
    session: { groupBy: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    balance: { findMany: jest.fn(async () => [{ userId: 'u21', asset: 'USDT', available: '10.125', locked: '2' }]) },
    demoBalance: { findMany: jest.fn(async () => []) },
    depositAddressCopyEvent: { findMany: jest.fn(async () => []) },
    deposit: { findMany: jest.fn(async () => []), count: jest.fn(async () => 101) },
    withdrawal: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    order: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    purchase: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    kycSubmission: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    futuresOrder: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    futuresPosition: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    cfdPosition: { findMany: jest.fn(async () => []), count: jest.fn(async () => 0) },
    auditLog: { findMany: jest.fn(async () => []), count: jest.fn(async () => 201), create: jest.fn() },
    $queryRaw: jest.fn(async () => [{ id: 'u21' }]),
  };
  const app = express(); app.use('/api/v1', adminUsersRouter(prisma, {} as any));
  app.use((_error: Error, _req: any, res: any, _next: any) => res.status(503).json({ error: 'Read unavailable' }));
  const auth = `Bearer ${jwt.sign({ sub: 'admin' }, process.env.JWT_SECRET!)}`;
  return { prisma, app, auth };
}

test('users page is bounded, stable and scopes balance/session reads to the returned page', async () => {
  const { prisma, app, auth } = fixture();
  const r = await request(app).get('/api/v1/admin/users/page?page=2&pageSize=20&search=u21').set('Authorization', auth);
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ total: 41, page: 2, pageSize: 20, totalPages: 3, items: [{ id: 'u21', password: null, balances: [{ available: '10.125', locked: '2' }] }] });
  expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20, skip: 20, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], where: { role: 'USER', OR: [{ email: { contains: 'u21', mode: 'insensitive' } }, { id: { contains: 'u21', mode: 'insensitive' } }] } }));
  expect(prisma.balance.findMany).toHaveBeenCalledWith({ where: { userId: { in: ['u21'] } } });
  expect(prisma.session.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: { in: ['u21'] } } }));
});

test.each(['page=0', 'pageSize=101', 'pageSize=NaN', 'sort=passwordHash', 'direction=sideways', 'status=unknown'])('invalid query %s fails before reading a list', async query => {
  const { prisma, app, auth } = fixture();
  expect((await request(app).get('/api/v1/admin/users/page?' + query).set('Authorization', auth)).status).toBe(400);
  expect(prisma.user.findMany).not.toHaveBeenCalled();
});
test('search treats percent and underscore literally, consistently with last-login SQL sorting', async () => {
  const { prisma, app, auth } = fixture();
  expect((await request(app).get('/api/v1/admin/users/page').query({ search: '_%' }).set('Authorization', auth)).status).toBe(200);
  expect(prisma.user.findMany.mock.calls[0][0].where.OR[0].email.contains).toBe('\\_\\%');
});

test('profile loads no history and missing user is 404', async () => {
  const { prisma, app, auth } = fixture();
  const r = await request(app).get('/api/v1/admin/users/u21/profile').set('Authorization', auth);
  expect(r.status).toBe(200); expect(r.body.id).toBe('u21'); expect(r.body.deposits).toBeUndefined();
  for (const model of ['deposit', 'withdrawal', 'order', 'purchase', 'kycSubmission', 'auditLog']) expect(prisma[model].findMany).not.toHaveBeenCalled();
  expect((await request(app).get('/api/v1/admin/users/missing/profile').set('Authorization', auth)).status).toBe(404);
});

test('history reaches rows beyond the old 100-row cap and reads one kind only', async () => {
  const { prisma, app, auth } = fixture();
  const r = await request(app).get('/api/v1/admin/users/u21/history?kind=deposits&page=6&pageSize=20').set('Authorization', auth);
  expect(r.status).toBe(200); expect(r.body).toMatchObject({ total: 101, page: 6, totalPages: 6 });
  expect(prisma.deposit.findMany).toHaveBeenCalledWith({ where: { userId: 'u21' }, skip: 100, take: 20, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  expect(prisma.order.findMany).not.toHaveBeenCalled();
  expect((await request(app).get('/api/v1/admin/users/u21/history?kind=secret').set('Authorization', auth)).status).toBe(400);
});
test('withdrawal queue filters on the server before paging beyond 200 and preserves balanceHeld', async () => {
  const { prisma, app, auth } = fixture();
  prisma.withdrawal.count.mockResolvedValue(201);
  prisma.withdrawal.findMany.mockResolvedValue([{ id: 'w201', userId: 'u21', user: { email: 'person@example.invalid' }, asset: 'USDT', network: 'tron', toAddress: 'fixture-address', amount: '500.125', status: 'APPROVED', txHash: null, balanceHeld: false }]);
  const r = await request(app).get('/api/v1/admin/withdrawals/page?page=11&status=active&search=person').set('Authorization', auth);
  expect(r.status).toBe(200); expect(r.body).toMatchObject({ total: 201, page: 11, items: [{ id: 'w201', amount: '500.125', balanceHeld: false }] });
  expect(prisma.withdrawal.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20, skip: 200, where: expect.objectContaining({ status: { in: ['PENDING', 'APPROVED'] }, OR: expect.arrayContaining([{ user: { email: { contains: 'person', mode: 'insensitive' } } }]) }) }));
});
test('processed withdrawal queue means sent or rejected; unsupported status rejects', async () => {
  const { prisma, app, auth } = fixture();
  expect((await request(app).get('/api/v1/admin/withdrawals/page?status=processed').set('Authorization', auth)).status).toBe(200);
  expect(prisma.withdrawal.count).toHaveBeenCalledWith({ where: { status: { in: ['SENT', 'REJECTED', 'COMPLETED'] } } });
  expect((await request(app).get('/api/v1/admin/withdrawals/page?status=COMPLETED').set('Authorization', auth)).status).toBe(200);
  expect((await request(app).get('/api/v1/admin/withdrawals/page?status=EXECUTE').set('Authorization', auth)).status).toBe(400);
});

test('KYC reads only a page of users and their latest submission', async () => {
  const { prisma, app, auth } = fixture();
  const r = await request(app).get('/api/v1/admin/clients/page?pageSize=20&status=PENDING').set('Authorization', auth);
  expect(r.status).toBe(200);
  expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
  expect(prisma.user.findMany.mock.calls[0][0].include).toBeUndefined();
  expect(prisma.$queryRaw.mock.calls[0][0].sql).toContain('LIMIT 1');
  expect(prisma.kycSubmission.findMany).not.toHaveBeenCalled();
});
test('KYC date range applies to the latest submission, and malformed or inverted ranges fail', async () => {
  const { prisma, app, auth } = fixture();
  prisma.$queryRaw.mockImplementation(async (sql: any) => sql.sql.includes('count(*)') ? [{ total: 41n }] : sql.sql.includes('SELECT u."id"') ? [{ id: 'u21' }] : []);
  expect((await request(app).get('/api/v1/admin/clients/page?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z').set('Authorization', auth)).status).toBe(200);
  expect(prisma.$queryRaw.mock.calls[0][0].sql).toContain('LATERAL');
  expect(prisma.$queryRaw.mock.calls[0][0].sql).toContain('LIMIT 1');
  expect((await request(app).get('/api/v1/admin/clients/page?from=invalid').set('Authorization', auth)).status).toBe(400);
  expect((await request(app).get('/api/v1/admin/clients/page?from=2026-02-01T00:00:00Z&to=2026-01-01T00:00:00Z').set('Authorization', auth)).status).toBe(400);
});

test.each([['futuresOrders', 'futuresOrder', 'createdAt'], ['futuresPositions', 'futuresPosition', 'openedAt'], ['cfdPositions', 'cfdPosition', 'openedAt']])('history %s reads only its own stored records without an execution service', async (kind, model, dateField) => {
  const { prisma, app, auth } = fixture();
  const r = await request(app).get('/api/v1/admin/users/u21/history?kind=' + kind).set('Authorization', auth);
  expect(r.status).toBe(200);
  expect(prisma[model].findMany).toHaveBeenCalledWith({ where: { userId: 'u21' }, skip: 0, take: 20, orderBy: [{ [dateField]: 'desc' }, { id: 'desc' }] });
  expect(prisma.order.findMany).not.toHaveBeenCalled();
});

test('audit can page beyond 200 with date/action/user filters and redacts secret metadata', async () => {
  const { prisma, app, auth } = fixture();
  prisma.auditLog.findMany.mockResolvedValue([{ id: 'a201', userId: 'u21', action: 'BALANCE_ADJUSTED', metadata: { delta: '1.2', accessToken: 'fixture-do-not-return', nested: { database_url: 'fixture-secret', reason: 'normal' } }, createdAt: new Date() }]);
  const r = await request(app).get('/api/v1/admin/audit-log/page?page=11&pageSize=20&userId=u21&action=BALANCE_ADJUSTED&from=2026-01-01T00:00:00Z').set('Authorization', auth);
  expect(r.status).toBe(200); expect(r.body.total).toBe(201); expect(r.body.items[0].metadata.delta).toBe('1.2');
  expect(JSON.stringify(r.body)).not.toContain('fixture-secret'); expect(JSON.stringify(r.body)).not.toContain('fixture-do-not-return');
  expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 200, take: 20, where: expect.objectContaining({ userId: 'u21', action: 'BALANCE_ADJUSTED', createdAt: { gte: new Date('2026-01-01T00:00:00Z') } }) }));
});
test('audit search finds target or acting admin email inside SQL without loading a user directory', async () => {
  const { prisma, app, auth } = fixture();
  prisma.$queryRaw.mockImplementation(async (sql: any) => sql.sql.includes('count(*)') ? [{ total: 1n }] : [{ id: 'audit-email', userId: 'u21', action: 'FIXTURE', metadata: { performedByAdminId: 'admin' }, createdAt: new Date() }]);
  const r = await request(app).get('/api/v1/admin/audit-log/page?search=person%40example.invalid').set('Authorization', auth);
  expect(r.status).toBe(200); expect(r.body.total).toBe(1);
  expect(prisma.$queryRaw.mock.calls[0][0].sql).toContain('target."email"');
  expect(prisma.$queryRaw.mock.calls[0][0].sql).toContain('actor."email"');
  expect(prisma.user.findMany).toHaveBeenCalledWith({ where: { id: { in: ['u21', 'admin'] } }, select: { id: true, email: true } });
});

test('read failure returns an HTTP error and server continues serving later requests; unauthenticated and non-admin fail', async () => {
  const { prisma, app, auth } = fixture();
  prisma.user.count.mockRejectedValueOnce(new Error('fixture DB failure'));
  expect((await request(app).get('/api/v1/admin/users/page').set('Authorization', auth)).status).toBe(503);
  expect((await request(app).get('/api/v1/admin/users/page').set('Authorization', auth)).status).toBe(200);
  expect((await request(app).get('/api/v1/admin/users/page')).status).toBe(401);
  const userAuth = `Bearer ${jwt.sign({ sub: 'u21' }, process.env.JWT_SECRET!)}`;
  expect((await request(app).get('/api/v1/admin/users/page').set('Authorization', userAuth)).status).toBe(403);
  expect(prisma.auditLog.create).not.toHaveBeenCalled();
});
