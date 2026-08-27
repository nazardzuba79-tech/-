import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

export function adminRouter(prisma: PrismaClient): Router {
  const router = Router();

  // Admin-only: every client, with their latest KYC submission (if any) —
  // the full client list, not just the pending-review queue.
  router.get('/admin/clients', requireAuth(prisma), requireAdmin(prisma), async (_req, res) => {
    const [users, submissions] = await Promise.all([
      prisma.user.findMany({ orderBy: { createdAt: 'desc' } }),
      prisma.kycSubmission.findMany({ orderBy: { createdAt: 'desc' } }),
    ]);

    const latestByUser = new Map<string, (typeof submissions)[number]>();
    for (const s of submissions) {
      if (!latestByUser.has(s.userId)) latestByUser.set(s.userId, s);
    }

    res.json(
      users.map((u: (typeof users)[number]) => {
        const latest = latestByUser.get(u.id);
        return {
          id: u.id,
          email: u.email,
          role: u.role,
          isAdmin: u.role === 'ADMIN',
          kycStatus: u.kycStatus,
          createdAt: u.createdAt,
          latestKyc: latest
            ? {
                id: latest.id,
                country: latest.country,
                fullName: latest.fullName,
                dateOfBirth: latest.dateOfBirth,
                documentType: latest.documentType,
                status: latest.status,
                rejectionReason: latest.rejectionReason,
                createdAt: latest.createdAt,
              }
            : null,
        };
      })
    );
  });

  return router;
}
