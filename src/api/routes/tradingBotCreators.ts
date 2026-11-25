import { thomasProfileRouter } from './thomasProfile';
import type { LiveSource } from '../../services/marketData/live/contract';
import { botHistoryReader } from '../../services/tradingBotPerformance';
import type { BotHistory } from '../../shared/thomasPerformance';
import { quantStudioRouter } from './quantStudio';
import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { asyncRoute } from '../asyncRoute';
import { requireAuth } from '../middleware/auth';

// Owner-approved profile binding. Renaming the profile preserves author identity.
const CATALOGUE_THOMAS_USER_ID = '85bb5e78-7f14-43e1-a5e4-7a0becf14a60';
export function tradingBotCreatorsRouter(prisma: PrismaClient, thomasId = process.env.TRADING_BOTS_THOMAS_USER_ID ?? CATALOGUE_THOMAS_USER_ID, feed:LiveSource|null=null) {
  const router = Router();
  const history = botHistoryReader(process.env.TRADING_BOTS_THOMAS_VERIFIED_SNAPSHOT, thomasId);
  let lastHistory: BotHistory | undefined;
  let responseBody = Buffer.alloc(0);
  router.get('/trading-bots/range/performance', requireAuth(prisma), asyncRoute(async (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    try {
      const current = await history();
      if (current !== lastHistory) {
        responseBody = Buffer.from(JSON.stringify(current));
        lastHistory = current;
      }
      // The same immutable snapshot is shared by authenticated readers. Avoid encoding
      // and generating a new ETag per poll on this private, no-store endpoint.
      res.type('json').set('Content-Length', String(responseBody.length)).end(responseBody);
    }
    catch { res.status(503).json({ error: 'Performance temporarily unavailable' }); }
  }));
  router.get('/trading-bots/creators', requireAuth(prisma), asyncRoute(async (_req, res) => {
    res.set('Cache-Control', 'private, no-store');
    const owner = thomasId ? await prisma.user.findUnique({
      where: { id: thomasId }, select: { displayName: true, avatarUrl: true },
    }) : null;
    if (!owner) return res.json({ creators: {} });

    const name = owner.displayName?.trim();
    const displayName = name && name.length <= 80 && !/[\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(name) ? name : null;
    const photo = owner.avatarUrl;
    const avatarUrl = photo && photo.length <= 700_000 && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(photo) ? photo : null;
    return res.json({ creators: { range: { displayName, avatarUrl } } });
  }));
  router.use(thomasProfileRouter(prisma,thomasId,feed));
  router.use(quantStudioRouter(prisma, thomasId));
  return router;
}
