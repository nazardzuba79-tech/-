import { ethers } from 'ethers';
import BigNumber from 'bignumber.js';
import { ChainConfig } from '../../config/chains';
import { DepositVerifier } from './types';
import { DepositVerificationError } from './errors';

const ERC20_TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

/** Ethereum and other EVM-compatible chains (Polygon, BSC, ...) via a JSON-RPC provider. */
export class EvmDepositVerifier implements DepositVerifier {
  constructor(private chainConfig: ChainConfig) {}

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
}
