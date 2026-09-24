import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { ChainConfig } from '../../config/chains';
import { DepositService, DepositVerificationError, PriceSource } from '../../services/DepositService';
import { TreasuryWalletService, treasuryGeneration } from '../../services/TreasuryWalletService';
import { createHash } from 'crypto';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { MIN_DEPOSIT_USD, DEPOSIT_USD_PEGGED_ASSETS } from '../../config/limits';

// The only chains this deployment knows how to verify deposits on — see
// deposit-verifiers/. A chain only actually appears to users (via
// /deposit-chains) once its required env vars are set; listing every
// UNCONFIGURED chain here too would be harmless (loadChainConfig throws
// and it's filtered out below), but keeping the list exactly this narrow
// is what stops the deposit UI from ever inventing a chain/asset combo
// nobody configured a treasury address for.
//
// Bitcoin, Tron, Ethereum, BSC, Solana, and TON — each configured (or not)
// purely via env vars, see config/chains.ts. Adding another EVM chain
// (Polygon, Avalanche, Arbitrum, ...) later is the same env-var setup, no
// code change needed here; add its chain name to this list.
// Exported so adminDeposits.ts (the manual-credit feed) walks the exact
// same set of chains — one list, not two that could drift apart.
export const KNOWN_CHAINS = ['bitcoin', 'tron', 'ethereum', 'bsc', 'solana', 'ton'];

// Bitcoin/Tron/TON tx hashes are plain 64 hex chars (as shown by their
// block explorers); EVM chains prefix the same 64 hex chars with "0x".
// Solana signatures are base58-encoded (64-byte signature), typically 87-88
// characters, never containing 0/O/I/l.
export const TX_HASH_PATTERN: Record<ChainConfig['type'], RegExp> = {
  evm: /^0x[a-fA-F0-9]{64}$/,
  bitcoin: /^[a-fA-F0-9]{64}$/,
  tron: /^[a-fA-F0-9]{64}$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{64,100}$/,
  ton: /^(0x)?[a-fA-F0-9]{64}$/,
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

  // The deposit panel's list, held in memory. Addresses almost never change,
  // so the list is resolved once and served from here until an admin edits
  // an address (TreasuryWalletService bumps its generation on every write),
  // or CHAINS_TTL_MS passes as a backstop for edits made outside this app.
  // `version` is a fingerprint of exactly what a client shows; the client
  // keeps the list on the device and only downloads it again when the
  // fingerprint it holds no longer matches (/deposit-config-version).
  // Verification of a claimed deposit never reads this cache — it resolves
  // the chain afresh (resolveChainConfig below).
  type DepositChain = { chain: string; nativeAsset: string; tokens: string[]; supportedAssets: string[]; address: string };
  const CHAINS_TTL_MS = 5 * 60_000;
  let chainsCache: { generation: number; at: number; chains: DepositChain[]; version: string } | null = null;

  async function depositChains(): Promise<{ chains: DepositChain[]; version: string | null }> {
    const generation = treasuryGeneration(prisma);
    if (chainsCache && chainsCache.generation === generation && Date.now() - chainsCache.at < CHAINS_TTL_MS) {
      return chainsCache;
    }
    let configs: ChainConfig[];
    // Every chain in ONE override read (resolveMany), not one database round
    // trip per chain in sequence. A failed read omits every chain, exactly as
    // six failed per-chain reads did before, and is not remembered.
    try { configs = await treasuryWallets.resolveMany(KNOWN_CHAINS); } catch { return { chains: [], version: null }; }
    const chains = configs.map((config): DepositChain => {
      const tokens = Object.keys(config.tokens);
      return { chain: config.chain, nativeAsset: config.nativeAsset, tokens,
        supportedAssets: config.type === 'tron' ? tokens : [config.nativeAsset, ...tokens],
        // The same treasury address /deposit-address/:chain would hand back
        // for this chain, to the same authenticated caller — carried here so
        // a client that shows every wallet at once needs ONE request rather
        // than one per chain. Not a new disclosure: same auth, same value,
        // and a chain only reaches this array once its address resolved.
        address: config.treasuryAddress };
    });
    const version = createHash('sha256')
      .update(JSON.stringify({ chains, minDepositUsd: MIN_DEPOSIT_USD, usdPeggedAssets: DEPOSIT_USD_PEGGED_ASSETS }))
      .digest('hex').slice(0, 16);
    chainsCache = { generation, at: Date.now(), chains, version };
    return chainsCache;
  }

  // Every chain this deployment actually accepts deposits on (i.e. has a
  // treasury address configured for), with the exact assets supported on
  // each — the deposit UI should only ever offer these, so a user can't
  // send something the backend has no way to credit.
  router.get('/deposit-chains', requireAuth(prisma), async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { chains, version } = await depositChains();
    // Opt-in envelope preserves the original array contract for older clients:
    // the bare list carries neither supportedAssets nor address, exactly as
    // before, so nothing reading it sees a changed shape.
    res.json(req.query.includeConfig === 'true'
      ? { chains, minDepositUsd: MIN_DEPOSIT_USD, usdPeggedAssets: DEPOSIT_USD_PEGGED_ASSETS, ...(version ? { version } : {}) }
      : chains.map(({ supportedAssets: _supported, address: _address, ...chain }) => chain));
  });

  // The fingerprint alone — no addresses, no session lookup, and (once the
  // list is in memory) no database read. A client holding the list asks only
  // this on each open and re-downloads the list only when it differs.
  router.get('/deposit-config-version', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const { version } = await depositChains();
    if (!version) { res.status(503).json({ error: 'Deposit configuration unavailable' }); return; }
    res.json({ version });
  });

  // Shows YOUR treasury wallet address (e.g. Trust Wallet) — same address
  // for every user, on every chain you've configured. Reflects whatever an
  // admin most recently set via Settings → Кошельки, falling back to the
  // env-var default when no override has ever been set.
  router.get('/deposit-address/:chain', requireAuth(prisma), async (req, res) => {
    try {
      const config = await resolveChainConfig(treasuryWallets, req.params.chain);
      res.json({
        chain: config.chain,
        address: config.treasuryAddress,
        // Tron's native asset (TRX) is deliberately excluded — TronDepositVerifier
        // only checks TRC-20 token transfers, so a native TRX send would never
        // verify or even show up in the admin's incoming feed. Every other
        // chain type here actually supports its native asset.
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
  router.get('/deposits/me', requireAuth(prisma), async (req: AuthedRequest, res) => {
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

  router.post('/deposits/claim/:chain', requireAuth(prisma), async (req: AuthedRequest, res) => {
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
