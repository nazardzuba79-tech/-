import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { loadChainConfig, ChainConfig } from '../../config/chains';
import { createVerifier } from '../../services/deposit-verifiers';
import { DepositService, DepositVerificationError, PriceSource } from '../../services/DepositService';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { KNOWN_CHAINS, TX_HASH_PATTERN } from './deposits';

/**
 * Manual, admin-driven deposit crediting — the replacement for asking the
 * CLIENT to find and paste a transaction hash. Instead: the admin sees a
 * live feed of transfers that actually arrived at the treasury address
 * (still-uncredited only), picks which user each one belongs to, and
 * credits it with one click. Crediting itself reuses DepositService's
 * existing on-chain re-verification — the feed is just a display
 * convenience; a bad or stale entry there can never cause a wrong credit,
 * because verify() checks the chain again at the moment of crediting.
 */
export function adminDepositsRouter(prisma: PrismaClient, priceSource: PriceSource): Router {
  const router = Router();

  // Every deposit ever recorded, across every user — GET /deposits/me is
  // deliberately scoped to the caller only, this is the admin-wide view.
  router.get('/admin/deposits', requireAuth, requireAdmin(prisma), async (_req, res) => {
    const deposits = await prisma.deposit.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { user: { select: { email: true } } },
    });
    res.json(
      deposits.map((d) => ({
        id: d.id,
        userId: d.userId,
        userEmail: d.user.email,
        asset: d.asset,
        chain: d.chain,
        txHash: d.txHash,
        amount: d.amount.toString(),
        confirmations: d.confirmations,
        status: d.status,
        createdAt: d.createdAt,
      }))
    );
  });

  // Recent transfers to the treasury address that aren't recorded as a
  // Deposit yet — real on-chain data (see each verifier's listIncoming),
  // not anything the client submitted.
  router.get('/admin/deposits/incoming', requireAuth, requireAdmin(prisma), async (_req, res) => {
    const results: Array<{ chain: string; txHash: string; asset: string; amount: string; confirmations: number }> = [];

    for (const chain of KNOWN_CHAINS) {
      let config: ChainConfig;
      try {
        config = loadChainConfig(chain);
      } catch {
        continue; // not configured on this deployment
      }
      try {
        const transfers = await createVerifier(config).listIncoming();
        for (const t of transfers) results.push({ chain, ...t });
      } catch (err) {
        // One chain's provider being unreachable shouldn't blank the whole
        // feed — the admin still sees whatever chains DID respond.
        console.error(`Failed to list incoming transfers for ${chain}:`, err);
      }
    }

    if (results.length === 0) return res.json([]);

    const existing = await prisma.deposit.findMany({
      where: { OR: results.map((r) => ({ chain: r.chain, txHash: r.txHash })) },
      select: { chain: true, txHash: true },
    });
    const existingKeys = new Set(existing.map((d) => `${d.chain}:${d.txHash}`));

    res.json(results.filter((r) => !existingKeys.has(`${r.chain}:${r.txHash}`)));
  });

  const manualCreditSchema = z.object({
    userId: z.string().uuid(),
    chain: z.string().min(1),
    txHash: z.string().min(1),
    asset: z.string().min(1),
  });

  // Admin picks a user + the tx hash they found (from the feed above, or
  // their own wallet) — re-verified on-chain via the same DepositService
  // path self-service claims use, just crediting an arbitrary target user.
  router.post('/admin/deposits/manual-credit', requireAuth, requireAdmin(prisma), async (req: AuthedRequest, res) => {
    const parsed = manualCreditSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { userId, chain, asset, txHash } = parsed.data;

    let config: ChainConfig;
    try {
      config = loadChainConfig(chain);
    } catch {
      return res.status(404).json({ error: `Unknown or unconfigured chain: ${chain}` });
    }

    if (!TX_HASH_PATTERN[config.type].test(txHash)) {
      return res.status(400).json({ error: 'invalid transaction hash for this network' });
    }

    const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    try {
      const service = new DepositService(prisma, config, priceSource);
      const result = await service.claimDeposit({ userId, txHash, asset, performedByAdminId: req.userId! });
      res.json(result);
    } catch (err) {
      if (err instanceof DepositVerificationError) return res.status(400).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Failed to verify deposit' });
    }
  });

  return router;
}
