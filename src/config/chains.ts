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
 * Three chain "types" are supported, each verified completely differently
 * on deposit claim (see src/services/deposit-verifiers/):
 *   - "evm"     Ethereum, Polygon, BSC, ... — via an RPC provider (ethers.js)
 *   - "bitcoin" Bitcoin — via a public Esplora-style block explorer API
 *   - "tron"    Tron (e.g. USDT-TRC20) — via the TronGrid API
 *
 * Set real values via environment variables — never hardcode a real address
 * or RPC/API key in source control.
 */

export type ChainType = 'evm' | 'bitcoin' | 'tron';

// Chains whose type isn't inferable from their name are assumed "evm" —
// that covers every EVM-compatible chain (ethereum, polygon, bsc, ...)
// without needing a per-chain env var for the common case.
const CHAIN_TYPE_OVERRIDES: Record<string, ChainType> = {
  bitcoin: 'bitcoin',
  tron: 'tron',
};

export interface ChainConfig {
  chain: string; // "ethereum", "polygon", "bsc", "bitcoin", "tron", ...
  type: ChainType;
  treasuryAddress: string; // YOUR wallet (e.g. Trust Wallet) that receives all deposits
  minConfirmations: number;
  nativeAsset: string; // "ETH", "BTC", "TRX", ...
  /** ERC-20 / TRC-20 tokens supported for deposit on this chain. */
  tokens: Record<string, { contractAddress: string; decimals: number }>;
  /** EVM only — JSON-RPC endpoint (Alchemy/Infura/...). */
  rpcUrl?: string;
  /** Bitcoin/Tron only — REST API base URL (Blockstream Esplora / TronGrid). */
  apiUrl?: string;
  /** Tron only — optional TronGrid API key (raises the free rate limit). */
  apiKey?: string;
}

const DEFAULT_MIN_CONFIRMATIONS: Record<ChainType, number> = {
  evm: 12,
  bitcoin: 2,
  tron: 19,
};

const DEFAULT_API_URL: Partial<Record<ChainType, string>> = {
  bitcoin: 'https://blockstream.info/api',
  tron: 'https://api.trongrid.io',
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
    treasuryAddress: requireEnv(`${prefix}_TREASURY_ADDRESS`),
    minConfirmations: Number(process.env[`${prefix}_MIN_CONFIRMATIONS`] ?? DEFAULT_MIN_CONFIRMATIONS[type]),
    nativeAsset: requireEnv(`${prefix}_NATIVE_ASSET`),
    tokens: parseTokenList(process.env[`${prefix}_TOKENS`]),
  };

  if (type === 'evm') {
    return { ...base, rpcUrl: requireEnv(`${prefix}_RPC_URL`) };
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
