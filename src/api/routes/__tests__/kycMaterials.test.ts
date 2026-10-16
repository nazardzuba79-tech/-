process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { generateKeyPairSync, sign as edSign, randomUUID } from 'crypto';
import { kycRouter } from '../kyc';
import { KycEdgeTrust, KYC_EDGE_BODY_TYPE } from '../../../services/KycEdgeTrust';
import { kycMaterialDeliveryId, kycReviewStage, SELFIE_CONSENT_VERSION } from '../../../services/kycMaterials';

/**
 * Additional KYC materials — an admin asks for a new document photo, an
 * ordinary selfie, or both, without rejecting the submission.
 * Behavioural tests on a small in-memory store; synthetic values only.
 */

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PUBLIC_X = (publicKey.export({ format: 'jwk' }) as { x: string }).x;
const auth = (userId: string) => `Bearer ${jwt.sign({ sub: userId, sid: `test-session:${userId}` }, process.env.JWT_SECRET!)}`;

type Row = Record<string, any>;
function store() {
  const users = new Map<string, Row>([
    ['admin-1', { id: 'admin-1', role: 'ADMIN', email: 'admin@example.test', kycStatus: 'NOT_STARTED' }],
    ['user-1', { id: 'user-1', role: 'USER', email: 'user-1@example.test', kycStatus: 'PENDING' }],
    ['user-2', { id: 'user-2', role: 'USER', email: 'user-2@example.test', kycStatus: 'PENDING' }],
  ]);
  const subs = new Map<string, Row>([
    ['sub-1', { id: 'sub-1', userId: 'user-1', status: 'PENDING', fullName: 'Synthetic Person One', createdAt: new Date('2026-10-01T10:00:00Z') }],
    ['sub-2', { id: 'sub-2', userId: 'user-2', status: 'PENDING', fullName: 'Synthetic Person Two', createdAt: new Date('2026-10-01T11:00:00Z') }],
    ['sub-done', { id: 'sub-done', userId: 'user-2', status: 'APPROVED', fullName: 'Synthetic Done', createdAt: new Date('2026-09-01T11:00:00Z') }],
  ]);
  const reqs = new Map<string, Row>();
  const audit: Row[] = [];
  const locks: string[] = [];
  const blank = { documentReason: null, documentReasonText: null, selfieComment: null, status: 'OPEN', clientRequestId: null,
    documentDeliveryId: null, documentReceivedAt: null, documentMessageId: null, documentMimeType: null, documentSizeBytes: null,
    selfieDeliveryId: null, selfieReceivedAt: null, selfieMessageId: null, selfieMimeType: null, selfieSizeBytes: null,
    selfieConsentAt: null, selfieConsentVersion: null, acknowledgedAt: null, acknowledgedBy: null, closedAt: null, closedBy: null, closedOutcome: null };
  const match = (row: Row, where: Row = {}) => Object.entries(where).every(([k, v]) => (v === null ? row[k] == null : row[k] === v));
  const newest = (rows: Row[]) => rows.sort((a, b) => b.createdAt - a.createdAt);
  const pick = (row: Row | undefined, select?: Row) => (!row ? null : select ? Object.fromEntries(Object.keys(select).map(k => [k, row[k]])) : { ...row });
  const prisma: any = {
    session: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, userId: where.id.replace('test-session:', ''), revokedAt: null, lastSeenAt: new Date() })) },
    user: {
      findUnique: jest.fn(async ({ where, select }: any) => pick(users.get(where.id), select)),
      update: jest.fn(async ({ where, data }: any) => Object.assign(users.get(where.id)!, data)),
    },
    kycSubmission: {
      findUnique: jest.fn(async ({ where, select }: any) => pick(subs.get(where.id), select)),
      findFirst: jest.fn(async ({ where }: any) => pick(newest([...subs.values()].filter(s => match(s, where)))[0])),
      update: jest.fn(async ({ where, data }: any) => Object.assign(subs.get(where.id)!, data)),
    },
    kycMaterialRequest: {
      findUnique: jest.fn(async ({ where }: any) => pick(where.id ? reqs.get(where.id) : [...reqs.values()].find(r => r.clientRequestId === where.clientRequestId))),
      findFirst: jest.fn(async ({ where, select }: any) => pick(newest([...reqs.values()].filter(r => match(r, where)))[0], select)),
      create: jest.fn(async ({ data }: any) => { const row = { ...blank, id: randomUUID(), createdAt: new Date(), ...data }; reqs.set(row.id, row); return { ...row }; }),
      update: jest.fn(async ({ where, data }: any) => ({ ...Object.assign(reqs.get(where.id)!, data) })),
      updateMany: jest.fn(async ({ where, data }: any) => { const rows = [...reqs.values()].filter(r => match(r, where)); rows.forEach(r => Object.assign(r, data)); return { count: rows.length }; }),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => { audit.push(data); return data; }) },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
      const sql = strings.join('?');
      locks.push(sql);
      if (sql.includes('"KycSubmission"')) { const s = subs.get(values[0]); return s ? [{ id: s.id, status: s.status, userId: s.userId }] : []; }
      if (sql.includes('"KycMaterialRequest"')) return reqs.has(values[0]) ? [{ id: values[0] }] : [];
      return [];
    }),
  };
  return { prisma, users, subs, reqs, audit, locks };
}

function app(prisma: any) {
  const a = express();
  a.use(express.json({ limit: '100kb' }));
  a.use('/api/v1', kycRouter(prisma, new KycEdgeTrust()));
  return a;
}

function edgePost(a: express.Express, route: string, body: unknown, bearer?: string) {
  const raw = JSON.stringify(body);
  const ts = String(Date.now());
  const fullPath = `/api/v1${route}`;
  const sig = edSign(null, Buffer.from(`v1\n${ts}\n${fullPath}\n${raw}`), privateKey).toString('base64url');
  let r = request(a).post(fullPath).set('Content-Type', KYC_EDGE_BODY_TYPE).set('x-voltex-kyc-edge-ts', ts).set('x-voltex-kyc-edge-sig', sig);
  if (bearer) r = r.set('Authorization', bearer);
  return r.send(raw);
}

beforeEach(() => { process.env.KYC_EDGE_PUBLIC_KEY = PUBLIC_X; });
afterEach(() => { delete process.env.KYC_EDGE_PUBLIC_KEY; jest.restoreAllMocks(); });

const ask = (a: express.Express, sub: string, body: Record<string, unknown>, who = 'admin-1') =>
  request(a).post(`/api/v1/kyc/${sub}/material-requests`).set('Authorization', auth(who)).send({ clientRequestId: randomUUID(), ...body });

describe('review stage (one function for the user and the admin)', () => {
  const at = new Date('2026-10-02T10:00:00Z');
  const req = (over: Record<string, unknown>) => ({ kind: 'DOCUMENT', status: 'OPEN', documentReceivedAt: null, selfieReceivedAt: null, acknowledgedAt: null, closedAt: null, ...over }) as any;
  it.each([
    [null, null, 'NOT_STARTED'],
    [{ status: 'PENDING' }, null, 'UNDER_REVIEW'],
    [{ status: 'PENDING' }, req({ kind: 'DOCUMENT' }), 'DOCUMENT_REQUIRED'],
    [{ status: 'PENDING' }, req({ kind: 'SELFIE' }), 'SELFIE_REQUIRED'],
    [{ status: 'PENDING' }, req({ kind: 'DOCUMENT_AND_SELFIE' }), 'DOCUMENT_AND_SELFIE_REQUIRED'],
    // Both asked, one arrived: only the missing one is still required.
    [{ status: 'PENDING' }, req({ kind: 'DOCUMENT_AND_SELFIE', documentReceivedAt: at }), 'SELFIE_REQUIRED'],
    [{ status: 'PENDING' }, req({ kind: 'DOCUMENT_AND_SELFIE', selfieReceivedAt: at }), 'DOCUMENT_REQUIRED'],
    [{ status: 'PENDING' }, req({ kind: 'DOCUMENT_AND_SELFIE', status: 'RECEIVED', documentReceivedAt: at, selfieReceivedAt: at }), 'MATERIALS_RECEIVED'],
    [{ status: 'PENDING' }, req({ kind: 'SELFIE', status: 'RECEIVED', selfieReceivedAt: at, acknowledgedAt: at }), 'RE_REVIEW'],
    [{ status: 'PENDING' }, req({ kind: 'SELFIE', closedAt: at }), 'UNDER_REVIEW'],
    [{ status: 'APPROVED' }, req({ kind: 'SELFIE' }), 'APPROVED'],
    [{ status: 'REJECTED' }, null, 'REJECTED'],
  ])('%j + %j → %s', (submission, request, stage) => {
    expect(kycReviewStage(submission as any, request)).toBe(stage);
  });
});

describe('POST /kyc/:id/material-requests (admin asks without rejecting)', () => {
  it('only an admin can ask; a user and an anonymous caller are refused', async () => {
    const s = store();
    expect((await ask(app(s.prisma), 'sub-1', { kind: 'SELFIE' }, 'user-1')).status).toBe(403);
    expect((await request(app(s.prisma)).post('/api/v1/kyc/sub-1/material-requests').send({ kind: 'SELFIE' })).status).toBe(401);
    expect(s.reqs.size).toBe(0);
  });

  it('a document request needs a reason; «Другая причина» needs the admin\'s own words', async () => {
    const s = store();
    const a = app(s.prisma);
    const noReason = await ask(a, 'sub-1', { kind: 'DOCUMENT' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error).toBe('Укажите причину запроса нового фото документа');
    const otherEmpty = await ask(a, 'sub-1', { kind: 'DOCUMENT', documentReason: 'OTHER', documentReasonText: '  ' });
    expect(otherEmpty.status).toBe(400);
    expect(otherEmpty.body.error).toMatch(/своими словами/);
    expect((await ask(a, 'sub-1', { kind: 'SELFIE', documentReason: 'BLURRY' })).status).toBe(400);
    expect((await ask(a, 'sub-1', { kind: 'DOCUMENT', documentReason: 'BLURRY', selfieComment: 'x' })).status).toBe(400);
    expect((await ask(a, 'sub-1', { kind: 'DOCUMENT', documentReason: 'BLURRY', documentReasonText: 'not for this reason' })).status).toBe(400);
    expect((await ask(a, 'sub-1', { kind: 'SELFIE', approve: true })).status).toBe(400);
    expect(s.reqs.size).toBe(0);
  });

  it('creates an OPEN request under a row lock, audits it, and leaves the user PENDING', async () => {
    const s = store();
    const res = await ask(app(s.prisma), 'sub-1', { kind: 'DOCUMENT_AND_SELFIE', documentReason: 'OTHER', documentReasonText: 'Блик\u0000 на  фото', selfieComment: 'Без головного убора' });
    expect(res.status).toBe(201);
    expect(res.body.reviewStage).toBe('DOCUMENT_AND_SELFIE_REQUIRED');
    expect(res.body.materialRequest).toMatchObject({ kind: 'DOCUMENT_AND_SELFIE', status: 'OPEN', documentReason: 'OTHER', documentReasonText: 'Блик на фото', selfieComment: 'Без головного убора', requestedBy: 'admin-1' });
    expect(s.locks.some(sql => sql.includes('"KycSubmission"') && sql.includes('FOR UPDATE'))).toBe(true);
    expect(s.audit).toEqual([expect.objectContaining({ userId: 'user-1', action: 'KYC_MATERIALS_REQUESTED', metadata: expect.objectContaining({ submissionId: 'sub-1', kind: 'DOCUMENT_AND_SELFIE', requestedBy: 'admin-1' }) })]);
    expect(s.users.get('user-1')!.kycStatus).toBe('PENDING');
    expect(s.subs.get('sub-1')!.status).toBe('PENDING');
  });

  it('a repeated click (same clientRequestId) returns the same request, no duplicate', async () => {
    const s = store();
    const a = app(s.prisma);
    const clientRequestId = randomUUID();
    const first = await request(a).post('/api/v1/kyc/sub-1/material-requests').set('Authorization', auth('admin-1')).send({ clientRequestId, kind: 'SELFIE' });
    const again = await request(a).post('/api/v1/kyc/sub-1/material-requests').set('Authorization', auth('admin-1')).send({ clientRequestId, kind: 'SELFIE' });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.materialRequest.id).toBe(first.body.materialRequest.id);
    expect(s.reqs.size).toBe(1);
    expect(s.audit).toHaveLength(1);
  });

  it('a new request replaces the open one (SUPERSEDED), keeping its history', async () => {
    const s = store();
    const a = app(s.prisma);
    const first = await ask(a, 'sub-1', { kind: 'DOCUMENT', documentReason: 'BLURRY' });
    const second = await ask(a, 'sub-1', { kind: 'SELFIE' });
    expect(second.status).toBe(201);
    const old = s.reqs.get(first.body.materialRequest.id)!;
    expect(old).toMatchObject({ status: 'CLOSED', closedOutcome: 'SUPERSEDED', closedBy: 'admin-1' });
    expect(s.reqs.size).toBe(2);
    expect(s.audit[1].metadata.supersededId).toBe(old.id);
  });

  it('a decided or unknown submission cannot receive a request', async () => {
    const s = store();
    expect((await ask(app(s.prisma), 'sub-done', { kind: 'SELFIE' })).status).toBe(409);
    expect((await ask(app(s.prisma), 'nope', { kind: 'SELFIE' })).status).toBe(404);
    expect(s.reqs.size).toBe(0);
  });
});

async function openRequest(s: ReturnType<typeof store>, kind: string, sub = 'sub-1') {
  const body = kind === 'SELFIE' ? { kind } : { kind, documentReason: 'CROPPED' };
  const res = await ask(app(s.prisma), sub, body);
  return res.body.materialRequest.id as string;
}

const attempt = () => randomUUID();
function authorizeBody(materialRequestId: string, part: 'DOCUMENT' | 'SELFIE', requestId = attempt(), extra: Record<string, unknown> = {}) {
  return { requestId, materialRequestId, part, mimeType: 'image/jpeg', sizeBytes: 345_678,
    ...(part === 'SELFIE' ? { selfieConsent: true, consentVersion: SELFIE_CONSENT_VERSION } : {}), ...extra };
}
function confirmBody(userId: string, materialRequestId: string, part: 'DOCUMENT' | 'SELFIE', requestId = attempt(), extra: Record<string, unknown> = {}) {
  const deliveryId = kycMaterialDeliveryId(userId, materialRequestId, part, requestId);
  return { requestId, materialRequestId, part, mimeType: 'image/jpeg', sizeBytes: 345_678, deliveryId, userId,
    emailMessageId: `${deliveryId}@voltextech.net`, emailAcceptedAt: '2026-10-15T09:00:00.000Z',
    ...(part === 'SELFIE' ? { selfieConsentAt: '2026-10-15T08:59:30.000Z', consentVersion: SELFIE_CONSENT_VERSION } : {}), ...extra };
}

describe('POST /internal/kyc/materials/authorize (edge → server, before the email)', () => {
  it('returns a server-derived delivery id and the identity for the email; writes nothing', async () => {
    const s = store();
    const id = await openRequest(s, 'DOCUMENT');
    const requestId = attempt();
    const res = await edgePost(app(s.prisma), '/internal/kyc/materials/authorize', authorizeBody(id, 'DOCUMENT', requestId), auth('user-1'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deliveryId: kycMaterialDeliveryId('user-1', id, 'DOCUMENT', requestId), userId: 'user-1', email: 'user-1@example.test', fullName: 'Synthetic Person One', submissionId: 'sub-1', alreadyReceived: false });
    expect(s.reqs.get(id)!.documentReceivedAt).toBeNull();
  });

  it('another user\'s request is answered exactly like a missing one', async () => {
    const s = store();
    const id = await openRequest(s, 'DOCUMENT');
    const foreign = await edgePost(app(s.prisma), '/internal/kyc/materials/authorize', authorizeBody(id, 'DOCUMENT'), auth('user-2'));
    const missing = await edgePost(app(s.prisma), '/internal/kyc/materials/authorize', authorizeBody(randomUUID(), 'DOCUMENT'), auth('user-2'));
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });

  it('without the edge signature, or without the user\'s session, nothing is authorized', async () => {
    const s = store();
    const id = await openRequest(s, 'DOCUMENT');
    const plain = await request(app(s.prisma)).post('/api/v1/internal/kyc/materials/authorize').set('Authorization', auth('user-1')).send(authorizeBody(id, 'DOCUMENT'));
    expect([403, 415]).toContain(plain.status);
    expect((await edgePost(app(s.prisma), '/internal/kyc/materials/authorize', authorizeBody(id, 'DOCUMENT'))).status).toBe(401);
  });

  it('only what was asked: a selfie on a document request, or a document on a selfie request → 409', async () => {
    const s = store();
    const doc = await openRequest(s, 'DOCUMENT');
    expect((await edgePost(app(s.prisma), '/internal/kyc/materials/authorize', authorizeBody(doc, 'SELFIE'), auth('user-1'))).body.code).toBe('kyc_material_not_requested');
    const selfie = await openRequest(s, 'SELFIE');
    expect((await edgePost(app(s.prisma), '/internal/kyc/materials/authorize', authorizeBody(selfie, 'DOCUMENT'), auth('user-1'))).body.code).toBe('kyc_material_not_requested');
    // The superseded document request is closed now.
    expect((await edgePost(app(s.prisma), '/internal/kyc/materials/authorize', authorizeBody(doc, 'DOCUMENT'), auth('user-1'))).body.code).toBe('kyc_material_request_closed');
  });

  it('a selfie needs explicit consent and must be a photo (no PDF)', async () => {
    const s = store();
    const id = await openRequest(s, 'SELFIE');
    const noConsent = await edgePost(app(s.prisma), '/internal/kyc/materials/authorize', { requestId: attempt(), materialRequestId: id, part: 'SELFIE', mimeType: 'image/jpeg', sizeBytes: 1000 }, auth('user-1'));
    expect(noConsent.status).toBe(400);
    expect(noConsent.body.code).toBe('kyc_selfie_consent_required');
    const pdf = await edgePost(app(s.prisma), '/internal/kyc/materials/authorize', authorizeBody(id, 'SELFIE', attempt(), { mimeType: 'application/pdf' }), auth('user-1'));
    expect(pdf.body.code).toBe('kyc_file_type');
    expect((await edgePost(app(s.prisma), '/internal/kyc/materials/authorize', authorizeBody(id, 'SELFIE', attempt(), { sizeBytes: 5 * 1024 * 1024 }), auth('user-1'))).status).toBe(400);
  });

  it('after the decision the request is closed for uploads', async () => {
    const s = store();
    const id = await openRequest(s, 'SELFIE');
    await request(app(s.prisma)).post('/api/v1/kyc/sub-1/review').set('Authorization', auth('admin-1')).send({ approve: false, reason: 'Synthetic rejection' });
    expect(s.reqs.get(id)).toMatchObject({ status: 'CLOSED', closedOutcome: 'REJECTED' });
    expect((await edgePost(app(s.prisma), '/internal/kyc/materials/authorize', authorizeBody(id, 'SELFIE'), auth('user-1'))).body.code).toBe('kyc_material_request_closed');
  });
});

describe('POST /internal/kyc/materials/confirmed (edge → server, after the email)', () => {
  it('records a part; both parts complete the request → MATERIALS_RECEIVED, audited, user still PENDING', async () => {
    const s = store();
    const id = await openRequest(s, 'DOCUMENT_AND_SELFIE');
    const a = app(s.prisma);
    const doc = await edgePost(a, '/internal/kyc/materials/confirmed', confirmBody('user-1', id, 'DOCUMENT'));
    expect(doc.status).toBe(201);
    expect(doc.body).toEqual({ status: 'created', complete: false });
    expect(s.reqs.get(id)!.status).toBe('OPEN');
    expect(s.locks.some(sql => sql.includes('"KycMaterialRequest"') && sql.includes('FOR UPDATE'))).toBe(true);
    const selfie = await edgePost(a, '/internal/kyc/materials/confirmed', confirmBody('user-1', id, 'SELFIE'));
    expect(selfie.body).toEqual({ status: 'created', complete: true });
    expect(s.reqs.get(id)).toMatchObject({ status: 'RECEIVED', selfieConsentVersion: SELFIE_CONSENT_VERSION, documentMimeType: 'image/jpeg', selfieSizeBytes: 345_678 });
    expect(s.reqs.get(id)!.selfieConsentAt).toEqual(new Date('2026-10-15T08:59:30.000Z'));
    const received = s.audit.filter(e => e.action === 'KYC_MATERIAL_RECEIVED');
    expect(received.map(e => e.metadata.part)).toEqual(['DOCUMENT', 'SELFIE']);
    expect(JSON.stringify(received)).not.toMatch(/Synthetic Person|example\.test/);
    expect(s.users.get('user-1')!.kycStatus).toBe('PENDING');
    const me = await request(a).get('/api/v1/kyc/me').set('Authorization', auth('user-1'));
    expect(me.body.reviewStage).toBe('MATERIALS_RECEIVED');
  });

  it('a repeated callback is idempotent; a second, different upload of a received part is refused', async () => {
    const s = store();
    const id = await openRequest(s, 'SELFIE');
    const a = app(s.prisma);
    const requestId = attempt();
    expect((await edgePost(a, '/internal/kyc/materials/confirmed', confirmBody('user-1', id, 'SELFIE', requestId))).status).toBe(201);
    const repeat = await edgePost(a, '/internal/kyc/materials/confirmed', confirmBody('user-1', id, 'SELFIE', requestId));
    expect(repeat.status).toBe(200);
    expect(repeat.body.status).toBe('exists');
    const other = await edgePost(a, '/internal/kyc/materials/confirmed', confirmBody('user-1', id, 'SELFIE', attempt()));
    expect(other.status).toBe(409);
    expect(s.audit.filter(e => e.action === 'KYC_MATERIAL_RECEIVED')).toHaveLength(1);
    // The browser retrying the same attempt is told the email must not go out again.
    const again = await edgePost(a, '/internal/kyc/materials/authorize', authorizeBody(id, 'SELFIE', requestId), auth('user-1'));
    expect(again.body.alreadyReceived).toBe(true);
    expect((await edgePost(a, '/internal/kyc/materials/authorize', authorizeBody(id, 'SELFIE', attempt()), auth('user-1'))).body.code).toBe('kyc_material_already_received');
  });

  it('an id the server did not derive, a selfie without consent, or a foreign user → refused, nothing written', async () => {
    const s = store();
    const id = await openRequest(s, 'SELFIE');
    const a = app(s.prisma);
    expect((await edgePost(a, '/internal/kyc/materials/confirmed', { ...confirmBody('user-1', id, 'SELFIE'), deliveryId: randomUUID() })).body.code).toBe('kyc_delivery_mismatch');
    const { selfieConsentAt: _drop, ...noConsent } = confirmBody('user-1', id, 'SELFIE') as any;
    expect((await edgePost(a, '/internal/kyc/materials/confirmed', noConsent)).body.code).toBe('kyc_selfie_consent_required');
    expect((await edgePost(a, '/internal/kyc/materials/confirmed', confirmBody('user-2', id, 'SELFIE'))).status).toBe(404);
    expect(s.reqs.get(id)!.selfieReceivedAt).toBeNull();
  });

  it('is not reachable with a user or admin JWT — only the edge signature', async () => {
    const s = store();
    const id = await openRequest(s, 'SELFIE');
    const res = await request(app(s.prisma)).post('/api/v1/internal/kyc/materials/confirmed').set('Authorization', auth('admin-1')).send(confirmBody('user-1', id, 'SELFIE'));
    expect([403, 415]).toContain(res.status);
    expect(s.reqs.get(id)!.selfieReceivedAt).toBeNull();
  });

  it('a file delivered after the decision is recorded but cannot reopen the request', async () => {
    const s = store();
    const id = await openRequest(s, 'SELFIE');
    const a = app(s.prisma);
    await request(a).post('/api/v1/kyc/sub-1/review').set('Authorization', auth('admin-1')).send({ approve: true });
    const late = await edgePost(a, '/internal/kyc/materials/confirmed', confirmBody('user-1', id, 'SELFIE'));
    expect(late.status).toBe(201);
    expect(s.reqs.get(id)).toMatchObject({ status: 'CLOSED', closedOutcome: 'APPROVED' });
    expect(s.reqs.get(id)!.selfieReceivedAt).not.toBeNull();
    expect(s.audit.at(-1)!.metadata.afterClose).toBe(true);
  });
});

describe('GET /kyc/me and acknowledgement', () => {
  it('the user sees the request with its reason, and nothing internal', async () => {
    const s = store();
    const a = app(s.prisma);
    await ask(a, 'sub-1', { kind: 'DOCUMENT_AND_SELFIE', documentReason: 'LOW_LIGHT', selfieComment: 'Снимите очки' });
    const me = await request(a).get('/api/v1/kyc/me').set('Authorization', auth('user-1'));
    expect(me.status).toBe(200);
    expect(me.headers['cache-control']).toContain('no-store');
    expect(me.body.reviewStage).toBe('DOCUMENT_AND_SELFIE_REQUIRED');
    expect(me.body.materialRequest).toMatchObject({ kind: 'DOCUMENT_AND_SELFIE', documentReason: 'LOW_LIGHT', documentReasonText: null, selfieComment: 'Снимите очки',
      documentRequested: true, selfieRequested: true, documentReceived: false, selfieReceived: false });
    expect(JSON.stringify(me.body)).not.toMatch(/requestedBy|admin-1|clientRequestId|MessageId|DeliveryId/);
    // Another user sees only their own state.
    const other = await request(a).get('/api/v1/kyc/me').set('Authorization', auth('user-2'));
    expect(other.body.materialRequest).toBeNull();
  });

  it('opening received materials moves MATERIALS_RECEIVED → RE_REVIEW once, audited; admin only', async () => {
    const s = store();
    const id = await openRequest(s, 'SELFIE');
    const a = app(s.prisma);
    const ack = (who: string) => request(a).post(`/api/v1/kyc/material-requests/${id}/acknowledge`).set('Authorization', auth(who)).send({});
    expect((await ack('admin-1')).body).toEqual({ acknowledged: false }); // nothing arrived yet: no change
    await edgePost(a, '/internal/kyc/materials/confirmed', confirmBody('user-1', id, 'SELFIE'));
    expect((await ack('user-1')).status).toBe(403);
    expect((await ack('admin-1')).body).toEqual({ acknowledged: true });
    expect((await ack('admin-1')).body).toEqual({ acknowledged: true });
    expect(s.audit.filter(e => e.action === 'KYC_MATERIALS_VIEWED')).toHaveLength(1);
    expect((await request(a).get('/api/v1/kyc/me').set('Authorization', auth('user-1'))).body.reviewStage).toBe('RE_REVIEW');
  });
});
