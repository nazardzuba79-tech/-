import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import type { PrismaClient } from "@prisma/client";
import { thomasProfileRouter } from "../thomasProfile";

const endpoint = "/trading-bots/range/author";
function setup(userId: string, role: string) {
  const db = {
    user: { findUnique: jest.fn().mockResolvedValue({ role }) },
    session: {
      findUnique: jest
        .fn()
        .mockResolvedValue({
          id: "fixture",
          userId,
          revokedAt: null,
          lastSeenAt: new Date(),
        }),
    },
    $queryRaw: jest
      .fn()
      .mockResolvedValue([{ bio: "Profile", links: {}, revision: 1 }]),
  };
  const app = express();
  app.use(
    express.json(),
    thomasProfileRouter(db as unknown as PrismaClient, "bound-owner", null),
  );
  const token = jwt.sign(
    { sub: userId, sid: "fixture" },
    process.env.JWT_SECRET!,
    { expiresIn: "10m" },
  );
  return {
    db,
    app,
    write: (payload: object) =>
      request(app)
        .put(endpoint)
        .set("Authorization", "Bearer " + token)
        .send(payload),
  };
}
const edit = { bio: "Profile", links: {}, revision: 0 };
test("authenticated owner or current server administrator can edit; untrusted input cannot assign ownership", async () => {
  for (const [id, role] of [
    ["bound-owner", "USER"],
    ["other", "ADMIN"],
  ]) {
    const { write, db } = setup(id, role);
    await write(edit).expect(200);
    expect(db.$queryRaw.mock.calls[0]).toContain("bound-owner");
    await write({ ...edit, ownerId: "another" }).expect(400);
  }
  const regular = setup("another", "USER");
  await regular.write(edit).expect(403);
  expect(regular.db.$queryRaw).not.toHaveBeenCalled();
  await request(regular.app).get(endpoint).expect(401);
});
test("rejects unknown networks, invalid URLs and stale revisions with no overwrite", async () => {
  const { db, write } = setup("bound-owner", "USER");
  await write({ ...edit, links: { unknown: "https://example.com" } }).expect(
    400,
  );
  await write({
    ...edit,
    links: { instagram: "https://other.com/artist" },
  }).expect(400);
  expect(db.$queryRaw).not.toHaveBeenCalled();
  db.$queryRaw.mockResolvedValueOnce([]);
  await write({ ...edit, revision: 7 }).expect(409);
});
