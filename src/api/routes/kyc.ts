import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

/**
 * KYC identity verification — submission + manual review, same pattern as
 * Purchase fulfillment: a user submits their data and a document photo, an
 * admin looks at it and clicks approve/reject.
 *
 * NOT real identity verification. Nothing here checks that a document is
 * genuine, that the photo matches the person, or screens against sanctions
 * lists — see the KycSubmission model comment in schema.prisma for why a
 * licensed provider (Sumsub, Onfido, Jumio) is required before this can
 * hold real users' documents.
 */

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'kyc');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 10).replace(/[^.a-zA-Z0-9]/g, '');
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) return cb(new Error('Unsupported file type — use JPEG, PNG, or PDF'));
    cb(null, true);
  },
});

// multer's own errors (bad file type, too large) land in Express's error
// pipeline by default; convert them to a normal 400 instead of a 500.
function handleUpload(req: Request, res: Response, next: NextFunction) {
  upload.single('document')(req, res, (err: unknown) => {
    if (err) return res.status(400).json({ error: err instanceof Error ? err.message : 'Upload failed' });
    next();
  });
}

const submitSchema = z.object({
  country: z.string().regex(/^[A-Z]{2}$/, 'country must be an ISO 3166-1 alpha-2 code'),
  fullName: z.string().min(1).max(200),
  dateOfBirth: z.string().refine((v) => !isNaN(Date.parse(v)), 'invalid date of birth'),
  documentType: z.enum(['PASSPORT', 'ID_CARD', 'DRIVERS_LICENSE']),
  documentNumber: z.string().min(1).max(50),
});

const reviewSchema = z.object({
  approve: z.boolean(),
  reason: z.string().max(500).optional(),
});

export function kycRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.post('/kyc/submit', requireAuth, handleUpload, async (req: AuthedRequest, res) => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Document image is required' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!user) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: 'User not found' });
    }
    if (user.kycStatus === 'APPROVED') {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'Already verified' });
    }
    const alreadyPending = await prisma.kycSubmission.findFirst({ where: { userId: user.id, status: 'PENDING' } });
    if (alreadyPending) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'A submission is already pending review' });
    }

    const { country, fullName, dateOfBirth, documentType, documentNumber } = parsed.data;
    const submission = await prisma.kycSubmission.create({
      data: {
        userId: user.id,
        country,
        fullName,
        dateOfBirth: new Date(dateOfBirth),
        documentType,
        documentNumber,
        documentImagePath: req.file.path,
      },
    });
    await prisma.user.update({ where: { id: user.id }, data: { kycStatus: 'PENDING' } });
    await prisma.auditLog.create({
      data: { userId: user.id, action: 'KYC_SUBMITTED', metadata: { submissionId: submission.id } },
    });

    res.status(201).json({ id: submission.id, status: submission.status });
  });

  router.get('/kyc/me', requireAuth, async (req: AuthedRequest, res) => {
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

  // Admin-only: stream the uploaded document image/PDF for review.
  router.get('/kyc/:id/document', requireAuth, requireAdmin(prisma), async (req, res) => {
    const submission = await prisma.kycSubmission.findUnique({ where: { id: req.params.id } });
    if (!submission) return res.status(404).json({ error: 'Not found' });
    res.sendFile(submission.documentImagePath, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Document file missing' });
    });
  });

  router.post('/kyc/:id/review', requireAuth, requireAdmin(prisma), async (req: AuthedRequest, res) => {
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
