process.env.JWT_SECRET = 'copy-resolution-test-secret';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { mountDepositCopyReview } from '../adminDepositCopyReview';
import { pendingCopiesForCredit, resolveCopiesAfterCredit, ignoreDepositCopy } from '../../../services/deposits/depositCopyResolution';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const auth = (userId = 'admin') => `Bearer ${jwt.sign({ sub: userId, sid: 'sid:' + userId }, process.env.JWT_SECRET!)}`;
function fixture(role = 'ADMIN') {
  const prisma: any = {
    session: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, userId: where.id.slice(4), lastSeenAt: new Date(), revokedAt: null })) },
    user: { findUnique: jest.fn().mockResolvedValue({ role }) },
    balance: { update: jest.fn(), upsert: jest.fn() }, deposit: { update: jest.fn() },
    $queryRaw: jest.fn(async (sql: any) => /SELECT "userId" FROM/.test(sql.sql) ? [{ userId: 'u1' }] : []),
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const app = express(); app.use(express.json());
  const router = express.Router(); mountDepositCopyReview(router, prisma); app.use('/api/v1', router);
  app.use((_error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: 'failed' }));
  return { prisma, app };
}
const endpoint = `/api/v1/admin/deposit-address-copies/${id}/ignore`;

describe('explicit Ignore authorization and lifecycle', () => {
  it('rejects a guest before reading or writing the journal', async () => {
    const { app, prisma } = fixture();
    expect((await request(app).post(endpoint).send({})).status).toBe(401);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('rejects ordinary accounts before any journal query', async () => {
    const { app, prisma } = fixture('USER');
    expect((await request(app).post(endpoint).set('Authorization', auth('u1')).send({})).status).toBe(403);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('does not accept a client-selected user, outcome, amount or bulk cutoff', async () => {
    const { app, prisma } = fixture();
    for (const body of [{ userId: 'other' }, { outcome: 'CREDITED' }, { amount: '500' }, { before: new Date().toISOString() }]) {
      expect((await request(app).post(endpoint).set('Authorization', auth()).send(body)).status).toBe(400);
    }
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('validates the event identifier', async () => {
    const { app, prisma } = fixture();
    expect((await request(app).post(endpoint.replace(id, 'not-an-id')).set('Authorization', auth()).send({})).status).toBe(400);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('returns the next unresolved signal and never calls financial model methods', async () => {
    const { app, prisma } = fixture();
    const response = await request(app).post(endpoint).set('Authorization', auth()).send({});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: 'u1', ignoredEventId: id, lastDepositCopy: null, depositCopyLookupFailed: false });
    expect(response.headers['cache-control']).toContain('no-store');
    expect(prisma.balance.update).not.toHaveBeenCalled(); expect(prisma.balance.upsert).not.toHaveBeenCalled(); expect(prisma.deposit.update).not.toHaveBeenCalled();
    const statements = prisma.$queryRaw.mock.calls.map((c: any[]) => c[0].sql).join('\n');
    expect(statements).not.toMatch(/\b(?:UPDATE|DELETE)\b|"Balance"/);
    expect(statements).toContain('ON CONFLICT ("id") DO NOTHING');
  });
  it('a missing event is not silently marked as resolved', async () => {
    const { app, prisma } = fixture(); prisma.$queryRaw.mockResolvedValue([]);
    const response = await request(app).post(endpoint).set('Authorization', auth()).send({});
    expect(response.status).toBe(404); expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
  it('a failed persistence operation returns failure, not optimistic success', async () => {
    const { app, prisma } = fixture(); prisma.$transaction.mockRejectedValue(new Error('unavailable'));
    expect((await request(app).post(endpoint).set('Authorization', auth()).send({})).status).toBe(500);
  });
  it('a failed next-copy read is explicitly unknown after the acknowledgement', async () => {
    const { app, prisma } = fixture();
    prisma.$queryRaw.mockImplementation(async (sql: any) => {
      if (sql.sql.includes('CROSS JOIN LATERAL')) throw Error('read unavailable');
      return /SELECT "userId" FROM/.test(sql.sql) ? [{ userId: 'u1' }] : [];
    });
    const response = await request(app).post(endpoint).set('Authorization', auth()).send({});
    expect(response.status).toBe(200); expect(response.body.depositCopyLookupFailed).toBe(true);
  });
});

describe('copy resolution SQL scope', () => {
  it('credit snapshot is one read for a fixed user, coin and network, with no time expiry', async () => {
    const db: any = { $queryRaw: jest.fn().mockResolvedValue([]) };
    await pendingCopiesForCredit(db, 'u1', 'ethereum', 'USDT');
    const sql = db.$queryRaw.mock.calls[0][0];
    expect(sql.values).toEqual(['u1', 'USDT', 'ethereum']);
    expect(sql.sql).toContain('NOT EXISTS');
    expect(sql.sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|now|interval)\b/i);
  });
  it('no captured copies means no resolution write', async () => {
    const db: any = { $queryRaw: jest.fn() };
    await resolveCopiesAfterCredit(db, { ids: [], userId: 'u1', chain: 'ethereum', asset: 'USDT', adminId: 'a', batchId: 'b' });
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it('credit uses only captured IDs and validated user/rail, never a newly evaluated timestamp', async () => {
    const db: any = { $queryRaw: jest.fn().mockResolvedValue([]) };
    await resolveCopiesAfterCredit(db, { ids: ['z', 'a', 'z'], userId: 'u1', chain: 'ethereum', asset: 'USDT', adminId: 'admin', batchId: 'batch' });
    const sql = db.$queryRaw.mock.calls[0][0];
    expect(sql.values).toEqual(['batch', 'admin', 'a', 'z', 'u1', 'USDT', 'ethereum']);
    expect(sql.sql).toContain('ON CONFLICT ("id") DO NOTHING');
    expect(sql.sql).not.toContain('"Balance"');
  });
  it('Ignore scope is the original event and older copies of its exact destination, not the account globally', async () => {
    const { prisma } = fixture();
    await ignoreDepositCopy(prisma, id, 'admin');
    const sql = prisma.$queryRaw.mock.calls[1][0];
    expect(sql.sql).toContain('e."userId" = target."userId"');
    expect(sql.sql).toContain('e."asset" = target."asset"');
    expect(sql.sql).toContain('e."network" = target."network"');
    expect(sql.sql).toContain('e."addressSnapshot" = target."addressSnapshot"');
    expect(sql.sql).toContain('IS NOT DISTINCT FROM');
    expect(sql.sql).toContain('(e."receivedAt", e."id") <= (target."receivedAt", target."id")');
    expect(sql.values).toEqual([id, 'admin', id]);
  });
});
