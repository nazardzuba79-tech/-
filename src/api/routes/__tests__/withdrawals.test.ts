process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { withdrawalsRouter, type WithdrawalsRouterOptions } from '../withdrawals';
import { PrivateTradingError } from '../../../private-trading/serviceTypes';
import { walletDelegate } from '../../../test-utils/walletDelegate';

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
  userId?: string;
  balance?: { available: string; locked: string } | null;
  withdrawals?: any[];
  claimed?: string | null;
  spot?: { asset: string; available: string }[];
  futures?: { asset: string; available: string }[];
} = {}) {
  const rows = new Map(opts.balance ? [[`${opts.userId ?? 'u1'}:USDT`, { ...opts.balance }]] : []);
  const tx = {
    balance: walletDelegate(rows),
    withdrawal: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'w-new', ...data })),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: opts.claimed ?? null } }),
    },
    auditLog: { create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  return {
    rows,
    tx,
    withdrawal: {
      findMany: jest.fn().mockResolvedValue(opts.withdrawals ?? []),
      aggregate: jest.fn().mockResolvedValue({ _sum: { amount: opts.claimed ?? null } }),
    },
    balance: { findMany: jest.fn().mockResolvedValue(opts.spot ?? []) },
    futuresBalance: { findMany: jest.fn().mockResolvedValue(opts.futures ?? []) },
    // Minted-listing and simulated-sale reads: none here (covered on PostgreSQL by syntheticProceedsFloor.pg.test.ts).
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (fn: any) => {
      const before = new Map([...rows].map(([key, row]) => [key, { ...row }]));
      try { return await fn(tx); } catch (error) {
        rows.clear(); before.forEach((row, key) => rows.set(key, row)); throw error;
      }
    }),
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
      const prisma = makePrisma({ balance: { available: '100', locked: '0' } });
      const app = buildApp(prisma);
      const res = await request(app)
        .post('/api/v1/withdrawals')
        .set('Authorization', authHeader('u1'))
        .send({ asset: 'USDT', network: 'TRC20', toAddress: 'Tabc', amount: '10' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'PENDING', amount: '10' });
      expect(prisma.rows.get('u1:USDT')).toEqual({ available: '90', locked: '10' });
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

    // Issue #617: a Cross wallet is valued from DemoBalance (or a preview fixture), so it files nothing, ever.
    it('refuses the request (403) and writes nothing, not even a request row', async () => {
      const prisma = makePrisma({ balance: { available: '0', locked: '0' } });
      const options = wallet([{ asset: 'USDT', available: '5000' }]);
      const res = await request(buildApp(prisma, options))
        .post('/api/v1/withdrawals')
        .set('Authorization', authHeader(TRADER))
        .send({ asset: 'USDT', network: 'TRC20', toAddress: 'TXYZ', amount: '1200' });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'Demo funds are not withdrawable', code: 'DEMO_FUNDS_NOT_WITHDRAWABLE' });
      expect(prisma.tx.withdrawal.create).not.toHaveBeenCalled();
      expect(prisma.tx.auditLog.create).not.toHaveBeenCalled();
      expect(prisma.tx.balance.findUnique).not.toHaveBeenCalled();
      expect(prisma.tx.balance.update).not.toHaveBeenCalled();
      expect(prisma.tx.balance.updateMany).not.toHaveBeenCalled();
      expect(prisma.tx.balance.upsert).not.toHaveBeenCalled();
      // The account's own identity reaches the reader, never one from the body.
      expect(options.tradingWallet).toHaveBeenCalledWith(expect.objectContaining({ userId: TRADER, sessionId: `test-session:${TRADER}` }));
    });

    it.each([['a small amount', 'USDT', '1'], ['the whole valuation', 'USDT', '5000'], ['an asset it does not hold', 'BTC', '0.1']])(
      'refuses %s the same way', async (_label, asset, amount) => {
        const prisma = makePrisma();
        const res = await request(buildApp(prisma, wallet([{ asset: 'USDT', available: '5000' }])))
          .post('/api/v1/withdrawals')
          .set('Authorization', authHeader(TRADER))
          .send({ asset, network: 'TRC20', toAddress: 'TXYZ', amount });
        expect(res.status).toBe(403);
        expect(prisma.tx.withdrawal.create).not.toHaveBeenCalled();
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

    it('lists nothing withdrawable: the wallet is demo-valued', async () => {
      const prisma = makePrisma({ claimed: '1000' });
      const res = await request(buildApp(prisma, wallet([{ asset: 'USDT', available: '5000' }, { asset: 'BTC', available: '0' }])))
        .get('/api/v1/withdrawals/options')
        .set('Authorization', authHeader(TRADER));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ source: 'TRADING', assets: [], futures: [] });
    });

    it('falls back to the spot ledger while the trading account is not opened', async () => {
      const prisma = makePrisma({ userId: TRADER, balance: { available: '100', locked: '0' } });
      const res = await request(buildApp(prisma, wallet(null)))
        .post('/api/v1/withdrawals')
        .set('Authorization', authHeader(TRADER))
        .send({ asset: 'USDT', network: 'TRC20', toAddress: 'TXYZ', amount: '10' });
      expect(res.status).toBe(200);
      expect(res.body.balanceHeld).toBe(true);
      expect(prisma.tx.balance.updateMany).toHaveBeenCalledWith({
        where: { userId: TRADER, asset: 'USDT', available: { gte: '10' } },
        data: { available: { increment: '-10' }, locked: { increment: '10' } },
      });
      expect(prisma.rows.get(`${TRADER}:USDT`)).toEqual({ available: '90', locked: '10' });
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

// Issue #617: the refusal of demo-valued (Cross wallet) requests is permanent. No demo switch — on, off, or any other
// value — opens it, and none of them changes an ordinary Balance-funded request.
describe('demo-valued withdrawal fence, independent of every demo switch', () => {
  const TRADER = '00000000-0000-4000-8000-000000000001';
  const SWITCHES = ['DEMO_SPOT_ENABLED', 'DEMO_WITHDRAWAL_GUARD_ENABLED', 'DEMO_LIQUIDITY_ENABLED'];
  const saved = { ids: process.env.PRIVATE_TRADING_TEST_USER_IDS, ...Object.fromEntries(SWITCHES.map(key => [key, process.env[key]])) } as Record<string, string | undefined>;
  const restore = (key: string, value: string | undefined) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };
  const set = (env: Record<string, string>) => { for (const key of SWITCHES) delete process.env[key]; Object.assign(process.env, env); };
  beforeAll(() => { process.env.PRIVATE_TRADING_TEST_USER_IDS = TRADER; });
  afterEach(() => { for (const key of SWITCHES) restore(key, saved[key]); });
  afterAll(() => restore('PRIVATE_TRADING_TEST_USER_IDS', saved.ids));
  const wallet = () => ({ tradingWallet: jest.fn().mockResolvedValue([{ asset: 'USDT', available: '5000' }]) });
  const body = { asset: 'USDT', network: 'TRC20', toAddress: 'TXYZ', amount: '1200' };
  const ENVS: [string, Record<string, string>][] = [
    ['every demo switch unset', {}],
    ['every demo switch explicitly false', { DEMO_SPOT_ENABLED: 'false', DEMO_WITHDRAWAL_GUARD_ENABLED: 'false', DEMO_LIQUIDITY_ENABLED: 'false' }],
    ['switch values other than "true"', { DEMO_WITHDRAWAL_GUARD_ENABLED: '1', DEMO_SPOT_ENABLED: 'TRUE', DEMO_LIQUIDITY_ENABLED: 'yes' }],
    ['DEMO_WITHDRAWAL_GUARD_ENABLED=true', { DEMO_WITHDRAWAL_GUARD_ENABLED: 'true' }],
    ['DEMO_SPOT_ENABLED=true', { DEMO_SPOT_ENABLED: 'true' }],
    ['DEMO_LIQUIDITY_ENABLED=true', { DEMO_LIQUIDITY_ENABLED: 'true' }],
    ['every demo switch on', { DEMO_SPOT_ENABLED: 'true', DEMO_WITHDRAWAL_GUARD_ENABLED: 'true', DEMO_LIQUIDITY_ENABLED: 'true' }],
  ];

  it.each(ENVS)('%s: a demo-valued account files nothing and lists nothing', async (_label, env) => {
    set(env);
    const prisma = makePrisma({ balance: { available: '5000', locked: '0' } });
    const post = await request(buildApp(prisma, wallet())).post('/api/v1/withdrawals').set('Authorization', authHeader(TRADER)).send(body);
    expect(post.status).toBe(403);
    expect(post.body).toEqual({ error: 'Demo funds are not withdrawable', code: 'DEMO_FUNDS_NOT_WITHDRAWABLE' });
    expect(prisma.tx.withdrawal.create).not.toHaveBeenCalled();
    expect(prisma.tx.auditLog.create).not.toHaveBeenCalled();
    expect(prisma.tx.balance.updateMany).not.toHaveBeenCalled();
    const options = await request(buildApp(prisma, wallet())).get('/api/v1/withdrawals/options').set('Authorization', authHeader(TRADER));
    expect(options.body).toEqual({ source: 'TRADING', assets: [], futures: [] });
  });

  it.each(ENVS)('%s: an ordinary Balance-funded request is held exactly as before', async (_label, env) => {
    set(env);
    const prisma = makePrisma({ userId: 'u1', balance: { available: '100', locked: '0' } });
    const res = await request(buildApp(prisma)).post('/api/v1/withdrawals').set('Authorization', authHeader('u1')).send({ ...body, amount: '10' });
    expect(res.status).toBe(200); expect(res.body.balanceHeld).toBe(true);
    expect(prisma.rows.get('u1:USDT')).toEqual({ available: '90', locked: '10' });
  });

  it.each(ENVS)('%s: a configured tester without an opened Cross wallet keeps the Balance path', async (_label, env) => {
    set(env);
    const prisma = makePrisma({ userId: TRADER, balance: { available: '100', locked: '0' } });
    const res = await request(buildApp(prisma, { tradingWallet: jest.fn().mockResolvedValue(null) }))
      .post('/api/v1/withdrawals').set('Authorization', authHeader(TRADER)).send({ ...body, amount: '10' });
    expect(res.status).toBe(200); expect(res.body.balanceHeld).toBe(true);
  });

  it('switching every demo switch between requests changes nothing: there is no switch for the fence', async () => {
    const app = buildApp(makePrisma(), wallet());
    const sequence: Record<string, string>[] = [{}, { DEMO_SPOT_ENABLED: 'true' }, {}, { DEMO_WITHDRAWAL_GUARD_ENABLED: 'true' }, {}];
    for (const env of sequence) {
      set(env);
      expect((await request(app).post('/api/v1/withdrawals').set('Authorization', authHeader(TRADER)).send(body)).status).toBe(403);
    }
  });
});
