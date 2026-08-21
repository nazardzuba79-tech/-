import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { loadChainConfig } from '../../config/chains';
import { DepositService, DepositVerificationError } from '../../services/DepositService';
import { requireAuth, AuthedRequest } from '../middleware/auth';

const claimSchema = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'invalid tx hash'),
  asset: z.string().min(1),
});

export function depositsRouter(prisma: PrismaClient): Router {
  const router = Router();

  // Shows YOUR treasury wallet address (e.g. MetaMask) — same address for
  // every user, on every chain you've configured via env vars.
  router.get('/deposit-address/:chain', requireAuth, (req, res) => {
    try {
      const config = loadChainConfig(req.params.chain);
      res.json({
        chain: config.chain,
        address: config.treasuryAddress,
        supportedAssets: [config.nativeAsset, ...Object.keys(config.tokens)],
        note: 'Send only the listed assets on this exact network. After sending, submit the tx hash to /deposits/claim.',
      });
    } catch {
      res.status(404).json({ error: `Unknown or unconfigured chain: ${req.params.chain}` });
    }
  });

  router.post('/deposits/claim/:chain', requireAuth, async (req: AuthedRequest, res) => {
    const parsed = claimSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    try {
      const config = loadChainConfig(req.params.chain);
      const service = new DepositService(prisma, config);
      const result = await service.claimDeposit({
        userId: req.userId!,
        txHash: parsed.data.txHash,
        asset: parsed.data.asset,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof DepositVerificationError) {
        return res.status(400).json({ error: err.message });
      }
      console.error(err);
      res.status(500).json({ error: 'Failed to verify deposit' });
    }
  });

  return router;
}
