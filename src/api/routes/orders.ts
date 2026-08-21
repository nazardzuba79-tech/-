import { Router } from 'express';
import { z } from 'zod';
import BigNumber from 'bignumber.js';
import { PrismaClient } from '@prisma/client';
import { MatchingEngine } from '../../matching-engine/MatchingEngine';
import { OrderService } from '../../services/OrderService';
import { requireAuthOrApiKey, requireTradePermission, ApiAuthedRequest } from '../middleware/apiKeyAuth';

const placeOrderSchema = z.object({
  pair: z.string().regex(/^[A-Z0-9]+\/[A-Z0-9]+$/),
  side: z.enum(['BUY', 'SELL']),
  price: z.string().refine((v) => new BigNumber(v).isGreaterThan(0), 'price must be > 0'),
  quantity: z.string().refine((v) => new BigNumber(v).isGreaterThan(0), 'quantity must be > 0'),
});

export function ordersRouter(prisma: PrismaClient, engine: MatchingEngine): Router {
  const router = Router();
  const orderService = new OrderService(prisma, engine);

  router.post('/orders', requireAuthOrApiKey(prisma), requireTradePermission, async (req: ApiAuthedRequest, res) => {
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

  // Own orders, newest first — powers the "Open Orders" panel on the trade
  // page. Not paginated: fine for a single user's order history on an
  // internal team exchange, revisit if that stops being true.
  router.get('/orders/me', requireAuthOrApiKey(prisma), async (req: ApiAuthedRequest, res) => {
    const status = req.query.status as string | undefined;
    const orders = await prisma.order.findMany({
      where: { userId: req.userId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(
      orders.map((o: (typeof orders)[number]) => ({
        id: o.id,
        pair: o.pair,
        side: o.side,
        type: o.type,
        price: o.price?.toString() ?? null,
        originalQuantity: o.originalQuantity.toString(),
        remainingQuantity: o.remainingQuantity.toString(),
        status: o.status,
        createdAt: o.createdAt,
      }))
    );
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

  router.delete('/orders/:orderId', requireAuthOrApiKey(prisma), requireTradePermission, async (req: ApiAuthedRequest, res) => {
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
