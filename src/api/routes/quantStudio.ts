import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient, Prisma } from '@prisma/client';
import { asyncRoute } from '../asyncRoute';
import { requireAuth, type AuthedRequest } from '../middleware/auth';

type Reader = Pick<Prisma.TransactionClient, 'copyStrategyOwner'>;
function premiumAuthor(db: Reader, userId: string) {
  return db.copyStrategyOwner.findFirst({
    where: {
      premium: true,
      OR: [{ ownerUserId: userId }, { ownerUserId: null, studioAuthorUserId: userId }],
    },
    select: { traderId: true },
  });
}
const fields = { id: true, name: true, pair: true, description: true, publishedAt: true } as const;
const draft = z
  .object({
    name: z.string().trim().min(3).max(60),
    pair: z.enum(['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT']),
    description: z.string().trim().min(16).max(320),
  })
  .strict();

export function quantStudioRouter(prisma: PrismaClient, thomasId: string) {
  const router = Router();
  router.use('/trading-bots/studio', requireAuth(prisma), (_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  router.get(
    '/trading-bots/studio',
    asyncRoute(async (req: AuthedRequest, res) => {
      const ownerUserId = req.userId!;
      const [viewer, thomas, published] = await Promise.all([
        premiumAuthor(prisma, ownerUserId),
        premiumAuthor(prisma, thomasId),
        prisma.quantStrategyDraft.findMany({
          where: { publishedAt: { not: null } },
          orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
          take: 24,
          select: { ...fields, owner: { select: { displayName: true } } },
        }),
      ]);
      const drafts = viewer
        ? await prisma.quantStrategyDraft.findMany({
            where: { ownerUserId, publishedAt: null },
            orderBy: { createdAt: 'desc' },
            select: fields,
          })
        : [];
      res.json({ canCreate: !!viewer, thomasVip: !!thomas, published, drafts });
    }),
  );
  router.post(
    '/trading-bots/studio/drafts',
    asyncRoute(async (req: AuthedRequest, res) => {
      const ownerUserId = req.userId!;
      const result = await prisma.$transaction(
        async (tx) => {
          if (!(await premiumAuthor(tx, ownerUserId))) return { status: 403 };
          const parsed = draft.safeParse(req.body);
          if (!parsed.success) return { status: 400 };
          return {
            status: 201,
            data: await tx.quantStrategyDraft.create({
              data: { ...parsed.data, ownerUserId },
              select: fields,
            }),
          };
        },
        { isolationLevel: 'Serializable' },
      );
      res.status(result.status).json(result.data ?? { error: 'Draft unavailable' });
    }),
  );
  router.post(
    '/trading-bots/studio/drafts/:id/publish',
    asyncRoute(async (req: AuthedRequest, res) => {
      const ownerUserId = req.userId!;
      const status = await prisma.$transaction(
        async (tx) => {
          if (!(await premiumAuthor(tx, ownerUserId))) return 403;
          const updated = await tx.quantStrategyDraft.updateMany({
            where: { id: req.params.id, ownerUserId, publishedAt: null },
            data: { publishedAt: new Date() },
          });
          return updated.count === 1 ? 200 : 404;
        },
        { isolationLevel: 'Serializable' },
      );
      res.status(status).json({ published: status === 200 });
    }),
  );
  return router;
}
