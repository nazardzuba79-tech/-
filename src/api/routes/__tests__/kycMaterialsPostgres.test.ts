process.env.JWT_SECRET = process.env.JWT_SECRET || 'kyc-pg-test-secret-at-least-32-chars';

import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync, sign as edSign, randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { kycRouter } from '../kyc';
import { KycEdgeTrust, KYC_EDGE_BODY_TYPE } from '../../../services/KycEdgeTrust';
import { kycMaterialDeliveryId, SELFIE_CONSENT_VERSION } from '../../../services/kycMaterials';

/**
 * Additional KYC materials against real PostgreSQL (after `prisma migrate
 * deploy`): the table is additive and holds no binary, racing callbacks and
 * racing admin clicks never duplicate anything, and a document and a selfie
 * arriving at the same moment complete the request exactly once. Synthetic
 * data only; runs only against the disposable localhost database
 * voltex_kyc_test (CI: .github/workflows/kyc-edge.yml).
 */

const url = process.env.KYC_TEST_DATABASE_URL;
const pg = url ? describe : describe.skip;

pg('KYC additional materials on real PostgreSQL', () => {
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

  async function session(userId: string) {
    const s = await db.session.create({ data: { userId } });
    return `Bearer ${jwt.sign({ sub: userId, sid: s.id }, process.env.JWT_SECRET!)}`;
  }
  async function fixture(tag: string) {
    const admin = await db.user.create({ data: { email: `kyc-mat-admin-${tag}-${randomUUID()}@example.invalid`, passwordHash: 'QA_ONLY', referralCode: `KMA${randomUUID().slice(0, 8)}`, role: 'ADMIN' } });
    const user = await db.user.create({ data: { email: `kyc-mat-${tag}-${randomUUID()}@example.invalid`, passwordHash: 'QA_ONLY', referralCode: `KMU${randomUUID().slice(0, 8)}`, kycStatus: 'PENDING' } });
    const submission = await db.kycSubmission.create({ data: { userId: user.id, country: 'UA', fullName: 'Synthetic PG Person', dateOfBirth: new Date('1990-01-01'), documentType: 'PASSPORT', documentDelivery: 'EMAIL' } });
    return { admin, user, submission, adminAuth: await session(admin.id) };
  }
  function confirm(userId: string, materialRequestId: string, part: 'DOCUMENT' | 'SELFIE', requestId = randomUUID()) {
    const deliveryId = kycMaterialDeliveryId(userId, materialRequestId, part, requestId);
    const body = JSON.stringify({ requestId, materialRequestId, part, mimeType: 'image/jpeg', sizeBytes: 222_222, deliveryId, userId,
      emailMessageId: `${deliveryId}@voltextech.net`, emailAcceptedAt: new Date().toISOString(),
      ...(part === 'SELFIE' ? { selfieConsentAt: new Date().toISOString(), consentVersion: SELFIE_CONSENT_VERSION } : {}) });
    const ts = String(Date.now());
    const path = '/api/v1/internal/kyc/materials/confirmed';
    const sig = edSign(null, Buffer.from(`v1\n${ts}\n${path}\n${body}`), privateKey).toString('base64url');
    return () => request(app).post(path).set('Content-Type', KYC_EDGE_BODY_TYPE).set('x-voltex-kyc-edge-ts', ts).set('x-voltex-kyc-edge-sig', sig).send(body);
  }

  afterAll(async () => {
    await db.$disconnect();
    delete process.env.KYC_EDGE_PUBLIC_KEY;
  });

  it('the migration is additive: a new table with no binary column, existing tables untouched', async () => {
    const cols = await db.$queryRaw<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'KycMaterialRequest'`;
    expect(cols.length).toBeGreaterThan(20);
    expect(cols.filter(c => c.data_type === 'bytea')).toEqual([]);
    const kycStatus = await db.$queryRaw<{ v: string }[]>`SELECT unnest(enum_range(NULL::"KycStatus"))::text AS v`;
    expect(kycStatus.map(r => r.v)).toEqual(['NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED']);
  });

  it('five identical admin clicks at once → one request', async () => {
    const f = await fixture('clicks');
    const clientRequestId = randomUUID();
    const send = () => request(app).post(`/api/v1/kyc/${f.submission.id}/material-requests`).set('Authorization', f.adminAuth).send({ clientRequestId, kind: 'SELFIE' });
    const results = await Promise.all(Array.from({ length: 5 }, send));
    expect(results.every(r => r.status === 200 || r.status === 201)).toBe(true);
    expect(new Set(results.map(r => r.body.materialRequest.id)).size).toBe(1);
    expect(await db.kycMaterialRequest.count({ where: { submissionId: f.submission.id } })).toBe(1);
  });

  it('two different admin requests racing → exactly one stays open', async () => {
    const f = await fixture('race');
    const send = (kind: string) => request(app).post(`/api/v1/kyc/${f.submission.id}/material-requests`).set('Authorization', f.adminAuth)
      .send({ clientRequestId: randomUUID(), kind, ...(kind === 'DOCUMENT' ? { documentReason: 'BLURRY' } : {}) });
    const results = await Promise.all([send('DOCUMENT'), send('SELFIE')]);
    expect(results.map(r => r.status)).toEqual([201, 201]);
    expect(await db.kycMaterialRequest.count({ where: { submissionId: f.submission.id, closedAt: null } })).toBe(1);
    expect(await db.kycMaterialRequest.count({ where: { submissionId: f.submission.id, closedOutcome: 'SUPERSEDED' } })).toBe(1);
  });

  it('document and selfie arriving together complete the request once; repeats are no-ops', async () => {
    const f = await fixture('both');
    const created = await request(app).post(`/api/v1/kyc/${f.submission.id}/material-requests`).set('Authorization', f.adminAuth)
      .send({ clientRequestId: randomUUID(), kind: 'DOCUMENT_AND_SELFIE', documentReason: 'LOW_LIGHT' });
    const id = created.body.materialRequest.id;
    const doc = confirm(f.user.id, id, 'DOCUMENT');
    const selfie = confirm(f.user.id, id, 'SELFIE');
    const results = await Promise.all([doc(), selfie(), doc(), selfie()]);
    expect(results.filter(r => r.status === 201)).toHaveLength(2);
    expect(results.filter(r => r.status === 200).map(r => r.body.status)).toEqual(['exists', 'exists']);
    expect(results.filter(r => r.body.complete === true).length).toBeGreaterThanOrEqual(1);
    const row = await db.kycMaterialRequest.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('RECEIVED');
    expect(row.documentReceivedAt).not.toBeNull();
    expect(row.selfieReceivedAt).not.toBeNull();
    expect(row.selfieConsentVersion).toBe(SELFIE_CONSENT_VERSION);
    expect(await db.auditLog.count({ where: { userId: f.user.id, action: 'KYC_MATERIAL_RECEIVED' } })).toBe(2);
    expect((await db.user.findUniqueOrThrow({ where: { id: f.user.id } })).kycStatus).toBe('PENDING');
  });

  it('approving closes the request and keeps what arrived', async () => {
    const f = await fixture('approve');
    const created = await request(app).post(`/api/v1/kyc/${f.submission.id}/material-requests`).set('Authorization', f.adminAuth)
      .send({ clientRequestId: randomUUID(), kind: 'SELFIE' });
    const id = created.body.materialRequest.id;
    expect((await confirm(f.user.id, id, 'SELFIE')()).status).toBe(201);
    expect((await request(app).post(`/api/v1/kyc/${f.submission.id}/review`).set('Authorization', f.adminAuth).send({ approve: true })).status).toBe(200);
    const row = await db.kycMaterialRequest.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'CLOSED', closedOutcome: 'APPROVED', closedBy: f.admin.id });
    expect(row.selfieReceivedAt).not.toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: f.user.id } })).kycStatus).toBe('APPROVED');
  });
});
