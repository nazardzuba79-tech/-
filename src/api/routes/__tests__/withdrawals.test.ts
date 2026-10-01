process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { withdrawalsRouter, type WithdrawalsRouterOptions } from '../withdrawals';
import { PrivateTradingError } from '../../../private-trading/serviceTypes';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId, sid: `test-session:${userId}` }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any, options: WithdrawalsRouterOptions = {}) {
  // Route fixtures model the persisted sessions issued by the current login flow.
  prisma = { session: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, userId: where.id.replace('test-session:', ''), revokedAt: null, lastSeenAt: new Date() })) }, ...prisma };
  const app = express();
  app.use(express.json());
  app.use('/api/v1', withdrawalsRouter(prisma, options));
  return app;
}

function makePrisma(opts: {
  balance?: { available: string; locked: string } | null;
  withdrawals?: any[];
  claimed?: string | null;
  spot?: { asset: string; available: string }[];
  futures?: { asset: string; available: string }[];
} = {}) {
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
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: opts.claimed ?? null } }),
    },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  return {
    tx,
    withdrawal: {
      findMany: jest.fn().mockResolvedValue(opts.withdrawals ?? []),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: opts.claimed ?? null } }),
    },
    balance: { findMany: jest.fn().mockResolvedValue(opts.spot ?? []) },
    futuresBalance: { findMany: jest.fn().mockResolvedValue(opts.futures ?? []) },
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

  describe('Cross trading accounts (owner and configured test accounts)', () => {
    const TRADER = '00000000-0000-4000-8000-000000000001';
    const previous = process.env.PRIVATE_TRADING_TEST_USER_IDS;
    beforeAll(() => { process.env.PRIVATE_TRADING_TEST_USER_IDS = TRADER; });
    afterAll(() => { if (previous === undefined) delete process.env.PRIVATE_TRADING_TEST_USER_IDS; else process.env.PRIVATE_TRADING_TEST_USER_IDS = previous; });
    const wallet = (rows: { asset: string; available: string }[] | null) => ({ tradingWallet: jest.fn().mockResolvedValue(rows) });

    it('records the request without touching any Balance row', async () => {
      const prisma = makePrisma({ balance: { available: '0', locked: '0' } });
      const options = wallet([{ asset: 'USDT', available: '5000' }]);
      const res = await request(buildApp(prisma, options))
        .post('/api/v1/withdrawals')
        .set('Authorization', authHeader(TRADER))
        .send({ asset: 'USDT', network: 'TRC20', toAddress: 'TXYZ', amount: '1200' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'PENDING', amount: '1200', balanceHeld: false });
      expect(prisma.tx.withdrawal.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ balanceHeld: false }) }));
      expect(prisma.tx.balance.findUnique).not.toHaveBeenCalled();
      expect(prisma.tx.balance.update).not.toHaveBeenCalled();
      // The account's own identity reaches the reader, never one from the body.
      expect(options.tradingWallet).toHaveBeenCalledWith(expect.objectContaining({ userId: TRADER, sessionId: `test-session:${TRADER}` }));
    });

    it('refuses more than the account can withdraw once earlier requests are counted', async () => {
      const prisma = makePrisma({ claimed: '4000' });
      const res = await request(buildApp(prisma, wallet([{ asset: 'USDT', available: '5000' }])))
        .post('/api/v1/withdrawals')
        .set('Authorization', authHeader(TRADER))
        .send({ asset: 'USDT', network: 'TRC20', toAddress: 'TXYZ', amount: '1200' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Insufficient USDT balance');
      expect(prisma.tx.withdrawal.create).not.toHaveBeenCalled();
    });

    it('refuses an asset the account does not hold', async () => {
      const res = await request(buildApp(makePrisma(), wallet([{ asset: 'USDT', available: '5000' }])))
        .post('/api/v1/withdrawals')
        .set('Authorization', authHeader(TRADER))
        .send({ asset: 'BTC', network: 'Bitcoin', toAddress: 'bc1qxyz', amount: '0.1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Insufficient BTC balance');
    });

    it('answers 503, not a guess, when the account cannot be valued', async () => {
      const options = { tradingWallet: jest.fn().mockRejectedValue(new Error('upstream down')) };
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const res = await request(buildApp(makePrisma(), options))
        .post('/api/v1/withdrawals')
        .set('Authorization', authHeader(TRADER))
        .send({ asset: 'USDT', network: 'TRC20', toAddress: 'TXYZ', amount: '10' });
      spy.mockRestore();
      expect(res.status).toBe(503);
    });

    it('passes an access refusal through with its own status', async () => {
      const options = { tradingWallet: jest.fn().mockRejectedValue(new PrivateTradingError('session_expired', 'Войдите в аккаунт повторно', 401)) };
      const res = await request(buildApp(makePrisma(), options))
        .get('/api/v1/withdrawals/options')
        .set('Authorization', authHeader(TRADER));
      expect(res.status).toBe(401);
    });

    it('lists what is withdrawable, net of earlier requests', async () => {
      const prisma = makePrisma({ claimed: '1000' });
      const res = await request(buildApp(prisma, wallet([{ asset: 'USDT', available: '5000' }, { asset: 'BTC', available: '0' }])))
        .get('/api/v1/withdrawals/options')
        .set('Authorization', authHeader(TRADER));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ source: 'TRADING', assets: [{ asset: 'USDT', available: '4000' }], futures: [] });
    });

    it('falls back to the spot ledger while the trading account is not opened', async () => {
      const prisma = makePrisma({ balance: { available: '100', locked: '0' } });
      const res = await request(buildApp(prisma, wallet(null)))
        .post('/api/v1/withdrawals')
        .set('Authorization', authHeader(TRADER))
        .send({ asset: 'USDT', network: 'TRC20', toAddress: 'TXYZ', amount: '10' });
      expect(res.status).toBe(200);
      expect(res.body.balanceHeld).toBe(true);
      expect(prisma.tx.balance.update).toHaveBeenCalled();
    });
  });

  describe('GET /withdrawals/options for an ordinary account', () => {
    it('lists spot funds, and futures funds separately', async () => {
      const prisma = makePrisma({
        spot: [{ asset: 'USDT', available: '25' }, { asset: 'ETH', available: '0' }, { asset: 'VTA', available: '10' }],
        futures: [{ asset: 'USDT', available: '300' }],
      });
      const options = { tradingWallet: jest.fn() };
      const res = await request(buildApp(prisma, options)).get('/api/v1/withdrawals/options').set('Authorization', authHeader('u1'));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ source: 'SPOT', assets: [{ asset: 'USDT', available: '25' }], futures: [{ asset: 'USDT', available: '300' }] });
      // An ordinary account never reaches the trading-account reader.
      expect(options.tradingWallet).not.toHaveBeenCalled();
    });
  });

  describe('request shape', () => {
    it.each([
      ['an exponent amount', { amount: '1e3' }],
      ['an address with spaces', { toAddress: 'T abc' }],
      ['an over-long network', { network: 'N'.repeat(40) }],
    ])('400s %s', async (_label, patch) => {
      const res = await request(buildApp(makePrisma({ balance: { available: '100', locked: '0' } })))
        .post('/api/v1/withdrawals')
        .set('Authorization', authHeader('u1'))
        .send({ asset: 'USDT', network: 'TRC20', toAddress: 'Tabc', amount: '10', ...patch });
      expect(res.status).toBe(400);
    });
  });
});
