import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { ChainConfig } from '../../config/chains';
import { createVerifier } from '../../services/deposit-verifiers';
import { DepositService, DepositVerificationError, PriceSource } from '../../services/DepositService';
import { TreasuryWalletService } from '../../services/TreasuryWalletService';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { KNOWN_CHAINS, TX_HASH_PATTERN, resolveChainConfig } from './deposits';

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
  const treasuryWallets = new TreasuryWalletService(prisma);

  // Every unresolved deposit, plus recent credited history. A burst of credited
  // transfers must never push an older BELOW_MINIMUM out of the work queue.
  router.get('/admin/deposits', requireAuth(prisma), requireAdmin(prisma), async (_req, res) => {
    try {
      const [unresolved, credited] = await Promise.all([
        prisma.deposit.findMany({ where: { status: { not: 'CREDITED' } }, orderBy: { createdAt: 'desc' }, include: { user: { select: { email: true } } } }),
        prisma.deposit.findMany({ where: { status: 'CREDITED' }, orderBy: { createdAt: 'desc' }, take: 200, include: { user: { select: { email: true } } } }),
      ]);
      const deposits = [...unresolved, ...credited];
      res.json(
        deposits.map((d) => ({
          id: d.id,
          userId: d.userId,
          userEmail: d.user?.email ?? null,
          asset: d.asset,
          chain: d.chain,
          txHash: d.txHash,
          amount: d.amount.toString(),
          confirmations: d.confirmations,
          status: d.status,
          createdAt: d.createdAt,
        }))
      );
    } catch { res.status(503).json({ error: 'Failed to load deposit history' }); }
  });

  // Recent transfers to the treasury address that aren't recorded as a
  // Deposit yet — real on-chain data (see each verifier's listIncoming),
  // not anything the client submitted.
  router.get('/admin/deposits/incoming', requireAuth(prisma), requireAdmin(prisma), async (req, res) => {
    const failedChains = new Set<string>();
    const configuredChains: string[] = [];
    for (const chain of KNOWN_CHAINS) {
      let config: ChainConfig;
      try { config = await resolveChainConfig(treasuryWallets, chain); }
      catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (!message.startsWith('No treasury address configured') && !message.startsWith('Missing required env var:')) failedChains.add(chain);
        continue;
      }
      configuredChains.push(chain);
      try {
        const transfers = await createVerifier(config).listIncoming();
        const service = new DepositService(prisma, config, priceSource);
        const seen = new Set<string>();
        for (const transfer of transfers) {
          // Multiple events for the same transaction/asset need one verification.
          // The verifier supplies the authoritative total; list amounts do not.
          const key = `${transfer.txHash}:${transfer.asset}`;
          if (seen.has(key)) continue;
          seen.add(key);
          try { await service.recordIncoming(transfer); }
          catch { failedChains.add(chain); }
        }
      } catch { failedChains.add(chain); }
    }
    try {
      // Persisted observations survive provider outages and recent-feed windows.
      // No amount/minimum filter, and ignored transfers still remain in history.
      const [deposits, ignored] = await Promise.all([
        prisma.deposit.findMany({ where: { userId: null, status: { not: 'CREDITED' } }, orderBy: { createdAt: 'desc' } }),
        prisma.ignoredIncomingTransfer.findMany({ select: { chain: true, txHash: true } }),
      ]);
      const ignoredKeys = new Set(ignored.map(d => `${d.chain}:${d.txHash}`));
      const transfers = deposits.filter(d => !ignoredKeys.has(`${d.chain}:${d.txHash}`)).map(d => ({
        chain: d.chain, txHash: d.txHash, asset: d.asset, amount: d.amount.toString(),
        confirmations: d.confirmations, status: d.status, timestamp: d.createdAt.toISOString(),
      }));
      if (req.query.includeStatus === 'true') return res.json({ transfers, failedChains: [...failedChains], configuredChains });
      // Older clients must not interpret a failed provider as an empty success.
      if (failedChains.size) return res.status(503).json({ error: 'Incoming transfers are temporarily incomplete' });
      res.json(transfers);
    } catch { res.status(503).json({ error: 'Failed to load recorded incoming transfers' }); }
  });
  const ignoreSchema = z.object({
    chain: z.string().min(1),
    txHash: z.string().min(1),
  });

  // Marks a listed-but-not-ours transfer (e.g. old unrelated activity on a
  // reused treasury address) as permanently excluded from the feed above —
  // for entries that will never get credited because they aren't actually
  // this exchange's deposits.
  router.post('/admin/deposits/ignore', requireAuth(prisma), requireAdmin(prisma), async (req, res) => {
    const parsed = ignoreSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { chain, txHash } = parsed.data;

    await prisma.ignoredIncomingTransfer.upsert({
      where: { chain_txHash: { chain, txHash } },
      create: { chain, txHash },
      update: {},
    });

    res.json({ status: 'ignored' });
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
  router.post('/admin/deposits/manual-credit', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res) => {
    const parsed = manualCreditSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { userId, chain, asset, txHash } = parsed.data;

    let config: ChainConfig;
    try {
      config = await resolveChainConfig(treasuryWallets, chain);
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
