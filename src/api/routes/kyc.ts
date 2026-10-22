import { asyncRoute } from '../asyncRoute';
import express, { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma, PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { KycEdgeTrust, KYC_EDGE_BODY_TYPE, kycSubmissionId } from '../../services/KycEdgeTrust';
import {
  DOCUMENT_MIME_TYPES, DOCUMENT_REASONS, MATERIAL_KINDS, MATERIAL_PARTS, MAX_MATERIAL_BYTES, SELFIE_CONSENT_VERSION,
  kycMaterialDeliveryId, kycReviewStage, needsDocument, needsSelfie, requestComplete, userMaterialView, adminMaterialView,
  type MaterialPart,
} from '../../services/kycMaterials';

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
 *
 * ADDITIONAL MATERIALS (services/kycMaterials.ts): while a submission is
 * PENDING an admin can ask for a new document photo, an ordinary selfie, or
 * both (POST /kyc/:id/material-requests). The user's files take the same
 * edge → mailbox road, with the same two signed calls per file
 * (/internal/kyc/materials/authorize, /internal/kyc/materials/confirmed).
 * User.kycStatus stays PENDING; the finer stage is derived, never stored twice.
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

// Admin free text is shown to the user verbatim: one line, no control characters.
const adminText = (max: number) => z.string().transform(v => v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()).pipe(z.string().max(max));

const materialRequestSchema = z.object({
  clientRequestId: z.string().uuid(),
  kind: z.enum(MATERIAL_KINDS),
  documentReason: z.enum(DOCUMENT_REASONS).optional(),
  documentReasonText: adminText(300).optional(),
  selfieComment: adminText(300).optional(),
}).strict().superRefine((v, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (needsDocument(v.kind) && !v.documentReason) issue('documentReason', 'Укажите причину запроса нового фото документа');
  if (!needsDocument(v.kind) && (v.documentReason || v.documentReasonText)) issue('documentReason', 'Причина относится только к запросу документа');
  if (v.documentReason === 'OTHER' && (!v.documentReasonText || v.documentReasonText.length < 3)) issue('documentReasonText', 'Опишите причину своими словами (не меньше 3 символов)');
  if (v.documentReason !== 'OTHER' && v.documentReasonText) issue('documentReasonText', 'Собственный текст указывается только для «Другая причина»');
  if (!needsSelfie(v.kind) && v.selfieComment) issue('selfieComment', 'Комментарий относится только к запросу селфи');
});

const materialMeta = {
  requestId: z.string().uuid(),
  materialRequestId: z.string().uuid(),
  part: z.enum(MATERIAL_PARTS),
  mimeType: z.enum(DOCUMENT_MIME_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_MATERIAL_BYTES),
};

const materialAuthorizeSchema = z.object({
  ...materialMeta,
  selfieConsent: z.literal(true).optional(),
  consentVersion: z.literal(SELFIE_CONSENT_VERSION).optional(),
}).strict();

const materialConfirmSchema = z.object({
  ...materialMeta,
  deliveryId: z.string().uuid(),
  userId: z.string().min(1).max(64),
  emailMessageId: z.string().regex(/^[A-Za-z0-9._%+=$#!~-]{1,160}@[A-Za-z0-9.-]{1,120}$/),
  emailAcceptedAt: z.string().datetime(),
  selfieConsentAt: z.string().datetime().optional(),
  consentVersion: z.literal(SELFIE_CONSENT_VERSION).optional(),
}).strict();

/** A selfie is a photograph, and it is collected only with the user's explicit consent. */
function partRefusal(part: MaterialPart, mimeType: string, consent: boolean): { status: number; code: string } | null {
  if (part === 'SELFIE' && mimeType === 'application/pdf') return { status: 400, code: 'kyc_file_type' };
  if (part === 'SELFIE' && !consent) return { status: 400, code: 'kyc_selfie_consent_required' };
  return null;
}

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
    asyncRoute(async (req: RawRequest, res: Response, next: NextFunction) => {
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
    }),
  ];
}

export function kycRouter(prisma: PrismaClient, trust: KycEdgeTrust = new KycEdgeTrust()): Router {
  const router = Router();

  // The Render upload path is closed: no multer, no uploads/kyc, no disk
  // write. A stale client gets a clear answer instead of a silent failure.
  router.post('/kyc/submit', (_req: Request, res: Response) => {
    res.status(410).json({ error: 'KYC upload moved to the KYC edge', code: 'kyc_upload_moved' });
  });

  router.post('/internal/kyc/authorize', ...requireEdge(trust), requireAuth(prisma), asyncRoute(async (req: RawRequest, res: Response) => {
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
  }));

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

  router.get('/kyc/me', requireAuth(prisma), asyncRoute(async (req: AuthedRequest, res) => {
    const [user, latest] = await Promise.all([
      prisma.user.findUnique({ where: { id: req.userId }, select: { kycStatus: true } }),
      prisma.kycSubmission.findFirst({ where: { userId: req.userId }, orderBy: { createdAt: 'desc' } }),
    ]);
    // Only a submission under review can carry an open request. Read from the
    // server on every visit, so a request survives a reload or a new sign-in.
    const active = latest?.status === 'PENDING'
      ? await prisma.kycMaterialRequest.findFirst({ where: { submissionId: latest.id, userId: req.userId, closedAt: null }, orderBy: { createdAt: 'desc' } })
      : null;

    res.set('Cache-Control', 'private, no-store');
    res.json({
      kycStatus: user?.kycStatus ?? 'NOT_STARTED',
      reviewStage: kycReviewStage(latest, active),
      materialRequest: active ? userMaterialView(active) : null,
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
  }));

  // Admin-only: where new submissions' documents go. Fixed server-side in
  // the edge (and its send binding); nothing here can change it.
  router.get('/kyc/admin/delivery', requireAuth(prisma), requireAdmin(prisma), asyncRoute(async (_req, res) => {
    res.set('Cache-Control', 'private, no-store').json({ mode: 'EDGE_EMAIL', configured: await trust.configured(), recipient: RECIPIENT_MASKED });
  }));

  // Admin-only, LEGACY rows only: stream a document uploaded here before the
  // KYC edge. New submissions have no file on this server.
  router.get('/kyc/:id/document', requireAuth(prisma), requireAdmin(prisma), asyncRoute(async (req, res) => {
    const submission = await prisma.kycSubmission.findUnique({ where: { id: req.params.id } });
    if (!submission) return res.status(404).json({ error: 'Not found' });
    if (!submission.documentImagePath) return res.status(404).json({ error: 'Document delivered by email', code: 'kyc_document_emailed' });
    res.set('Cache-Control', 'private, no-store');
    res.sendFile(submission.documentImagePath, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Document file missing' });
    });
  }));

  router.post('/kyc/:id/review', requireAuth(prisma), requireAdmin(prisma), asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const submission = await prisma.kycSubmission.findUnique({ where: { id: req.params.id } });
    if (!submission) return res.status(404).json({ error: 'Not found' });
    if (submission.status !== 'PENDING') return res.status(400).json({ error: 'Already reviewed' });

    const status = parsed.data.approve ? 'APPROVED' : 'REJECTED';
    const reviewedAt = new Date();
    await prisma.kycSubmission.update({
      where: { id: submission.id },
      data: { status, rejectionReason: parsed.data.reason ?? null, reviewedBy: req.userId, reviewedAt },
    });
    await prisma.user.update({ where: { id: submission.userId }, data: { kycStatus: status } });
    // A decision ends any request for additional materials on this submission.
    // Nothing is deleted: what arrived stays recorded for the audit trail.
    const closed = await prisma.kycMaterialRequest.updateMany({
      where: { submissionId: submission.id, closedAt: null },
      data: { status: 'CLOSED', closedAt: reviewedAt, closedBy: req.userId, closedOutcome: status },
    });
    await prisma.auditLog.create({
      data: {
        userId: submission.userId,
        action: `KYC_${status}`,
        metadata: { submissionId: submission.id, reviewedBy: req.userId, closedMaterialRequests: closed?.count ?? 0 },
      },
    });

    res.json({ status });
  }));

  // ── Additional materials: the admin asks ───────────────────────────────

  router.post('/kyc/:id/material-requests', requireAuth(prisma), requireAdmin(prisma), asyncRoute(async (req: AuthedRequest, res) => {
    res.set('Cache-Control', 'private, no-store');
    const parsed = materialRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return res.status(400).json({ error: first?.code === 'custom' ? first.message : 'Недопустимые параметры запроса', code: 'kyc_material_request_invalid' });
    }
    const v = parsed.data;
    const adminId = req.userId!;
    const outcome = await prisma.$transaction(async (tx) => {
      // One request at a time per submission, and none after a decision: the
      // submission row is locked for the check-and-replace below.
      const locked = await tx.$queryRaw<{ id: string; status: string; userId: string }[]>`SELECT "id", "status", "userId" FROM "KycSubmission" WHERE "id" = ${req.params.id} FOR UPDATE`;
      if (locked.length === 0) return { result: 'not_found' as const };
      const replay = await tx.kycMaterialRequest.findUnique({ where: { clientRequestId: v.clientRequestId } });
      if (replay) return replay.submissionId === req.params.id ? { result: 'replay' as const, row: replay } : { result: 'conflict' as const };
      if (locked[0].status !== 'PENDING') return { result: 'not_pending' as const };
      const now = new Date();
      const superseded = await tx.kycMaterialRequest.findFirst({ where: { submissionId: req.params.id, closedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true } });
      if (superseded) {
        await tx.kycMaterialRequest.updateMany({
          where: { submissionId: req.params.id, closedAt: null },
          data: { status: 'CLOSED', closedAt: now, closedBy: adminId, closedOutcome: 'SUPERSEDED' },
        });
      }
      const row = await tx.kycMaterialRequest.create({
        data: {
          submissionId: req.params.id,
          userId: locked[0].userId,
          kind: v.kind,
          documentReason: needsDocument(v.kind) ? v.documentReason ?? null : null,
          documentReasonText: v.documentReason === 'OTHER' ? v.documentReasonText ?? null : null,
          selfieComment: needsSelfie(v.kind) && v.selfieComment ? v.selfieComment : null,
          requestedBy: adminId,
          clientRequestId: v.clientRequestId,
          createdAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: locked[0].userId,
          action: 'KYC_MATERIALS_REQUESTED',
          metadata: { submissionId: req.params.id, materialRequestId: row.id, kind: v.kind, documentReason: row.documentReason, supersededId: superseded?.id ?? null, requestedBy: adminId },
        },
      });
      return { result: 'created' as const, row };
    });
    if (outcome.result === 'not_found') return res.status(404).json({ error: 'Заявка не найдена', code: 'kyc_not_found' });
    if (outcome.result === 'conflict') return res.status(409).json({ error: 'Ключ запроса уже использован для другой заявки', code: 'kyc_material_request_conflict' });
    if (outcome.result === 'not_pending') return res.status(409).json({ error: 'По заявке уже принято решение. Запросить материалы можно только у заявки на проверке.', code: 'kyc_not_pending' });
    const row = outcome.row;
    res.status(outcome.result === 'created' ? 201 : 200).json({ materialRequest: adminMaterialView(row), reviewStage: kycReviewStage({ status: 'PENDING' }, row) });
  }));

  // The admin opened the received materials: «Материалы получены» → «Повторная проверка».
  router.post('/kyc/material-requests/:requestId/acknowledge', requireAuth(prisma), requireAdmin(prisma), asyncRoute(async (req: AuthedRequest, res) => {
    res.set('Cache-Control', 'private, no-store');
    const row = await prisma.kycMaterialRequest.findUnique({ where: { id: req.params.requestId } });
    if (!row) return res.status(404).json({ error: 'Запрос не найден', code: 'kyc_material_request_not_found' });
    if (row.closedAt || row.status !== 'RECEIVED') return res.json({ acknowledged: !!row.acknowledgedAt });
    if (row.acknowledgedAt) return res.json({ acknowledged: true });
    const now = new Date();
    const updated = await prisma.kycMaterialRequest.updateMany({
      where: { id: row.id, status: 'RECEIVED', closedAt: null, acknowledgedAt: null },
      data: { acknowledgedAt: now, acknowledgedBy: req.userId },
    });
    if (updated.count > 0) {
      await prisma.auditLog.create({ data: { userId: row.userId, action: 'KYC_MATERIALS_VIEWED', metadata: { submissionId: row.submissionId, materialRequestId: row.id, viewedBy: req.userId } } });
    }
    res.json({ acknowledged: true });
  }));

  // ── Additional materials: the user's file, through the edge ────────────

  router.post('/internal/kyc/materials/authorize', ...requireEdge(trust), requireAuth(prisma), asyncRoute(async (req: RawRequest, res: Response) => {
    const parsed = materialAuthorizeSchema.safeParse(req.edgeBody);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid material', code: 'kyc_bad_request' });
    const m = parsed.data;
    const refusal = partRefusal(m.part, m.mimeType, m.selfieConsent === true && m.consentVersion === SELFIE_CONSENT_VERSION);
    if (refusal) return res.status(refusal.status).json({ error: 'Material refused', code: refusal.code });

    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, email: true } });
    if (!user) return res.status(401).json({ error: 'User not found' });
    const row = await prisma.kycMaterialRequest.findUnique({ where: { id: m.materialRequestId } });
    // Another user's request is answered exactly like a missing one.
    if (!row || row.userId !== user.id) return res.status(404).json({ error: 'Request not found', code: 'kyc_material_request_not_found' });
    const submission = await prisma.kycSubmission.findUnique({ where: { id: row.submissionId }, select: { status: true, fullName: true } });
    if (!submission || row.closedAt || submission.status !== 'PENDING') return res.status(409).json({ error: 'Request closed', code: 'kyc_material_request_closed' });
    if (m.part === 'DOCUMENT' ? !needsDocument(row.kind) : !needsSelfie(row.kind)) return res.status(409).json({ error: 'Not requested', code: 'kyc_material_not_requested' });

    const deliveryId = kycMaterialDeliveryId(user.id, row.id, m.part, m.requestId);
    const receivedAt = m.part === 'DOCUMENT' ? row.documentReceivedAt : row.selfieReceivedAt;
    const receivedDelivery = m.part === 'DOCUMENT' ? row.documentDeliveryId : row.selfieDeliveryId;
    if (receivedAt) {
      // The same attempt already delivered and recorded — the edge must not send again.
      if (receivedDelivery === deliveryId) return res.json({ deliveryId, userId: user.id, email: user.email, fullName: submission.fullName, submissionId: row.submissionId, alreadyReceived: true });
      return res.status(409).json({ error: 'Already received', code: 'kyc_material_already_received' });
    }
    if (!allowAuthorize(`material:${user.id}`)) return res.status(429).json({ error: 'Too many attempts', code: 'kyc_rate_limited' });
    res.json({ deliveryId, userId: user.id, email: user.email, fullName: submission.fullName, submissionId: row.submissionId, alreadyReceived: false });
  }));

  router.post('/internal/kyc/materials/confirmed', ...requireEdge(trust), async (req: RawRequest, res: Response) => {
    const parsed = materialConfirmSchema.safeParse(req.edgeBody);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid confirmation', code: 'kyc_bad_request' });
    const c = parsed.data;
    if (kycMaterialDeliveryId(c.userId, c.materialRequestId, c.part, c.requestId) !== c.deliveryId) {
      return res.status(400).json({ error: 'Delivery id mismatch', code: 'kyc_delivery_mismatch' });
    }
    const refusal = partRefusal(c.part, c.mimeType, !!c.selfieConsentAt && c.consentVersion === SELFIE_CONSENT_VERSION);
    if (refusal) return res.status(refusal.status).json({ error: 'Material refused', code: refusal.code });

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        // Serialize per request: a document and a selfie arriving together can
        // never both decide the request is incomplete (or both complete it).
        const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "KycMaterialRequest" WHERE "id" = ${c.materialRequestId} FOR UPDATE`;
        if (locked.length === 0) return { result: 'no_request' as const };
        const row = await tx.kycMaterialRequest.findUnique({ where: { id: c.materialRequestId } });
        if (!row || row.userId !== c.userId) return { result: 'no_request' as const };
        const isDocument = c.part === 'DOCUMENT';
        if (isDocument ? !needsDocument(row.kind) : !needsSelfie(row.kind)) return { result: 'not_requested' as const };
        const received = isDocument ? row.documentReceivedAt : row.selfieReceivedAt;
        if (received) {
          const same = (isDocument ? row.documentDeliveryId : row.selfieDeliveryId) === c.deliveryId;
          return { result: same ? 'exists' as const : 'already_received' as const, complete: requestComplete(row) };
        }
        const at = new Date(c.emailAcceptedAt);
        const parts = isDocument
          ? { documentDeliveryId: c.deliveryId, documentReceivedAt: at, documentMessageId: c.emailMessageId, documentMimeType: c.mimeType, documentSizeBytes: c.sizeBytes }
          : { selfieDeliveryId: c.deliveryId, selfieReceivedAt: at, selfieMessageId: c.emailMessageId, selfieMimeType: c.mimeType, selfieSizeBytes: c.sizeBytes,
              selfieConsentAt: new Date(c.selfieConsentAt!), selfieConsentVersion: c.consentVersion! };
        const complete = requestComplete({ ...row, ...parts });
        // A file that arrived after the admin decided is still recorded (it was
        // delivered), but it cannot reopen a closed request.
        await tx.kycMaterialRequest.update({
          where: { id: row.id },
          data: { ...parts, ...(row.closedAt ? {} : { status: complete ? 'RECEIVED' : 'OPEN' }) },
        });
        await tx.auditLog.create({
          data: {
            userId: row.userId,
            action: 'KYC_MATERIAL_RECEIVED',
            metadata: { submissionId: row.submissionId, materialRequestId: row.id, part: c.part, delivery: 'EMAIL', complete, afterClose: !!row.closedAt,
              ...(isDocument ? {} : { consentVersion: c.consentVersion }) },
          },
        });
        return { result: 'created' as const, complete };
      });
      if (outcome.result === 'no_request') return res.status(404).json({ error: 'Request not found', code: 'kyc_material_request_not_found' });
      if (outcome.result === 'not_requested') return res.status(409).json({ error: 'Not requested', code: 'kyc_material_not_requested' });
      if (outcome.result === 'already_received') return res.status(409).json({ error: 'Already received', code: 'kyc_material_already_received' });
      return res.status(outcome.result === 'created' ? 201 : 200).json({ status: outcome.result, complete: outcome.complete });
    } catch (err) {
      console.error('[kyc] material confirm failed:', err instanceof Error ? err.name : 'error');
      return res.status(503).json({ error: 'Temporarily unavailable', code: 'kyc_confirm_failed' });
    }
  });

  return router;
}
