process.env.JWT_SECRET = process.env.JWT_SECRET || 'kyc-pg-test-secret-at-least-32-chars';

import express from 'express';
import request from 'supertest';
import { generateKeyPairSync, sign as edSign, randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { kycRouter } from '../kyc';
import { KycEdgeTrust, KYC_EDGE_BODY_TYPE, kycSubmissionId } from '../../../services/KycEdgeTrust';

/**
 * The KYC edge's metadata record against real PostgreSQL (after
 * `prisma migrate deploy`): legacy rows survive the migration, a confirmed
 * submission is one small row with no file path, a repeated or racing
 * callback never makes a second row, and two different attempts for one
 * user can never both become PENDING. Synthetic data only. Runs only against
 * a disposable localhost database named voltex_kyc_test
 * (CI: .github/workflows/kyc-edge.yml).
 */

const url = process.env.KYC_TEST_DATABASE_URL;
const pg = url ? describe : describe.skip;

pg('KYC edge metadata on real PostgreSQL', () => {
  if (url) {
    const parsed = new URL(url);
    if (parsed.hostname !== '127.0.0.1' || parsed.pathname !== '/voltex_kyc_test') throw new Error('disposable localhost test database required');
  }
  const db = new PrismaClient({ datasources: { db: { url: url ?? 'postgresql://localhost/disabled' } } });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  process.env.KYC_EDGE_PUBLIC_KEY = (publicKey.export({ format: 'jwk' }) as { x: string }).x;
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/v1', kycRouter(db, new KycEdgeTrust()));

  function confirm(userId: string, requestId = randomUUID()) {
    const submissionId = kycSubmissionId(userId, requestId);
    const body = JSON.stringify({
      requestId, submissionId, userId, country: 'UA', fullName: 'Synthetic PG Person', dateOfBirth: '1990-01-01',
      documentType: 'ID_CARD', documentMimeType: 'application/pdf', documentSizeBytes: 123_456,
      emailMessageId: `${submissionId}@voltextech.net`, emailAcceptedAt: new Date().toISOString(),
    });
    const ts = String(Date.now());
    const path = '/api/v1/internal/kyc/submission-confirmed';
    const sig = edSign(null, Buffer.from(`v1\n${ts}\n${path}\n${body}`), privateKey).toString('base64url');
    return { submissionId, send: () => request(app).post(path).set('Content-Type', KYC_EDGE_BODY_TYPE).set('x-voltex-kyc-edge-ts', ts).set('x-voltex-kyc-edge-sig', sig).send(body) };
  }

  async function freshUser(tag: string) {
    return db.user.create({ data: { email: `kyc-pg-${tag}-${randomUUID()}@example.invalid`, passwordHash: 'QA_ONLY', referralCode: `KYCPG${randomUUID().slice(0, 8)}` } });
  }

  afterAll(async () => {
    await db.$disconnect();
    delete process.env.KYC_EDGE_PUBLIC_KEY;
  });

  it('the migration is additive: legacy rows keep their file path, new rows may have none', async () => {
    const user = await freshUser('legacy');
    const legacy = await db.kycSubmission.create({ data: { userId: user.id, country: 'UA', fullName: 'Synthetic Legacy', dateOfBirth: new Date('1980-05-05'), documentType: 'PASSPORT', documentImagePath: '/app/uploads/kyc/legacy.jpg' } });
    expect((await db.kycSubmission.findUniqueOrThrow({ where: { id: legacy.id } })).documentImagePath).toBe('/app/uploads/kyc/legacy.jpg');
    const cols = await db.$queryRaw<{ column_name: string; data_type: string; is_nullable: string }[]>`
      SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'KycSubmission'`;
    const byName = Object.fromEntries(cols.map((c) => [c.column_name, c]));
    expect(byName.documentImagePath.is_nullable).toBe('YES');
    for (const c of ['documentDelivery', 'emailMessageId', 'emailAcceptedAt', 'documentMimeType', 'documentSizeBytes']) expect(byName[c]).toBeDefined();
    expect(cols.filter((c) => c.data_type === 'bytea')).toEqual([]);
  });

  it('a confirmed submission is one small metadata row; the user becomes PENDING', async () => {
    const user = await freshUser('ok');
    const c = confirm(user.id);
    const res = await c.send();
    expect(res.status).toBe(201);
    const row = await db.kycSubmission.findUniqueOrThrow({ where: { id: c.submissionId } });
    expect(row).toMatchObject({ userId: user.id, status: 'PENDING', documentImagePath: null, documentDelivery: 'EMAIL', documentSizeBytes: 123_456 });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).kycStatus).toBe('PENDING');
    const [{ bytes }] = await db.$queryRaw<{ bytes: number }[]>`SELECT pg_column_size(k.*)::int AS bytes FROM "KycSubmission" k WHERE id = ${c.submissionId}`;
    expect(bytes).toBeLessThan(2048);
  });

  it('the same callback five times at once → exactly one row', async () => {
    const user = await freshUser('same');
    const c = confirm(user.id);
    const results = await Promise.all(Array.from({ length: 5 }, () => c.send()));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(await db.kycSubmission.count({ where: { userId: user.id } })).toBe(1);
  });

  it('two different attempts racing for one user → one PENDING, the other is a no-op', async () => {
    const user = await freshUser('race');
    const [a, b] = [confirm(user.id), confirm(user.id)];
    const [ra, rb] = await Promise.all([a.send(), b.send()]);
    expect([ra.body.status, rb.body.status].sort()).toEqual(['created', 'duplicate_pending']);
    expect(await db.kycSubmission.count({ where: { userId: user.id, status: 'PENDING' } })).toBe(1);
  });

  it('an approved user is never moved back to PENDING by a late callback', async () => {
    const user = await db.user.update({ where: { id: (await freshUser('approved')).id }, data: { kycStatus: 'APPROVED' } });
    const res = await confirm(user.id).send();
    expect(res.body.status).toBe('ignored_approved');
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).kycStatus).toBe('APPROVED');
    expect(await db.kycSubmission.count({ where: { userId: user.id } })).toBe(0);
  });
});
