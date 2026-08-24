import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { ChainConfig } from '../../config/chains';
import { DepositService, DepositVerificationError, PriceSource } from '../../services/DepositService';
import { TreasuryWalletService } from '../../services/TreasuryWalletService';
import { requireAuth, AuthedRequest } from '../middleware/auth';

// The only chains this deployment knows how to verify deposits on — see
// deposit-verifiers/. A chain only actually appears to users (via
// /deposit-chains) once its required env vars are set; listing every
// UNCONFIGURED chain here too would be harmless (loadChainConfig throws
// and it's filtered out below), but keeping the list exactly this narrow
// is what stops the deposit UI from ever inventing a chain/asset combo
// nobody configured a treasury address for.
//
// Bitcoin, Tron, and Ethereum — each configured (or not) purely via env
// vars, see config/chains.ts. Adding another EVM chain (Polygon, BSC, ...)
// later is the same env-var setup, no code change needed here; add its
// chain name to this list.
// Exported so adminDeposits.ts (the manual-credit feed) walks the exact
// same set of chains — one list, not two that could drift apart.
export const KNOWN_CHAINS = ['bitcoin', 'tron', 'ethereum'];

// Bitcoin/Tron tx hashes are plain 64 hex chars (as shown by their block
// explorers); EVM chains prefix the same 64 hex chars with "0x".
export const TX_HASH_PATTERN: Record<ChainConfig['type'], RegExp> = {
  evm: /^0x[a-fA-F0-9]{64}$/,
  bitcoin: /^[a-fA-F0-9]{64}$/,
  tron: /^[a-fA-F0-9]{64}$/,
};

/** Thin re-export of TreasuryWalletService.resolve() — kept here since every
 * route in this file (and adminDeposits.ts) already imports KNOWN_CHAINS
 * from this module and calls this alongside it. The real logic lives on the
 * service (not this route file) so other services can use it too without
 * pulling in Express route/middleware modules. */
export async function resolveChainConfig(treasuryWallets: TreasuryWalletService, chain: string): Promise<ChainConfig> {
  return treasuryWallets.resolve(chain);
}

export function depositsRouter(prisma: PrismaClient, priceSource: PriceSource): Router {
  const router = Router();
  const treasuryWallets = new TreasuryWalletService(prisma);

  // Every chain this deployment actually accepts deposits on (i.e. has a
  // treasury address configured for), with the exact assets supported on
  // each — the deposit UI should only ever offer these, so a user can't
  // send something the backend has no way to credit.
  router.get('/deposit-chains', requireAuth, async (_req, res) => {
    const chains: { chain: string; nativeAsset: string; tokens: string[] }[] = [];
    for (const chain of KNOWN_CHAINS) {
      try {
        const config = await resolveChainConfig(treasuryWallets, chain);
        chains.push({ chain: config.chain, nativeAsset: config.nativeAsset, tokens: Object.keys(config.tokens) });
      } catch {
        // not configured on this deployment — omit it
      }
    }
    res.json(chains);
  });

  // Shows YOUR treasury wallet address (e.g. Trust Wallet) — same address
  // for every user, on every chain you've configured. Reflects whatever an
  // admin most recently set via Settings → Кошельки, falling back to the
  // env-var default when no override has ever been set.
  router.get('/deposit-address/:chain', requireAuth, async (req, res) => {
    try {
      const config = await resolveChainConfig(treasuryWallets, req.params.chain);
      res.json({
        chain: config.chain,
        address: config.treasuryAddress,
        // Tron's native asset (TRX) is deliberately excluded — TronDepositVerifier
        // only checks TRC-20 token transfers, so a native TRX send would never
        // verify or even show up in the admin's incoming feed. Every other
        // chain type here (bitcoin, evm) actually supports its native asset.
        supportedAssets: config.type === 'tron' ? Object.keys(config.tokens) : [config.nativeAsset, ...Object.keys(config.tokens)],
        note: 'Send only the listed assets on this exact network. After sending, submit the tx hash to /deposits/claim.',
      });
    } catch {
      res.status(404).json({ error: `Unknown or unconfigured chain: ${req.params.chain}` });
    }
  });

  // The account's own deposit history — real Deposit rows written by
  // DepositService on every claim attempt (PENDING/CONFIRMED/CREDITED),
  // scoped to req.userId so no one can read another account's deposits.
  router.get('/deposits/me', requireAuth, async (req: AuthedRequest, res) => {
    const deposits = await prisma.deposit.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(
      deposits.map((d) => ({
        id: d.id,
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

  router.post('/deposits/claim/:chain', requireAuth, async (req: AuthedRequest, res) => {
    let config: ChainConfig;
    try {
      config = await resolveChainConfig(treasuryWallets, req.params.chain);
    } catch {
      return res.status(404).json({ error: `Unknown or unconfigured chain: ${req.params.chain}` });
    }

    const claimSchema = z.object({
      txHash: z.string().regex(TX_HASH_PATTERN[config.type], 'invalid transaction hash for this network'),
      asset: z.string().min(1),
    });
    const parsed = claimSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    try {
      const service = new DepositService(prisma, config, priceSource);
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
