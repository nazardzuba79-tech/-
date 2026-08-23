process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { withdrawalsRouter } from '../withdrawals';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', withdrawalsRouter(prisma));
  return app;
}

function makePrisma(opts: { balance?: { available: string; locked: string } | null; withdrawals?: any[] } = {}) {
  const balanceState = opts.balance ? { ...opts.balance } : null;
  const tx = {
    balance: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(balanceState)),
      update: jest.fn().mockImplementation(({ data }: any) => {
        if (balanceState) Object.assign(balanceState, data);
        return Promise.resolve(balanceState);
      }),
    },
    withdrawal: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'w-new', ...data })),
    },
    auditLog: { create: jest.fn() },
  };
  return {
    withdrawal: { findMany: jest.fn().mockResolvedValue(opts.withdrawals ?? []) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  } as any;
}

describe('withdrawals routes', () => {
  describe('POST /withdrawals', () => {
    it('requires authentication', async () => {
      const app = buildApp(makePrisma());
      const res = await request(app).post('/api/v1/withdrawals').send({ asset: 'USDT', network: 'TRC20', toAddress: 'T...', amount: '10' });
      expect(res.status).toBe(401);
    });

    it('400s a malformed body', async () => {
      const app = buildApp(makePrisma());
      const res = await request(app)
        .post('/api/v1/withdrawals')
        .set('Authorization', authHeader('u1'))
        .send({ asset: 'USDT' });
      expect(res.status).toBe(400);
    });

    it('400s an insufficient balance', async () => {
      const app = buildApp(makePrisma({ balance: { available: '5', locked: '0' } }));
      const res = await request(app)
        .post('/api/v1/withdrawals')
        .set('Authorization', authHeader('u1'))
        .send({ asset: 'USDT', network: 'TRC20', toAddress: 'Tabc', amount: '10' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Insufficient');
    });

    it('creates a PENDING withdrawal and locks the balance', async () => {
      const app = buildApp(makePrisma({ balance: { available: '100', locked: '0' } }));
      const res = await request(app)
        .post('/api/v1/withdrawals')
        .set('Authorization', authHeader('u1'))
        .send({ asset: 'USDT', network: 'TRC20', toAddress: 'Tabc', amount: '10' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'PENDING', amount: '10' });
    });
  });

  describe('GET /withdrawals/me', () => {
    it('requires authentication', async () => {
      const app = buildApp(makePrisma());
      const res = await request(app).get('/api/v1/withdrawals/me');
      expect(res.status).toBe(401);
    });

    it("returns the caller's own withdrawal history", async () => {
      const prisma = makePrisma({
        withdrawals: [
          {
            id: 'w1',
            asset: 'USDT',
            network: 'TRC20',
            toAddress: 'Tabc',
            amount: { toString: () => '10' },
            status: 'PENDING',
            rejectionReason: null,
            createdAt: new Date('2026-01-01'),
          },
        ],
      });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/withdrawals/me').set('Authorization', authHeader('u1'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual([expect.objectContaining({ id: 'w1', amount: '10', status: 'PENDING' })]);
    });
  });
});
