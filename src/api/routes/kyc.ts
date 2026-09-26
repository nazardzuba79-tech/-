import express, { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma, PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { KycEdgeTrust, KYC_EDGE_BODY_TYPE, kycSubmissionId } from '../../services/KycEdgeTrust';

/**
 * KYC identity verification — submission + manual review.
 *
 * NOT real identity verification. Nothing here checks that a document is
 * genuine, that the photo matches the person, or screens against sanctions
 * lists. It is lightweight manual review, not a certified KYC provider.
 *
 * DOCUMENT PATH (since the KYC edge): browser → Cloudflare Worker
 * (workers/kyc-edge) → Cloudflare Email Routing → the admin mailbox. This API
 * never receives, stores, reads or serves a new document. Per submission it
 * sees two small signed JSON calls from the edge:
 *
 *   POST /internal/kyc/authorize            — before the email: whose session
 *        is this, may they submit, what is the submission id. Writes nothing.
 *   POST /internal/kyc/submission-confirmed — after the provider accepted the
 *        email: records the metadata row (PENDING). Idempotent on the id.
 *
 * So a PENDING row exists only for a document that was actually delivered.
 * Legacy rows (documentImagePath set, uploaded here before the edge) keep
 * their review preview; nothing old is deleted.
 */

const DOCUMENT_TYPES = ['PASSPORT', 'ID_CARD', 'DRIVERS_LICENSE'] as const;
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const RECIPIENT_MASKED = 'vo***@gmail.com';

function isPastDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getUTCFullYear() >= 1900 && date.getTime() < Date.now();
}

const metadataSchema = {
  requestId: z.string().uuid(),
  country: z.string().regex(/^[A-Z]{2}$/, 'country must be an ISO 3166-1 alpha-2 code'),
  fullName: z.string().trim().min(1).max(200),
  dateOfBirth: z.string().refine(isPastDate, 'invalid date of birth'),
  documentType: z.enum(DOCUMENT_TYPES),
  documentMimeType: z.enum(['image/jpeg', 'image/png', 'application/pdf']),
  documentSizeBytes: z.number().int().min(1).max(MAX_DOCUMENT_BYTES),
};

const authorizeSchema = z.object(metadataSchema).strict();

const confirmSchema = z.object({
  ...metadataSchema,
  submissionId: z.string().uuid(),
  userId: z.string().min(1).max(64),
  // The platform may assign its own Message-ID; only its shape is checked.
  emailMessageId: z.string().regex(/^[A-Za-z0-9._%+=$#!~-]{1,160}@[A-Za-z0-9.-]{1,120}$/),
  emailAcceptedAt: z.string().datetime(),
}).strict();

const reviewSchema = z.object({
  approve: z.boolean(),
  reason: z.string().max(500).optional(),
});

// Per-user attempts that reach the email step. In-memory is enough: one
// Render instance, and the edge applies its own per-IP limits first.
const AUTHORIZE_LIMIT = 10;
const AUTHORIZE_WINDOW_MS = 60 * 60_000;
const authorizeAttempts = new Map<string, number[]>();

function allowAuthorize(userId: string, now = Date.now()): boolean {
  const recent = (authorizeAttempts.get(userId) ?? []).filter((t) => now - t < AUTHORIZE_WINDOW_MS);
  if (recent.length >= AUTHORIZE_LIMIT) {
    authorizeAttempts.set(userId, recent);
    return false;
  }
  recent.push(now);
  authorizeAttempts.set(userId, recent);
  if (authorizeAttempts.size > 10_000) authorizeAttempts.clear();
  return true;
}

type RawRequest = AuthedRequest & { edgeBody?: unknown };

/** Raw body (for the signature) → signature check → parsed JSON on req.edgeBody. */
function requireEdge(trust: KycEdgeTrust) {
  const raw = express.raw({ type: KYC_EDGE_BODY_TYPE, limit: '16kb' });
  return [
    raw,
    async (req: RawRequest, res: Response, next: NextFunction) => {
      res.set('Cache-Control', 'no-store');
      if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: 'Unsupported body', code: 'kyc_edge_body' });
      const verdict = await trust.verify(req.originalUrl.split('?')[0], req.body, req.get('x-voltex-kyc-edge-ts'), req.get('x-voltex-kyc-edge-sig'));
      if (verdict === 'unconfigured') return res.status(503).json({ error: 'KYC edge not configured', code: 'kyc_edge_unconfigured' });
      if (verdict !== 'ok') return res.status(403).json({ error: 'Forbidden', code: 'kyc_edge_forbidden' });
      try {
        req.edgeBody = JSON.parse(req.body.toString('utf8'));
      } catch {
        return res.status(400).json({ error: 'Invalid body', code: 'kyc_bad_request' });
      }
      next();
    },
  ];
}

export function kycRouter(prisma: PrismaClient, trust: KycEdgeTrust = new KycEdgeTrust()): Router {
  const router = Router();

  // The Render upload path is closed: no multer, no uploads/kyc, no disk
  // write. A stale client gets a clear answer instead of a silent failure.
  router.post('/kyc/submit', (_req: Request, res: Response) => {
    res.status(410).json({ error: 'KYC upload moved to the KYC edge', code: 'kyc_upload_moved' });
  });

  router.post('/internal/kyc/authorize', ...requireEdge(trust), requireAuth(prisma), async (req: RawRequest, res: Response) => {
    const parsed = authorizeSchema.safeParse(req.edgeBody);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid submission', code: 'kyc_bad_request' });

    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, email: true, kycStatus: true } });
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.kycStatus === 'APPROVED') return res.status(409).json({ error: 'Already verified', code: 'kyc_already_verified' });

    const submissionId = kycSubmissionId(user.id, parsed.data.requestId);
    const existing = await prisma.kycSubmission.findUnique({ where: { id: submissionId }, select: { id: true, userId: true } });
    if (existing && existing.userId === user.id) {
      // The same attempt already delivered and recorded — the edge must not send again.
      return res.json({ submissionId, userId: user.id, email: user.email, alreadySubmitted: true });
    }
    const pending = await prisma.kycSubmission.findFirst({ where: { userId: user.id, status: 'PENDING' }, select: { id: true } });
    if (pending) return res.status(409).json({ error: 'A submission is already pending review', code: 'kyc_already_pending' });

    if (!allowAuthorize(user.id)) return res.status(429).json({ error: 'Too many attempts', code: 'kyc_rate_limited' });

    res.json({ submissionId, userId: user.id, email: user.email, alreadySubmitted: false });
  });

  router.post('/internal/kyc/submission-confirmed', ...requireEdge(trust), async (req: RawRequest, res: Response) => {
    const parsed = confirmSchema.safeParse(req.edgeBody);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid confirmation', code: 'kyc_bad_request' });
    const c = parsed.data;
    if (kycSubmissionId(c.userId, c.requestId) !== c.submissionId) {
      return res.status(400).json({ error: 'Submission id mismatch', code: 'kyc_submission_mismatch' });
    }

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        // Serialize per user: two confirmations can never both become PENDING.
        const locked = await tx.$queryRaw<{ id: string; kycStatus: string }[]>`SELECT "id", "kycStatus"::text AS "kycStatus" FROM "User" WHERE "id" = ${c.userId} FOR UPDATE`;
        if (locked.length === 0) return 'no_user' as const;
        const existing = await tx.kycSubmission.findUnique({ where: { id: c.submissionId }, select: { id: true } });
        if (existing) return 'exists' as const;
        if (locked[0].kycStatus === 'APPROVED') return 'ignored_approved' as const;
        const pending = await tx.kycSubmission.findFirst({ where: { userId: c.userId, status: 'PENDING' }, select: { id: true } });
        if (pending) return 'duplicate_pending' as const;

        await tx.kycSubmission.create({
          data: {
            id: c.submissionId,
            userId: c.userId,
            country: c.country,
            fullName: c.fullName,
            dateOfBirth: new Date(`${c.dateOfBirth}T00:00:00Z`),
            documentType: c.documentType,
            documentImagePath: null,
            documentDelivery: 'EMAIL',
            emailMessageId: c.emailMessageId,
            emailAcceptedAt: new Date(c.emailAcceptedAt),
            documentMimeType: c.documentMimeType,
            documentSizeBytes: c.documentSizeBytes,
          },
        });
        await tx.user.update({ where: { id: c.userId }, data: { kycStatus: 'PENDING' } });
        await tx.auditLog.create({
          data: { userId: c.userId, action: 'KYC_SUBMITTED', metadata: { submissionId: c.submissionId, delivery: 'EMAIL' } },
        });
        return 'created' as const;
      });
      if (outcome === 'no_user') return res.status(404).json({ error: 'User not found', code: 'kyc_no_user' });
      return res.status(outcome === 'created' ? 201 : 200).json({ status: outcome, submissionId: c.submissionId });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return res.status(200).json({ status: 'exists', submissionId: c.submissionId });
      }
      console.error('[kyc] confirm failed:', err instanceof Error ? err.name : 'error');
      return res.status(503).json({ error: 'Temporarily unavailable', code: 'kyc_confirm_failed' });
    }
  });

  router.get('/kyc/me', requireAuth(prisma), async (req: AuthedRequest, res) => {
    const [user, latest] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { kycStatus: true } }),
      prisma.kycSubmission.findFirst({ where: { userId: req.userId }, orderBy: { createdAt: 'desc' } }),
    ]);

    res.json({
      kycStatus: user?.kycStatus ?? 'NOT_STARTED',
      latestSubmission: latest
        ? {
            id: latest.id,
            country: latest.country,
            fullName: latest.fullName,
            documentType: latest.documentType,
            status: latest.status,
            rejectionReason: latest.rejectionReason,
            createdAt: latest.createdAt,
          }
        : null,
    });
  });

  // Admin-only: where new submissions' documents go. Fixed server-side in
  // the edge (and its send binding); nothing here can change it.
  router.get('/kyc/admin/delivery', requireAuth(prisma), requireAdmin(prisma), async (_req, res) => {
    res.set('Cache-Control', 'private, no-store').json({ mode: 'EDGE_EMAIL', configured: await trust.configured(), recipient: RECIPIENT_MASKED });
  });

  // Admin-only, LEGACY rows only: stream a document uploaded here before the
  // KYC edge. New submissions have no file on this server.
  router.get('/kyc/:id/document', requireAuth(prisma), requireAdmin(prisma), async (req, res) => {
    const submission = await prisma.kycSubmission.findUnique({ where: { id: req.params.id } });
    if (!submission) return res.status(404).json({ error: 'Not found' });
    if (!submission.documentImagePath) return res.status(404).json({ error: 'Document delivered by email', code: 'kyc_document_emailed' });
    res.set('Cache-Control', 'private, no-store');
    res.sendFile(submission.documentImagePath, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Document file missing' });
    });
  });

  router.post('/kyc/:id/review', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res) => {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const submission = await prisma.kycSubmission.findUnique({ where: { id: req.params.id } });
    if (!submission) return res.status(404).json({ error: 'Not found' });
    if (submission.status !== 'PENDING') return res.status(400).json({ error: 'Already reviewed' });

    const status = parsed.data.approve ? 'APPROVED' : 'REJECTED';
    await prisma.kycSubmission.update({
      where: { id: submission.id },
      data: { status, rejectionReason: parsed.data.reason ?? null, reviewedBy: req.userId, reviewedAt: new Date() },
    });
    await prisma.user.update({ where: { id: submission.userId }, data: { kycStatus: status } });
    await prisma.auditLog.create({
      data: {
        userId: submission.userId,
        action: `KYC_${status}`,
        metadata: { submissionId: submission.id, reviewedBy: req.userId },
      },
    });

    res.json({ status });
  });

  return router;
}
