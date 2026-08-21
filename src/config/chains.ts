/**
 * SINGLE-TREASURY DEPOSIT MODEL
 * ================================
 * Every deposit — regardless of which team member sends it — goes to ONE
 * wallet address that you control yourself (e.g. your MetaMask). The
 * exchange never generates or holds any private keys; it only WATCHES the
 * chain for incoming transfers to that address and credits the sender's
 * internal balance accordingly.
 *
 * This is simpler and, for a small trusted team, arguably safer than the
 * per-user custodial-address model in WalletService.ts — there's no HSM/MPC
 * to set up, because the only signer that ever matters is your own MetaMask,
 * which you already control directly. The trade-off: you personally become
 * the single point of custody, so protecting that MetaMask (hardware wallet,
 * strong seed backup, never approving unknown signature requests) matters a
 * lot more now that it holds the whole team's funds.
 *
 * Set real values via environment variables — never hardcode a real address
 * or RPC key in source control.
 */

export interface ChainConfig {
  chain: string; // "ethereum", "polygon", "bsc", ...
  rpcUrl: string;
  treasuryAddress: string; // YOUR wallet (e.g. MetaMask) that receives all deposits
  minConfirmations: number;
  nativeAsset: string; // "ETH", "MATIC", "BNB"
  /** ERC-20 tokens supported for deposit on this chain. */
  tokens: Record<string, { contractAddress: string; decimals: number }>;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export function loadChainConfig(chain: string): ChainConfig {
  const prefix = chain.toUpperCase();
  return {
    chain,
    rpcUrl: requireEnv(`${prefix}_RPC_URL`),
    treasuryAddress: requireEnv(`${prefix}_TREASURY_ADDRESS`),
    minConfirmations: Number(process.env[`${prefix}_MIN_CONFIRMATIONS`] ?? 12),
    nativeAsset: requireEnv(`${prefix}_NATIVE_ASSET`),
    tokens: parseTokenList(process.env[`${prefix}_TOKENS`]),
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
