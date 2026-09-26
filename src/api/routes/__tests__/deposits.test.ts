process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { depositsRouter } from '../deposits';
import { TreasuryWalletService } from '../../../services/TreasuryWalletService';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId, sid: `test-session:${userId}` }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any = {}, priceSource: any = { getTicker: jest.fn().mockResolvedValue(null) }) {
  // Route fixtures model the persisted sessions issued by the current login flow.
  prisma = { session: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, userId: where.id.replace('test-session:', ''), revokedAt: null, lastSeenAt: new Date() })) }, ...prisma };
  const app = express();
  app.use(express.json());
  const fullPrisma = { treasuryWallet: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) }, ...prisma };
  app.use('/api/v1', depositsRouter(fullPrisma, priceSource));
  return app;
}

const OLD_ENV = process.env;

describe('deposits routes', () => {
  beforeEach(() => {
    process.env = { ...OLD_ENV, JWT_SECRET: 'test-secret-at-least-this-long' };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  describe('GET /deposit-chains', () => {
    it('lists only the known chains that have a treasury address configured', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qexample';
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';
      delete process.env.TRON_TREASURY_ADDRESS;

      const app = buildApp();
      const res = await request(app).get('/api/v1/deposit-chains').set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(200);
      const chainNames = res.body.map((c: any) => c.chain);
      expect(chainNames).toEqual(['bitcoin']);
      expect(chainNames).not.toContain('tron');
    });

    it('lists ethereum once its env vars are configured', async () => {
      process.env.ETHEREUM_TREASURY_ADDRESS = '0xabc';
      process.env.ETHEREUM_NATIVE_ASSET = 'ETH';
      process.env.ETHEREUM_RPC_URL = 'https://rpc.example';

      const app = buildApp();
      const res = await request(app).get('/api/v1/deposit-chains').set('Authorization', authHeader('user-1'));

      expect(res.body.map((c: any) => c.chain)).toContain('ethereum');
    });

    it('omits ethereum when its env vars are not set', async () => {
      delete process.env.ETHEREUM_TREASURY_ADDRESS;

      const app = buildApp();
      const res = await request(app).get('/api/v1/deposit-chains').set('Authorization', authHeader('user-1'));

      expect(res.body.map((c: any) => c.chain)).not.toContain('ethereum');
    });

    it('requires authentication', async () => {
      const app = buildApp();
      const res = await request(app).get('/api/v1/deposit-chains');
      expect(res.status).toBe(401);
    });

    // The deposit screen lists every wallet at once. Carrying each address in
    // the config envelope is what lets it do that in ONE request instead of a
    // second round trip per chain.
    it('carries each chain treasury address in the includeConfig envelope', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qexample';
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';
      process.env.ETHEREUM_TREASURY_ADDRESS = '0xabc';
      process.env.ETHEREUM_NATIVE_ASSET = 'ETH';
      process.env.ETHEREUM_RPC_URL = 'https://rpc.example';

      const app = buildApp();
      const res = await request(app)
        .get('/api/v1/deposit-chains?includeConfig=true')
        .set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(200);
      const byChain = Object.fromEntries(res.body.chains.map((c: any) => [c.chain, c.address]));
      expect(byChain.bitcoin).toBe('bc1qexample');
      expect(byChain.ethereum).toBe('0xabc');
      // It must be the SAME value the per-chain route hands back, or the two
      // screens would print different addresses for one chain.
      const single = await request(app).get('/api/v1/deposit-address/bitcoin').set('Authorization', authHeader('user-1'));
      expect(single.body.address).toBe(byChain.bitcoin);
    });

    it('reflects an admin override in the envelope address, not just the env default', async () => {
      delete process.env.BITCOIN_TREASURY_ADDRESS;
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';

      const prisma = {
        treasuryWallet: { findMany: jest.fn().mockResolvedValue([{ chain: 'bitcoin', address: 'bc1qadmin-set' }]) },
      };
      const res = await request(buildApp(prisma))
        .get('/api/v1/deposit-chains?includeConfig=true')
        .set('Authorization', authHeader('user-1'));

      expect(res.body.chains.find((c: any) => c.chain === 'bitcoin').address).toBe('bc1qadmin-set');
    });

    // The panel's «Загрузка сетей…» was six override reads in sequence.
    // Every chain now resolves from ONE read, with no per-chain lookups.
    it('reads the address overrides for every chain in one query', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qexample';
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';
      process.env.ETHEREUM_TREASURY_ADDRESS = '0xenv';
      process.env.ETHEREUM_NATIVE_ASSET = 'ETH';
      const findMany = jest.fn().mockResolvedValue([{ chain: 'ethereum', address: '0xadmin' }]);
      const findUnique = jest.fn();
      const res = await request(buildApp({ treasuryWallet: { findMany, findUnique } }))
        .get('/api/v1/deposit-chains?includeConfig=true')
        .set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(200);
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(findUnique).not.toHaveBeenCalled();
      const byChain = Object.fromEntries(res.body.chains.map((c: any) => [c.chain, c.address]));
      expect(byChain.bitcoin).toBe('bc1qexample');
      expect(byChain.ethereum).toBe('0xadmin');
    });

    // Addresses almost never change: the list is resolved once and served
    // from memory until an admin edits an address.
    it('serves the list from memory and re-reads only after an address changes', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qexample';
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';
      let rows: any[] = [];
      const findMany = jest.fn(async () => rows);
      const upsert = jest.fn(async ({ create }: any) => { rows = [{ chain: create.chain, address: create.address }]; return rows[0]; });
      // One client shared by the deposits router and the admin write, as in
      // src/index.ts — the change counter is kept per client.
      const prisma = { session: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, userId: 'user-1', revokedAt: null, lastSeenAt: new Date() })) }, treasuryWallet: { findMany, upsert } };
      const app = express();
      app.use('/api/v1', depositsRouter(prisma as any, { getTicker: jest.fn().mockResolvedValue(null) } as any));
      const get = () => request(app).get('/api/v1/deposit-chains?includeConfig=true').set('Authorization', authHeader('user-1'));

      const first = await get();
      const second = await get();
      expect(findMany).toHaveBeenCalledTimes(1);
      expect(second.body.version).toBe(first.body.version);
      expect(first.body.version).toMatch(/^[0-9a-f]{16}$/);

      // An admin changes the bitcoin address through the service every
      // writer uses; the next open sees it, under a new fingerprint.
      await new TreasuryWalletService(prisma as any).upsert('bitcoin', 'bc1qadmin-new', 'admin-1');
      const third = await get();
      expect(findMany).toHaveBeenCalledTimes(2);
      expect(third.body.chains.find((c: any) => c.chain === 'bitcoin').address).toBe('bc1qadmin-new');
      expect(third.body.version).not.toBe(first.body.version);
    });

    it('answers the fingerprint alone, without a session, from memory', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qexample';
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';
      const findMany = jest.fn().mockResolvedValue([]);
      const app = buildApp({ treasuryWallet: { findMany } });
      const full = await request(app).get('/api/v1/deposit-chains?includeConfig=true').set('Authorization', authHeader('user-1'));
      const check = await request(app).get('/api/v1/deposit-config-version');

      expect(check.status).toBe(200);
      expect(check.body).toEqual({ version: full.body.version });
      expect(JSON.stringify(check.body)).not.toContain('bc1qexample');
      expect(findMany).toHaveBeenCalledTimes(1);
    });

    it('omits every chain, still 200, when the override read fails', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qexample';
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';
      const findMany = jest.fn().mockRejectedValue(new Error('db down'));
      const res = await request(buildApp({ treasuryWallet: { findMany } }))
        .get('/api/v1/deposit-chains?includeConfig=true')
        .set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(200);
      expect(res.body.chains).toEqual([]);
      expect(res.body.version).toBeUndefined();
      // A failure is not remembered: the next open reads again.
      findMany.mockResolvedValueOnce([]);
      const retry = await request(buildApp({ treasuryWallet: { findMany } }))
        .get('/api/v1/deposit-chains?includeConfig=true')
        .set('Authorization', authHeader('user-1'));
      expect(retry.body.chains.map((c: any) => c.chain)).toEqual(['bitcoin']);
    });

    // The bare array is the older contract. Adding a field to the envelope
    // must not change it.
    it('keeps the bare list free of address and supportedAssets', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qexample';
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';

      const app = buildApp();
      const res = await request(app).get('/api/v1/deposit-chains').set('Authorization', authHeader('user-1'));

      expect(res.body[0]).toEqual({ chain: 'bitcoin', nativeAsset: 'BTC', tokens: expect.any(Array) });
      expect(res.body[0]).not.toHaveProperty('address');
      expect(res.body[0]).not.toHaveProperty('supportedAssets');
    });

    it('omits a chain entirely rather than listing it with a blank address', async () => {
      delete process.env.BITCOIN_TREASURY_ADDRESS;
      delete process.env.TRON_TREASURY_ADDRESS;
      delete process.env.ETHEREUM_TREASURY_ADDRESS;

      const res = await request(buildApp())
        .get('/api/v1/deposit-chains?includeConfig=true')
        .set('Authorization', authHeader('user-1'));

      expect(res.body.chains.every((c: any) => typeof c.address === 'string' && c.address.length > 0)).toBe(true);
    });
  });

  describe('GET /deposit-address/:chain', () => {
    it('includes the native asset for bitcoin', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qexample';
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';

      const app = buildApp();
      const res = await request(app).get('/api/v1/deposit-address/bitcoin').set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(200);
      expect(res.body.supportedAssets).toEqual(['BTC']);
    });

    // The real bug this guards against: TronDepositVerifier only ever
    // checks TRC-20 token transfers, never native TRX — offering TRX here
    // would let a client "deposit" something that can never be verified or
    // even show up in the admin's incoming-transfers feed.
    it('excludes the native asset (TRX) for tron, offering only its TRC-20 tokens', async () => {
      process.env.TRON_TREASURY_ADDRESS = 'Texample';
      process.env.TRON_NATIVE_ASSET = 'TRX';
      process.env.TRON_TOKENS = 'USDT:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t:6';

      const app = buildApp();
      const res = await request(app).get('/api/v1/deposit-address/tron').set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(200);
      expect(res.body.supportedAssets).toEqual(['USDT']);
    });

    it('includes both the native asset and any tokens for an EVM chain', async () => {
      process.env.ETHEREUM_TREASURY_ADDRESS = '0xabc';
      process.env.ETHEREUM_NATIVE_ASSET = 'ETH';
      process.env.ETHEREUM_RPC_URL = 'https://rpc.example';
      process.env.ETHEREUM_TOKENS = 'USDT:0xdAC17F958D2ee523a2206206994597C13D831ec7:6';

      const app = buildApp();
      const res = await request(app).get('/api/v1/deposit-address/ethereum').set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(200);
      expect(res.body.supportedAssets).toEqual(['ETH', 'USDT']);
    });

    it('404s when the chain has no treasury address anywhere — env or admin override', async () => {
      delete process.env.BITCOIN_TREASURY_ADDRESS;
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';

      const app = buildApp();
      const res = await request(app).get('/api/v1/deposit-address/bitcoin').set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(404);
    });

    // The actual fix: an admin-set address (no env var at all) must work —
    // that's the entire point of TreasuryWalletService's override.
    it('200s using an admin-set override address even with no env var set', async () => {
      delete process.env.BITCOIN_TREASURY_ADDRESS;
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';

      const prisma = {
        treasuryWallet: {
          findUnique: jest.fn().mockResolvedValue({ chain: 'bitcoin', address: 'bc1qadmin-set' }),
        },
      };
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/deposit-address/bitcoin').set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(200);
      expect(res.body.address).toBe('bc1qadmin-set');
    });
  });

  describe('POST /deposits/claim/:chain', () => {
    it('accepts a 0x-prefixed hash for an EVM chain', async () => {
      process.env.ETHEREUM_TREASURY_ADDRESS = '0xabc';
      process.env.ETHEREUM_NATIVE_ASSET = 'ETH';
      process.env.ETHEREUM_RPC_URL = 'https://rpc.example';

      const prisma = { depositClaim: { count: jest.fn().mockResolvedValue(0), upsert: jest.fn().mockResolvedValue({}) }, deposit: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() } };
      const app = buildApp(prisma);
      const res = await request(app)
        .post('/api/v1/deposits/claim/ethereum')
        .set('Authorization', authHeader('user-1'))
        .send({ txHash: '0x' + '1'.repeat(64), asset: 'ETH', performedByAdminId: 'admin', status: 'CREDITED', amount: '999' });

      // A claim is a request for review only: stored as a hint, no chain call,
      // no attribution, no amount or registry state in the answer.
      expect(res.status).toBe(202);
      expect(res.body.status).toBe('SUBMITTED');
      expect(JSON.stringify(res.body)).not.toMatch(/999|CREDITED|amount/);
      expect(prisma.depositClaim.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: { userId: 'user-1', chain: 'ethereum', txHash: '0x' + '1'.repeat(64), asset: 'ETH' } }));
      expect(prisma.deposit.upsert).not.toHaveBeenCalled();
      expect(prisma.deposit.update).not.toHaveBeenCalled();
    });

    it('rejects a 0x-prefixed hash for a Bitcoin claim', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qexample';
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';

      const app = buildApp();
      const res = await request(app)
        .post('/api/v1/deposits/claim/bitcoin')
        .set('Authorization', authHeader('user-1'))
        .send({ txHash: '0x' + '1'.repeat(64), asset: 'BTC' });

      expect(res.status).toBe(400);
    });

    it('accepts a plain 64-hex hash for a Bitcoin claim', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qexample';
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';

      const app = buildApp({ depositClaim: { count: jest.fn().mockResolvedValue(0), upsert: jest.fn().mockResolvedValue({}) }, deposit: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() } });
      const res = await request(app)
        .post('/api/v1/deposits/claim/bitcoin')
        .set('Authorization', authHeader('user-1'))
        .send({ txHash: '1'.repeat(64), asset: 'BTC' });

      expect(res.status).toBe(202);
    });

    it('rejects an asset the chain does not accept and caps claims per day', async () => {
      process.env.BITCOIN_TREASURY_ADDRESS = 'bc1qexample';
      process.env.BITCOIN_NATIVE_ASSET = 'BTC';
      const app = buildApp({ depositClaim: { count: jest.fn().mockResolvedValue(0), upsert: jest.fn().mockResolvedValue({}) }, deposit: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() } });
      const bad = await request(app).post('/api/v1/deposits/claim/bitcoin').set('Authorization', authHeader('user-1')).send({ txHash: '1'.repeat(64), asset: 'DOGE' });
      expect(bad.status).toBe(400);
      const busy = buildApp({ depositClaim: { count: jest.fn().mockResolvedValue(50), upsert: jest.fn() } });
      const capped = await request(busy).post('/api/v1/deposits/claim/bitcoin').set('Authorization', authHeader('user-1')).send({ txHash: '1'.repeat(64), asset: 'BTC' });
      expect(capped.status).toBe(429);
    });

    it('returns 404 for an unconfigured chain', async () => {
      delete process.env.SOLANA_TREASURY_ADDRESS;
      const app = buildApp();
      const res = await request(app)
        .post('/api/v1/deposits/claim/solana')
        .set('Authorization', authHeader('user-1'))
        .send({ txHash: '1'.repeat(64), asset: 'SOL' });

      expect(res.status).toBe(404);
    });
  });

  describe('GET /deposits/me', () => {
    it("returns only this account's own CREDITED deposits — nothing awaiting review", async () => {
      const rows = [
        {
          id: 'dep-1',
          userId: 'user-1',
          asset: 'BTC',
          chain: 'bitcoin',
          txHash: 'a'.repeat(64),
          amount: { toString: () => '0.05' },
          confirmations: 3,
          status: 'CREDITED',
          createdAt: new Date('2026-01-01'),
        },
      ];
      const findManyMock = jest.fn().mockResolvedValue(rows);
      const prisma = { deposit: { findMany: findManyMock } };
      const app = buildApp(prisma);

      const res = await request(app).get('/api/v1/deposits/me').set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ asset: 'BTC', amount: '0.05', status: 'CREDITED' });
      expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1', status: 'CREDITED' } }));
    });

    it('requires authentication', async () => {
      const app = buildApp({ deposit: { findMany: jest.fn() } });
      const res = await request(app).get('/api/v1/deposits/me');
      expect(res.status).toBe(401);
    });
  });
});
