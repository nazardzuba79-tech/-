import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { requireAuthOrApiKey, ApiAuthedRequest } from '../middleware/apiKeyAuth';

/**
 * A user's own completed trades (fills), newest first — powers the "Trade
 * History" tab on the trade page. Distinct from /orders/me: an order can
 * fill across several trades, each at a possibly different price.
 */
export function tradesRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.get('/trades/me', requireAuthOrApiKey(prisma), async (req: ApiAuthedRequest, res) => {
    const pair = req.query.pair as string | undefined;
    const trades = await prisma.trade.findMany({
      where: {
        OR: [{ takerUserId: req.userId }, { makerUserId: req.userId }],
        ...(pair ? { pair } : {}),
      },
      orderBy: { executedAt: 'desc' },
      take: 100,
    });

    res.json(
      trades.map((t: (typeof trades)[number]) => ({
        id: t.id,
        pair: t.pair,
        // trade.side records the TAKER's side — flip it for the maker leg.
        side: t.takerUserId === req.userId ? t.side : t.side === 'BUY' ? 'SELL' : 'BUY',
        price: t.price.toString(),
        quantity: t.quantity.toString(),
        executedAt: t.executedAt,
      }))
    );
  });

  return router;
}
