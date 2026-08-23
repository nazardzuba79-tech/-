import { ethers } from 'ethers';
import BigNumber from 'bignumber.js';
import { ChainConfig } from '../../config/chains';
import { DepositVerifier, IncomingTransfer } from './types';
import { DepositVerificationError } from './errors';

const ERC20_TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const INCOMING_FEED_LIMIT = 20;

interface EtherscanResponse<T> {
  status: string; // "1" ok, "0" error or empty result
  message: string;
  result: T[] | string;
}

interface EtherscanNativeTx {
  hash: string;
  to: string;
  value: string;
  isError: string; // "0" success, "1" failed — failed txs never moved the funds
}

interface EtherscanTokenTx {
  hash: string;
  to: string;
  value: string;
  contractAddress: string;
}

/**
 * Ethereum and other EVM-compatible chains (Polygon, BSC, ...).
 *
 * Two independent, deliberately different data sources — not one API doing
 * both jobs:
 *   - verify() uses a plain JSON-RPC endpoint (ethers.js) for the
 *     authoritative single-transaction check at credit time. A free public
 *     RPC (e.g. https://ethereum.publicnode.com) is genuinely fine here —
 *     no signup, no payment — because this is one cheap read per credit
 *     attempt, not a sustained high-volume workload.
 *   - listIncoming() uses an Etherscan-style block-explorer API instead of
 *     scanning raw RPC logs/blocks, for the same reason Bitcoin/Tron use
 *     their own explorer APIs for listing: a "give me recent transfers to
 *     this address" endpoint already exists and is far cheaper than paging
 *     through thousands of blocks over RPC. Needs a free Etherscan API key
 *     (signup at https://etherscan.io/apis, no payment) — without one, this
 *     throws and the admin feed just skips this chain (verify() still works
 *     fine on its own if the admin already has a tx hash).
 */
export class EvmDepositVerifier implements DepositVerifier {
  constructor(private chainConfig: ChainConfig, private fetchFn: typeof fetch = fetch) {}

  async verify(txHash: string, asset: string): Promise<{ amount: BigNumber; confirmations: number }> {
    const provider = new ethers.JsonRpcProvider(this.chainConfig.rpcUrl);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) throw new DepositVerificationError('Transaction not found or not yet mined');
    if (receipt.status !== 1) throw new DepositVerificationError('Transaction failed on-chain');

    const latestBlock = await provider.getBlockNumber();
    const confirmations = latestBlock - receipt.blockNumber + 1;

    const amount = await this.extractAndVerifyAmount(receipt, asset, provider, txHash);
    return { amount, confirmations };
  }

  /**
   * Verifies the transaction actually paid the treasury address, and returns
   * the amount — for native currency (ETH/MATIC/BNB) via tx.value, or for an
   * ERC-20 token via the Transfer event log. Throws if the claimed asset
   * doesn't match what the transaction actually did.
   */
  private async extractAndVerifyAmount(
    receipt: ethers.TransactionReceipt,
    asset: string,
    provider: ethers.JsonRpcProvider,
    txHash: string
  ): Promise<BigNumber> {
    const treasury = this.chainConfig.treasuryAddress.toLowerCase();

    if (asset.toUpperCase() === this.chainConfig.nativeAsset.toUpperCase()) {
      const tx = await provider.getTransaction(txHash);
      if (!tx) throw new DepositVerificationError('Transaction not found');
      if (tx.to?.toLowerCase() !== treasury) {
        throw new DepositVerificationError('Transaction does not pay the treasury address');
      }
      return new BigNumber(ethers.formatEther(tx.value));
    }

    const tokenConfig = this.chainConfig.tokens[asset.toUpperCase()];
    if (!tokenConfig) throw new DepositVerificationError(`Unsupported asset: ${asset}`);

    const matchingLog = receipt.logs.find(
      (log) =>
        log.address.toLowerCase() === tokenConfig.contractAddress.toLowerCase() &&
        log.topics[0] === ERC20_TRANSFER_TOPIC &&
        log.topics.length === 3 &&
        ethers.getAddress('0x' + log.topics[2].slice(26)).toLowerCase() === treasury
    );
    if (!matchingLog) {
      throw new DepositVerificationError('No matching token transfer to treasury address found in this transaction');
    }

    const rawAmount = BigInt(matchingLog.data);
    return new BigNumber(rawAmount.toString()).dividedBy(new BigNumber(10).pow(tokenConfig.decimals));
  }

  /** Best-effort display feed only — verify() re-checks the real chain
   * state again at credit time, so a stale or wrong entry here can never
   * cause a bad credit. Confirmations aren't reported by Etherscan's list
   * endpoints without an extra per-tx call, so this treats every listed
   * transfer as at-minimum-confirmed (same approximation TronDepositVerifier
   * makes for the same reason). */
  async listIncoming(): Promise<IncomingTransfer[]> {
    const treasury = this.chainConfig.treasuryAddress.toLowerCase();
    const results: IncomingTransfer[] = [];

    const nativeTxs = await this.request<EtherscanNativeTx>({
      module: 'account',
      action: 'txlist',
      address: this.chainConfig.treasuryAddress,
      sort: 'desc',
    });
    for (const tx of nativeTxs.slice(0, INCOMING_FEED_LIMIT)) {
      if (tx.to?.toLowerCase() !== treasury || tx.isError !== '0') continue;
      results.push({
        txHash: tx.hash,
        asset: this.chainConfig.nativeAsset,
        amount: new BigNumber(ethers.formatEther(tx.value)).toString(),
        confirmations: this.chainConfig.minConfirmations,
      });
    }

    for (const [asset, tokenConfig] of Object.entries(this.chainConfig.tokens)) {
      const tokenTxs = await this.request<EtherscanTokenTx>({
        module: 'account',
        action: 'tokentx',
        address: this.chainConfig.treasuryAddress,
        contractaddress: tokenConfig.contractAddress,
        sort: 'desc',
      });
      for (const tx of tokenTxs.slice(0, INCOMING_FEED_LIMIT)) {
        if (tx.to?.toLowerCase() !== treasury) continue;
        results.push({
          txHash: tx.hash,
          asset,
          amount: new BigNumber(tx.value).dividedBy(new BigNumber(10).pow(tokenConfig.decimals)).toString(),
          confirmations: this.chainConfig.minConfirmations,
        });
      }
    }

    return results;
  }

  private async request<T>(params: Record<string, string>): Promise<T[]> {
    if (!this.chainConfig.apiKey) {
      throw new DepositVerificationError(
        'No Etherscan-style API key configured for this chain — set its *_API_KEY env var'
      );
    }
    const query = new URLSearchParams({ ...params, apikey: this.chainConfig.apiKey });
    const baseUrl = this.chainConfig.apiUrl ?? 'https://api.etherscan.io/api';

    let res: Response;
    try {
      res = await this.fetchFn(`${baseUrl}?${query.toString()}`);
    } catch (err: any) {
      throw new DepositVerificationError(`Failed to reach block explorer API: ${err.message}`);
    }
    if (!res.ok) {
      throw new DepositVerificationError(`Block explorer API responded with HTTP ${res.status}`);
    }

    const body = (await res.json()) as EtherscanResponse<T>;
    // status "0" covers both a real error and "no transactions found" — the
    // latter has message "No transactions found", which is a legitimate
    // empty result, not a failure.
    if (body.status === '0') {
      if (body.message === 'No transactions found') return [];
      throw new DepositVerificationError(`Block explorer API error: ${body.message}`);
    }
    return Array.isArray(body.result) ? body.result : [];
  }
}
