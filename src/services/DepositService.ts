import { PrismaClient, Prisma } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { ChainConfig } from '../config/chains';
import { createVerifier } from './deposit-verifiers';
import { MIN_DEPOSIT_USD, REFERRAL_REWARD_PERCENT } from '../config/limits';

export { DepositVerificationError } from './deposit-verifiers';

const STABLECOINS = new Set(['USDT', 'USDC', 'USD', 'DAI']);

// Only what DepositService needs from KrakenMarketDataService — narrow
// interface so tests can supply a plain mock instead of the real thing.
export interface PriceSource {
  getTicker(pair: string): Promise<{ lastPrice: string } | null>;
}

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
 *   4. If the confirmed amount converts to at least MIN_DEPOSIT_USD, credits
 *      the user's internal available balance and stores an immutable
 *      Deposit row keyed by (chain, txHash) — the DB unique constraint makes
 *      replaying the same tx hash a no-op, not a double credit. Below the
 *      minimum, the deposit is still recorded (so there's a paper trail for
 *      support) but marked BELOW_MINIMUM and left uncredited — the minimum
 *      exists specifically to make shuffling dust-sized amounts back and
 *      forth (airdrop farming, wash-trading bots) not worth the trouble.
 *
 * This does NOT require a chain indexer running 24/7 — verification happens
 * on demand when a user claims a deposit, which is the right tradeoff for a
 * small internal team tool. For a public-facing exchange you'd add a
 * background watcher too, so balances update even if the user never clicks
 * "claim".
 */
export class DepositService {
  private verifier = createVerifier(this.chainConfig);

  constructor(private prisma: PrismaClient, private chainConfig: ChainConfig, private priceSource: PriceSource) {}

  async claimDeposit(params: {
    userId: string;
    txHash: string;
    asset: string;
    // Set when an admin triggers this on the user's behalf (the manual
    // deposit-crediting feed) rather than the user self-claiming — recorded
    // in the audit log for accountability. Undefined for the normal
    // self-service path.
    performedByAdminId?: string;
  }): Promise<{ status: 'CREDITED' | 'PENDING' | 'BELOW_MINIMUM'; amount: string; confirmations: number; minDepositUsd?: number }> {
    const { userId, txHash, asset, performedByAdminId } = params;

    // Idempotency: if we've already recorded this tx, don't re-verify or re-credit.
    const existing = await this.prisma.deposit.findUnique({
      where: { chain_txHash: { chain: this.chainConfig.chain, txHash } },
    });
    if (existing) {
      return {
        status: existing.status as 'CREDITED' | 'PENDING' | 'BELOW_MINIMUM',
        amount: existing.amount.toString(),
        confirmations: existing.confirmations,
      };
    }

    const { amount, confirmations } = await this.verifier.verify(txHash, asset);
    const isConfirmed = confirmations >= this.chainConfig.minConfirmations;

    let status: 'CREDITED' | 'PENDING' | 'BELOW_MINIMUM' = isConfirmed ? 'CREDITED' : 'PENDING';
    if (isConfirmed) {
      const usdValue = await this.usdValueOf(asset, amount);
      // A price lookup failure (feed down) does NOT block a legitimate
      // deposit — we only ever withhold credit when we positively know the
      // value is below the threshold, never on "couldn't tell".
      if (usdValue !== null && usdValue.isLessThan(MIN_DEPOSIT_USD)) {
        status = 'BELOW_MINIMUM';
      }
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const deposit = await tx.deposit.create({
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

      if (status === 'CREDITED') {
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
          data: {
            userId,
            action: 'DEPOSIT_CREDITED',
            metadata: {
              txHash,
              asset,
              amount: amount.toString(),
              ...(performedByAdminId ? { performedByAdminId } : {}),
            },
          },
        });

        // Referral reward: 5% of THIS deposit, in the same asset, straight
        // to the referrer's own spot balance — see ReferralReward's schema
        // doc comment. Only ever runs for a user who was actually referred
        // (referredById set once, at registration); everyone else is a
        // no-op here.
        const depositor = await tx.user.findUnique({ where: { id: userId }, select: { referredById: true } });
        if (depositor?.referredById) {
          const rewardAmount = amount.times(REFERRAL_REWARD_PERCENT).dividedBy(100);
          const referrerBalance = await tx.balance.upsert({
            where: { userId_asset: { userId: depositor.referredById, asset } },
            create: { userId: depositor.referredById, asset, available: '0', locked: '0' },
            update: {},
          });
          await tx.balance.update({
            where: { userId_asset: { userId: depositor.referredById, asset } },
            data: { available: new BigNumber(referrerBalance.available.toString()).plus(rewardAmount).toString() },
          });
          await tx.referralReward.create({
            data: {
              referrerId: depositor.referredById,
              referredUserId: userId,
              depositId: deposit.id,
              asset,
              amount: rewardAmount.toString(),
            },
          });
          await tx.auditLog.create({
            data: {
              userId: depositor.referredById,
              action: 'REFERRAL_REWARD_CREDITED',
              metadata: { referredUserId: userId, depositId: deposit.id, asset, amount: rewardAmount.toString() },
            },
          });
        }
      } else if (status === 'BELOW_MINIMUM') {
        await tx.auditLog.create({
          data: { userId, action: 'DEPOSIT_BELOW_MINIMUM', metadata: { txHash, asset, amount: amount.toString() } },
        });
      }
    });

    return {
      status,
      amount: amount.toString(),
      confirmations,
      ...(status === 'BELOW_MINIMUM' ? { minDepositUsd: MIN_DEPOSIT_USD } : {}),
    };
  }

  private async usdValueOf(asset: string, amount: BigNumber): Promise<BigNumber | null> {
    if (STABLECOINS.has(asset)) return amount;
    try {
      const ticker = await this.priceSource.getTicker(`${asset}/USDT`);
      if (!ticker) return null;
      const price = new BigNumber(ticker.lastPrice);
      if (!price.isFinite() || price.isLessThanOrEqualTo(0)) return null;
      return amount.times(price);
    } catch {
      return null;
    }
  }
}
