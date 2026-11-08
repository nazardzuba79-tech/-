import BigNumber from 'bignumber.js';
import { ChainConfig } from '../../config/chains';
import { DepositVerifier, IncomingTransfer } from './types';
import { DepositVerificationError, ProviderUnavailableError, TransferNotFoundError } from './errors';
import { ALLOWLISTED_TOKENS, TransferProof } from './proof';
import { tronAddressHex } from './tronAddress';

const INCOMING_FEED_LIMIT = 20;

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = 'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const REQUEST_TIMEOUT_MS = 10_000;

interface TronTxInfo {
  id?: string;
  blockNumber?: number;
  blockTimeStamp?: number;
  result?: string; // "FAILED" on failure; absent on success
  receipt?: { result?: string };
  log?: { address?: string; topics?: string[]; data?: string }[];
}

interface TronGridNowBlockResponse {
  block_header: { raw_data: { number: number } };
}

interface TronGridTrc20Transfer {
  transaction_id: string;
  to: string;
  value: string;
  block_timestamp: number; // unix milliseconds
}

interface TronGridTrc20Response {
  data: TronGridTrc20Transfer[];
}

/**
 * Tron mainnet — allowlisted TRC-20 tokens and native TransferContract TRX.
 *
 * The proof comes from the node itself, not an indexer feed:
 *   1. /walletsolidity/gettransactioninfobyid — present only once the block
 *      is solidified (irreversible). Falls back to /wallet/ (full node) for a
 *      transaction that is mined but not yet solidified: finalized=false.
 *   2. The receipt must be SUCCESS; a reverted/failed transaction proves nothing.
 *   3. Transfer logs are decoded here: emitting contract == allowlisted
 *      contract, topic[2] recipient == the treasury address being checked.
 *      Several matching logs in one transaction are summed into one amount.
 *   4. Confirmations = chain head - block + 1, head read once per call
 *      (or supplied by a caller that already read it this run).
 * Addresses are compared in 41-prefixed hex (Base58Check decoded).
 * A TronGrid API key (TRON_API_KEY) raises the request rate limit.
 */
export class TronDepositVerifier implements DepositVerifier {
  constructor(private chainConfig: ChainConfig, private fetchFn: typeof fetch = fetch) {}

  async verify(txHash: string, asset: string): Promise<{ amount: BigNumber; confirmations: number }> {
    const proof = await this.prove(txHash, asset);
    return { amount: proof.amount, confirmations: proof.confirmations };
  }

  /** Full on-chain proof of `txHash` paying `recipient` (default: the
   * configured treasury) in `asset`. Throws DepositVerificationError when the
   * chain says no, TransferNotFoundError when it does not know the
   * transaction, ProviderUnavailableError when it could not be asked. */
  async prove(txHash: string, asset: string, options: { recipient?: string; headBlock?: number } = {}): Promise<TransferProof> {
    const symbol = asset.toUpperCase();
    if (symbol === 'TRX') return this.proveNative(txHash, options);
    const tokenConfig = this.chainConfig.tokens[symbol];
    if (!tokenConfig) {
      throw new DepositVerificationError(`Unsupported asset on Tron: ${asset}`);
    }
    const allowed = ALLOWLISTED_TOKENS.tron[symbol];
    const contract = tronAddressHex(tokenConfig.contractAddress);
    if (!allowed || contract !== tronAddressHex(allowed.contract) || tokenConfig.decimals !== allowed.decimals) {
      throw new DepositVerificationError(`Token contract for ${symbol} is not on the TRON mainnet allowlist`);
    }
    const recipient = options.recipient ?? this.chainConfig.treasuryAddress;
    const recipientHex = tronAddressHex(recipient);
    if (!recipientHex || !contract) throw new DepositVerificationError('Invalid Tron token or treasury configuration');
    if (!/^[0-9a-f]{64}$/i.test(txHash)) throw new DepositVerificationError('Invalid Tron transaction hash');

    let info = await this.txInfo('/walletsolidity/gettransactioninfobyid', txHash);
    const finalized = !!info;
    if (!info) info = await this.txInfo('/wallet/gettransactioninfobyid', txHash);
    if (!info) throw new TransferNotFoundError('Transaction not found on chain (not mined yet or unknown)');

    if (info.result === 'FAILED' || info.receipt?.result !== 'SUCCESS') {
      throw new DepositVerificationError('Transaction failed on chain');
    }
    if (!Number.isSafeInteger(info.blockNumber) || info.blockNumber! < 0) throw new ProviderUnavailableError('Invalid TronGrid transaction info');

    let raw = BigInt(0);
    let matched = 0;
    for (const log of Array.isArray(info.log) ? info.log : []) {
      const topics = Array.isArray(log?.topics) ? log.topics.map((t) => String(t).toLowerCase().replace(/^0x/, '')) : [];
      if (topics[0] !== TRANSFER_TOPIC || topics.length < 3) continue;
      if (tronAddressHex(log.address) !== contract) continue; // 20-byte hex, 41-prefixed or not
      if (!/^[0-9a-f]{64}$/.test(topics[2]) || `41${topics[2].slice(24)}` !== recipientHex) continue;
      const data = String(log.data ?? '').replace(/^0x/, '');
      if (!/^[0-9a-f]{1,64}$/i.test(data)) throw new ProviderUnavailableError('Invalid TronGrid transfer log');
      raw += BigInt(`0x${data}`);
      matched++;
    }
    if (matched === 0) {
      throw new DepositVerificationError('Transaction has no allowlisted token transfer to this treasury address');
    }
    if (raw <= BigInt(0)) throw new DepositVerificationError('Token transfer amount must be positive');
    const amount = new BigNumber(raw.toString()).dividedBy(new BigNumber(10).pow(tokenConfig.decimals));

    const head = options.headBlock ?? await this.headBlock();
    const confirmations = Math.max(0, head - info.blockNumber! + 1);
    const blockTimestamp = Number.isSafeInteger(info.blockTimeStamp) && info.blockTimeStamp! > 0 ? new Date(info.blockTimeStamp!) : null;
    return { amount, confirmations, blockNumber: info.blockNumber!, blockTimestamp, finalized, recipient };
  }

  /** Native TRX is a system TransferContract, never a token log or a fee.
   * Both body and inclusion receipt must refer to the requested transaction.
   * A native receipt normally has no receipt.result; execution success is in
   * transaction.ret[].contractRet. Finality requires both solidified reads. */
  private async proveNative(txHash: string, options: { recipient?: string; headBlock?: number }): Promise<TransferProof> {
    if (this.chainConfig.type !== 'tron' || this.chainConfig.nativeAsset !== 'TRX') {
      throw new DepositVerificationError('Native TRX is not configured');
    }
    if (!/^[0-9a-f]{64}$/i.test(txHash)) throw new DepositVerificationError('Invalid Tron transaction hash');
    const recipient = options.recipient ?? this.chainConfig.treasuryAddress;
    const recipientHex = tronAddressHex(recipient);
    if (!recipientHex) throw new DepositVerificationError('Invalid Tron treasury configuration');
    const bodyAt = async (prefix: string): Promise<any | null> => {
      const body = await this.request<any>(`${prefix}/gettransactionbyid`, { value: txHash.toLowerCase() });
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ProviderUnavailableError('Invalid TronGrid transaction body');
      if (Object.keys(body).length === 0) return null;
      if (typeof body.txID !== 'string' || body.txID.toLowerCase() !== txHash.toLowerCase()) throw new ProviderUnavailableError('TronGrid returned a different transaction');
      return body;
    };
    const solidBody = await bodyAt('/walletsolidity');
    const body = solidBody ?? await bodyAt('/wallet');
    if (!body) throw new TransferNotFoundError('Transaction not found on chain (not mined yet or unknown)');
    const contracts = body.raw_data?.contract;
    if (!Array.isArray(contracts) || contracts.length !== 1 || contracts[0]?.type !== 'TransferContract'
      || contracts[0]?.parameter?.type_url !== 'type.googleapis.com/protocol.TransferContract') {
      throw new DepositVerificationError('Transaction is not a native TRX TransferContract');
    }
    if (!Array.isArray(body.ret) || body.ret.length !== 1 || body.ret[0]?.contractRet !== 'SUCCESS') {
      throw new DepositVerificationError('Transaction failed on chain or has no successful native execution');
    }
    const value = contracts[0].parameter.value;
    if (!tronAddressHex(value?.owner_address)) throw new ProviderUnavailableError('Invalid native TRX sender');
    if (!value || tronAddressHex(value.to_address) !== recipientHex) throw new DepositVerificationError('Native TRX transfer does not pay this treasury address');
    const raw = nativeTrxSun(value.amount);
    const solidInfo = await this.txInfo('/walletsolidity/gettransactioninfobyid', txHash);
    const info = solidInfo ?? await this.txInfo('/wallet/gettransactioninfobyid', txHash);
    if (!info) throw new TransferNotFoundError('Native transaction inclusion receipt not found');
    if (info.id?.toLowerCase() !== txHash.toLowerCase() || !Number.isSafeInteger(info.blockNumber) || info.blockNumber! < 0) {
      throw new ProviderUnavailableError('Invalid native transaction inclusion receipt');
    }
    if (info.result === 'FAILED' || (info.receipt?.result !== undefined && info.receipt.result !== 'SUCCESS')) {
      throw new DepositVerificationError('Transaction failed on chain');
    }
    const head = options.headBlock ?? await this.headBlock();
    if (!Number.isSafeInteger(head) || head < info.blockNumber!) throw new ProviderUnavailableError('Invalid TronGrid chain head');
    return { amount: new BigNumber(raw).shiftedBy(-6), confirmations: head - info.blockNumber! + 1,
      blockNumber: info.blockNumber!, blockTimestamp: Number.isSafeInteger(info.blockTimeStamp) && info.blockTimeStamp! > 0 ? new Date(info.blockTimeStamp!) : null,
      finalized: !!solidBody && !!solidInfo, recipient };
  }

  /** Current chain head. One call; a watcher run reads it once and passes it on. */
  async headBlock(): Promise<number> {
    const nowBlock = await this.request<TronGridNowBlockResponse>('/wallet/getnowblock');
    const block = nowBlock?.block_header?.raw_data?.number;
    if (!Number.isSafeInteger(block) || block < 0) throw new ProviderUnavailableError('Invalid TronGrid block response');
    return block;
  }

  async listIncoming(): Promise<IncomingTransfer[]> {
    const treasury = this.chainConfig.treasuryAddress;
    const results: IncomingTransfer[] = [];

    if (this.chainConfig.nativeAsset === 'TRX') {
      const page = await this.request<{ data?: any[] }>(`/v1/accounts/${treasury}/transactions?limit=${INCOMING_FEED_LIMIT}&only_to=true&only_confirmed=true`);
      if (!Array.isArray(page?.data)) throw new ProviderUnavailableError('Invalid native TronGrid transfer list');
      for (const item of page.data.slice(0, INCOMING_FEED_LIMIT)) {
        const contracts = item?.raw_data?.contract;
        if (!Array.isArray(contracts) || contracts.length !== 1 || contracts[0]?.type !== 'TransferContract') continue;
        const value = contracts[0]?.parameter?.value;
        if (!tronAddressHex(treasury) || tronAddressHex(value?.to_address) !== tronAddressHex(treasury)) continue;
        if (item.ret?.[0]?.contractRet !== 'SUCCESS' || value?.amount === 0 || value?.amount === '0') continue;
        if (!/^[a-f0-9]{64}$/i.test(item.txID) || !Number.isSafeInteger(item.block_timestamp)) throw new ProviderUnavailableError('Invalid native TronGrid transfer list');
        results.push({ txHash: item.txID.toLowerCase(), asset: 'TRX', amount: new BigNumber(nativeTrxSun(value.amount)).shiftedBy(-6).toFixed(),
          confirmations: null, timestamp: new Date(item.block_timestamp).toISOString() });
      }
    }

    // One call per configured TRC-20 token (just USDT normally) — TronGrid's
    // account-scoped endpoint already filters to this address. Display feed
    // only: every listed transfer is proven by prove() before it is stored.
    for (const [asset, tokenConfig] of Object.entries(this.chainConfig.tokens)) {
      const res = await this.request<TronGridTrc20Response>(
        `/v1/accounts/${treasury}/transactions/trc20?limit=${INCOMING_FEED_LIMIT}&only_to=true&contract_address=${tokenConfig.contractAddress}`
      );
      if (!Array.isArray(res?.data)) throw new ProviderUnavailableError('Invalid TronGrid transfer list');
      for (const t of res.data.slice(0, INCOMING_FEED_LIMIT)) {
        if (!tronAddressHex(treasury) || tronAddressHex(t.to) !== tronAddressHex(treasury)) continue;
        results.push({
          txHash: t.transaction_id,
          asset,
          amount: new BigNumber(t.value).dividedBy(new BigNumber(10).pow(tokenConfig.decimals)).toString(),
          // Not measured by this list; prove() measures it.
          confirmations: null,
          timestamp: new Date(t.block_timestamp).toISOString(),
        });
      }
    }

    return results;
  }

  private baseUrl(): string {
    return this.chainConfig.apiUrl ?? 'https://api.trongrid.io';
  }

  /** Transaction info, or null when the node does not know it (`{}`). */
  private async txInfo(path: string, txHash: string): Promise<TronTxInfo | null> {
    const info = await this.request<TronTxInfo>(path, { value: txHash.toLowerCase() });
    if (!info || typeof info !== 'object') throw new ProviderUnavailableError('Invalid TronGrid transaction info');
    if (info.id !== undefined && (typeof info.id !== 'string' || info.id.toLowerCase() !== txHash.toLowerCase())) throw new ProviderUnavailableError('TronGrid returned a different transaction');
    return info.id || info.blockNumber !== undefined ? info : null;
  }

  private async request<T>(path: string, body?: unknown): Promise<T> {
    let res: Response;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
    try {
      const headers: Record<string, string> = this.chainConfig.apiKey ? { 'TRON-PRO-API-KEY': this.chainConfig.apiKey } : {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      res = await this.fetchFn(`${this.baseUrl()}${path}`, {
        headers,
        ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (err: any) {
      throw new ProviderUnavailableError(`Failed to reach TronGrid API: ${err?.message ?? 'network error'}`);
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) {
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      throw new ProviderUnavailableError(`TronGrid API responded with HTTP ${res.status}`,
        Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : null);
    }
    try { return (await res.json()) as T; }
    catch { throw new ProviderUnavailableError('TronGrid API returned an unreadable body'); }
  }
}

/** Preserve all six decimals without accepting rounded JSON int64 values. */
export function nativeTrxSun(value: unknown): string {
  if ((typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isSafeInteger(value))) {
    throw new ProviderUnavailableError('Invalid native TRX amount');
  }
  const raw = String(value);
  if (!/^\d{1,19}$/.test(raw) || BigInt(raw) <= 0n || BigInt(raw) > 9223372036854775807n) throw new DepositVerificationError('Native TRX amount must be a positive int64 sun value');
  return BigInt(raw).toString();
}
