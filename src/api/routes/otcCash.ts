import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { asyncRoute } from '../asyncRoute';
import { OtcActor, OtcCashService } from '../../otc/OtcCashService';
import { OtcError, createSchema, actionSchema } from '../../otc/policy';
import { PriceSourceWithMeta } from '../../services/deposits/depositPolicy';
import { InsufficientWalletBalance } from '../../services/WalletMutation';
import { markWriteWithoutBackgroundWork } from '../../services/BackgroundWorkCoordinator';

const pageSchema = z.coerce.number().int().min(0).max(10000).default(0);
const idSchema = z.string().uuid();
const messageSchema = z.object({ text: z.string().min(1).max(3000), idempotencyKey: idSchema }).strict();
export function otcCashRouter(db: PrismaClient, prices: PriceSourceWithMeta, service = new OtcCashService(db, prices)): Router {
  const router = Router();
  const actor = (req: AuthedRequest): OtcActor => ({ userId: req.userId!, sessionId: req.sessionId });
  const action = (work: (req: AuthedRequest, res: Response) => Promise<unknown>) => asyncRoute(async (req: AuthedRequest, res: Response) => {
    res.setHeader('Cache-Control','private, no-store');
    try { await work(req, res); }
    catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: 'INVALID_INPUT' });
      if (error instanceof OtcError) return res.status(error.status).json({ error: error.code });
      if (error instanceof InsufficientWalletBalance) return res.status(409).json({ error: 'INSUFFICIENT_BALANCE' });
      if ((error as { code?: string })?.code === 'P2002') return res.status(409).json({ error: 'DUPLICATE_REFERENCE_OR_KEY' });
      // Never log plain chat, addresses, tokens or raw Prisma request arguments.
      console.error('OTC_OPERATION_UNAVAILABLE');
      return res.status(503).json({ error: 'RESULT_UNKNOWN_CHECK_ORIGINAL_KEY' });
    }
  });
  router.get('/otc/config', (_req,res) => res.json({ enabled: service.policy.enabled,
    version: service.policy.version, routes: service.policy.routes, maxActive: service.policy.maxActive,
    minimums: { 'otc-convert':'10000','cash-exchange':'50000','private-otc':'100000' } }));
  router.use(['/otc/requests','/otc/balances','/admin/otc'], requireAuth(db));
  router.get('/otc/balances', action(async (req,res) => res.json(await service.balances(actor(req)))));
  router.get('/otc/requests/by-key/:key', action(async (req,res) => res.json({ request: await service.byKey(actor(req), idSchema.parse(req.params.key)) })));
  router.post('/otc/requests', action(async (req,res) => res.status(201).json(await service.create(actor(req),createSchema.parse(req.body)))));
  for (const admin of [false,true]) {
    const base = admin ? '/admin/otc' : '/otc/requests';
    router.get(base, action(async (req,res) => {
      const status = z.enum(['RESERVED','OFFERED','ACCEPTED','PICKUP_READY','PAYOUT_IN_PROGRESS','COMPLETED','CANCELLED','REJECTED']).optional().parse(req.query.status);
      return res.json(await service.list(actor(req),admin,pageSchema.parse(req.query.page),status));
    }));
    router.get(`${base}/:id`, action(async (req,res) => res.json(await service.detail(actor(req),idSchema.parse(req.params.id),admin))));
    router.get(`${base}/:id/commands/:key`, action(async (req,res) => res.json({ result: await service.command(actor(req),idSchema.parse(req.params.id),idSchema.parse(req.params.key),admin) })));
    router.get(`${base}/:id/messages`, action(async (req,res) => res.json(await service.messages(actor(req),idSchema.parse(req.params.id),admin,pageSchema.parse(req.query.page)))));
    router.post(`${base}/:id/messages`, action(async (req,res) => {
      const input = messageSchema.parse(req.body);
      const result = await service.message(actor(req),idSchema.parse(req.params.id),input.text,input.idempotencyKey,admin);
      // Dependency audit: no trading/funding/liquidation/deposit watcher reads
      // OtcCashMessage. Only this text append is exempt; money/state writes are not.
      markWriteWithoutBackgroundWork(res);
      return res.status(201).json(result);
    }));
    router.post(`${base}/:id/actions`, action(async (req,res) => res.json(await service.act(actor(req),idSchema.parse(req.params.id),actionSchema.parse(req.body),admin))));
  }
  return router;
}
