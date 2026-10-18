import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { asyncRoute } from '../asyncRoute';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { ConversionError, WalletConversionService } from '../../services/WalletConversionService';

/** Owner-filtered projection only. Never expose admin reasons, identities, balances or demo activity. */
export function walletActivityRouter(prisma: PrismaClient, conversion: WalletConversionService): Router {
  const router = Router();
  router.use('/wallet/activity', asyncRoute(requireAuth(prisma)));
  router.use('/wallet/conversion', asyncRoute(requireAuth(prisma)));
  const writeLimit = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false,
    keyGenerator: req => (req as AuthedRequest).userId!, message: { code: 'RATE_LIMITED' } });
  router.get('/wallet/activity', asyncRoute(async (req: AuthedRequest, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const rows = await prisma.auditLog.findMany({ where: { userId: req.userId!, action: { in: ['BALANCE_ADJUSTED', 'WALLET_CONVERTED'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100, select: { id: true, action: true, metadata: true, createdAt: true } });
    const items = rows.flatMap(row => {
      const m = row.metadata;
      if (!m || typeof m !== 'object' || Array.isArray(m)) return [];
      if (row.action === 'BALANCE_ADJUSTED') {
        if (typeof m.asset !== 'string' || !['string', 'number'].includes(typeof m.delta)) return [];
        const delta = new BigNumber(m.delta as string | number);
        if (!delta.isFinite() || delta.isZero()) return [];
        return [{ id: row.id, kind: 'adjustment', asset: m.asset, amount: delta.toFixed(), createdAt: row.createdAt.toISOString() }];
      }
      if (['fromAsset', 'toAsset', 'fromAmount', 'toAmount'].some(k => typeof m[k] !== 'string')) return [];
      if (![m.fromAmount, m.toAmount].every(value => new BigNumber(value as string).isFinite() && new BigNumber(value as string).gt(0))) return [];
      return [{ id: row.id, kind: 'conversion', asset: m.fromAsset as string, amount: new BigNumber(m.fromAmount as string).negated().toFixed(),
        toAsset: m.toAsset as string, toAmount: m.toAmount as string, createdAt: row.createdAt.toISOString() }];
    });
    res.json(items);
  }));
  function guarded(fn: (req: AuthedRequest) => Promise<unknown>) {
    return asyncRoute(async (req: AuthedRequest, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      try { res.json(await fn(req)); }
      catch (error) {
        if (error instanceof ConversionError) return res.status(error.code === 'PRICE_UNAVAILABLE' ? 503 : 409).json({ code: error.code });
        throw error;
      }
    });
  }
  router.get('/wallet/conversion/assets', guarded(req => conversion.assets(req.userId!)));
  const quoteSchema = z.object({ fromAsset: z.string().regex(/^[A-Z0-9]{2,16}$/), toAsset: z.string().regex(/^[A-Z0-9]{2,16}$/), amount: z.string().max(37) }).strict();
  router.post('/wallet/conversion/quote', writeLimit, asyncRoute(async (req, res, next) => {
    if (!quoteSchema.safeParse(req.body).success) return res.status(400).json({ code: 'INVALID_CONVERSION' });
    next();
  }), guarded(req => conversion.quote(req.userId!, req.body.fromAsset, req.body.toAsset, req.body.amount)));
  const confirmSchema = z.object({ quoteId: z.string().uuid() }).strict();
  router.post('/wallet/conversion/confirm', writeLimit, asyncRoute(async (req, res, next) => {
    if (!confirmSchema.safeParse(req.body).success) return res.status(400).json({ code: 'INVALID_CONVERSION' });
    next();
  }), guarded(req => conversion.confirm(req.userId!, req.body.quoteId)));
  router.get('/wallet/conversion/receipt/:quoteId', asyncRoute(async (req, res, next) => {
    if (!z.string().uuid().safeParse(req.params.quoteId).success) return res.status(400).json({ code: 'INVALID_CONVERSION' });
    next();
  }), guarded(req => conversion.status(req.userId!, req.params.quoteId)));
  return router;
}
