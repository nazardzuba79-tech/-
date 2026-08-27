import BigNumber from 'bignumber.js';
import { ChainConfig } from '../../config/chains';
import { DepositVerifier, IncomingTransfer } from './types';
import { DepositVerificationError } from './errors';

const NANOTONS_PER_TON = new BigNumber(10).pow(9);
const EVENTS_WINDOW = 100; // recent activity searched for a matching event_id in verify()
const INCOMING_FEED_LIMIT = 20;

interface TonApiAddress {
  address: string;
}

interface TonApiTonTransfer {
  sender: TonApiAddress;
  recipient: TonApiAddress;
  amount: number; // nanotons
}

interface TonApiJettonTransfer {
  sender?: TonApiAddress;
  recipient?: TonApiAddress;
  amount: string; // raw jetton units, as a string
  jetton: { address: string };
}

interface TonApiAction {
  type: string; // 'TonTransfer' | 'JettonTransfer' | ... (other action types are ignored)
  status: string; // 'ok' | 'failed'
  TonTransfer?: TonApiTonTransfer;
  JettonTransfer?: TonApiJettonTransfer;
}

interface TonApiEvent {
  event_id: string;
  timestamp: number; // unix seconds
  actions: TonApiAction[];
}

interface TonApiEventsResponse {
  events: TonApiEvent[];
}

/**
 * TON — native TON and jettons (e.g. USDT-TON). Verified via tonapi.io's
 * decoded-events API rather than raw transactions/messages: a jetton
 * transfer to "your" address never actually touches that address on-chain
 * (it lands on a per-owner jetton-wallet contract instead, then forwards a
 * notification) — tonapi's account-events endpoint already resolves that
 * indirection into a plain TonTransfer/JettonTransfer action addressed to
 * the real owner, which is what both verify() and listIncoming() need.
 * verify() searches a recent window of the treasury's own events for one
 * whose event_id matches the submitted hash — tonapi has no separate
 * "look up one transaction by hash" endpoint that returns decoded actions.
 *
 * NOT tested against the live API from this environment (network access
 * here is sandboxed) — verify against tonapi.io's real API with a small
 * real TON and USDT-TON transfer before trusting this with real deposits.
 * A free tonapi.io API key (TON_API_KEY, from https://tonconsole.com)
 * raises the request rate limit.
 */
export class TonDepositVerifier implements DepositVerifier {
  constructor(private chainConfig: ChainConfig, private fetchFn: typeof fetch = fetch) {}

  async verify(txHash: string, asset: string): Promise<{ amount: BigNumber; confirmations: number }> {
    const treasury = this.chainConfig.treasuryAddress;
    const res = await this.request<TonApiEventsResponse>(`/v2/accounts/${treasury}/events?limit=${EVENTS_WINDOW}`);

    const needle = txHash.replace(/^0x/i, '').toLowerCase();
    const event = res.events.find((e) => e.event_id.toLowerCase() === needle);
    if (!event) {
      throw new DepositVerificationError(
        'Transaction not found among the treasury address’s recent activity — it may be too old, unconfirmed, or not addressed to the treasury'
      );
    }

    const amount = this.matchingAmount(event, treasury, asset);
    if (!amount) {
      throw new DepositVerificationError('No matching transfer to treasury address found in this transaction');
    }

    // tonapi only indexes transactions once they're in a finalized block —
    // by the time an event is visible here it's already past TON's fast
    // finality, so every match is treated as fully confirmed (same
    // approximation the EVM/Tron list branches make for the same reason).
    return { amount, confirmations: this.chainConfig.minConfirmations };
  }

  private matchingAmount(event: TonApiEvent, treasury: string, asset: string): BigNumber | null {
    const isNative = asset.toUpperCase() === this.chainConfig.nativeAsset.toUpperCase();

    if (isNative) {
      const action = event.actions.find(
        (a) => a.type === 'TonTransfer' && a.status === 'ok' && a.TonTransfer?.recipient.address === treasury
      );
      if (!action?.TonTransfer) return null;
      return new BigNumber(action.TonTransfer.amount).dividedBy(NANOTONS_PER_TON);
    }

    const tokenConfig = this.chainConfig.tokens[asset.toUpperCase()];
    if (!tokenConfig) throw new DepositVerificationError(`Unsupported asset: ${asset}`);

    const action = event.actions.find(
      (a) =>
        a.type === 'JettonTransfer' &&
        a.status === 'ok' &&
        a.JettonTransfer?.recipient?.address === treasury &&
        a.JettonTransfer?.jetton.address === tokenConfig.contractAddress
    );
    if (!action?.JettonTransfer) return null;
    return new BigNumber(action.JettonTransfer.amount).dividedBy(new BigNumber(10).pow(tokenConfig.decimals));
  }

  /** Best-effort display feed only — verify() re-checks the real chain
   * state again at credit time, so a stale or wrong entry here can never
   * cause a bad credit. */
  async listIncoming(): Promise<IncomingTransfer[]> {
    const treasury = this.chainConfig.treasuryAddress;
    const res = await this.request<TonApiEventsResponse>(`/v2/accounts/${treasury}/events?limit=${INCOMING_FEED_LIMIT}`);

    const results: IncomingTransfer[] = [];
    for (const event of res.events) {
      const timestamp = new Date(event.timestamp * 1000).toISOString();

      for (const action of event.actions) {
        if (action.type === 'TonTransfer' && action.status === 'ok' && action.TonTransfer?.recipient.address === treasury) {
          results.push({
            txHash: event.event_id,
            asset: this.chainConfig.nativeAsset,
            amount: new BigNumber(action.TonTransfer.amount).dividedBy(NANOTONS_PER_TON).toString(),
            confirmations: this.chainConfig.minConfirmations,
            timestamp,
          });
          continue;
        }

        if (action.type === 'JettonTransfer' && action.status === 'ok' && action.JettonTransfer?.recipient?.address === treasury) {
          const asset = Object.entries(this.chainConfig.tokens).find(
            ([, token]) => token.contractAddress === action.JettonTransfer!.jetton.address
          );
          if (!asset) continue; // a jetton we don't have configured as a supported deposit token
          const [symbol, tokenConfig] = asset;
          results.push({
            txHash: event.event_id,
            asset: symbol,
            amount: new BigNumber(action.JettonTransfer.amount).dividedBy(new BigNumber(10).pow(tokenConfig.decimals)).toString(),
            confirmations: this.chainConfig.minConfirmations,
            timestamp,
          });
        }
      }
    }

    return results;
  }

  private baseUrl(): string {
    return this.chainConfig.apiUrl ?? 'https://tonapi.io';
  }

  private async request<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl()}${path}`, {
        headers: this.chainConfig.apiKey ? { Authorization: `Bearer ${this.chainConfig.apiKey}` } : {},
      });
    } catch (err: any) {
      throw new DepositVerificationError(`Failed to reach tonapi.io: ${err.message}`);
    }
    if (!res.ok) {
      throw new DepositVerificationError(`tonapi.io responded with HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }
}
