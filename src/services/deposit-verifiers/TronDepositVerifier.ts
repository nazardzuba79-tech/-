import BigNumber from 'bignumber.js';
import { ChainConfig } from '../../config/chains';
import { DepositVerifier } from './types';
import { DepositVerificationError } from './errors';

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

/**
 * Tron only — for USDT and other TRC-20 tokens (native TRX deposits aren't
 * implemented; add a native-transfer check the same way EvmDepositVerifier
 * does for ETH if you need it). Verifies via TronGrid's decoded-events API,
 * which reports Transfer events with addresses already in base58 (T...)
 * form — no hex/base58 conversion needed to compare against the treasury
 * address.
 *
 * NOT tested against the live API from this environment (network access
 * here is sandboxed) — verify against TronGrid's real API with a small real
 * USDT-TRC20 transfer before trusting this with real deposits. A free
 * TronGrid API key (TRON_API_KEY) raises the request rate limit — get one
 * at https://www.trongrid.io.
 */
export class TronDepositVerifier implements DepositVerifier {
  constructor(private chainConfig: ChainConfig, private fetchFn: typeof fetch = fetch) {}

  async verify(txHash: string, asset: string): Promise<{ amount: BigNumber; confirmations: number }> {
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
