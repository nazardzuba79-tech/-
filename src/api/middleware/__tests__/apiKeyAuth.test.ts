process.env.JWT_SECRET = 'test-secret-at-least-this-long';
process.env.API_KEY_ENCRYPTION_SECRET = '0'.repeat(64);

import crypto from 'crypto';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { encryptApiSecret } from '../../../services/ApiKeyService';
import { requireAuthOrApiKey, requireTradePermission, ApiAuthedRequest } from '../apiKeyAuth';

const API_KEY = 'ak_testkey';
const API_SECRET = 'plaintext-secret-for-signing';

function makePrismaMock(overrides: Partial<any> = {}) {
  return {
    apiKey: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'apikey-1',
        userId: 'user-1',
        apiKey: API_KEY,
        encryptedSecret: encryptApiSecret(API_SECRET),
        canTrade: false,
        revokedAt: null,
      }),
      update: jest.fn().mockResolvedValue({}),
      ...overrides,
    },
  } as any;
}

function sign(secret: string, timestamp: string, method: string, path: string, body: unknown = {}) {
  const message = `${timestamp}${method}${path}${JSON.stringify(body)}`;
  return crypto.createHmac('sha256', secret).update(message).digest('hex');
}

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.post('/api/v1/probe', requireAuthOrApiKey(prisma), requireTradePermission, (req: ApiAuthedRequest, res) => {
    res.json({ userId: req.userId, apiKeyId: req.apiKeyId ?? null });
  });
  app.get('/api/v1/read-probe', requireAuthOrApiKey(prisma), (req: ApiAuthedRequest, res) => {
    res.json({ userId: req.userId });
  });
  return app;
}

describe('requireAuthOrApiKey', () => {
  it('authenticates a correctly signed request', async () => {
    const prisma = makePrismaMock({
      findUnique: jest.fn().mockResolvedValue({
        id: 'apikey-1', userId: 'user-1', apiKey: API_KEY, encryptedSecret: encryptApiSecret(API_SECRET), canTrade: true, revokedAt: null,
      }),
    });
    const app = buildApp(prisma);
    const timestamp = String(Date.now());
    const signature = sign(API_SECRET, timestamp, 'POST', '/api/v1/probe', {});

    const res = await request(app)
      .post('/api/v1/probe')
      .set('X-API-KEY', API_KEY)
      .set('X-API-TIMESTAMP', timestamp)
      .set('X-API-SIGNATURE', signature);

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('user-1');
    expect(res.body.apiKeyId).toBe('apikey-1');
  });

  it('rejects an incorrect signature', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);
    const timestamp = String(Date.now());

    const res = await request(app)
      .post('/api/v1/probe')
      .set('X-API-KEY', API_KEY)
      .set('X-API-TIMESTAMP', timestamp)
      .set('X-API-SIGNATURE', 'a'.repeat(64));

    expect(res.status).toBe(401);
  });

  it('rejects a stale timestamp', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);
    const timestamp = String(Date.now() - 60_000); // 60s old, tolerance is 30s
    const signature = sign(API_SECRET, timestamp, 'POST', '/api/v1/probe', {});

    const res = await request(app)
      .post('/api/v1/probe')
      .set('X-API-KEY', API_KEY)
      .set('X-API-TIMESTAMP', timestamp)
      .set('X-API-SIGNATURE', signature);

    expect(res.status).toBe(401);
  });

  it('rejects an unknown API key', async () => {
    const prisma = makePrismaMock({ findUnique: jest.fn().mockResolvedValue(null) });
    const app = buildApp(prisma);
    const timestamp = String(Date.now());

    const res = await request(app)
      .post('/api/v1/probe')
      .set('X-API-KEY', 'ak_doesnotexist')
      .set('X-API-TIMESTAMP', timestamp)
      .set('X-API-SIGNATURE', sign(API_SECRET, timestamp, 'POST', '/api/v1/probe', {}));

    expect(res.status).toBe(401);
  });

  it('rejects a revoked API key', async () => {
    const prisma = makePrismaMock({
      findUnique: jest.fn().mockResolvedValue({
        id: 'apikey-1', userId: 'user-1', apiKey: API_KEY, encryptedSecret: encryptApiSecret(API_SECRET), canTrade: true, revokedAt: new Date(),
      }),
    });
    const app = buildApp(prisma);
    const timestamp = String(Date.now());

    const res = await request(app)
      .post('/api/v1/probe')
      .set('X-API-KEY', API_KEY)
      .set('X-API-TIMESTAMP', timestamp)
      .set('X-API-SIGNATURE', sign(API_SECRET, timestamp, 'POST', '/api/v1/probe', {}));

    expect(res.status).toBe(401);
  });

  it('falls back to JWT auth when no X-API-KEY header is present', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);
    const token = jwt.sign({ sub: 'jwt-user' }, process.env.JWT_SECRET!);

    const res = await request(app).get('/api/v1/read-probe').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('jwt-user');
    expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
  });
});

describe('requireTradePermission', () => {
  it('blocks a read-only API key from the trade route', async () => {
    const prisma = makePrismaMock(); // canTrade: false
    const app = buildApp(prisma);
    const timestamp = String(Date.now());

    const res = await request(app)
      .post('/api/v1/probe')
      .set('X-API-KEY', API_KEY)
      .set('X-API-TIMESTAMP', timestamp)
      .set('X-API-SIGNATURE', sign(API_SECRET, timestamp, 'POST', '/api/v1/probe', {}));

    expect(res.status).toBe(403);
  });

  it('always allows a JWT-authenticated (browser) request through', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);
    const token = jwt.sign({ sub: 'jwt-user' }, process.env.JWT_SECRET!);

    const res = await request(app).post('/api/v1/probe').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });
});
