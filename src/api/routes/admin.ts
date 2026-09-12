import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

export function adminRouter(prisma: PrismaClient): Router {
  const router = Router();

  // One read-only aggregate request; no explorer fan-out and no financial writes.
  router.get('/admin/overview', requireAuth(prisma), requireAdmin(prisma), async (_req, res) => {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setUTCHours(0, 0, 0, 0);
    try {
      const [totalUsers, pendingKyc, pendingWithdrawals, creditedDepositsToday] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { kycStatus: 'PENDING' } }),
        prisma.withdrawal.count({ where: { status: 'PENDING' } }),
        // Deposit.createdAt is not a credit timestamp. The credit audit event
        // is created in the credit transaction, including delayed credits.
        prisma.auditLog.count({ where: { action: 'DEPOSIT_CREDITED', createdAt: { gte: dayStart, lte: now } } }),
      ]);
      res.json({ totalUsers, pendingKyc, pendingWithdrawals, creditedDepositsToday,
        unmatchedIncoming: null, unmatchedIncomingReason: 'live_provider_feed',
        dayStart: dayStart.toISOString(), asOf: now.toISOString() });
    } catch {
      res.status(503).json({ error: 'Admin overview temporarily unavailable' });
    }
  });

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
