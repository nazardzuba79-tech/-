process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { productsRouter } from '../products';

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId }, process.env.JWT_SECRET!)}`;
}

function buildApp(prisma: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', productsRouter(prisma));
  return app;
}

function adminPrisma(overrides: any = {}) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }) },
    product: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
    },
    purchase: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

const priceableProduct = {
  id: 'prod-1',
  name: 'VIP Card',
  description: 'Priority support and a metal card',
  priceAmount: { toString: () => '99' },
  priceAsset: 'USDT',
  active: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

describe('products routes', () => {
  describe('GET /products', () => {
    it('lists only active products, publicly', async () => {
      const prisma = adminPrisma({ product: { findMany: jest.fn().mockResolvedValue([priceableProduct]) } });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/products');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([expect.objectContaining({ id: 'prod-1', priceAmount: '99' })]);
      expect(prisma.product.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { active: true } }));
    });
  });

  describe('POST /products', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', authHeader('u1'))
        .send({ name: 'X', description: 'Y', priceAmount: '10', priceAsset: 'USDT' });
      expect(res.status).toBe(403);
    });

    it('creates a product', async () => {
      const prisma = adminPrisma({ product: { create: jest.fn().mockResolvedValue(priceableProduct) } });
      const app = buildApp(prisma);
      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', authHeader('admin-1'))
        .send({ name: 'VIP Card', description: 'Priority support and a metal card', priceAmount: '99', priceAsset: 'USDT' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ id: 'prod-1', priceAmount: '99' });
    });

    it('rejects a non-positive price', async () => {
      const prisma = adminPrisma();
      const app = buildApp(prisma);
      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', authHeader('admin-1'))
        .send({ name: 'X', description: 'Y', priceAmount: '0', priceAsset: 'USDT' });
      expect(res.status).toBe(400);
      expect(prisma.product.create).not.toHaveBeenCalled();
    });
  });

  describe('GET /admin/products', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/products').set('Authorization', authHeader('u1'));
      expect(res.status).toBe(403);
    });

    it('lists every product regardless of active state', async () => {
      const inactive = { ...priceableProduct, id: 'prod-2', active: false };
      const prisma = adminPrisma({ product: { findMany: jest.fn().mockResolvedValue([priceableProduct, inactive]) } });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/admin/products').set('Authorization', authHeader('admin-1'));

      expect(res.status).toBe(200);
      expect(prisma.product.findMany).toHaveBeenCalledWith(expect.not.objectContaining({ where: expect.anything() }));
      expect(res.body.map((p: any) => p.id)).toEqual(['prod-1', 'prod-2']);
    });
  });

  describe('PATCH /products/:id', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app)
        .patch('/api/v1/products/prod-1')
        .set('Authorization', authHeader('u1'))
        .send({ name: 'New name' });
      expect(res.status).toBe(403);
    });

    it('rejects an empty update body', async () => {
      const prisma = adminPrisma();
      const app = buildApp(prisma);
      const res = await request(app).patch('/api/v1/products/prod-1').set('Authorization', authHeader('admin-1')).send({});
      expect(res.status).toBe(400);
      expect(prisma.product.update).not.toHaveBeenCalled();
    });

    it('updates the given fields, including reactivating a product', async () => {
      const prisma = adminPrisma({
        product: { update: jest.fn().mockResolvedValue({ ...priceableProduct, active: true }) },
      });
      const app = buildApp(prisma);
      const res = await request(app)
        .patch('/api/v1/products/prod-1')
        .set('Authorization', authHeader('admin-1'))
        .send({ active: true });

      expect(res.status).toBe(200);
      expect(prisma.product.update).toHaveBeenCalledWith({ where: { id: 'prod-1' }, data: { active: true } });
      expect(res.body).toMatchObject({ active: true });
    });

    it('404s an unknown product id', async () => {
      const prisma = adminPrisma({ product: { update: jest.fn().mockRejectedValue(new Error('not found')) } });
      const app = buildApp(prisma);
      const res = await request(app)
        .patch('/api/v1/products/nope')
        .set('Authorization', authHeader('admin-1'))
        .send({ name: 'X' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /products/:id', () => {
    it('requires an admin account', async () => {
      const prisma = adminPrisma({ user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } });
      const app = buildApp(prisma);
      const res = await request(app).delete('/api/v1/products/prod-1').set('Authorization', authHeader('u1'));
      expect(res.status).toBe(403);
    });

    it('soft-deletes by setting active: false', async () => {
      const prisma = adminPrisma();
      const app = buildApp(prisma);
      const res = await request(app).delete('/api/v1/products/prod-1').set('Authorization', authHeader('admin-1'));

      expect(res.status).toBe(204);
      expect(prisma.product.update).toHaveBeenCalledWith({ where: { id: 'prod-1' }, data: { active: false } });
    });
  });

  describe('GET /purchases/me', () => {
    it('requires authentication', async () => {
      const prisma = adminPrisma();
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/purchases/me');
      expect(res.status).toBe(401);
    });

    it("returns the caller's own purchases", async () => {
      const prisma = adminPrisma({
        purchase: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'p1', product: { name: 'VIP Card' }, amount: { toString: () => '99' }, asset: 'USDT', status: 'PENDING_FULFILLMENT', createdAt: new Date() },
          ]),
        },
      });
      const app = buildApp(prisma);
      const res = await request(app).get('/api/v1/purchases/me').set('Authorization', authHeader('user-1'));

      expect(res.status).toBe(200);
      expect(res.body).toEqual([expect.objectContaining({ productName: 'VIP Card', amount: '99' })]);
      expect(prisma.purchase.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1' } }));
    });
  });
});
