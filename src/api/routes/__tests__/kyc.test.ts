process.env.JWT_SECRET = 'test-secret-at-least-this-long';

import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { generateKeyPairSync, sign as edSign, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { kycRouter } from '../kyc';
import { KycEdgeTrust, KYC_EDGE_BODY_TYPE, kycSubmissionId } from '../../../services/KycEdgeTrust';

// Synthetic values only — no real person or document.
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const PUBLIC_X = (publicKey.export({ format: 'jwk' }) as { x: string }).x;
const other = generateKeyPairSync('ed25519');

function authHeader(userId: string) {
  return `Bearer ${jwt.sign({ sub: userId, sid: `test-session:${userId}` }, process.env.JWT_SECRET!)}`;
}

/** Same app shape as production, with a persisted login session. */
function buildApp(prisma: any, trust: KycEdgeTrust = new KycEdgeTrust()) {
  prisma = { session: { findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, userId: where.id.replace('test-session:', ''), revokedAt: null, lastSeenAt: new Date() })) }, ...prisma };
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use('/api/v1', kycRouter(prisma, trust));
  return app;
}

function edgePost(app: express.Express, route: string, body: unknown, opts: { key?: any; ts?: number; bearer?: string; tamper?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(opts.ts ?? Date.now());
  const fullPath = `/api/v1${route}`;
  const sig = edSign(null, Buffer.from(`v1\n${ts}\n${fullPath}\n${raw}`), opts.key ?? privateKey).toString('base64url');
  let req = request(app).post(fullPath).set('Content-Type', KYC_EDGE_BODY_TYPE).set('x-voltex-kyc-edge-ts', ts).set('x-voltex-kyc-edge-sig', sig);
  if (opts.bearer) req = req.set('Authorization', opts.bearer);
  return req.send(opts.tamper ? raw.replace('UA', 'PL') : raw);
}

const REQUEST_ID = '6f1d2a3b-4c5d-4e6f-8a7b-9c0d1e2f3a4b';
const metadata = {
  requestId: REQUEST_ID,
  country: 'UA',
  fullName: 'Synthetic Test Person',
  dateOfBirth: '1990-01-01',
  documentType: 'PASSPORT',
  documentMimeType: 'image/jpeg',
  documentSizeBytes: 812_345,
};

function confirmBody(userId = 'user-1', requestId = REQUEST_ID) {
  const submissionId = kycSubmissionId(userId, requestId);
  return {
    ...metadata,
    requestId,
    submissionId,
    userId,
    emailMessageId: `${submissionId}@voltextech.net`,
    emailAcceptedAt: '2026-09-26T12:00:05.000Z',
  };
}

beforeEach(() => {
  process.env.KYC_EDGE_PUBLIC_KEY = PUBLIC_X;
});
afterEach(() => {
  delete process.env.KYC_EDGE_PUBLIC_KEY;
  jest.restoreAllMocks();
});

describe('POST /kyc/submit (legacy Render upload) is closed', () => {
  it('answers 410 without touching the DB, multer or the disk', async () => {
    const uploads = path.join(process.cwd(), 'uploads', 'kyc');
    const existedBefore = fs.existsSync(uploads);
    const prisma = { user: { findUnique: jest.fn() }, kycSubmission: { create: jest.fn() } } as any;
    const res = await request(buildApp(prisma))
      .post('/api/v1/kyc/submit')
      .set('Authorization', authHeader('user-1'))
      .field('country', 'UA')
      .attach('document', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(410);
    expect(res.body.code).toBe('kyc_upload_moved');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.kycSubmission.create).not.toHaveBeenCalled();
    if (!existedBefore) expect(fs.existsSync(uploads)).toBe(false);
  });
});

describe('POST /internal/kyc/authorize (edge → Render, before the email)', () => {
  function prismaFor(user: any, { existing = null, pending = null }: { existing?: any; pending?: any } = {}) {
    return {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
      kycSubmission: { findUnique: jest.fn().mockResolvedValue(existing), findFirst: jest.fn().mockResolvedValue(pending), create: jest.fn() },
      auditLog: { create: jest.fn() },
    } as any;
  }

  it('returns the server-decided submission id and the account email; writes nothing', async () => {
    const prisma = prismaFor({ id: 'user-1', email: 'qa@example.test', kycStatus: 'NOT_STARTED' });
    const res = await edgePost(buildApp(prisma), '/internal/kyc/authorize', metadata, { bearer: authHeader('user-1') });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ submissionId: kycSubmissionId('user-1', REQUEST_ID), userId: 'user-1', email: 'qa@example.test', alreadySubmitted: false });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(prisma.kycSubmission.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('unsigned, wrongly signed, tampered or stale calls → 403 before any DB read', async () => {
    const prisma = prismaFor({ id: 'user-1', email: 'qa@example.test', kycStatus: 'NOT_STARTED' });
    const app = buildApp(prisma);
    const unsigned = await request(app).post('/api/v1/internal/kyc/authorize').set('Content-Type', KYC_EDGE_BODY_TYPE).set('Authorization', authHeader('user-1')).send(JSON.stringify(metadata));
    expect(unsigned.status).toBe(403);
    expect((await edgePost(app, '/internal/kyc/authorize', metadata, { bearer: authHeader('user-1'), key: other.privateKey })).status).toBe(403);
    expect((await edgePost(app, '/internal/kyc/authorize', metadata, { bearer: authHeader('user-1'), tamper: true })).status).toBe(403);
    expect((await edgePost(app, '/internal/kyc/authorize', metadata, { bearer: authHeader('user-1'), ts: Date.now() - 10 * 60_000 })).status).toBe(403);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('plain application/json (a browser) cannot reach it', async () => {
    const prisma = prismaFor({ id: 'user-1', email: 'qa@example.test', kycStatus: 'NOT_STARTED' });
    const res = await request(buildApp(prisma)).post('/api/v1/internal/kyc/authorize').set('Authorization', authHeader('user-1')).send(metadata);
    expect(res.status).toBe(415);
  });

  it('a signed call without a user session → 401 (the edge cannot act alone)', async () => {
    const prisma = prismaFor({ id: 'user-1', email: 'qa@example.test', kycStatus: 'NOT_STARTED' });
    const res = await edgePost(buildApp(prisma), '/internal/kyc/authorize', metadata);
    expect(res.status).toBe(401);
  });

  it('already approved → 409 kyc_already_verified', async () => {
    const res = await edgePost(buildApp(prismaFor({ id: 'user-1', email: 'qa@example.test', kycStatus: 'APPROVED' })), '/internal/kyc/authorize', metadata, { bearer: authHeader('user-1') });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('kyc_already_verified');
  });

  it('another submission pending → 409 kyc_already_pending', async () => {
    const res = await edgePost(buildApp(prismaFor({ id: 'user-1', email: 'qa@example.test', kycStatus: 'PENDING' }, { pending: { id: 'other' } })), '/internal/kyc/authorize', metadata, { bearer: authHeader('user-1') });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('kyc_already_pending');
  });

  it('the same attempt already recorded → alreadySubmitted (edge must not email again)', async () => {
    const id = kycSubmissionId('user-1', REQUEST_ID);
    const res = await edgePost(buildApp(prismaFor({ id: 'user-1', email: 'qa@example.test', kycStatus: 'PENDING' }, { existing: { id, userId: 'user-1' }, pending: { id } })), '/internal/kyc/authorize', metadata, { bearer: authHeader('user-1') });
    expect(res.status).toBe(200);
    expect(res.body.alreadySubmitted).toBe(true);
  });

  it('invalid metadata (future DOB, bad country, oversize, extra fields) → 400', async () => {
    const prisma = prismaFor({ id: 'user-1', email: 'qa@example.test', kycStatus: 'NOT_STARTED' });
    const app = buildApp(prisma);
    for (const bad of [{ dateOfBirth: '2999-01-01' }, { country: 'Ukraine' }, { documentSizeBytes: 5 * 1024 * 1024 }, { documentMimeType: 'text/html' }, { document: 'AAAA' }]) {
      const res = await edgePost(app, '/internal/kyc/authorize', { ...metadata, ...bad }, { bearer: authHeader('user-1') });
      expect(res.status).toBe(400);
    }
  });

  it('per-user limit → 429 after 10 attempts in an hour', async () => {
    const prisma = prismaFor({ id: 'user-limit', email: 'qa@example.test', kycStatus: 'NOT_STARTED' });
    const app = buildApp(prisma);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await edgePost(app, '/internal/kyc/authorize', { ...metadata, requestId: randomUUID() }, { bearer: authHeader('user-limit') })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('no reachable edge key → 503 (never accepts unsigned)', async () => {
    delete process.env.KYC_EDGE_PUBLIC_KEY;
    const trust = new KycEdgeTrust({ fetchImpl: (async () => { throw new Error('offline'); }) as any });
    const res = await edgePost(buildApp(prismaFor(null), trust), '/internal/kyc/authorize', metadata, { bearer: authHeader('user-1') });
    expect(res.status).toBe(503);
  });

  it('resolves the edge public key over HTTPS when not pinned, and caches it', async () => {
    delete process.env.KYC_EDGE_PUBLIC_KEY;
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ alg: 'Ed25519', key: { kty: 'OKP', crv: 'Ed25519', x: PUBLIC_X } }) });
    const trust = new KycEdgeTrust({ fetchImpl: fetchImpl as any });
    const app = buildApp(prismaFor({ id: 'user-1', email: 'qa@example.test', kycStatus: 'NOT_STARTED' }), trust);
    expect((await edgePost(app, '/internal/kyc/authorize', { ...metadata, requestId: randomUUID() }, { bearer: authHeader('user-1') })).status).toBe(200);
    expect((await edgePost(app, '/internal/kyc/authorize', { ...metadata, requestId: randomUUID() }, { bearer: authHeader('user-1') })).status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://kyc.voltextech.net/v1/public-key');
  });
});

describe('POST /internal/kyc/submission-confirmed (edge → Render, after the email)', () => {
  function txPrisma({ user = { id: 'user-1', kycStatus: 'NOT_STARTED' } as any, existing = null as any, pending = null as any, createError = null as any } = {}) {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue(user ? [user] : []),
      kycSubmission: {
        findUnique: jest.fn().mockResolvedValue(existing),
        findFirst: jest.fn().mockResolvedValue(pending),
        create: createError ? jest.fn().mockRejectedValue(createError) : jest.fn().mockResolvedValue({}),
      },
      user: { update: jest.fn() },
      auditLog: { create: jest.fn() },
    };
    return { tx, prisma: { $transaction: jest.fn((fn: any) => fn(tx)) } as any };
  }

  it('creates exactly the metadata row: id = submission id, no file path, EMAIL delivery, user → PENDING', async () => {
    const { tx, prisma } = txPrisma();
    const body = confirmBody();
    const res = await edgePost(buildApp(prisma), '/internal/kyc/submission-confirmed', body);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ status: 'created', submissionId: body.submissionId });
    const data = tx.kycSubmission.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ id: body.submissionId, userId: 'user-1', documentImagePath: null, documentDelivery: 'EMAIL', emailMessageId: body.emailMessageId, documentMimeType: 'image/jpeg', documentSizeBytes: 812_345 });
    expect(JSON.stringify(data).length).toBeLessThan(1024);
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { kycStatus: 'PENDING' } });
    expect(tx.auditLog.create).toHaveBeenCalledWith({ data: { userId: 'user-1', action: 'KYC_SUBMITTED', metadata: { submissionId: body.submissionId, delivery: 'EMAIL' } } });
  });

  it('a repeated callback is idempotent → 200 exists, no second row', async () => {
    const body = confirmBody();
    const { tx, prisma } = txPrisma({ existing: { id: body.submissionId } });
    const res = await edgePost(buildApp(prisma), '/internal/kyc/submission-confirmed', body);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('exists');
    expect(tx.kycSubmission.create).not.toHaveBeenCalled();
  });

  it('a racing duplicate insert (unique violation) → 200 exists', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
    const { prisma } = txPrisma({ createError: err });
    const res = await edgePost(buildApp(prisma), '/internal/kyc/submission-confirmed', confirmBody());
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('exists');
  });

  it('an id the server did not issue for this user/attempt → 400, nothing written', async () => {
    const { tx, prisma } = txPrisma();
    const res = await edgePost(buildApp(prisma), '/internal/kyc/submission-confirmed', { ...confirmBody(), userId: 'someone-else' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('kyc_submission_mismatch');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.kycSubmission.create).not.toHaveBeenCalled();
  });

  it('user already approved or another PENDING → no second PENDING row', async () => {
    const approved = txPrisma({ user: { id: 'user-1', kycStatus: 'APPROVED' } });
    expect((await edgePost(buildApp(approved.prisma), '/internal/kyc/submission-confirmed', confirmBody())).body.status).toBe('ignored_approved');
    expect(approved.tx.kycSubmission.create).not.toHaveBeenCalled();
    const dup = txPrisma({ pending: { id: 'other' } });
    expect((await edgePost(buildApp(dup.prisma), '/internal/kyc/submission-confirmed', confirmBody())).body.status).toBe('duplicate_pending');
    expect(dup.tx.kycSubmission.create).not.toHaveBeenCalled();
  });

  it('refuses a document or any extra field in the callback', async () => {
    const { prisma } = txPrisma();
    const res = await edgePost(buildApp(prisma), '/internal/kyc/submission-confirmed', { ...confirmBody(), document: '/9j/4AAQSkZJRg==' });
    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('is not reachable with a user or admin JWT — only the edge signature', async () => {
    const { prisma } = txPrisma();
    const res = await request(buildApp(prisma)).post('/api/v1/internal/kyc/submission-confirmed').set('Content-Type', KYC_EDGE_BODY_TYPE).set('Authorization', authHeader('admin-1')).send(JSON.stringify(confirmBody()));
    expect(res.status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('the submission id is stable per attempt and differs across attempts and users', () => {
    expect(kycSubmissionId('user-1', REQUEST_ID)).toBe(kycSubmissionId('user-1', REQUEST_ID.toUpperCase()));
    expect(kycSubmissionId('user-1', REQUEST_ID)).not.toBe(kycSubmissionId('user-2', REQUEST_ID));
    expect(kycSubmissionId('user-1', REQUEST_ID)).not.toBe(kycSubmissionId('user-1', randomUUID()));
    expect(kycSubmissionId('user-1', REQUEST_ID)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('GET /kyc/me', () => {
  it('returns the current status and latest submission', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ kycStatus: 'REJECTED' }) },
      kycSubmission: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'sub-1', country: 'UA', fullName: 'Synthetic Person', documentType: 'PASSPORT', status: 'REJECTED',
          rejectionReason: 'Blurry photo', createdAt: new Date('2026-01-01'), emailMessageId: 'x@voltextech.net',
        }),
      },
    } as any;
    const res = await request(buildApp(prisma)).get('/api/v1/kyc/me').set('Authorization', authHeader('user-1'));
    expect(res.status).toBe(200);
    expect(res.body.kycStatus).toBe('REJECTED');
    expect(res.body.latestSubmission.rejectionReason).toBe('Blurry photo');
    expect(JSON.stringify(res.body)).not.toMatch(/voltextech|emailMessageId/);
  });
});

describe('admin-only KYC routes', () => {
  it('POST /kyc/:id/review requires an admin account', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } } as any;
    const res = await request(buildApp(prisma)).post('/api/v1/kyc/sub-1/review').set('Authorization', authHeader('user-1')).send({ approve: true });
    expect(res.status).toBe(403);
  });

  it('POST /kyc/:id/review approves a submission for an admin', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }), update: jest.fn() },
      kycSubmission: { findUnique: jest.fn().mockResolvedValue({ id: 'sub-1', userId: 'user-1', status: 'PENDING' }), update: jest.fn() },
      auditLog: { create: jest.fn() },
    } as any;
    const res = await request(buildApp(prisma)).post('/api/v1/kyc/sub-1/review').set('Authorization', authHeader('admin-1')).send({ approve: true });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { kycStatus: 'APPROVED' } });
  });

  it('POST /kyc/:id/review rejects with a reason', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }), update: jest.fn() },
      kycSubmission: { findUnique: jest.fn().mockResolvedValue({ id: 'sub-1', userId: 'user-1', status: 'PENDING' }), update: jest.fn() },
      auditLog: { create: jest.fn() },
    } as any;
    const res = await request(buildApp(prisma)).post('/api/v1/kyc/sub-1/review').set('Authorization', authHeader('admin-1')).send({ approve: false, reason: 'Document expired' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REJECTED');
    expect(prisma.kycSubmission.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED', rejectionReason: 'Document expired' }) }));
  });

  it('POST /kyc/:id/review refuses to re-review an already-decided submission', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }) },
      kycSubmission: { findUnique: jest.fn().mockResolvedValue({ id: 'sub-1', status: 'APPROVED' }) },
    } as any;
    const res = await request(buildApp(prisma)).post('/api/v1/kyc/sub-1/review').set('Authorization', authHeader('admin-1')).send({ approve: true });
    expect(res.status).toBe(400);
  });

  it('GET /kyc/:id/document serves nothing for an emailed submission (no Render file traffic)', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }) },
      kycSubmission: { findUnique: jest.fn().mockResolvedValue({ id: 'sub-1', documentImagePath: null, documentDelivery: 'EMAIL' }) },
    } as any;
    const res = await request(buildApp(prisma)).get('/api/v1/kyc/sub-1/document').set('Authorization', authHeader('admin-1'));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('kyc_document_emailed');
  });

  it('GET /kyc/:id/document still serves a LEGACY file that exists', async () => {
    const legacy = path.join(__dirname, '__legacy-kyc-fixture.png');
    fs.writeFileSync(legacy, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    try {
      const prisma = {
        user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }) },
        kycSubmission: { findUnique: jest.fn().mockResolvedValue({ id: 'sub-1', documentImagePath: legacy }) },
      } as any;
      const res = await request(buildApp(prisma)).get('/api/v1/kyc/sub-1/document').set('Authorization', authHeader('admin-1'));
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
    } finally {
      fs.rmSync(legacy, { force: true });
    }
  });

  it('GET /kyc/admin/delivery reports the edge mode and masked recipient; admin-only', async () => {
    const admin = { user: { findUnique: jest.fn().mockResolvedValue({ role: 'ADMIN' }) } } as any;
    const res = await request(buildApp(admin)).get('/api/v1/kyc/admin/delivery').set('Authorization', authHeader('admin-1'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: 'EDGE_EMAIL', configured: true, recipient: 'vo***@gmail.com' });
    const user = { user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } } as any;
    expect((await request(buildApp(user)).get('/api/v1/kyc/admin/delivery').set('Authorization', authHeader('u'))).status).toBe(403);
  });
});
