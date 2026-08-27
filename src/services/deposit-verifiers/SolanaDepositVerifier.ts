import BigNumber from 'bignumber.js';
import { ChainConfig } from '../../config/chains';
import { DepositVerifier, IncomingTransfer } from './types';
import { DepositVerificationError } from './errors';

const LAMPORTS_PER_SOL = new BigNumber(10).pow(9);
const INCOMING_FEED_LIMIT = 20;

interface SolanaRpcError {
  code: number;
  message: string;
}

interface SolanaRpcResponse<T> {
  result?: T;
  error?: SolanaRpcError;
}

interface ParsedAccountKey {
  pubkey: string;
}

interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

interface TransactionMeta {
  err: unknown;
  preBalances: number[];
  postBalances: number[];
  preTokenBalances?: TokenBalance[];
  postTokenBalances?: TokenBalance[];
}

interface GetTransactionResult {
  meta: TransactionMeta | null;
  transaction: { message: { accountKeys: ParsedAccountKey[] } };
  blockTime: number | null;
}

interface SignatureInfo {
  signature: string;
  slot: number;
  err: unknown;
  blockTime: number | null;
}

interface SignatureStatus {
  confirmations: number | null; // null means finalized (maximum) — Solana's own convention
  err: unknown;
}

/**
 * Solana — native SOL and SPL tokens (e.g. USDT-SPL). Everything goes
 * through the plain public JSON-RPC endpoint (no separate explorer API,
 * unlike Bitcoin/Tron/EVM): getTransaction's pre/post balance snapshots
 * give the exact amount that reached the treasury address in one call, for
 * both native SOL (preBalances/postBalances, in lamports) and SPL tokens
 * (preTokenBalances/postTokenBalances, already in the token's own units).
 *
 * NOT tested against the live API from this environment (network access
 * here is sandboxed) — verify against a real public Solana RPC with a small
 * real SOL and USDT-SPL transfer before trusting this with real deposits.
 */
export class SolanaDepositVerifier implements DepositVerifier {
  constructor(private chainConfig: ChainConfig, private fetchFn: typeof fetch = fetch) {}

  async verify(txHash: string, asset: string): Promise<{ amount: BigNumber; confirmations: number }> {
    const result = await this.rpc<GetTransactionResult | null>('getTransaction', [
      txHash,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
    ]);
    if (!result) throw new DepositVerificationError('Transaction not found or not yet processed');
    if (!result.meta) throw new DepositVerificationError('Transaction has no metadata yet');
    if (result.meta.err) throw new DepositVerificationError('Transaction failed on-chain');

    const amount = this.extractAmount(result, asset);
    const confirmations = await this.confirmationsFor(txHash);
    return { amount, confirmations };
  }

  private extractAmount(result: GetTransactionResult, asset: string): BigNumber {
    const treasury = this.chainConfig.treasuryAddress;
    const accountKeys = result.transaction.message.accountKeys;
    const treasuryIndex = accountKeys.findIndex((k) => k.pubkey === treasury);

    if (asset.toUpperCase() === this.chainConfig.nativeAsset.toUpperCase()) {
      if (treasuryIndex === -1) {
        throw new DepositVerificationError('Transaction does not involve the treasury address');
      }
      const pre = result.meta!.preBalances[treasuryIndex] ?? 0;
      const post = result.meta!.postBalances[treasuryIndex] ?? 0;
      const delta = post - pre;
      if (delta <= 0) {
        throw new DepositVerificationError('Transaction does not pay the treasury address');
      }
      return new BigNumber(delta).dividedBy(LAMPORTS_PER_SOL);
    }

    const tokenConfig = this.chainConfig.tokens[asset.toUpperCase()];
    if (!tokenConfig) throw new DepositVerificationError(`Unsupported asset: ${asset}`);

    const pre = (result.meta!.preTokenBalances ?? []).find((b) => b.owner === treasury && b.mint === tokenConfig.contractAddress);
    const post = (result.meta!.postTokenBalances ?? []).find((b) => b.owner === treasury && b.mint === tokenConfig.contractAddress);
    if (!post) {
      throw new DepositVerificationError('No matching token transfer to treasury address found in this transaction');
    }
    const preAmount = pre ? BigInt(pre.uiTokenAmount.amount) : BigInt(0);
    const postAmount = BigInt(post.uiTokenAmount.amount);
    const delta = postAmount - preAmount;
    if (delta <= BigInt(0)) {
      throw new DepositVerificationError('Transaction does not pay the treasury address');
    }
    return new BigNumber(delta.toString()).dividedBy(new BigNumber(10).pow(tokenConfig.decimals));
  }

  private async confirmationsFor(txHash: string): Promise<number> {
    const statuses = await this.rpc<{ value: (SignatureStatus | null)[] }>('getSignatureStatuses', [[txHash]]);
    const status = statuses.value[0];
    // null confirmations means "finalized" (Solana's maximum) — treat that
    // as at-minimum fully confirmed rather than as "unknown".
    return status?.confirmations ?? this.chainConfig.minConfirmations;
  }

  /** Best-effort display feed only — verify() re-checks the real chain
   * state again at credit time, so a stale or wrong entry here can never
   * cause a bad credit. One getSignaturesForAddress call plus one
   * getTransaction per signature — the same per-item cost the Etherscan
   * token-list branch pays for EVM chains, just without a bulk endpoint to
   * fall back to. */
  async listIncoming(): Promise<IncomingTransfer[]> {
    const treasury = this.chainConfig.treasuryAddress;
    const signatures = await this.rpc<SignatureInfo[]>('getSignaturesForAddress', [treasury, { limit: INCOMING_FEED_LIMIT }]);

    const results: IncomingTransfer[] = [];
    for (const sig of signatures) {
      if (sig.err) continue;
      let tx: GetTransactionResult | null;
      try {
        tx = await this.rpc<GetTransactionResult | null>('getTransaction', [
          sig.signature,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 },
        ]);
      } catch {
        continue; // one bad tx shouldn't blank out the whole feed
      }
      if (!tx?.meta || tx.meta.err) continue;

      const timestamp = sig.blockTime != null ? new Date(sig.blockTime * 1000).toISOString() : null;

      try {
        const nativeAmount = this.extractAmount(tx, this.chainConfig.nativeAsset);
        results.push({ txHash: sig.signature, asset: this.chainConfig.nativeAsset, amount: nativeAmount.toString(), confirmations: this.chainConfig.minConfirmations, timestamp });
        continue; // a transfer is either native SOL or one SPL token, never both
      } catch {
        // not a native transfer to the treasury — fall through and check tokens
      }

      for (const asset of Object.keys(this.chainConfig.tokens)) {
        try {
          const amount = this.extractAmount(tx, asset);
          results.push({ txHash: sig.signature, asset, amount: amount.toString(), confirmations: this.chainConfig.minConfirmations, timestamp });
          break;
        } catch {
          // not a transfer of this token either — try the next configured token
        }
      }
    }

    return results;
  }

  private baseUrl(): string {
    return this.chainConfig.apiUrl ?? 'https://api.mainnet-beta.solana.com';
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(this.baseUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
    } catch (err: any) {
      throw new DepositVerificationError(`Failed to reach Solana RPC endpoint: ${err.message}`);
    }
    if (!res.ok) {
      throw new DepositVerificationError(`Solana RPC endpoint responded with HTTP ${res.status}`);
    }
    const body = (await res.json()) as SolanaRpcResponse<T>;
    if (body.error) {
      throw new DepositVerificationError(`Solana RPC error: ${body.error.message}`);
    }
    return body.result as T;
  }
}
