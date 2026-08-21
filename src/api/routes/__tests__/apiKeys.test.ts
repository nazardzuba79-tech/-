process.env.JWT_SECRET = 'test-secret-at-least-this-long';
process.env.API_KEY_ENCRYPTION_SECRET = '0'.repeat(64);

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { apiKeysRouter } from '../apiKeys';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function makePrismaMock() {
  const store = new Map<string, any>();
  let counter = 0;
  return {
    apiKey: {
      create: jest.fn(async ({ data }: any) => {
        counter += 1;
        const row = { id: `key-${counter}`, createdAt: new Date(), lastUsedAt: null, revokedAt: null, ...data };
        store.set(row.id, row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        Array.from(store.values()).filter((k) => k.userId === where.userId && k.revokedAt === where.revokedAt)
      ),
      findUnique: jest.fn(async ({ where }: any) => store.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const row = store.get(where.id);
        Object.assign(row, data);
        return row;
      }),
    },
  } as any;
}

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', apiKeysRouter(prisma));
  return app;
}

describe('API key routes', () => {
  it('creates a key and returns the plaintext secret', async () => {
    const app = buildApp(makePrismaMock());

    const res = await request(app)
      .post('/api/v1/api-keys')
      .set('Authorization', authHeader('user-1'))
      .send({ label: 'My bot', canTrade: true });

    expect(res.status).toBe(201);
    expect(res.body.apiKey).toMatch(/^ak_/);
    expect(res.body.apiSecret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a missing label', async () => {
    const app = buildApp(makePrismaMock());

    const res = await request(app).post('/api/v1/api-keys').set('Authorization', authHeader('user-1')).send({});

    expect(res.status).toBe(400);
  });

  it('defaults canTrade to false when omitted', async () => {
    const app = buildApp(makePrismaMock());

    const res = await request(app)
      .post('/api/v1/api-keys')
      .set('Authorization', authHeader('user-1'))
      .send({ label: 'Read-only bot' });

    expect(res.body.canTrade).toBe(false);
  });

  it('lists keys without ever including the secret', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);
    await request(app).post('/api/v1/api-keys').set('Authorization', authHeader('user-1')).send({ label: 'A' });

    const res = await request(app).get('/api/v1/api-keys').set('Authorization', authHeader('user-1'));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].apiSecret).toBeUndefined();
    expect(res.body[0].encryptedSecret).toBeUndefined();
  });

  it('revokes a key and it disappears from the list', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);
    const created = await request(app).post('/api/v1/api-keys').set('Authorization', authHeader('user-1')).send({ label: 'A' });

    const del = await request(app).delete(`/api/v1/api-keys/${created.body.id}`).set('Authorization', authHeader('user-1'));
    expect(del.status).toBe(204);

    const list = await request(app).get('/api/v1/api-keys').set('Authorization', authHeader('user-1'));
    expect(list.body).toHaveLength(0);
  });

  it('returns 404 revoking a key that belongs to someone else', async () => {
    const prisma = makePrismaMock();
    const app = buildApp(prisma);
    const created = await request(app).post('/api/v1/api-keys').set('Authorization', authHeader('user-1')).send({ label: 'A' });

    const res = await request(app).delete(`/api/v1/api-keys/${created.body.id}`).set('Authorization', authHeader('user-2'));

    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const app = buildApp(makePrismaMock());
    const res = await request(app).get('/api/v1/api-keys');
    expect(res.status).toBe(401);
  });
});
