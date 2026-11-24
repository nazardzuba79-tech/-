import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import type { PrismaClient } from "@prisma/client";
import { quantStudioRouter } from "../quantStudio";

const base = "/trading-bots/studio";
const input = {
  name: "Local strategy",
  pair: "XRP/USDT",
  description: "A descriptive paper strategy.",
};
function setup(eligible: boolean) {
  const findFirst = jest.fn(async ({ where }) =>
    where.premium === true &&
    where.OR.some(
      (entry: { studioAuthorUserId?: string; ownerUserId?: string | null }) =>
        entry.ownerUserId === null && entry.studioAuthorUserId === "author",
    ) &&
    eligible
      ? { traderId: "testing" }
      : null,
  );
  const drafts = {
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: "draft" }),
    findFirst: jest.fn().mockResolvedValue({ publishedAt: null }),
    findUniqueOrThrow: jest
      .fn()
      .mockResolvedValue({ id: "author-card", revision: 2 }),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const session = {
    userId: "author",
    id: "session",
    revokedAt: null,
    lastSeenAt: new Date(),
  };
  const findMany = jest.fn(async ({ where }) =>
    where.premium &&
    where.OR.some(
      (clause: {
        ownerUserId: unknown;
        studioAuthorUserId?: { in: string[] };
      }) =>
        clause.ownerUserId === null &&
        clause.studioAuthorUserId?.in.includes("author"),
    ) &&
    eligible
      ? [{ ownerUserId: null, studioAuthorUserId: "author" }]
      : [],
  );
  const tx = {
    copyStrategyOwner: { findFirst, findMany },
    quantStrategyDraft: drafts,
  };
  const db = {
    ...tx,
    session: { findUnique: jest.fn().mockResolvedValue(session) },
    $transaction: jest.fn((fn) => fn(tx)),
  };
  const app = express();
  app.use(
    express.json(),
    quantStudioRouter(db as unknown as PrismaClient, "author"),
  );
  const auth = {
    Authorization:
      "Bearer " +
      jwt.sign({ sub: "author", sid: "session" }, process.env.JWT_SECRET!),
  };
  return { app, auth, db, drafts, findFirst };
}
it("requires an active session and current premium physical ownership for each publication", async () => {
  const { app, auth, drafts, findFirst } = setup(false);
  await request(app).get(base).expect(401);
  await request(app)
    .post(base + "/drafts")
    .send(input)
    .expect(401);
  await request(app)
    .get(base)
    .set(auth)
    .expect(200, {
      canCreate: false,
      thomasVip: false,
      published: [],
      drafts: [],
    });
  await request(app)
    .post(base + "/drafts")
    .set(auth)
    .send(input)
    .expect(403);
  await request(app)
    .post(base + "/drafts/another/publish")
    .set(auth)
    .expect(403);
  expect(drafts.create).not.toHaveBeenCalled();
  expect(drafts.updateMany).not.toHaveBeenCalled();
  for (const [lookup] of findFirst.mock.calls)
    expect(lookup.where).toEqual({
      premium: true,
      OR: [
        { ownerUserId: "author" },
        { ownerUserId: null, studioAuthorUserId: "author" },
      ],
    });
});
it("scopes unpublished metadata to the caller and publishes it at most once", async () => {
  const { app, auth, drafts } = setup(true);
  await request(app)
    .get(base)
    .set(auth)
    .expect(200, {
      canCreate: true,
      thomasVip: true,
      published: [],
      drafts: [],
    });
  expect(drafts.findMany.mock.calls[1][0].where).toEqual({
    ownerUserId: "author",
  });
  await request(app)
    .post(base + "/drafts")
    .set(auth)
    .send({ ...input, ownerUserId: "other", execute: true })
    .expect(400);
  await request(app)
    .post(base + "/drafts")
    .set(auth)
    .send(input)
    .expect(201);
  expect(drafts.create.mock.calls[0][0].data).toEqual({
    ...input,
    ownerUserId: "author",
  });
  await request(app)
    .post(base + "/drafts/foreign/publish")
    .set(auth)
    .expect(404);
  expect(drafts.updateMany.mock.calls[0][0].where).toEqual({
    id: "foreign",
    ownerUserId: "author",
    publishedAt: null,
  });
  drafts.updateMany.mockResolvedValueOnce({ count: 1 });
  await request(app)
    .post(base + "/drafts/draft/publish")
    .set(auth)
    .expect(200, { published: true });
  await request(app)
    .post(base + "/drafts/draft/publish")
    .set(auth)
    .expect(404);
});

const metadata = {
  category: "Grid",
  risk: "Умеренный",
  minInvestmentUsdt: 500,
  maxDrawdownStop: 10,
  lookbackWindow: 24,
  rebalanceInterval: "4 часа",
  presetLogoId: "atlas-grid",
  customLogoUrl: null,
};
it("rejects unauthorized updates, bad image containers and client financial overrides", async () => {
  const regular = setup(false),
    vip = setup(true);
  const url = base + "/drafts/author-card",
    card = { ...input, settings: metadata, revision: 1, published: true };
  await request(vip.app).patch(url).send(card).expect(401);
  await request(regular.app)
    .patch(url)
    .set(regular.auth)
    .send(card)
    .expect(403);
  for (const settings of [
    { ...metadata, includeModelDisclaimer: false },
    { ...metadata, customLogoUrl: "data:image/png;base64,eHl6" },
    { ...metadata, minInvestmentUsdt: -1 },
  ]) {
    await request(vip.app)
      .patch(url)
      .set(vip.auth)
      .send({ ...card, settings })
      .expect(400);
  }
  expect(vip.drafts.updateMany).not.toHaveBeenCalled();
});
it("pins edits and unpublication to owner and revision and reports stale versions", async () => {
  const { app, auth, drafts } = setup(true);
  const url = base + "/drafts/author-card",
    card = { ...input, settings: metadata, revision: 2, published: false };
  drafts.findFirst.mockResolvedValueOnce(null);
  await request(app).patch(url).set(auth).send(card).expect(404);
  await request(app).patch(url).set(auth).send(card).expect(409);
  drafts.updateMany.mockResolvedValueOnce({ count: 1 });
  await request(app).patch(url).set(auth).send(card).expect(200);
  expect(drafts.updateMany).toHaveBeenLastCalledWith({
    where: { id: "author-card", ownerUserId: "author", revision: 2 },
    data: {
      ...input,
      settings: metadata,
      revision: { increment: 1 },
      publishedAt: null,
    },
  });
});
