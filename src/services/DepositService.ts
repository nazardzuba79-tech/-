import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { ChainConfig } from '../config/chains';
import { createVerifier } from './deposit-verifiers';

export { DepositVerificationError } from './deposit-verifiers';

/**
 * Flow:
 *   1. User sends crypto from their own wallet (Trust Wallet, MetaMask, ...)
 *      to your treasury address, shown via GET /api/v1/deposit-address/:chain.
 *   2. User submits the resulting tx hash to POST /api/v1/deposits/claim.
 *   3. A chain-specific verifier (see deposit-verifiers/) independently
 *      checks ON-CHAIN (never trusts client input) that:
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
  private verifier = createVerifier(this.chainConfig);

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

    const { amount, confirmations } = await this.verifier.verify(txHash, asset);
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
}
