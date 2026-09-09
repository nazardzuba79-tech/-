import BigNumber from 'bignumber.js';
import { ChainConfig } from '../../config/chains';
import { DepositVerifier, IncomingTransfer } from './types';
import { DepositVerificationError } from './errors';
import { tronAddressHex } from './tronAddress';

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

/**
 * Tron only — for USDT and other TRC-20 tokens (native TRX deposits aren't
 * implemented; add a native-transfer check the same way EvmDepositVerifier
 * does for ETH if you need it). Verifies via TronGrid's decoded-events API,
 * whose decoded event recipient is hex while configured addresses normally
 * use Base58Check. Normalize both before comparing the recipient/contract.
 *
 * Also powers the admin manual-credit feed (listIncoming) via TronGrid's
 * account-scoped TRC-20 transfer list — same API, no separate integration.
 *
 * Public TronGrid Transfer-event compatibility has been checked. This does
 * not prove an exchange production deposit end-to-end; see the deposit
 * minimum/TRC20 audit for the verification scope and remaining live check.
 * A TronGrid API key (TRON_API_KEY) raises the request rate limit.
 */
export class TronDepositVerifier implements DepositVerifier {
  constructor(private chainConfig: ChainConfig, private fetchFn: typeof fetch = fetch) {}

  async verify(txHash: string, asset: string): Promise<{ amount: BigNumber; confirmations: number }> {
    const tokenConfig = this.chainConfig.tokens[asset.toUpperCase()];
    if (!tokenConfig) {
      throw new DepositVerificationError(`Unsupported asset on Tron: ${asset}`);
    }

    const events = await this.request<TronGridEventsResponse>(`/v1/transactions/${txHash}/events`);
    const treasury = tronAddressHex(this.chainConfig.treasuryAddress);
    const contract = tronAddressHex(tokenConfig.contractAddress);
    if (!treasury || !contract || !Number.isInteger(tokenConfig.decimals) || tokenConfig.decimals < 0 || tokenConfig.decimals > 36) {
      throw new DepositVerificationError('Invalid Tron token or treasury configuration');
    }
    if (events.success !== true || !Array.isArray(events.data)) throw new DepositVerificationError('Invalid TronGrid event response');

    const transfers = events.data.filter(
      (e) =>
        e?.event_name === 'Transfer' &&
        tronAddressHex(e.contract_address) === contract &&
        tronAddressHex(e.result?.to) === treasury
    );
    if (transfers.length === 0) {
      // Deliberately one error for "doesn't exist", "not yet mined", "wrong
      // contract", and "wrong recipient" — TronGrid's events endpoint
      // doesn't cleanly distinguish these, and none of them are creditable.
      throw new DepositVerificationError(
        'Transaction not found, not yet mined, or has no matching token transfer to the treasury address'
      );
    }

    if (transfers.some(e => !/^\d+$/.test(e.result.value) || !Number.isSafeInteger(e.block_number) || e.block_number < 0))
      throw new DepositVerificationError('Invalid TronGrid transfer data');
    const rawAmount = transfers.reduce((sum, e) => sum + BigInt(e.result.value), BigInt(0));
    if (rawAmount <= BigInt(0)) throw new DepositVerificationError('Token transfer amount must be positive');
    const amount = new BigNumber(rawAmount.toString()).dividedBy(new BigNumber(10).pow(tokenConfig.decimals));

    const nowBlock = await this.request<TronGridNowBlockResponse>('/wallet/getnowblock');
    const block = nowBlock.block_header?.raw_data?.number;
    if (!Number.isSafeInteger(block) || block < 0) throw new DepositVerificationError('Invalid TronGrid block response');
    const confirmations = Math.max(0, block - Math.max(...transfers.map(e => e.block_number)) + 1);

    return { amount, confirmations };
  }

  async listIncoming(): Promise<IncomingTransfer[]> {
    const treasury = this.chainConfig.treasuryAddress;
    const results: IncomingTransfer[] = [];

    // One call per configured TRC-20 token (just USDT normally) — TronGrid's
    // account-scoped endpoint already filters to this address, so no
    // client-side matching needed like the Bitcoin verifier does.
    for (const [asset, tokenConfig] of Object.entries(this.chainConfig.tokens)) {
      const res = await this.request<TronGridTrc20Response>(
        `/v1/accounts/${treasury}/transactions/trc20?limit=${INCOMING_FEED_LIMIT}&only_to=true&contract_address=${tokenConfig.contractAddress}`
      );
      for (const t of res.data) {
        if (!tronAddressHex(treasury) || tronAddressHex(t.to) !== tronAddressHex(treasury)) continue;
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
