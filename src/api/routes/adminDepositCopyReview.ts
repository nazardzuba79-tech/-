import type { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { asyncRoute } from '../asyncRoute';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { CopyReviewNotFound, ignoreDepositCopy } from '../../services/deposits/depositCopyResolution';
import { latestDepositCopiesForUsers } from '../../services/deposits/latestDepositCopiesForUsers';
import { markWriteWithoutBackgroundWork } from '../../services/BackgroundWorkCoordinator';

/** Explicit admin action only. Never called by opening a row/tab or a timer. */
export function mountDepositCopyReview(router: Router, prisma: PrismaClient): void {
  router.post('/admin/deposit-address-copies/:id/ignore', requireAuth(prisma), requireAdmin(prisma), asyncRoute(async (req: AuthedRequest, res) => {
    markWriteWithoutBackgroundWork(res);
    if (!z.string().uuid().safeParse(req.params.id).success || !z.object({}).strict().safeParse(req.body ?? {}).success) {
      return res.status(400).json({ error: 'Некорректный сигнал.' });
    }
    try {
      const result = await ignoreDepositCopy(prisma, req.params.id, req.userId!);
      // The acknowledgement committed before this read. A different rail or
      // a newer copy remains visible instead of being optimistically erased.
      const copies = await latestDepositCopiesForUsers(prisma, [result.userId]);
      res.set('Cache-Control', 'private, no-store');
      return res.json({ userId: result.userId, ignoredEventId: req.params.id,
        lastDepositCopy: copies.byUser.get(result.userId) ?? null, depositCopyLookupFailed: copies.failed });
    } catch (error) {
      if (error instanceof CopyReviewNotFound) return res.status(404).json({ error: error.message });
      throw error;
    }
  }));
}
