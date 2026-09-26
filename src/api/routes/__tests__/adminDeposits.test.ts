process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { adminDepositsRouter } from '../adminDeposits';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any, priceSource: any = { getTicker: jest.fn().mockResolvedValue(null) }) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', adminDepositsRouter(prisma, priceSource));
  return app;
}

function adminPrisma(overrides: any = {}) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }) },
    deposit: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(async ({create}: any) => create),
    },
    ignoredIncomingTransfer: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn().mockResolvedValue({}) },
    treasuryWallet: { findUnique: jest.fn().mockResolvedValue(null) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

const OLD_ENV = process.env;

describe('admin deposits routes', () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV, JWT_SECRET: 'test-secret-at-least-this-long' };
    delete process.env.BITCOIN_TREASURY_ADDRESS;
    delete process.env.TRON_TREASURY_ADDRESS;
    // @ts-ignore
    global.fetch = jest.fn();
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  describe('GET /admin/deposits', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/deposits').set('Authorization', authHeader('u1'));
      expect(res.status).toBe(403);
    });

    it("lists every user's deposits with their email joined", async () => {
      const prisma = adminPrisma({
        deposit: {
          findMany: jest.fn().mockImplementation(async ({where}: any) => where.status !== 'CREDITED' ? [] : [
            {
              id: 'd1',
              userId: 'user-1',
              user: { email: 'alice@team.com' },
              asset: 'BTC',
              chain: 'bitcoin',
              txHash: 'a'.repeat(64),
              amount: { toString: () => '0.05' },
              confirmations: 3,
              status: 'CREDITED',
              createdAt: new Date('2026-01-01'),
            },
          ]),
        },
      });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/deposits').set('Authorization', authHeader('admin-1'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        expect.objectContaining({ userEmail: 'alice@team.com', asset: 'BTC', amount: '0.05', status: 'CREDITED' }),
      ]);
    });
  });

  describe('GET /admin/user-activity (Users page work queue)', () => {
    it('returns counts and only unresolved, user-owned deposits — no history, no live providers', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch' as any);
      const findMany = jest.fn().mockResolvedValue([
        { id: 'd1', userId: 'u1', asset: 'USDT', chain: 'tron', txHash: 'a'.repeat(64), amount: { toString: () => '2500' }, confirmations: 30, status: 'PENDING', createdAt: new Date('2026-09-26T08:00:00.000Z') },
      ]);
      const count = jest.fn()
        .mockResolvedValueOnce(42)   // total users
        .mockResolvedValueOnce(3)    // registered in the last 24h
        .mockResolvedValueOnce(2);   // KYC pending
      const prisma = adminPrisma({
        user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }), count },
        deposit: { findMany, findUnique: jest.fn(), upsert: jest.fn() },
      });
      const res = await request(buildApp(prisma)).get('/api/v1/admin/user-activity').set('Authorization', authHeader('admin-1'));

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.body).toMatchObject({ totalUsers: 42, newUsers24h: 3, pendingKyc: 2 });
      expect(res.body.pendingDeposits).toEqual([
        { id: 'd1', userId: 'u1', asset: 'USDT', chain: 'tron', txHash: 'a'.repeat(64), amount: '2500', confirmations: 30, status: 'PENDING', createdAt: '2026-09-26T08:00:00.000Z' },
      ]);
      // One bounded read of the work queue: user-owned, not credited, newest first, capped.
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(findMany.mock.calls[0][0]).toMatchObject({
        where: { userId: { not: null }, status: { not: 'CREDITED' } }, orderBy: { createdAt: 'desc' }, take: 200,
      });
      expect(findMany.mock.calls[0][0].include).toBeUndefined();
      // Registrations in the last 24 hours and pending KYC are counts, not lists.
      expect(count.mock.calls[1][0].where.createdAt.gte).toBeInstanceOf(Date);
      expect(Date.now() - count.mock.calls[1][0].where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
      expect(count.mock.calls[2][0]).toEqual({ where: { kycStatus: 'PENDING' } });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('is admin-only and reads nothing for anyone else', async () => {
      const count = jest.fn();
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }), count } });
      const res = await request(buildApp(prisma)).get('/api/v1/admin/user-activity').set('Authorization', authHeader('u1'));
      expect(res.status).toBe(403);
      expect(count).not.toHaveBeenCalled();
      expect(prisma.deposit.findMany).not.toHaveBeenCalled();
    });

    it('answers 503 instead of a partial queue when the database fails', async () => {
      const prisma = adminPrisma({
        user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }), count: jest.fn().mockRejectedValue(new Error('db down')) },
      });
      const res = await request(buildApp(prisma)).get('/api/v1/admin/user-activity').set('Authorization', authHeader('admin-1'));
      expect(res.status).toBe(503);
    });
  });

  describe('GET /admin/deposits/recent-by-user', () => {
    it('returns one compact recent row per user without loading full deposit history', async () => {
      const queryRaw = jest.fn().mockResolvedValue([
        {
          userId: 'user-1',
          amount: { toString: () => '1250.50' },
          asset: 'USDT',
          createdAt: new Date('2026-09-25T12:00:00.000Z'),
        },
        {
          userId: 'user-2',
          amount: { toString: () => '0.25' },
          asset: 'BTC',
          createdAt: new Date('2026-09-25T11:00:00.000Z'),
        },
      ]);
      const findMany = jest.fn();
      const prisma = adminPrisma({
        $queryRaw: queryRaw,
        deposit: { findMany, findUnique: jest.fn(), upsert: jest.fn() },
      });
      const app = buildApp(prisma);

      const res = await request(app)
        .get('/api/v1/admin/deposits/recent-by-user')
        .set('Authorization', authHeader('admin-1'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { userId: 'user-1', amount: '1250.50', asset: 'USDT', createdAt: '2026-09-25T12:00:00.000Z' },
        { userId: 'user-2', amount: '0.25', asset: 'BTC', createdAt: '2026-09-25T11:00:00.000Z' },
      ]);
      expect(queryRaw).toHaveBeenCalledTimes(1);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('still requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app)
        .get('/api/v1/admin/deposits/recent-by-user')
        .set('Authorization', authHeader('u1'));

      expect(res.status).toBe(403);
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('GET /admin/deposits/incoming', () => {
    it('returns an empty list when no chain is configured', async () => {
      const prisma = adminPrisma();
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/deposits/incoming').set('Authorization', authHeader('admin-1'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('lists real incoming transfers and excludes ones already recorded', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qtreasury';
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';

      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/tx/')) return Promise.resolve({ ok: true, json: async () => ({ txid: url.split('/').pop(), vout: [{ scriptpubkey_address: 'bc1qtreasury', value: 100000 }], status: { confirmed: true, block_height: 100 } }) });
        if (url.includes('/address/')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve([
                { txid: 'tx-new', vout: [{ scriptpubkey_address: 'bc1qtreasury', value: 100000 }], status: { confirmed: true, block_height: 100 } },
                { txid: 'tx-old', vout: [{ scriptpubkey_address: 'bc1qtreasury', value: 50000 }], status: { confirmed: true, block_height: 90 } },
              ]),
          });
        }
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('105') });
      });

      const prisma = adminPrisma({
        deposit: {
          findUnique: jest.fn(async ({where}: any) => where.chain_txHash.txHash === 'tx-old' ? {status:'CREDITED'} : null),
          upsert: jest.fn(async ({create}: any) => create),
          findMany: jest.fn().mockResolvedValue([{ chain: 'bitcoin', txHash: 'tx-new', asset:'BTC', amount:'0.001', confirmations:6, status:'PENDING', createdAt:new Date() }]),
        },
      });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/deposits/incoming').set('Authorization', authHeader('admin-1'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual([expect.objectContaining({ chain: 'bitcoin', txHash: 'tx-new', asset: 'BTC' })]);
    });

    it('excludes transfers an admin has ignored, alongside already-recorded ones', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qtreasury';
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';

      (global.fetch as jest.Mock).mockImplementation((url: string) => {
        if (url.includes('/tx/')) return Promise.resolve({ok:true,json:async()=>({vout:[{scriptpubkey_address:'bc1qtreasury',value:100000}],status:{confirmed:true,block_height:100}})});
        if (url.includes('/address/')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () =>
              Promise.resolve([
                { txid: 'tx-new', vout: [{ scriptpubkey_address: 'bc1qtreasury', value: 100000 }], status: { confirmed: true, block_height: 100 } },
                { txid: 'tx-ignored', vout: [{ scriptpubkey_address: 'bc1qtreasury', value: 50000 }], status: { confirmed: true, block_height: 90 } },
              ]),
          });
        }
        return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('105') });
      });

      const prisma = adminPrisma({
        ignoredIncomingTransfer: { findMany: jest.fn().mockResolvedValue([{ chain: 'bitcoin', txHash: 'tx-ignored' }]) },
        deposit: {
          findUnique: jest.fn().mockResolvedValue(null), upsert:jest.fn(async ({create}: any) => create),
          findMany:jest.fn().mockResolvedValue(['tx-new','tx-ignored'].map(txHash=>({chain:'bitcoin',txHash,asset:'BTC',amount:'0.001',confirmations:6,status:'PENDING',createdAt:new Date()}))),
        },
      });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/deposits/incoming').set('Authorization', authHeader('admin-1'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual([expect.objectContaining({ chain: 'bitcoin', txHash: 'tx-new', asset: 'BTC' })]);
    });
  });

  describe('POST /admin/deposits/ignore', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app)
        .post('/api/v1/admin/deposits/ignore')
        .set('Authorization', authHeader('u1'))
        .send({ chain: 'bitcoin', txHash: 'tx-old' });
      expect(res.status).toBe(403);
    });

    it('records the ignored transfer so future feeds exclude it', async () => {
      const prisma = adminPrisma();
      const app = buildApp(prisma);

      const res = await request(app)
        .post('/api/v1/admin/deposits/ignore')
        .set('Authorization', authHeader('admin-1'))
        .send({ chain: 'bitcoin', txHash: 'tx-old' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ignored' });
      expect(prisma.ignoredIncomingTransfer.upsert).toHaveBeenCalledWith({
        where: { chain_txHash: { chain: 'bitcoin', txHash: 'tx-old' } },
        create: { chain: 'bitcoin', txHash: 'tx-old' },
        update: {},
      });
    });
  });

  describe('POST /admin/deposits/manual-credit', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app)
        .post('/api/v1/admin/deposits/manual-credit')
        .set('Authorization', authHeader('u1'))
        .send({ userId: 'x', chain: 'bitcoin', txHash: 'a'.repeat(64), asset: 'BTC' });
      expect(res.status).toBe(403);
    });

    it('400s an invalid tx hash for the chain', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qtreasury';
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }) } });
      const app = buildApp(prisma);

      const res = await request(app)
        .post('/api/v1/admin/deposits/manual-credit')
        .set('Authorization', authHeader('admin-1'))
        .send({ userId: '11111111-1111-1111-1111-111111111111', chain: 'bitcoin', txHash: '0xnotbitcoin', asset: 'BTC' });

      expect(res.status).toBe(400);
    });

    it('404s an unconfigured chain', async () => {
      const prisma = adminPrisma();
      const app = buildApp(prisma);
      const res = await request(app)
        .post('/api/v1/admin/deposits/manual-credit')
        .set('Authorization', authHeader('admin-1'))
        .send({ userId: '11111111-1111-1111-1111-111111111111', chain: 'bitcoin', txHash: 'a'.repeat(64), asset: 'BTC' });
      expect(res.status).toBe(404);
    });

    it('404s when the target user does not exist', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qtreasury';
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';
      const prisma = adminPrisma({
        user: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce({ role: 'ADMIN' }) // requireAdmin check
            .mockResolvedValueOnce(null), // target user lookup
        },
      });
      const app = buildApp(prisma);

      const res = await request(app)
        .post('/api/v1/admin/deposits/manual-credit')
        .set('Authorization', authHeader('admin-1'))
        .send({ userId: '11111111-1111-1111-1111-111111111111', chain: 'bitcoin', txHash: 'a'.repeat(64), asset: 'BTC' });

      expect(res.status).toBe(404);
    });

    it('credits the target user by reusing the idempotent claim path', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qtreasury';
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';
      const prisma = adminPrisma({
        user: {
          findUnique: jest
            .fn()
            .mockResolvedValueOnce({ role: 'ADMIN' })
            .mockResolvedValueOnce({ id: '11111111-1111-1111-1111-111111111111' }),
        },
        // Pre-existing Deposit row makes DepositService.claimDeposit take its
        // idempotent short-circuit — no real network call needed to prove
        // this route wires through to it correctly.
        deposit: { findUnique: jest.fn().mockResolvedValue({ userId:'11111111-1111-1111-1111-111111111111', asset:'BTC', status: 'CREDITED', amount: '0.05', confirmations: 3 }) },
      });
      const app = buildApp(prisma);

      const res = await request(app)
        .post('/api/v1/admin/deposits/manual-credit')
        .set('Authorization', authHeader('admin-1'))
        .send({ userId: '11111111-1111-1111-1111-111111111111', chain: 'bitcoin', txHash: 'a'.repeat(64), asset: 'BTC' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'CREDITED', amount: '0.05' });
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
