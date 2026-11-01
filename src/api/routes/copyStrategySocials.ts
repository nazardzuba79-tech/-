import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { canPublishStrategySocials, normalizeStrategySocial, publicStrategySocials, type StrategySocials } from '../../shared/copyStrategySocials';

export function copyStrategySocialsRouter(db: PrismaClient) {
  const router = Router();
  router.use('/copy-trading/socials/:traderId', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); }, requireAuth(db));
  const handle = (write: boolean) => async (req: AuthedRequest, res: import('express').Response) => {
    const id = req.params.traderId;
    // requireAuth verifies JWT and live sessions; this editor additionally refuses legacy/no-exp tokens.
    const claims = jwt.decode(req.headers.authorization!.slice(7));
    if (!req.sessionId || !claims || typeof claims === 'string' || typeof claims.exp !== 'number') { res.status(401).json({ error: 'Требуется активная сессия' }); return; }
    if (!canPublishStrategySocials(id)) { res.status(403).json({ error: 'Редактирование недоступно' }); return; }
    let patch: Partial<StrategySocials> = {};
    if (write) {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || !Object.keys(req.body).length || Object.keys(req.body).some(k => !['xUrl', 'telegramUrl'].includes(k))) { res.status(400).json({ error: 'Допустимы только X и Telegram' }); return; }
      try { for (const field of ['xUrl', 'telegramUrl'] as const) if (Object.prototype.hasOwnProperty.call(req.body, field)) patch[field] = normalizeStrategySocial(field, req.body[field]); }
      catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
    }
    try {
      const result = await db.$transaction(async tx => {
        // Lock session and binding so logout/rebinding cannot race a completed write.
        const sessions = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Session" WHERE "id"=${req.sessionId!} AND "userId"=${req.userId!} AND "revokedAt" IS NULL FOR UPDATE`;
        if (!sessions.length) return { status: 401, error: 'Сессия завершена' };
        await tx.$queryRaw`SELECT "traderId" FROM "CopyStrategyOwner" WHERE "traderId"=${id} FOR UPDATE`;
        const owner = await tx.copyStrategyOwner.findUnique({ where: { traderId: id } });
        if (!owner || owner.ownerUserId !== req.userId) return { status: 403, error: 'Редактирование доступно только владельцу стратегии' };
        const current = publicStrategySocials(id, owner.socialOwnerUserId === owner.ownerUserId ? owner : null);
        if (!write) return { status: 200, value: { traderId: id, ...current } };
        const saved = await tx.copyStrategyOwner.update({ where: { traderId: id }, data: { ...current, ...patch, socialOwnerUserId: req.userId }, select: { traderId: true, xUrl: true, telegramUrl: true } });
        return { status: 200, value: saved };
      });
      res.status(result.status).json(result.value ?? { error: result.error });
    } catch { res.status(503).json({ error: 'Не удалось сохранить ссылки. Повторите позже.' }); }
  };
  router.get('/copy-trading/socials/:traderId', handle(false));
  router.patch('/copy-trading/socials/:traderId', handle(true));
  return router;
}
