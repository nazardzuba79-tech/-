import { ethers } from 'ethers';
import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { ChainConfig } from '../config/chains';

const ERC20_TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');

export class DepositVerificationError extends Error {}

/**
 * Flow:
 *   1. User sends crypto from their own wallet (MetaMask etc.) to your
 *      treasury address, shown via GET /api/v1/deposit-address/:chain.
 *   2. User submits the resulting tx hash to POST /api/v1/deposits/claim.
 *   3. This service independently verifies ON-CHAIN (never trusts client
 *      input) that:
 *        - the transaction exists and is confirmed
 *        - it actually paid the configured treasury address
 *        - the asset/amount match what's claimed
 *   4. On success, credits the user's internal available balance and stores
 *      an immutable Deposit row keyed by (chain, txHash) — the DB unique
 *      constraint makes replaying the same tx hash a no-op, not a double credit.
 *
 * This does NOT require a chain indexer running 24/7 — verification happens
 * on demand when a user claims a deposit, which is the right tradeoff for a
 * small internal team tool. For a public-facing exchange you'd add a
 * background watcher too, so balances update even if the user never clicks
 * "claim".
 */
export class DepositService {
  constructor(private prisma: PrismaClient, private chainConfig: ChainConfig) {}

  async claimDeposit(params: {
    userId: string;
    txHash: string;
    asset: string;
  }): Promise<{ status: 'CREDITED' | 'PENDING'; amount: string; confirmations: number }> {
    const { userId, txHash, asset } = params;

    // Idempotency: if we've already recorded this tx, don't re-verify or re-credit.
    const existing = await this.prisma.deposit.findUnique({
      where: { chain_txHash: { chain: this.chainConfig.chain, txHash } },
    });
    if (existing) {
      return {
        status: existing.status === 'CREDITED' ? 'CREDITED' : 'PENDING',
        amount: existing.amount.toString(),
        confirmations: existing.confirmations,
      };
    }

    const provider = new ethers.JsonRpcProvider(this.chainConfig.rpcUrl);
    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) throw new DepositVerificationError('Transaction not found or not yet mined');
    if (receipt.status !== 1) throw new DepositVerificationError('Transaction failed on-chain');

    const latestBlock = await provider.getBlockNumber();
    const confirmations = latestBlock - receipt.blockNumber + 1;

    const amount = await this.extractAndVerifyAmount(receipt, asset, provider, txHash);

    const isConfirmed = confirmations >= this.chainConfig.minConfirmations;
    const status = isConfirmed ? 'CREDITED' : 'PENDING';

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.deposit.create({
        data: {
          userId,
          asset,
          chain: this.chainConfig.chain,
          txHash,
          amount: amount.toString(),
          confirmations,
          status,
        },
      });

      if (isConfirmed) {
        const balance = await tx.balance.upsert({
          where: { userId_asset: { userId, asset } },
          create: { userId, asset, available: '0', locked: '0' },
          update: {},
        });
        await tx.balance.update({
          where: { userId_asset: { userId, asset } },
          data: { available: new BigNumber(balance.available.toString()).plus(amount).toString() },
        });
        await tx.auditLog.create({
          data: { userId, action: 'DEPOSIT_CREDITED', metadata: { txHash, asset, amount: amount.toString() } },
        });
      }
    });

    return { status, amount: amount.toString(), confirmations };
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
