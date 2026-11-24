import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import type { PrismaClient } from '@prisma/client';
import { quantStudioRouter } from '../quantStudio';

const base = '/trading-bots/studio';
const input = { name: 'Local strategy', pair: 'XRP/USDT', description: 'A descriptive paper strategy.' };
function setup(eligible: boolean) {
  const findFirst = jest.fn(async ({ where }) =>
    where.premium === true &&
    where.OR.some(
      (entry: { studioAuthorUserId?: string; ownerUserId?: string | null }) =>
        entry.ownerUserId === null && entry.studioAuthorUserId === 'author',
    ) &&
    eligible
      ? { traderId: 'testing' }
      : null,
  );
  const drafts = {
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 'draft' }),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const session = { userId: 'author', id: 'session', revokedAt: null, lastSeenAt: new Date() };
  const tx = { copyStrategyOwner: { findFirst }, quantStrategyDraft: drafts };
  const db = {
    ...tx,
    session: { findUnique: jest.fn().mockResolvedValue(session) },
    $transaction: jest.fn((fn) => fn(tx)),
  };
  const app = express();
  app.use(express.json(), quantStudioRouter(db as unknown as PrismaClient, 'author'));
  const auth = {
    Authorization: 'Bearer ' + jwt.sign({ sub: 'author', sid: 'session' }, process.env.JWT_SECRET!),
  };
  return { app, auth, db, drafts, findFirst };
}
it('requires an active session and current premium physical ownership for each publication', async () => {
  const { app, auth, drafts, findFirst } = setup(false);
  await request(app).get(base).expect(401);
  await request(app)
    .post(base + '/drafts')
    .send(input)
    .expect(401);
  await request(app)
    .get(base)
    .set(auth)
    .expect(200, { canCreate: false, thomasVip: false, published: [], drafts: [] });
  await request(app)
    .post(base + '/drafts')
    .set(auth)
    .send(input)
    .expect(403);
  await request(app)
    .post(base + '/drafts/another/publish')
    .set(auth)
    .expect(403);
  expect(drafts.create).not.toHaveBeenCalled();
  expect(drafts.updateMany).not.toHaveBeenCalled();
  for (const [lookup] of findFirst.mock.calls)
    expect(lookup.where).toEqual({
      premium: true,
      OR: [{ ownerUserId: 'author' }, { ownerUserId: null, studioAuthorUserId: 'author' }],
    });
});
it('scopes unpublished metadata to the caller and publishes it at most once', async () => {
  const { app, auth, drafts } = setup(true);
  await request(app)
    .get(base)
    .set(auth)
    .expect(200, { canCreate: true, thomasVip: true, published: [], drafts: [] });
  expect(drafts.findMany.mock.calls[1][0].where).toEqual({ ownerUserId: 'author', publishedAt: null });
  await request(app)
    .post(base + '/drafts')
    .set(auth)
    .send({ ...input, ownerUserId: 'other', execute: true })
    .expect(400);
  await request(app)
    .post(base + '/drafts')
    .set(auth)
    .send(input)
    .expect(201);
  expect(drafts.create.mock.calls[0][0].data).toEqual({ ...input, ownerUserId: 'author' });
  await request(app)
    .post(base + '/drafts/foreign/publish')
    .set(auth)
    .expect(404);
  expect(drafts.updateMany.mock.calls[0][0].where).toEqual({
    id: 'foreign',
    ownerUserId: 'author',
    publishedAt: null,
  });
  drafts.updateMany.mockResolvedValueOnce({ count: 1 });
  await request(app)
    .post(base + '/drafts/draft/publish')
    .set(auth)
    .expect(200, { published: true });
  await request(app)
    .post(base + '/drafts/draft/publish')
    .set(auth)
    .expect(404);
});
