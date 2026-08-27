process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { depositsRouter } from '../deposits';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any = {}, priceSource: any = { getTicker: jest.fn().mockResolvedValue(null) }) {
  const app = express();
  app.use(express.json());
  const fullPrisma = { treasuryWallet: { findUnique: jest.fn().mockResolvedValue(null) }, ...prisma };
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

    // TronDepositVerifier verifies both native TRX (via TransferContract)
    // and TRC-20 token transfers, so both should be offered here.
    it('includes both the native asset (TRX) and TRC-20 tokens for tron', async () => {
      process.env.TRON_TREASURY_ADDRESS = 'Texample';
      process.env.TRON_NATIVE_ASSET = 'TRX';
      process.env.TRON_TOKENS = 'USDT:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t:6';

      const app = buildApp();
      const res = await request(app).get('/api/v1/deposit-address/tron').set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(200);
      expect(res.body.supportedAssets).toEqual(['TRX', 'USDT']);
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

      const app = buildApp({ deposit: { findUnique: jest.fn().mockResolvedValue({ status: 'PENDING', amount: '1', confirmations: 0 }) } });
      const res = await request(app)
        .post('/api/v1/deposits/claim/ethereum')
        .set('Authorization', authHeader('user-1'))
        .send({ txHash: '0x' + '1'.repeat(64), asset: 'ETH' });

      expect(res.status).toBe(200);
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

      const app = buildApp({ deposit: { findUnique: jest.fn().mockResolvedValue({ status: 'PENDING', amount: '1', confirmations: 0 }) } });
      const res = await request(app)
        .post('/api/v1/deposits/claim/bitcoin')
        .set('Authorization', authHeader('user-1'))
        .send({ txHash: '1'.repeat(64), asset: 'BTC' });

      expect(res.status).toBe(200);
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
    it("returns only this account's own deposits, newest first", async () => {
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
      expect(findManyMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' }, orderBy: { createdAt: 'desc' } })
      );
    });

    it('requires authentication', async () => {
      const app = buildApp({ deposit: { findMany: jest.fn() } });
      const res = await request(app).get('/api/v1/deposits/me');
      expect(res.status).toBe(401);
    });
  });
});
