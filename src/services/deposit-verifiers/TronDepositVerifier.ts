import BigNumber from 'bignumber.js';
import { ChainConfig } from '../../config/chains';
import { DepositVerifier, IncomingTransfer } from './types';
import { DepositVerificationError } from './errors';

const INCOMING_FEED_LIMIT = 20;

interface TronGridEvent {
  block_number: number;
  contract_address: string;
  event_name: string;
  result: { from: string; to: string; value: string };
}

interface TronGridEventsResponse {
  data: TronGridEvent[];
  success: boolean;
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

interface TronGridContractValue {
  amount?: number;
  owner_address: string;
  to_address?: string; // hex, "41..." prefixed — NOT base58
}

interface TronGridTransactionInfo {
  blockNumber?: number; // absent until the tx is mined
  raw_data: {
    timestamp?: number; // unix milliseconds
    contract: { type: string; parameter: { value: TronGridContractValue } }[];
  };
}

interface TronGridTransactionResponse {
  data: TronGridTransactionInfo[];
}

interface TronGridNativeTx {
  txID: string;
  blockNumber?: number;
  raw_data: {
    timestamp?: number;
    contract: { type: string; parameter: { value: TronGridContractValue } }[];
  };
}

interface TronGridNativeTxResponse {
  data: TronGridNativeTx[];
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Tron addresses are base58check ("T...") everywhere a human sees them,
 * but a native TransferContract's to_address comes back from TronGrid as
 * raw hex ("41..." prefixed, no checksum) — unlike TRC-20 Transfer events,
 * which TronGrid already decodes to base58 for us. Converts the treasury's
 * base58 address to that same hex form once, so it can be compared
 * directly against native transfers without a Tron SDK dependency. */
function base58ToHexAddress(base58: string): string {
  let num = BigInt(0);
  for (const char of base58) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) throw new DepositVerificationError(`Invalid base58 Tron address: ${base58}`);
    num = num * BigInt(58) + BigInt(index);
  }
  let hex = num.toString(16);
  if (hex.length % 2 !== 0) hex = '0' + hex;
  let leadingZeroBytes = 0;
  for (const char of base58) {
    if (char !== '1') break;
    leadingZeroBytes++;
  }
  const fullHex = '00'.repeat(leadingZeroBytes) + hex;
  // Strip the trailing 4-byte (8 hex char) checksum, keep the 21-byte
  // (0x41 prefix + 20-byte address) payload.
  return fullHex.slice(0, fullHex.length - 8).toLowerCase();
}

/**
 * Tron — native TRX and TRC-20 tokens (e.g. USDT-TRC20). Two different
 * TronGrid data shapes, matching the two different contract types Tron
 * itself distinguishes:
 *   - TRC-20 transfers verify via TronGrid's decoded-events API, which
 *     reports Transfer events with addresses already in base58 (T...) form.
 *   - Native TRX transfers verify via the plain transaction-info API, whose
 *     to_address comes back in raw hex — see base58ToHexAddress() above.
 *
 * Also powers the admin manual-credit feed (listIncoming) via TronGrid's
 * account-scoped transaction lists — same two APIs, no separate integration.
 *
 * NOT tested against the live API from this environment (network access
 * here is sandboxed) — verify against TronGrid's real API with a small real
 * transfer of each asset before trusting this with real deposits. A free
 * TronGrid API key (TRON_API_KEY) raises the request rate limit — get one
 * at https://www.trongrid.io.
 */
export class TronDepositVerifier implements DepositVerifier {
  constructor(private chainConfig: ChainConfig, private fetchFn: typeof fetch = fetch) {}

  async verify(txHash: string, asset: string): Promise<{ amount: BigNumber; confirmations: number }> {
    if (asset.toUpperCase() === this.chainConfig.nativeAsset.toUpperCase()) {
      return this.verifyNative(txHash);
    }

    const tokenConfig = this.chainConfig.tokens[asset.toUpperCase()];
    if (!tokenConfig) {
      throw new DepositVerificationError(`Unsupported asset on Tron: ${asset}`);
    }

    const events = await this.request<TronGridEventsResponse>(`/v1/transactions/${txHash}/events`);
    const treasury = this.chainConfig.treasuryAddress;

    const transfers = events.data.filter(
      (e) =>
        e.event_name === 'Transfer' &&
        e.contract_address === tokenConfig.contractAddress &&
        e.result.to === treasury
    );
    if (transfers.length === 0) {
      // Deliberately one error for "doesn't exist", "not yet mined", "wrong
      // contract", and "wrong recipient" — TronGrid's events endpoint
      // doesn't cleanly distinguish these, and none of them are creditable.
      throw new DepositVerificationError(
        'Transaction not found, not yet mined, or has no matching token transfer to the treasury address'
      );
    }

    const rawAmount = transfers.reduce((sum, e) => sum + BigInt(e.result.value), BigInt(0));
    const amount = new BigNumber(rawAmount.toString()).dividedBy(new BigNumber(10).pow(tokenConfig.decimals));

    const nowBlock = await this.request<TronGridNowBlockResponse>('/wallet/getnowblock');
    const confirmations = nowBlock.block_header.raw_data.number - transfers[0].block_number + 1;

    return { amount, confirmations };
  }

  private async verifyNative(txHash: string): Promise<{ amount: BigNumber; confirmations: number }> {
    const treasuryHex = base58ToHexAddress(this.chainConfig.treasuryAddress);
    const res = await this.request<TronGridTransactionResponse>(`/v1/transactions/${txHash}`);
    const tx = res.data[0];
    if (!tx) throw new DepositVerificationError('Transaction not found');
    if (tx.blockNumber == null) throw new DepositVerificationError('Transaction not yet mined');

    const transferContract = tx.raw_data.contract.find(
      (c) => c.type === 'TransferContract' && c.parameter.value.to_address?.toLowerCase() === treasuryHex
    );
    if (!transferContract) {
      throw new DepositVerificationError('Transaction does not pay the treasury address');
    }

    const rawAmount = transferContract.parameter.value.amount ?? 0;
    const amount = new BigNumber(rawAmount).dividedBy(new BigNumber(10).pow(6)); // TRX has 6 decimals, like SUN -> TRX

    const nowBlock = await this.request<TronGridNowBlockResponse>('/wallet/getnowblock');
    const confirmations = nowBlock.block_header.raw_data.number - tx.blockNumber + 1;

    return { amount, confirmations };
  }

  async listIncoming(): Promise<IncomingTransfer[]> {
    const treasury = this.chainConfig.treasuryAddress;
    const treasuryHex = base58ToHexAddress(treasury);
    const results: IncomingTransfer[] = [];

    // One call per configured TRC-20 token (just USDT normally) — TronGrid's
    // account-scoped endpoint already filters to this address, so no
    // client-side matching needed like the Bitcoin verifier does.
    for (const [asset, tokenConfig] of Object.entries(this.chainConfig.tokens)) {
      const res = await this.request<TronGridTrc20Response>(
        `/v1/accounts/${treasury}/transactions/trc20?limit=${INCOMING_FEED_LIMIT}&only_to=true&contract_address=${tokenConfig.contractAddress}`
      );
      for (const t of res.data) {
        if (t.to !== treasury) continue; // belt-and-suspenders, only_to should already guarantee this
        results.push({
          txHash: t.transaction_id,
          asset,
          amount: new BigNumber(t.value).dividedBy(new BigNumber(10).pow(tokenConfig.decimals)).toString(),
          // This endpoint only returns already-indexed transfers (no mempool
          // entries), so treating them as at-minimum-confirmed is accurate
          // enough for the feed — verify() re-checks the real count at
          // credit time regardless.
          confirmations: this.chainConfig.minConfirmations,
          timestamp: new Date(t.block_timestamp).toISOString(),
        });
      }
    }

    // Native TRX transfers — same account-scoped listing, but the plain
    // transaction endpoint (not /trc20), filtered client-side to
    // TransferContract calls that actually paid the treasury address.
    const nativeRes = await this.request<TronGridNativeTxResponse>(
      `/v1/accounts/${treasury}/transactions?limit=${INCOMING_FEED_LIMIT}&only_to=true`
    );
    for (const tx of nativeRes.data) {
      const transferContract = tx.raw_data.contract.find(
        (c) => c.type === 'TransferContract' && c.parameter.value.to_address?.toLowerCase() === treasuryHex
      );
      if (!transferContract) continue;
      results.push({
        txHash: tx.txID,
        asset: this.chainConfig.nativeAsset,
        amount: new BigNumber(transferContract.parameter.value.amount ?? 0).dividedBy(new BigNumber(10).pow(6)).toString(),
        confirmations: this.chainConfig.minConfirmations,
        timestamp: tx.raw_data.timestamp != null ? new Date(tx.raw_data.timestamp).toISOString() : null,
      });
    }

    return results;
  }

  private baseUrl(): string {
    return this.chainConfig.apiUrl ?? 'https://api.trongrid.io';
  }

  private async request<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl()}${path}`, {
        headers: this.chainConfig.apiKey ? { 'TRON-PRO-API-KEY': this.chainConfig.apiKey } : {},
      });
    } catch (err: any) {
      throw new DepositVerificationError(`Failed to reach TronGrid API: ${err.message}`);
    }
    if (!res.ok) {
      throw new DepositVerificationError(`TronGrid API responded with HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }
}
