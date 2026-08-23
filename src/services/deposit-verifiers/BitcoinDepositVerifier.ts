import BigNumber from 'bignumber.js';
import { ChainConfig } from '../../config/chains';
import { DepositVerifier, IncomingTransfer } from './types';
import { DepositVerificationError } from './errors';

const SATS_PER_BTC = new BigNumber(10).pow(8);
const INCOMING_FEED_LIMIT = 25; // one Esplora page — enough for "recent deposits", not a full history sync

interface EsploraVout {
  scriptpubkey_address?: string;
  value: number; // sats
}

interface EsploraTx {
  txid: string;
  vout: EsploraVout[];
  status: { confirmed: boolean; block_height?: number };
}

/**
 * Bitcoin has no ERC-20-style tokens and no JSON-RPC provider like ethers —
 * this verifies deposits via a public Esplora-style block explorer REST API
 * (Blockstream's by default; point BITCOIN_API_URL at a self-hosted Esplora
 * instance if you'd rather not depend on a third party for something that
 * moves money).
 *
 * Also powers the admin manual-credit feed (listIncoming) via Esplora's
 * /address/:address/txs endpoint — the same API, no separate integration.
 *
 * NOT tested against the live API from this environment (network access
 * here is sandboxed) — verify against Blockstream's real API with a small
 * real transaction before trusting this with real deposits.
 */
export class BitcoinDepositVerifier implements DepositVerifier {
  constructor(private chainConfig: ChainConfig, private fetchFn: typeof fetch = fetch) {}

  async verify(txHash: string, asset: string): Promise<{ amount: BigNumber; confirmations: number }> {
    if (asset.toUpperCase() !== this.chainConfig.nativeAsset.toUpperCase()) {
      throw new DepositVerificationError(`Unsupported asset on Bitcoin: ${asset}`);
    }

    const tx = await this.requestJson<EsploraTx>(`/tx/${txHash}`);
    const treasury = this.chainConfig.treasuryAddress;

    const matchingSats = this.matchingSats(tx, treasury);
    if (matchingSats === 0) {
      throw new DepositVerificationError('Transaction does not pay the treasury address');
    }
    const amount = new BigNumber(matchingSats).dividedBy(SATS_PER_BTC);

    let confirmations = 0;
    if (tx.status.confirmed && tx.status.block_height != null) {
      const tipHeight = await this.requestText('/blocks/tip/height');
      confirmations = Number(tipHeight) - tx.status.block_height + 1;
    }

    return { amount, confirmations };
  }

  async listIncoming(): Promise<IncomingTransfer[]> {
    const treasury = this.chainConfig.treasuryAddress;
    const txs = await this.requestJson<EsploraTx[]>(`/address/${treasury}/txs`);
    const matching = txs.slice(0, INCOMING_FEED_LIMIT).filter((tx) => this.matchingSats(tx, treasury) > 0);
    if (matching.length === 0) return [];

    // One tip-height call shared across the whole batch — cheap, and gives
    // real confirmation counts instead of a placeholder.
    const tipHeight = Number(await this.requestText('/blocks/tip/height'));

    return matching.map((tx) => ({
      txHash: tx.txid,
      asset: this.chainConfig.nativeAsset,
      amount: new BigNumber(this.matchingSats(tx, treasury)).dividedBy(SATS_PER_BTC).toString(),
      confirmations: tx.status.confirmed && tx.status.block_height != null ? tipHeight - tx.status.block_height + 1 : 0,
    }));
  }

  private matchingSats(tx: EsploraTx, treasury: string): number {
    return tx.vout.filter((o) => o.scriptpubkey_address === treasury).reduce((sum, o) => sum + o.value, 0);
  }

  private baseUrl(): string {
    return this.chainConfig.apiUrl ?? 'https://blockstream.info/api';
  }

  private async requestJson<T>(path: string): Promise<T> {
    const res = await this.fetch(path);
    return (await res.json()) as T;
  }

  private async requestText(path: string): Promise<string> {
    const res = await this.fetch(path);
    return res.text();
  }

  private async fetch(path: string): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl()}${path}`);
    } catch (err: any) {
      throw new DepositVerificationError(`Failed to reach Bitcoin explorer API: ${err.message}`);
    }
    if (res.status === 404) {
      throw new DepositVerificationError('Transaction not found or not yet mined');
    }
    if (!res.ok) {
      throw new DepositVerificationError(`Bitcoin explorer API responded with HTTP ${res.status}`);
    }
    return res;
  }
}
