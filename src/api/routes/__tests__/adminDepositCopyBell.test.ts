process.env.JWT_SECRET = 'admin-copy-bell-test-secret';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { latestDepositCopiesForUsers } from '../../../services/deposits/latestDepositCopiesForUsers';
import { adminUsersRouter } from '../adminUsers';

const sample = {
  userId: 'u1', id: 'event-1', asset: 'BTC', network: 'bitcoin',
  receivedAt: new Date('2026-10-01T08:06:07.487Z'),
  clientCopiedAt: new Date('2026-10-01T08:06:05.067Z'),
};
const auth = (id = 'admin') => `Bearer ${jwt.sign({ sub: id, sid: 'sid:' + id }, process.env.JWT_SECRET!)}`;
const users = ['u1', 'u2'].map(id => ({ id, email: `${id}@example.invalid`, role: 'USER', createdAt: new Date('2026-09-01'), kycStatus: 'NOT_STARTED' }));
function fixture(role = 'ADMIN') {
  const prisma: any = {
    $queryRaw: jest.fn().mockResolvedValue([sample]),
    user: { findUnique: jest.fn().mockResolvedValue({ role }), findMany: jest.fn().mockResolvedValue(users) },
    session: {
      findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, userId: where.id.slice(4), lastSeenAt: new Date(), revokedAt: null })),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    balance: { findMany: jest.fn().mockResolvedValue([{ userId: 'u1', asset: 'USDT', available: '100', locked: '20' }]) },
    adminPasswordVault: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const app = express(); app.use(express.json()); app.use('/api/v1', adminUsersRouter(prisma, {} as any));
  return { prisma, app };
}

describe('latest deposit-copy summaries', () => {
  it('empty user list does not query anything', async () => {
    const db: any = { $queryRaw: jest.fn() };
    const result = await latestDepositCopiesForUsers(db, []);
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(result.failed).toBe(false);
    expect(result.byUser.size).toBe(0);
  });
  it('one bound SQL query for all users, latest one per user, no full journal and no writes', async () => {
    const db: any = { $queryRaw: jest.fn().mockResolvedValue([sample]) };
    const result = await latestDepositCopiesForUsers(db, ['u1', 'u2', 'u1']);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = db.$queryRaw.mock.calls[0][0];
    expect(sql.values).toEqual(['u1', 'u2']);
    expect(sql.sql).toMatch(/CROSS JOIN LATERAL/);
    expect(sql.sql).toMatch(/WHERE e\."userId" = u\."id"/);
    expect(sql.sql).toMatch(/ORDER BY e\."receivedAt" DESC, e\."id" DESC\s+LIMIT 1/);
    expect(sql.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|FOR UPDATE)\b/i);
    expect(result.failed).toBe(false);
    expect(result.byUser.get('u1')).toEqual({ id: 'event-1', asset: 'BTC', network: 'bitcoin', receivedAt: '2026-10-01T08:06:07.487Z', clientCopiedAt: '2026-10-01T08:06:05.067Z' });
    expect(result.byUser.has('u2')).toBe(false);
  });
  it('IDs remain bound parameters; no unrelated account is returned', async () => {
    const id = "x'); DROP TABLE anything;--";
    const db: any = { $queryRaw: jest.fn().mockResolvedValue([sample, { ...sample, userId: 'other' }]) };
    const result = await latestDepositCopiesForUsers(db, ['u1', id]);
    const sql = db.$queryRaw.mock.calls[0][0];
    expect(sql.sql).not.toContain(id);
    expect(sql.values).toContain(id);
    expect([...result.byUser.keys()]).toEqual(['u1']);
  });
  it('a journal outage is unknown, not evidence of no copies', async () => {
    const db: any = { $queryRaw: jest.fn().mockRejectedValue(new Error('unavailable')) };
    const result = await latestDepositCopiesForUsers(db, ['u1']);
    expect(result.failed).toBe(true);
    expect(result.byUser.size).toBe(0);
  });
});

describe('copy bell data in the existing admin users response', () => {
  it('attaches the right event to the right user and keeps balances unchanged', async () => {
    const { app, prisma } = fixture();
    const res = await request(app).get('/api/v1/admin/users').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body[0].lastDepositCopy).toMatchObject({ id: 'event-1', asset: 'BTC', network: 'bitcoin' });
    expect(res.body[0].balances).toEqual([{ asset: 'USDT', available: '100', locked: '20' }]);
    expect(res.body[0].depositCopyLookupFailed).toBe(false);
    expect(res.body[1].lastDepositCopy).toBeNull();
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(res.body[0].lastDepositCopy).not.toHaveProperty('addressSnapshot');
  });
  it('users and balances still load when copy metadata cannot be read', async () => {
    const { app, prisma } = fixture(); prisma.$queryRaw.mockRejectedValue(new Error('journal unavailable'));
    const res = await request(app).get('/api/v1/admin/users').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].depositCopyLookupFailed).toBe(true);
    expect(res.body[0].balances[0].available).toBe('100');
  });
  it('a regular user is refused before any journal query', async () => {
    const { app, prisma } = fixture('USER');
    const res = await request(app).get('/api/v1/admin/users').set('Authorization', auth('u1'));
    expect(res.status).toBe(403); expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('a guest is refused before any journal query', async () => {
    const { app, prisma } = fixture();
    const res = await request(app).get('/api/v1/admin/users');
    expect(res.status).toBe(401); expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('an empty customer list does not add a SQL read', async () => {
    const { app, prisma } = fixture(); prisma.user.findMany.mockResolvedValue([]);
    const res = await request(app).get('/api/v1/admin/users').set('Authorization', auth());
    expect(res.status).toBe(200); expect(res.body).toEqual([]); expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
