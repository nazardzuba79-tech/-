import { ethers } from 'ethers';
import BigNumber from 'bignumber.js';
import { PrismaClient } from '@prisma/client';
import { TreasuryWalletService } from './TreasuryWalletService';

const SATS_PER_BTC = new BigNumber(10).pow(8);

export interface ReserveRow {
  chain: string;
  asset: string;
  treasuryAddress: string;
  /** Sum of every user's available + locked balance in this asset — the
   * exchange's real liability, not an estimate. Trading between users never
   * changes this total (it only moves balance between accounts); only
   * deposits and withdrawals do, which is exactly what should track the
   * treasury's on-chain holdings. */
  internalLiabilities: string;
  /** null when the on-chain lookup itself failed (RPC down, rate limited,
   * ...) — shown as "unavailable" in the UI, never silently treated as 0. */
  onChainBalance: string | null;
  /** onChainBalance / internalLiabilities, as a plain ratio (1 = fully
   * backed). null whenever onChainBalance is null. */
  coverageRatio: number | null;
  error?: string;
}

// Same narrow list deposits.ts actually accepts claims on — a reserves row
// for a chain nobody can deposit through would be misleading, not honest.
const KNOWN_CHAINS = ['bitcoin', 'tron', 'ethereum', 'bsc', 'solana', 'ton'];

const ERC20_BALANCE_OF_ABI = ['function balanceOf(address) view returns (uint256)'];

async function internalLiabilities(prisma: PrismaClient, asset: string): Promise<BigNumber> {
  const rows = await prisma.balance.findMany({ where: { asset }, select: { available: true, locked: true } });
  return rows.reduce(
    (sum, r) => sum.plus(new BigNumber(r.available.toString())).plus(new BigNumber(r.locked.toString())),
    new BigNumber(0)
  );
}

function coverageRatio(onChain: BigNumber | null, liabilities: BigNumber): number | null {
  if (onChain === null) return null;
  if (liabilities.isZero()) return onChain.isZero() ? 1 : Infinity;
  return onChain.dividedBy(liabilities).toNumber();
}

interface EsploraAddressStats {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
}

// NOT tested against the live API from this environment (network access
// here is sandboxed) — same caveat as BitcoinDepositVerifier/TronDepositVerifier,
// which this mirrors. Verify against the real APIs before trusting this
// with a real treasury address.
async function fetchBitcoinTreasuryBalance(apiUrl: string, address: string, fetchFn: typeof fetch): Promise<BigNumber> {
  const res = await fetchFn(`${apiUrl}/address/${address}`);
  if (!res.ok) throw new Error(`Bitcoin explorer API responded with HTTP ${res.status}`);
  const stats = (await res.json()) as EsploraAddressStats;
  // Confirmed balance only (chain_stats) — mempool_stats (unconfirmed) is
  // deliberately excluded, same "wait for confirmations" posture the deposit
  // verifier itself takes before crediting anyone.
  const sats = stats.chain_stats.funded_txo_sum - stats.chain_stats.spent_txo_sum;
  return new BigNumber(sats).dividedBy(SATS_PER_BTC);
}

interface TronGridAccountResponse {
  data: { trc20?: Record<string, string>[] }[];
}

async function fetchTronTokenBalance(
  apiUrl: string,
  apiKey: string | undefined,
  address: string,
  contractAddress: string,
  decimals: number,
  fetchFn: typeof fetch
): Promise<BigNumber> {
  const res = await fetchFn(`${apiUrl}/v1/accounts/${address}`, {
    headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {},
  });
  if (!res.ok) throw new Error(`TronGrid API responded with HTTP ${res.status}`);
  const body = (await res.json()) as TronGridAccountResponse;
  const trc20 = body.data?.[0]?.trc20 ?? [];
  const entry = trc20.find((t) => Object.keys(t)[0] === contractAddress);
  const raw = entry ? Object.values(entry)[0] : '0';
  return new BigNumber(raw).dividedBy(new BigNumber(10).pow(decimals));
}

// RPC-based, like EvmDepositVerifier.verify() — a single balance read per
// asset, cheap enough for a free public endpoint even though this runs on
// every reserves check rather than only at credit time.
async function fetchEvmNativeBalance(rpcUrl: string, address: string): Promise<BigNumber> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const balance = await provider.getBalance(address);
  return new BigNumber(ethers.formatEther(balance));
}

async function fetchEvmTokenBalance(
  rpcUrl: string,
  treasuryAddress: string,
  contractAddress: string,
  decimals: number
): Promise<BigNumber> {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(contractAddress, ERC20_BALANCE_OF_ABI, provider);
  const raw: bigint = await contract.balanceOf(treasuryAddress);
  return new BigNumber(raw.toString()).dividedBy(new BigNumber(10).pow(decimals));
}

interface SolanaRpcBalanceResponse {
  result?: { value: number };
  error?: { message: string };
}

async function solanaRpc<T>(apiUrl: string, method: string, params: unknown[], fetchFn: typeof fetch): Promise<T> {
  const res = await fetchFn(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Solana RPC endpoint responded with HTTP ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`Solana RPC error: ${body.error.message}`);
  return body.result as T;
}

async function fetchSolanaNativeBalance(apiUrl: string, address: string, fetchFn: typeof fetch): Promise<BigNumber> {
  const result = await solanaRpc<{ value: number }>(apiUrl, 'getBalance', [address], fetchFn);
  return new BigNumber(result.value).dividedBy(new BigNumber(10).pow(9));
}

interface SolanaTokenAccountsResponse {
  value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[];
}

async function fetchSolanaTokenBalance(
  apiUrl: string,
  address: string,
  mint: string,
  decimals: number,
  fetchFn: typeof fetch
): Promise<BigNumber> {
  const result = await solanaRpc<SolanaTokenAccountsResponse>(
    apiUrl,
    'getTokenAccountsByOwner',
    [address, { mint }, { encoding: 'jsonParsed' }],
    fetchFn
  );
  const total = result.value.reduce(
    (sum, acc) => sum + BigInt(acc.account.data.parsed.info.tokenAmount.amount),
    BigInt(0)
  );
  return new BigNumber(total.toString()).dividedBy(new BigNumber(10).pow(decimals));
}

interface TonApiAccountResponse {
  balance: string; // nanotons, as a string
}

async function fetchTonNativeBalance(apiUrl: string, apiKey: string | undefined, address: string, fetchFn: typeof fetch): Promise<BigNumber> {
  const res = await fetchFn(`${apiUrl}/v2/accounts/${address}`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  if (!res.ok) throw new Error(`tonapi.io responded with HTTP ${res.status}`);
  const body = (await res.json()) as TonApiAccountResponse;
  return new BigNumber(body.balance).dividedBy(new BigNumber(10).pow(9));
}

interface TonApiJettonBalanceResponse {
  balance: string; // raw jetton units, as a string
}

async function fetchTonJettonBalance(
  apiUrl: string,
  apiKey: string | undefined,
  address: string,
  jettonAddress: string,
  decimals: number,
  fetchFn: typeof fetch
): Promise<BigNumber> {
  const res = await fetchFn(`${apiUrl}/v2/accounts/${address}/jettons/${jettonAddress}`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  // tonapi returns 404 when the treasury has never held this jetton (no
  // jetton-wallet contract deployed for it yet) — that's a real zero
  // balance, not an error.
  if (res.status === 404) return new BigNumber(0);
  if (!res.ok) throw new Error(`tonapi.io responded with HTTP ${res.status}`);
  const body = (await res.json()) as TonApiJettonBalanceResponse;
  return new BigNumber(body.balance).dividedBy(new BigNumber(10).pow(decimals));
}

/**
 * A self-reported reserves check, not an independent audit: it compares
 * this deployment's own database (what it owes every user, per asset)
 * against the same treasury addresses' real on-chain balances, fetched live
 * from the same public block explorer / TronGrid / RPC endpoints the
 * deposit verifiers use. There is no cryptographic attestation (Merkle
 * proof of individual balances, third-party auditor signature, ...) —
 * that's a materially different, much bigger feature. Labelled as such in
 * the UI.
 */
export async function getReserves(prisma: PrismaClient, fetchFn: typeof fetch = fetch): Promise<ReserveRow[]> {
  const rows: ReserveRow[] = [];
  const treasuryWallets = new TreasuryWalletService(prisma);

  for (const chain of KNOWN_CHAINS) {
    let config;
    try {
      config = await treasuryWallets.resolve(chain);
    } catch {
      continue; // not configured on this deployment (no treasury address anywhere)
    }

    if (config.type === 'bitcoin') {
      const liabilities = await internalLiabilities(prisma, config.nativeAsset);
      try {
        const onChain = await fetchBitcoinTreasuryBalance(
          config.apiUrl ?? 'https://blockstream.info/api',
          config.treasuryAddress,
          fetchFn
        );
        rows.push({
          chain: config.chain,
          asset: config.nativeAsset,
          treasuryAddress: config.treasuryAddress,
          internalLiabilities: liabilities.toFixed(),
          onChainBalance: onChain.toFixed(),
          coverageRatio: coverageRatio(onChain, liabilities),
        });
      } catch (err: any) {
        rows.push({
          chain: config.chain,
          asset: config.nativeAsset,
          treasuryAddress: config.treasuryAddress,
          internalLiabilities: liabilities.toFixed(),
          onChainBalance: null,
          coverageRatio: null,
          error: err.message,
        });
      }
      continue;
    }

    if (config.type === 'tron') {
      // Native TRX deposits aren't creditable in this deployment (see
      // TronDepositVerifier) — only the configured TRC-20 tokens are.
      for (const [asset, token] of Object.entries(config.tokens)) {
        const liabilities = await internalLiabilities(prisma, asset);
        try {
          const onChain = await fetchTronTokenBalance(
            config.apiUrl ?? 'https://api.trongrid.io',
            config.apiKey,
            config.treasuryAddress,
            token.contractAddress,
            token.decimals,
            fetchFn
          );
          rows.push({
            chain: config.chain,
            asset,
            treasuryAddress: config.treasuryAddress,
            internalLiabilities: liabilities.toFixed(),
            onChainBalance: onChain.toFixed(),
            coverageRatio: coverageRatio(onChain, liabilities),
          });
        } catch (err: any) {
          rows.push({
            chain: config.chain,
            asset,
            treasuryAddress: config.treasuryAddress,
            internalLiabilities: liabilities.toFixed(),
            onChainBalance: null,
            coverageRatio: null,
            error: err.message,
          });
        }
      }
    }

    if (config.type === 'evm') {
      const nativeLiabilities = await internalLiabilities(prisma, config.nativeAsset);
      try {
        const onChain = await fetchEvmNativeBalance(config.rpcUrl!, config.treasuryAddress);
        rows.push({
          chain: config.chain,
          asset: config.nativeAsset,
          treasuryAddress: config.treasuryAddress,
          internalLiabilities: nativeLiabilities.toFixed(),
          onChainBalance: onChain.toFixed(),
          coverageRatio: coverageRatio(onChain, nativeLiabilities),
        });
      } catch (err: any) {
        rows.push({
          chain: config.chain,
          asset: config.nativeAsset,
          treasuryAddress: config.treasuryAddress,
          internalLiabilities: nativeLiabilities.toFixed(),
          onChainBalance: null,
          coverageRatio: null,
          error: err.message,
        });
      }

      for (const [asset, token] of Object.entries(config.tokens)) {
        const liabilities = await internalLiabilities(prisma, asset);
        try {
          const onChain = await fetchEvmTokenBalance(config.rpcUrl!, config.treasuryAddress, token.contractAddress, token.decimals);
          rows.push({
            chain: config.chain,
            asset,
            treasuryAddress: config.treasuryAddress,
            internalLiabilities: liabilities.toFixed(),
            onChainBalance: onChain.toFixed(),
            coverageRatio: coverageRatio(onChain, liabilities),
          });
        } catch (err: any) {
          rows.push({
            chain: config.chain,
            asset,
            treasuryAddress: config.treasuryAddress,
            internalLiabilities: liabilities.toFixed(),
            onChainBalance: null,
            coverageRatio: null,
            error: err.message,
          });
        }
      }
    }

    if (config.type === 'solana') {
      const nativeLiabilities = await internalLiabilities(prisma, config.nativeAsset);
      try {
        const onChain = await fetchSolanaNativeBalance(config.apiUrl!, config.treasuryAddress, fetchFn);
        rows.push({
          chain: config.chain,
          asset: config.nativeAsset,
          treasuryAddress: config.treasuryAddress,
          internalLiabilities: nativeLiabilities.toFixed(),
          onChainBalance: onChain.toFixed(),
          coverageRatio: coverageRatio(onChain, nativeLiabilities),
        });
      } catch (err: any) {
        rows.push({
          chain: config.chain,
          asset: config.nativeAsset,
          treasuryAddress: config.treasuryAddress,
          internalLiabilities: nativeLiabilities.toFixed(),
          onChainBalance: null,
          coverageRatio: null,
          error: err.message,
        });
      }

      for (const [asset, token] of Object.entries(config.tokens)) {
        const liabilities = await internalLiabilities(prisma, asset);
        try {
          const onChain = await fetchSolanaTokenBalance(config.apiUrl!, config.treasuryAddress, token.contractAddress, token.decimals, fetchFn);
          rows.push({
            chain: config.chain,
            asset,
            treasuryAddress: config.treasuryAddress,
            internalLiabilities: liabilities.toFixed(),
            onChainBalance: onChain.toFixed(),
            coverageRatio: coverageRatio(onChain, liabilities),
          });
        } catch (err: any) {
          rows.push({
            chain: config.chain,
            asset,
            treasuryAddress: config.treasuryAddress,
            internalLiabilities: liabilities.toFixed(),
            onChainBalance: null,
            coverageRatio: null,
            error: err.message,
          });
        }
      }
    }

    if (config.type === 'ton') {
      const nativeLiabilities = await internalLiabilities(prisma, config.nativeAsset);
      try {
        const onChain = await fetchTonNativeBalance(config.apiUrl ?? 'https://tonapi.io', config.apiKey, config.treasuryAddress, fetchFn);
        rows.push({
          chain: config.chain,
          asset: config.nativeAsset,
          treasuryAddress: config.treasuryAddress,
          internalLiabilities: nativeLiabilities.toFixed(),
          onChainBalance: onChain.toFixed(),
          coverageRatio: coverageRatio(onChain, nativeLiabilities),
        });
      } catch (err: any) {
        rows.push({
          chain: config.chain,
          asset: config.nativeAsset,
          treasuryAddress: config.treasuryAddress,
          internalLiabilities: nativeLiabilities.toFixed(),
          onChainBalance: null,
          coverageRatio: null,
          error: err.message,
        });
      }

      for (const [asset, token] of Object.entries(config.tokens)) {
        const liabilities = await internalLiabilities(prisma, asset);
        try {
          const onChain = await fetchTonJettonBalance(
            config.apiUrl ?? 'https://tonapi.io',
            config.apiKey,
            config.treasuryAddress,
            token.contractAddress,
            token.decimals,
            fetchFn
          );
          rows.push({
            chain: config.chain,
            asset,
            treasuryAddress: config.treasuryAddress,
            internalLiabilities: liabilities.toFixed(),
            onChainBalance: onChain.toFixed(),
            coverageRatio: coverageRatio(onChain, liabilities),
          });
        } catch (err: any) {
          rows.push({
            chain: config.chain,
            asset,
            treasuryAddress: config.treasuryAddress,
            internalLiabilities: liabilities.toFixed(),
            onChainBalance: null,
            coverageRatio: null,
            error: err.message,
          });
        }
      }
    }
  }

  return rows;
}
