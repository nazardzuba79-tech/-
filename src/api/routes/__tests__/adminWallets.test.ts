process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { adminWalletsRouter } from '../adminWallets';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', adminWalletsRouter(prisma));
  return app;
}

function adminPrisma(overrides: any = {}) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }) },
    treasuryWallet: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    ...overrides,
  };
}

const OLD_ENV = process.env;

describe('admin wallets routes', () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV, JWT_SECRET: 'test-secret-at-least-this-long' };
    delete process.env.BITCOIN_TREASURY_ADDRESS;
    delete process.env.TRON_TREASURY_ADDRESS;
    delete process.env.ETHEREUM_TREASURY_ADDRESS;
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  describe('GET /admin/wallets', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/wallets').set('Authorization', authHeader('u1'));
      expect(res.status).toBe(403);
    });

    it('lists every known chain, falling back to the env default when there is no override', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qenv';
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';

      const prisma = adminPrisma();
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/wallets').set('Authorization', authHeader('admin-1'));

      expect(res.status).toBe(200);
      const bitcoin = res.body.find((r: any) => r.chain === 'bitcoin');
      expect(bitcoin).toMatchObject({ address: 'bc1qenv', isOverridden: false, envConfigured: true });

      const tron = res.body.find((r: any) => r.chain === 'tron');
      expect(tron).toMatchObject({ address: null, envConfigured: false });
    });

    it('prefers a saved override address over the env default', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qenv';
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';

      const prisma = adminPrisma({
        treasuryWallet: {
          findMany: jest.fn().mockResolvedValue([
            { chain: 'bitcoin', address: 'bc1qoverride', updatedByAdminId: 'admin-1', updatedAt: new Date('2026-02-01') },
          ]),
        },
      });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/wallets').set('Authorization', authHeader('admin-1'));

      const bitcoin = res.body.find((r: any) => r.chain === 'bitcoin');
      expect(bitcoin).toMatchObject({ address: 'bc1qoverride', isOverridden: true, updatedByAdminId: 'admin-1' });
    });
  });

  describe('PUT /admin/wallets/:chain', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app)
        .put('/api/v1/admin/wallets/bitcoin')
        .set('Authorization', authHeader('u1'))
        .send({ address: 'bc1qnew' });
      expect(res.status).toBe(403);
    });

    it('404s an unknown chain', async () => {
      const prisma = adminPrisma();
      const app = buildApp(prisma);
      const res = await request(app)
        .put('/api/v1/admin/wallets/dogecoin')
        .set('Authorization', authHeader('admin-1'))
        .send({ address: 'D123' });
      expect(res.status).toBe(404);
    });

    it('rejects an empty address', async () => {
      const prisma = adminPrisma();
      const app = buildApp(prisma);
      const res = await request(app)
        .put('/api/v1/admin/wallets/bitcoin')
        .set('Authorization', authHeader('admin-1'))
        .send({ address: '   ' });
      expect(res.status).toBe(400);
      expect(prisma.treasuryWallet.upsert).not.toHaveBeenCalled();
    });

    it('upserts the override and writes an audit log entry with the acting admin', async () => {
      const prisma = adminPrisma({
        treasuryWallet: {
          findMany: jest.fn().mockResolvedValue([]),
          upsert: jest.fn().mockResolvedValue({ chain: 'bitcoin', address: 'bc1qnew', updatedByAdminId: 'admin-1', updatedAt: new Date() }),
        },
      });
      const app = buildApp(prisma);
      const res = await request(app)
        .put('/api/v1/admin/wallets/bitcoin')
        .set('Authorization', authHeader('admin-1'))
        .send({ address: 'bc1qnew' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ chain: 'bitcoin', address: 'bc1qnew' });
      expect(prisma.treasuryWallet.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chain: 'bitcoin' },
          create: expect.objectContaining({ chain: 'bitcoin', address: 'bc1qnew', updatedByAdminId: 'admin-1' }),
          update: expect.objectContaining({ address: 'bc1qnew', updatedByAdminId: 'admin-1' }),
        })
      );
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'admin-1', action: 'TREASURY_WALLET_UPDATED', metadata: { chain: 'bitcoin', address: 'bc1qnew' } }),
        })
      );
    });
  });

  describe('DELETE /admin/wallets/:chain', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app).delete('/api/v1/admin/wallets/bitcoin').set('Authorization', authHeader('u1'));
      expect(res.status).toBe(403);
    });

    it('removes the override and logs which admin reset it', async () => {
      const prisma = adminPrisma();
      const app = buildApp(prisma);
      const res = await request(app).delete('/api/v1/admin/wallets/bitcoin').set('Authorization', authHeader('admin-1'));

      expect(res.status).toBe(200);
      expect(prisma.treasuryWallet.deleteMany).toHaveBeenCalledWith({ where: { chain: 'bitcoin' } });
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'admin-1', action: 'TREASURY_WALLET_RESET', metadata: { chain: 'bitcoin' } }),
        })
      );
    });
  });
});
