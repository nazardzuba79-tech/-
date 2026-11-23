import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { PrismaClient } from '@prisma/client';
import { tradingBotCreatorsRouter } from '../tradingBotCreators';

const path = '/api/v1/trading-bots/creators';
function fixture(binding: string) {
  const findUnique = jest.fn();
  const prisma = { user: { findUnique }, session: { findUnique: jest.fn().mockResolvedValue({
    id: 'local-session', userId: 'viewer', revokedAt: null, lastSeenAt: new Date(),
  }) } };
  const app = express();
  app.use('/api/v1', tradingBotCreatorsRouter(prisma as unknown as PrismaClient, binding));
  const token = jwt.sign({ sub: 'viewer', sid: 'local-session' }, process.env.JWT_SECRET!, { expiresIn: '10m' });
  return { app, findUnique, get: () => request(app).get(path).set('Authorization', 'Bearer ' + token) };
}

it('only reads the bound author and picks up profile changes for a different signed-in viewer', async () => {
  const { app, findUnique, get } = fixture('bound-thomas');
  await request(app).get(path).expect(401);
  expect(findUnique).not.toHaveBeenCalled();
  const avatarUrl = 'data:image/png;base64,aGVsbG8=';
  findUnique.mockResolvedValueOnce({ displayName: ' Thomas ', avatarUrl })
    .mockResolvedValueOnce({ displayName: 'Updated name', avatarUrl: null });
  await get().expect(200, { creators: { range: { displayName: 'Thomas', avatarUrl } } });
  await get().expect(200, { creators: { range: { displayName: 'Updated name', avatarUrl: null } } });
  expect(findUnique.mock.calls).toEqual(Array(2).fill([{ where: { id: 'bound-thomas' }, select: { displayName: true, avatarUrl: true } }]));
});

it('uses the catalogue fallback without a binding or a matching owner', async () => {
  const unbound = fixture('');
  await unbound.get().expect(200, { creators: {} });
  expect(unbound.findUnique).not.toHaveBeenCalled();
  const missing = fixture('missing');
  missing.findUnique.mockResolvedValue(null);
  await missing.get().expect(200, { creators: {} });
});

it('omits unsafe identity fields', async () => {
  const { get, findUnique } = fixture('bound-thomas');
  findUnique.mockResolvedValue({ displayName: 'A\u202eB', avatarUrl: 'https://example.invalid/tracker' });
  await get().expect(200, { creators: { range: { displayName: null, avatarUrl: null } } });
});

it('serves only bot aggregate history, requires authentication and exposes no trading action', async () => {
  const {app,findUnique} = fixture('');
  const url = '/api/v1/trading-bots/range/performance';
  await request(app).get(url).expect(401);
  const token = jwt.sign({ sub: 'viewer', sid: 'local-session' }, process.env.JWT_SECRET!, { expiresIn: '10m' });
  const auth = { Authorization: 'Bearer ' + token };
  await request(app).get(url + '?creatorUserId=other&path=other').set(auth).expect(200,{status:'unavailable'});
  await request(app).post(url).set(auth).expect(404);
  await request(app).get('/api/v1/trading-bots/other/performance').set(auth).expect(404);
  expect(findUnique).not.toHaveBeenCalled();
});
