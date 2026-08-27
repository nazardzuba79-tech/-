import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { loadChainConfig } from '../../config/chains';
import { TreasuryWalletService } from '../../services/TreasuryWalletService';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { KNOWN_CHAINS } from './deposits';

/**
 * Admin management of the treasury deposit addresses — the ones every user
 * is shown on the deposit page. Editing here writes to TreasuryWallet, which
 * (via TreasuryWalletService.applyOverride, used throughout deposits.ts,
 * adminDeposits.ts and ReservesService.ts) immediately supersedes the
 * env-var default everywhere a chain's address is resolved — no redeploy.
 */
export function adminWalletsRouter(prisma: PrismaClient): Router {
  const router = Router();
  const treasuryWallets = new TreasuryWalletService(prisma);

  // Every chain this deployment could accept deposits on, with whichever
  // address currently applies (a saved override, or the env-var default) —
  // so the admin always sees exactly what users are shown.
  router.get('/admin/wallets', requireAuth(prisma), requireAdmin(prisma), async (_req, res) => {
    const overrides = await treasuryWallets.list();
    const overrideByChain = new Map(overrides.map((o) => [o.chain, o]));

    const result = KNOWN_CHAINS.map((chain) => {
      const override = overrideByChain.get(chain);
      let envConfigured = true;
      let defaultAddress: string | null = null;
      let nativeAsset: string | null = null;
      let tokens: string[] = [];
      try {
        const config = loadChainConfig(chain);
        // loadChainConfig() never requires a treasury address (see its
        // comment) — envConfigured here means "this chain type itself is
        // set up on the backend" (native asset, RPC, ...), not "has an
        // address". A chain with no address anywhere yet still reports
        // envConfigured: true and address: null, which the admin panel
        // shows as an empty field to fill in — not the "not configured on
        // this deployment at all" state.
        defaultAddress = config.treasuryAddress || null;
        nativeAsset = config.nativeAsset;
        tokens = Object.keys(config.tokens);
      } catch {
        envConfigured = false;
      }

      return {
        chain,
        nativeAsset,
        tokens,
        address: override?.address ?? defaultAddress,
        isOverridden: Boolean(override),
        envConfigured,
        updatedByAdminId: override?.updatedByAdminId ?? null,
        updatedAt: override?.updatedAt ?? null,
      };
    });

    res.json(result);
  });

  const upsertSchema = z.object({ address: z.string().trim().min(1).max(256) });

  router.put('/admin/wallets/:chain', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res) => {
    const { chain } = req.params;
    if (!KNOWN_CHAINS.includes(chain)) {
      return res.status(404).json({ error: `Unknown chain: ${chain}` });
    }

    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const row = await treasuryWallets.upsert(chain, parsed.data.address, req.userId!);
    await prisma.auditLog.create({
      data: { userId: req.userId!, action: 'TREASURY_WALLET_UPDATED', metadata: { chain, address: parsed.data.address } },
    });

    res.json(row);
  });

  // Reverts the chain back to its env-var default address.
  router.delete('/admin/wallets/:chain', requireAuth(prisma), requireAdmin(prisma), async (req: AuthedRequest, res) => {
    const { chain } = req.params;
    await treasuryWallets.remove(chain);
    await prisma.auditLog.create({
      data: { userId: req.userId!, action: 'TREASURY_WALLET_RESET', metadata: { chain } },
    });

    res.json({ ok: true });
  });

  return router;
}
