process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { depositsRouter } from '../deposits';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', depositsRouter(prisma));
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

    it('never lists ethereum, even if its env vars happen to be set', async () => {
      process.env.ETHEREUM_TREASURY_ADDRESS = '0xabc';
      process.env.ETHEREUM_NATIVE_ASSET = 'ETH';
      process.env.ETHEREUM_RPC_URL = 'https://rpc.example';

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
});
