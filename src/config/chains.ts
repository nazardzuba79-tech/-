/**
 * SINGLE-TREASURY DEPOSIT MODEL
 * ================================
 * Every deposit — regardless of which team member sends it — goes to ONE
 * wallet address that you control yourself (e.g. a Trust Wallet or
 * MetaMask address, one per chain). The exchange never generates or holds
 * any private keys; it only WATCHES the chain for incoming transfers to
 * that address and credits the sender's internal balance accordingly.
 *
 * This is simpler and, for a small trusted team, arguably safer than the
 * per-user custodial-address model in WalletService.ts — there's no HSM/MPC
 * to set up, because the only signer that ever matters is your own wallet,
 * which you already control directly. The trade-off: you personally become
 * the single point of custody, so protecting that wallet (hardware wallet,
 * strong seed backup, never approving unknown signature requests) matters a
 * lot more now that it holds the whole team's funds.
 *
 * Five chain "types" are supported, each verified completely differently
 * on deposit claim (see src/services/deposit-verifiers/):
 *   - "evm"     Ethereum, BSC, ... — a free public RPC endpoint (no signup)
 *               verifies a specific tx at credit time; for Ethereum and BSC
 *               specifically this defaults automatically (same zero-config
 *               treatment as Bitcoin/Tron below) — other EVM chains still
 *               need their own *_RPC_URL. A free Etherscan-style API key
 *               (2-minute signup, no payment) powers the admin's
 *               incoming-transfers feed — see EvmDepositVerifier
 *   - "bitcoin" Bitcoin — via a public Esplora-style block explorer API
 *   - "tron"    Tron (e.g. USDT-TRC20) — via the TronGrid API
 *   - "solana"  Solana — native SOL and SPL tokens (e.g. USDT-SPL) — via a
 *               free public JSON-RPC endpoint (also used for the admin
 *               incoming-transfers feed, no separate explorer API needed)
 *   - "ton"     TON — native TON and jettons (e.g. USDT-TON) — via the
 *               tonapi.io REST API
 *
 * Set real values via environment variables — never hardcode a real address
 * or RPC/API key in source control.
 */

export type ChainType = 'evm' | 'bitcoin' | 'tron' | 'solana' | 'ton';

// Chains whose type isn't inferable from their name are assumed "evm" —
// that covers every EVM-compatible chain (ethereum, bsc, ...) without
// needing a per-chain env var for the common case.
const CHAIN_TYPE_OVERRIDES: Record<string, ChainType> = {
  bitcoin: 'bitcoin',
  tron: 'tron',
  solana: 'solana',
  ton: 'ton',
};

export interface ChainConfig {
  chain: string; // "ethereum", "polygon", "bsc", "bitcoin", "tron", ...
  type: ChainType;
  treasuryAddress: string; // YOUR wallet (e.g. Trust Wallet) that receives all deposits
  minConfirmations: number;
  nativeAsset: string; // "ETH", "BTC", "TRX", "SOL", "TON", ...
  /** ERC-20 / TRC-20 / SPL / jetton tokens supported for deposit on this chain. */
  tokens: Record<string, { contractAddress: string; decimals: number }>;
  /** EVM only — JSON-RPC endpoint, used only for the authoritative
   * single-transaction check at credit time. A free public endpoint (e.g.
   * https://ethereum.publicnode.com) is fine here — no signup, no payment,
   * no API key. */
  rpcUrl?: string;
  /** Bitcoin/Tron/EVM — REST API base URL (Blockstream Esplora / TronGrid /
   * Etherscan) that powers the admin's incoming-transfers feed. Solana/TON —
   * the ONLY endpoint (JSON-RPC / tonapi.io REST), used for both the
   * per-tx verify() check and the incoming-transfers feed. */
  apiUrl?: string;
  /** Tron: optional, raises TronGrid's free rate limit. EVM: required for
   * the incoming-transfers feed — Etherscan's API key is free (signup at
   * https://etherscan.io/apis, no payment), just not automatic like the
   * TronGrid/Blockstream defaults below. TON: optional, raises tonapi.io's
   * free rate limit (get one at https://tonconsole.com). Solana: unused —
   * the public RPC endpoint needs no key. */
  apiKey?: string;
}

const DEFAULT_MIN_CONFIRMATIONS: Record<ChainType, number> = {
  evm: 12,
  bitcoin: 2,
  tron: 19,
  solana: 32, // ~roughly Solana's "finalized" commitment level
  ton: 3,
};

const DEFAULT_API_URL: Partial<Record<ChainType, string>> = {
  bitcoin: 'https://blockstream.info/api',
  tron: 'https://api.trongrid.io',
  evm: 'https://api.etherscan.io/api',
  // Solana's own JSON-RPC doubles as the "explorer" API here — a single
  // free public endpoint answers both the per-tx verify() check and the
  // listIncoming() feed, unlike EVM/Bitcoin/Tron which split those across
  // an RPC and a separate explorer API.
  solana: 'https://api.mainnet-beta.solana.com',
  // tonapi.io — free tier, no signup required for light use; set
  // TON_API_KEY (from https://tonconsole.com) to raise the rate limit.
  ton: 'https://tonapi.io',
};

// Bitcoin/Tron get a zero-config default API above; Ethereum and BSC get
// the same treatment here for their RPC endpoints — genuinely free,
// no-signup public nodes, so deposits on these two work out of the box
// exactly like BTC/TRON, without an admin having to paste an RPC URL into
// env vars first. Other EVM chains (Polygon, Avalanche, Arbitrum, ...)
// still require their own *_RPC_URL — there's no single universal default
// that makes sense for an arbitrary chain.
const DEFAULT_RPC_URL: Partial<Record<string, string>> = {
  ethereum: 'https://ethereum.publicnode.com',
  bsc: 'https://bsc-dataseed.binance.org',
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function loadChainConfig(chain: string): ChainConfig {
  const prefix = chain.toUpperCase();
  const type = CHAIN_TYPE_OVERRIDES[chain.toLowerCase()] ?? 'evm';

  const base = {
    chain,
    type,
    // Deliberately NOT requireEnv() here — the treasury address is exactly
    // the one thing TreasuryWalletService.applyOverride() lets an admin set
    // from the panel with no redeploy (see its doc comment). Requiring it
    // here would mean an admin-saved address in the DB never even gets a
    // chance to apply, because this function would already have thrown.
    // resolveChainConfig() (deposits.ts) is what actually enforces that
    // *some* address — env or override — ends up set before use.
    treasuryAddress: process.env[`${prefix}_TREASURY_ADDRESS`] ?? '',
    minConfirmations: Number(process.env[`${prefix}_MIN_CONFIRMATIONS`] ?? DEFAULT_MIN_CONFIRMATIONS[type]),
    nativeAsset: requireEnv(`${prefix}_NATIVE_ASSET`),
    tokens: parseTokenList(process.env[`${prefix}_TOKENS`]),
  };

  if (type === 'evm') {
    const defaultRpcUrl = DEFAULT_RPC_URL[chain.toLowerCase()];
    return {
      ...base,
      rpcUrl: process.env[`${prefix}_RPC_URL`] ?? defaultRpcUrl ?? requireEnv(`${prefix}_RPC_URL`),
      apiUrl: process.env[`${prefix}_API_URL`] ?? DEFAULT_API_URL[type],
      apiKey: process.env[`${prefix}_API_KEY`],
    };
  }

  return {
    ...base,
    apiUrl: process.env[`${prefix}_API_URL`] ?? DEFAULT_API_URL[type],
    apiKey: process.env[`${prefix}_API_KEY`],
  };
}

/** Format: "USDT:0xdAC17F958D2ee523a2206206994597C13D831ec7:6,USDC:0x...:6" */
function parseTokenList(raw?: string): ChainConfig['tokens'] {
  if (!raw) return {};
  const tokens: ChainConfig['tokens'] = {};
  for (const entry of raw.split(',')) {
    const [symbol, contractAddress, decimals] = entry.split(':');
    if (!symbol || !contractAddress || !decimals) continue;
    tokens[symbol.toUpperCase()] = { contractAddress, decimals: Number(decimals) };
  }
  return tokens;
}
