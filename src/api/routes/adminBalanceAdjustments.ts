import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { asyncRoute } from '../asyncRoute';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { BalanceAdjustmentConflict, BalanceAdjustmentError, BalanceAdjustmentService } from '../../services/BalanceAdjustmentService';

const intentSchema = z.object({ asset: z.string().trim().min(1).max(10), amount: z.string().min(1).max(80), reason: z.string().trim().min(1).max(500), idempotencyKey: z.string().uuid() }).strict();

/** Additive only: old clients keep their old route until their own migration. */
export function adminBalanceAdjustmentsRouter(prisma: PrismaClient): Router {
  const router = Router(), service = new BalanceAdjustmentService(prisma);
  const gate = [requireAuth(prisma), requireAdmin(prisma)];
  router.post('/admin/users/:id/balance-adjustments', ...gate, asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = intentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Проверьте актив, сумму, причину и ключ операции.', code: 'INVALID_ADJUSTMENT' });
    if (!await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true } })) return res.status(404).json({ error: 'Пользователь не найден.', code: 'USER_NOT_FOUND' });
    try {
      const receipt = await service.adjustOnce({ ...parsed.data, userId: req.params.id, performedByAdminId: req.userId! });
      return res.set('Cache-Control', 'private, no-store').json(receipt);
    } catch (error) {
      if (error instanceof BalanceAdjustmentConflict) return res.status(409).json({ error: 'Ключ операции уже использован с другими параметрами. Проверьте исходную операцию.', code: 'OPERATION_CONFLICT' });
      if (error instanceof BalanceAdjustmentError) return res.status(400).json({ error: 'Корректировка недоступна: проверьте актив, точность суммы и доступный баланс.', code: 'INVALID_ADJUSTMENT' });
      throw error;
    }
  }));
  router.get('/admin/users/:id/balance-adjustments/:operationId', ...gate, asyncRoute(async (req: AuthedRequest, res) => {
    if (!z.string().uuid().safeParse(req.params.operationId).success) return res.status(400).json({ error: 'Некорректный ключ операции.', code: 'INVALID_OPERATION_KEY' });
    const receipt = await service.findReceipt(req.params.id, req.params.operationId, req.userId!);
    res.set('Cache-Control', 'private, no-store');
    if (!receipt) return res.status(404).json({ error: 'Подтверждённый результат пока не найден. Сохраните исходный ключ операции.', code: 'RECEIPT_NOT_FOUND' });
    return res.json(receipt);
  }));
  return router;
}
