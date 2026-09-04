import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { WalletPortfolioService } from '../../services/WalletPortfolioService';

const RANGE_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Backs the Wallet page's profit chart (7d/30d/90d). The client computes
 * its own total portfolio value already (spot + futures, priced off the
 * same Kraken mirror shown everywhere else) — this just persists that
 * exact number once per UTC calendar day per account, rather than
 * recomputing pricing a second time server-side. History starts empty and
 * fills in day by day from whenever an account first visits after this
 * shipped; nothing here backfills or fabricates earlier points.
 */
export function portfolioRouter(prisma: PrismaClient, walletPortfolio?: WalletPortfolioService): Router {
  const router = Router();

  /**
   * Everything the Wallet page needs about what the account is worth.
   *
   * requireAuth is the gate: there is no anonymous path to this data. The
   * account's own row is then re-read here — role and email come from the
   * database on every request, never from the token — and only that row
   * decides whether the presentation profile is attached. Real balances are
   * returned under `real` regardless, and stay the only thing any other part
   * of the exchange reads.
   */
  router.get('/wallet/overview', requireAuth(prisma), async (req: AuthedRequest, res) => {
    if (!walletPortfolio) return res.status(503).json({ error: 'Portfolio service unavailable' });
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, role: true, email: true },
    });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      res.json(await walletPortfolio.overview(user));
    } catch (err) {
      console.error('[wallet/overview]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * Portfolio performance: one canonical daily series per account, with 7D,
   * 30D, 90D, 1Y and all-time measured as five windows over it. A period the
   * series cannot cover comes back `available: false` rather than borrowing a
   * shorter window's number.
   */
  router.get('/wallet/performance', requireAuth(prisma), async (req: AuthedRequest, res) => {
    if (!walletPortfolio) return res.status(503).json({ error: 'Portfolio service unavailable' });
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { id: true, role: true, email: true },
    });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    try {
      res.json(await walletPortfolio.performance(user));
    } catch (err) {
      console.error('[wallet/performance]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  const snapshotSchema = z.object({
    totalValueUsd: z.string().refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, 'must be a non-negative number'),
  });

  router.post('/wallet/portfolio-snapshot', requireAuth(prisma), async (req: AuthedRequest, res) => {
    const parsed = snapshotSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const latest = await prisma.portfolioSnapshot.findFirst({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
    });

    const today = startOfUtcDay(new Date());
    if (latest && startOfUtcDay(latest.createdAt).getTime() === today.getTime()) {
      return res.json({ recorded: false });
    }

    await prisma.portfolioSnapshot.create({
      data: { userId: req.userId!, totalValueUsd: parsed.data.totalValueUsd },
    });
    res.json({ recorded: true });
  });

  router.get('/wallet/portfolio-history', requireAuth(prisma), async (req: AuthedRequest, res) => {
    const range = typeof req.query.range === 'string' ? req.query.range : '30d';
    const days = RANGE_DAYS[range];
    if (!days) return res.status(400).json({ error: 'range must be one of: 7d, 30d, 90d' });

    const since = new Date(Date.now() - days * 86_400_000);
    const snapshots = await prisma.portfolioSnapshot.findMany({
      where: { userId: req.userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
    });

    res.json({
      points: snapshots.map((s) => ({ date: s.createdAt, totalValueUsd: s.totalValueUsd.toString() })),
    });
  });

  return router;
}
