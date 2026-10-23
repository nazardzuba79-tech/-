import { asyncRoute } from '../asyncRoute';
import { Router } from 'express';
import { z } from 'zod';
import BigNumber from 'bignumber.js';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { DemoTradingService, DemoTradingError } from '../../services/DemoTradingService';
import { VtaDemoSales, VtaDemoError } from '../../services/testMarkets/VtaDemoSales';
import { demoSpotEnabled, demoSpotLedger, demoSpotRole } from '../../services/demoSpotAccess';

const priceString = z.string().refine((v) => new BigNumber(v).isGreaterThan(0), 'must be > 0');

const placeOrderSchema = z
  .object({
    pair: z.string().regex(/^[A-Z0-9]+\/[A-Z0-9]+$/),
    side: z.enum(['BUY', 'SELL']),
    type: z.enum(['LIMIT', 'MARKET']).default('LIMIT'),
    price: priceString.optional(),
    quantity: priceString,
    // Optional client request ID: a retry after a lost response returns the same order.
    requestId: z.string().uuid().optional(),
  })
  .refine((v) => v.type !== 'LIMIT' || v.price !== undefined, { message: 'price is required for a LIMIT order', path: ['price'] });

export interface DemoSpotRouterOptions {
  /** Server flag, read per request (default: DEMO_SPOT_ENABLED === 'true'). */
  enabled?: () => boolean;
  /** Whether a pair is one the real Spot terminal trades. Admitted USER
   * accounts may trade only such pairs; without a checker none is admitted. */
  isSpotPair?: (pair: string) => Promise<boolean>;
}

const orderRow = (o: { id: string; pair: string; side: string; type: string; price: { toString(): string } | null;
  originalQuantity: { toString(): string }; remainingQuantity: { toString(): string }; status: string; createdAt: Date }) => ({
  id: o.id,
  pair: o.pair,
  side: o.side,
  type: o.type,
  price: o.price?.toString() ?? null,
  originalQuantity: o.originalQuantity.toString(),
  remainingQuantity: o.remainingQuantity.toString(),
  status: o.status,
  createdAt: o.createdAt,
});

/**
 * The demo trading ledger — see DemoBalance's doc comment in schema.prisma
 * for why this trades against its own MatchingEngine/tables instead of the
 * real ones. VTA routes are admin-only. The Spot routes are admin-only while
 * DEMO_SPOT_ENABLED is off (byte-for-byte the previous behaviour); with it on
 * they also serve a USER account an admin has credited with demo funds (see
 * demoSpotAccess). Everyone else is refused here, whatever the client sends.
 */
export function demoTradingRouter(prisma: PrismaClient, demoTrading: DemoTradingService, vtaDemo = new VtaDemoSales(prisma), options: DemoSpotRouterOptions = {}): Router {
  const router = Router();
  const enabled = options.enabled ?? (() => demoSpotEnabled());
  const isSpotPair = options.isSpotPair ?? (async () => false);
  const adminOnly = requireAdmin(prisma);
  const demoSpot = asyncRoute(async (req: AuthedRequest, res, next) => {
    if (!enabled()) return adminOnly(req, res, next);
    const role = await demoSpotRole(prisma, req.userId!, true);
    if (!role) return res.status(403).json({ error: 'Demo trading access required', code: 'DEMO_ACCESS_DENIED' });
    res.locals.demoSpotRole = role;
    next();
  });

  /** What the Spot terminal needs to choose its ledger. Never refuses a signed-in caller. */
  router.get('/demo/spot/access', requireAuth(prisma), asyncRoute(async (req: AuthedRequest, res) => {
    const on = enabled();
    res.json({
      enabled: on,
      admitted: on && (await demoSpotRole(prisma, req.userId!, true)) !== null,
      ledger: await demoSpotLedger(prisma, req.userId!, on),
    });
  }));

  // Internal demo liquidity (off by default): configuration, inventory, reference freshness. Admin only, read only.
  router.get('/demo/liquidity', requireAuth(prisma), requireAdmin(prisma), asyncRoute(async (_req, res) => {
    res.json(await demoTrading.liquidityStatus());
  }));

  router.get('/demo/vta', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res, next) => {
    try { res.json(await vtaDemo.snapshot(req.userId!)); } catch (error) {
      if (error instanceof VtaDemoError) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  });
  router.get('/demo/vta/sales/:requestId', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res, next) => {
    const parsed = z.string().uuid().safeParse(req.params.requestId);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid request ID' });
    try { res.json(await vtaDemo.operation(req.userId!, parsed.data)); } catch (error) {
      if (error instanceof VtaDemoError) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  });
  const vtaSaleSchema = z.object({ requestId: z.string().uuid(), quantity: priceString }).strict();
  router.post('/demo/vta/sell', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res, next) => {
    const parsed = vtaSaleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Некорректный запрос продажи.' });
    try { res.json(await vtaDemo.sell({ userId: req.userId!, ...parsed.data })); }
    catch (error) {
      if (error instanceof VtaDemoError) return res.status(error.status).json({ error: error.message, ...(error.status === 400 ? { vtaOutcome: 'REJECTED' } : {}) });
      next(error);
    }
  });

  router.get('/demo/balances', requireAuth(prisma), demoSpot, asyncRoute(async (req: AuthedRequest, res) => {
    const balances = await demoTrading.getBalances(req.userId!);
    res.json(balances.map((b) => ({ asset: b.asset, available: b.available.toString(), locked: b.locked.toString() })));
  }));

  router.post('/demo/orders', requireAuth(prisma), demoSpot, asyncRoute(async (req: AuthedRequest, res) => {
    const parsed = placeOrderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { pair, side, type, price, quantity, requestId } = parsed.data;
    if (res.locals.demoSpotRole === 'trader' && !(await isSpotPair(pair).catch(() => false))) {
      return res.status(400).json({ error: 'Unsupported trading pair', code: 'PAIR_NOT_SUPPORTED' });
    }

    try {
      const result = await demoTrading.placeOrder({
        userId: req.userId!,
        pair,
        side,
        type,
        price: price ? new BigNumber(price) : undefined,
        quantity: new BigNumber(quantity),
        ...(requestId ? { requestId } : {}),
      });
      // A replayed request ID answers with the order its first attempt committed.
      res.status('replayed' in result ? 200 : 201).json({
        order: {
          ...result.order,
          price: result.order.price?.toString() ?? null,
          originalQuantity: result.order.originalQuantity.toString(),
          remainingQuantity: result.order.remainingQuantity.toString(),
        },
        trades: result.trades.map((t) => ({ ...t, price: t.price.toString(), quantity: t.quantity.toString() })),
      });
    } catch (err) {
      if (err instanceof DemoTradingError) return res.status(err.code === 'REQUEST_CONFLICT' ? 409 : 400).json({ error: err.message, code: err.code });
      throw err;
    }
  }));

  router.get('/demo/orders/open', requireAuth(prisma), demoSpot, asyncRoute(async (req: AuthedRequest, res) => {
    res.json((await demoTrading.getOpenOrders(req.userId!)).map(orderRow));
  }));

  router.get('/demo/orders/history', requireAuth(prisma), demoSpot, asyncRoute(async (req: AuthedRequest, res) => {
    res.json((await demoTrading.getOrderHistory(req.userId!)).map(orderRow));
  }));

  router.delete('/demo/orders/:orderId', requireAuth(prisma), demoSpot, asyncRoute(async (req: AuthedRequest, res) => {
    const cancelled = await demoTrading.cancelOrder(req.userId!, req.params.orderId);
    if (!cancelled) return res.status(404).json({ error: 'Order not found or not cancellable' });
    res.status(204).send();
  }));

  router.get('/demo/orderbook/:pair', requireAuth(prisma), demoSpot, asyncRoute(async (req, res) => {
    const snapshot = await demoTrading.getOrderBook(req.params.pair.toUpperCase());
    res.json({
      pair: snapshot.pair,
      bids: snapshot.bids.map((l) => ({ price: l.price.toString(), quantity: l.quantity.toString(), orders: l.orderCount })),
      asks: snapshot.asks.map((l) => ({ price: l.price.toString(), quantity: l.quantity.toString(), orders: l.orderCount })),
      timestamp: snapshot.timestamp,
    });
  }));

  router.get('/demo/trades/:pair', requireAuth(prisma), demoSpot, asyncRoute(async (req, res) => {
    const trades = await demoTrading.getRecentTrades(req.params.pair.toUpperCase());
    res.json(trades.map((t) => ({ ...t, price: t.price.toString(), quantity: t.quantity.toString() })));
  }));

  return router;
}
