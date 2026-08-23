import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

/**
 * A simple read-only feed of every AuditLog entry — who approved, rejected,
 * or changed what, and when. Every sensitive admin action already writes
 * one of these (KYC review, withdrawal approve/mark-sent/reject, treasury
 * wallet changes, manual balance adjustments, ...); this route just
 * surfaces them newest-first, with whichever admin acted resolved to an
 * email address where the entry recorded one (different actions use
 * different metadata keys — `performedByAdminId` or `reviewedBy` — so both
 * are checked).
 */
export function adminAuditLogRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/admin/audit-log', requireAuth, requireAdmin(prisma), async (req, res) => {
    const action = typeof req.query.action === 'string' ? req.query.action : undefined;
    const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;

    const entries = await prisma.auditLog.findMany({
      where: { ...(action ? { action } : {}), ...(userId ? { userId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    function actingAdminId(metadata: unknown): string | undefined {
      const meta = metadata as { performedByAdminId?: string; reviewedBy?: string } | null;
      return meta?.performedByAdminId ?? meta?.reviewedBy;
    }

    const relatedUserIds = Array.from(
      new Set(
        entries.flatMap((e) => [e.userId ?? undefined, actingAdminId(e.metadata)]).filter((v): v is string => Boolean(v))
      )
    );
    const users = relatedUserIds.length
      ? await prisma.user.findMany({ where: { id: { in: relatedUserIds } }, select: { id: true, email: true } })
      : [];
    const emailById = new Map(users.map((u) => [u.id, u.email]));

    res.json(
      entries.map((e) => {
        const adminId = actingAdminId(e.metadata);
        return {
          id: e.id,
          userId: e.userId,
          userEmail: e.userId ? emailById.get(e.userId) ?? null : null,
          action: e.action,
          metadata: e.metadata,
          performedByAdminEmail: adminId ? emailById.get(adminId) ?? null : null,
          createdAt: e.createdAt,
        };
      })
    );
  });

  return router;
}
