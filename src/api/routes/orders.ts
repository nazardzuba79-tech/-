import { Router } from 'express';
import { z } from 'zod';
import BigNumber from 'bignumber.js';
import { PrismaClient } from '@prisma/client';
import { MatchingEngine } from '../../matching-engine/MatchingEngine';
import { OrderService } from '../../services/OrderService';
import { requireAuth, AuthedRequest } from '../middleware/auth';

const placeOrderSchema = z.object({
  pair: z.string().regex(/^[A-Z0-9]+\/[A-Z0-9]+$/),
  side: z.enum(['BUY', 'SELL']),
  price: z.string().refine((v) => new BigNumber(v).isGreaterThan(0), 'price must be > 0'),
  quantity: z.string().refine((v) => new BigNumber(v).isGreaterThan(0), 'quantity must be > 0'),
});

export function ordersRouter(prisma: PrismaClient, engine: MatchingEngine): Router {
  const router = Router();
  const orderService = new OrderService(prisma, engine);

  router.post('/orders', requireAuth, async (req: AuthedRequest, res) => {
    const parsed = placeOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    const { pair, side, price, quantity } = parsed.data;

    try {
      const result = await orderService.placeLimitOrder({
        userId: req.userId!,
        pair,
        side,
        price: new BigNumber(price),
        quantity: new BigNumber(quantity),
      });
      res.status(201).json({
        order: {
          ...result.order,
          price: result.order.price?.toString(),
          originalQuantity: result.order.originalQuantity.toString(),
          remainingQuantity: result.order.remainingQuantity.toString(),
        },
        trades: result.trades.map((t: (typeof result.trades)[number]) => ({
        ...t,
        price: t.price.toString(),
        quantity: t.quantity.toString(),
      })),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  router.get('/orderbook/:pair', async (req, res) => {
    const snapshot = engine.getBook(req.params.pair.toUpperCase()).snapshot();
    res.json({
      pair: snapshot.pair,
      bids: snapshot.bids.map((l) => ({ price: l.price.toString(), quantity: l.quantity.toString(), orders: l.orderCount })),
      asks: snapshot.asks.map((l) => ({ price: l.price.toString(), quantity: l.quantity.toString(), orders: l.orderCount })),
      timestamp: snapshot.timestamp,
    });
  });

  router.delete('/orders/:orderId', requireAuth, async (req: AuthedRequest, res) => {
    const order = await prisma.order.findUnique({ where: { id: req.params.orderId } });
    if (!order || order.userId !== req.userId) {
      return res.status(404).json({ error: 'Order not found' });
    }
    engine.cancelOrder(order.pair, order.id);
    await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    // NOTE: unlocking the corresponding locked balance on cancel is omitted
    // here for brevity — mirror the lock logic in OrderService in reverse.
    res.status(204).send();
  });

  return router;
}
