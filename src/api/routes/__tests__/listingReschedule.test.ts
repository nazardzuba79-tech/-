process.env.JWT_SECRET = 'local-reschedule-test-not-production';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { adminListingsRouter } from '../adminListings';
import type { ListingStore } from '../../../services/listings/store';

test('reschedule requires authenticated ADMIN; strict body, server actor and invalidated registry', async () => {
  const reschedule = jest.fn().mockResolvedValue({ id: 'nryia-demo', listingAt: '2026-11-16T13:00:00Z' });
  const registry = { invalidate: jest.fn(), ensureFresh: jest.fn() };
  const prisma = { user: { findUnique: jest.fn(({ where }) => ({ role: where.id === 'admin' ? 'ADMIN' : 'USER' })) } };
  const app = express(); app.use(express.json());
  app.use(adminListingsRouter(prisma as never, { reschedule } as unknown as ListingStore, null, registry));
  const path = '/admin/listings/nryia-demo/reschedule';
  const body = { days: 1, draftRevision: 1, activeVersion: 1, operationKey: 'reschedule-test-0001' };
  const auth = (sub: string) => `Bearer ${jwt.sign({ sub }, process.env.JWT_SECRET!)}`;
  expect((await request(app).post(path).send(body)).status).toBe(401);
  expect((await request(app).post(path).set('Authorization', auth('user')).send(body)).status).toBe(403);
  for (const bad of [{ ...body, days: 4 }, { ...body, days: '1' }, { ...body, actor: 'admin' }, { ...body, draftRevision: 0 }, { ...body, operationKey: 'bad' }])
    expect((await request(app).post(path).set('Authorization', auth('admin')).send(bad)).status).toBe(400);
  expect(reschedule).not.toHaveBeenCalled();
  expect((await request(app).post(path).set('Authorization', auth('admin')).send(body)).status).toBe(200);
  expect(reschedule).toHaveBeenCalledWith('nryia-demo', body, 'admin');
  expect(registry.invalidate).toHaveBeenCalledTimes(1);
});
