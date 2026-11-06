import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { orderTicketAllowed, requireOrderTicketTrader } from '../middleware/orderTicketAccess';
import { asyncRoute } from '../asyncRoute';

/** Shared outer policy, mounted before the existing financial routers. They
 * retain their engines, ownership checks, listing gates and financial math.
 * This boundary neither modifies a balance nor grants new execution types. */
export function orderTicketBoundary(prisma: PrismaClient): Router {
  const router = Router();
  const authenticate = requireAuth(prisma);
  router.get('/orders/access', authenticate, asyncRoute(async (req: AuthedRequest, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Vary', 'Authorization');
    res.json({ allowed: await orderTicketAllowed(prisma, req) });
  }));
  router.use((req, _res, next) => {
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const ticketPath = /^\/(?:orders(?:\/|$)|demo\/(?:orders(?:\/|$)|vta\/sell\/?$)|futures\/(?:orders(?:\/|$)|positions\/[^/]+\/(?:close|protection)\/?$)|private-trading\/native(?:\/|$))/i.test(req.path);
    if (!mutation || !ticketPath) return next('router');
    next();
  });
  router.use(authenticate, requireOrderTicketTrader(prisma));
  router.use((req, res, next) => {
    // Only the already-existing simulation-only MARKET SELL is supported
    // on /orders. Demo BUY/LIMIT uses /demo/orders, never ordinary Balance.
    if (req.method === 'POST' && (/^\/orders\/oco\/?$/i.test(req.path)
      || (/^\/orders\/?$/i.test(req.path) && (req.body?.side !== 'SELL' || req.body?.type !== 'MARKET')))) {
      return res.status(403).json({ code: 'DEMO_ROUTE_REQUIRED', error: 'Use the supported demo execution route' });
    }
    next();
  });
  return router;
}
