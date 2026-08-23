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
    deposit: { findMany: jest.fn().mockResolvedValue([]) },
    treasuryWallet: { findUnique: jest.fn().mockResolvedValue(null) },
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
          findMany: jest.fn().mockResolvedValue([
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
        deposit: { findMany: jest.fn().mockResolvedValue([{ chain: 'bitcoin', txHash: 'tx-old' }]) },
      });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/deposits/incoming').set('Authorization', authHeader('admin-1'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual([expect.objectContaining({ chain: 'bitcoin', txHash: 'tx-new', asset: 'BTC' })]);
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
        deposit: { findUnique: jest.fn().mockResolvedValue({ status: 'CREDITED', amount: '0.05', confirmations: 3 }) },
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
