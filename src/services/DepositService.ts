import { PrismaClient, Prisma, Deposit } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { ChainConfig } from '../config/chains';
import { createVerifier, DepositVerificationError } from './deposit-verifiers';
import { MIN_DEPOSIT_USD, REFERRAL_REWARD_PERCENT, DEPOSIT_USD_PEGGED_ASSETS } from '../config/limits';

export { DepositVerificationError } from './deposit-verifiers';
export interface PriceSource { getTicker(pair: string): Promise<{ lastPrice: string } | null>; }
export type DepositStatus = 'CREDITED' | 'PENDING' | 'BELOW_MINIMUM';
export interface DepositResult {
  status: DepositStatus; amount: string; confirmations: number; minDepositUsd?: number; message?: string;
}

/** Detection has no dollar threshold. Every credit requires admin approval.
 * A shared treasury cannot identify the owner of an unsolicited transfer:
 * discovered transfers are persisted unassigned until claimed or assigned by admin.
 * All credits re-verify the chain and atomically transition the same unique row.
 */
export class DepositService {
  private verifier = createVerifier(this.chainConfig);
  constructor(private prisma: PrismaClient, private chainConfig: ChainConfig, private priceSource: PriceSource) {}

  private hash(value: string): string {
    if (this.chainConfig.type === 'solana') return value;
    return this.chainConfig.type === 'ton' ? value.toLowerCase().replace(/^0x/, '') : value.toLowerCase();
  }

  private result(row: Pick<Deposit, 'status' | 'amount' | 'confirmations'>): DepositResult {
    return { status: row.status as DepositStatus, amount: row.amount.toString(), confirmations: row.confirmations,
      ...(row.status === 'BELOW_MINIMUM' ? { minDepositUsd: MIN_DEPOSIT_USD,
        message: 'Депозит ниже минимальной суммы и требует ручной обработки администратором.' } : {}) };
  }

  private async verified(txHash: string, asset: string) {
    const verified = await this.verifier.verify(txHash, asset);
    if (!verified.amount.isFinite() || !verified.amount.isGreaterThan(0) || verified.amount.decimalPlaces()! > 18
      || !Number.isSafeInteger(verified.confirmations) || verified.confirmations < 0) {
      throw new DepositVerificationError('Invalid verified transfer');
    }
    return verified;
  }

  private async awaitingStatus(asset: string, amount: BigNumber): Promise<Exclude<DepositStatus, 'CREDITED'>> {
    const usd = await this.usdValueOf(asset, amount);
    if (usd !== null && usd.isLessThan(MIN_DEPOSIT_USD)) return 'BELOW_MINIMUM';
    // The minimum is a warning/classification only, never permission to credit.
    return 'PENDING';
  }

  /** Persist an independently verified incoming transfer even without a known user.
   * No balance mutation here. Repeated scans cannot overwrite credited or assigned rows.
   */
  async recordIncoming(params: { txHash: string; asset: string }): Promise<void> {
    const txHash = this.hash(params.txHash), asset = params.asset.toUpperCase();
    const where = { chain_txHash: { chain: this.chainConfig.chain, txHash } };
    const existing = await this.prisma.deposit.findUnique({ where });
    if (existing?.status === 'CREDITED') return;
    if (existing && existing.asset !== asset) throw new DepositVerificationError('Transaction already recorded for another asset');
    if (existing?.userId) {
      // Refresh attribution/confirmations only, even when fully confirmed.
      // Discovery must never supply admin approval or mutate balances.
      await this.claimDeposit({ userId: existing.userId, txHash, asset });
      return;
    }
    const { amount, confirmations } = await this.verified(txHash, asset);
    if (existing && !amount.eq(existing.amount.toString())) throw new DepositVerificationError('Verified amount differs from recorded transfer');
    const status = await this.awaitingStatus(asset, amount);
    if (existing) {
      // Do not overwrite a simultaneous admin assignment/credit.
      await this.prisma.deposit.updateMany({ where: { id: existing.id, userId: null, status: { not: 'CREDITED' } },
        data: { confirmations, status } });
      return;
    }
    await this.prisma.deposit.upsert({ where, update: { txHash }, create: {
      chain: this.chainConfig.chain, txHash, asset, amount: amount.toString(), confirmations,
      status,
    } });
  }

  async claimDeposit(params: { userId: string; txHash: string; asset: string; performedByAdminId?: string }): Promise<DepositResult> {
    const { userId, performedByAdminId } = params;
    const asset = params.asset.toUpperCase(), txHash = this.hash(params.txHash);
    const where = { chain_txHash: { chain: this.chainConfig.chain, txHash } };
    const existing = await this.prisma.deposit.findUnique({ where });
    const checkOwner = (row: Deposit) => {
      if ((row.userId !== null && row.userId !== userId) || row.asset !== asset) {
        throw new DepositVerificationError('Transaction already assigned to another user or asset');
      }
    };
    if (existing) {
      checkOwner(existing);
      if (existing.status === 'CREDITED') return this.result(existing);
    }
    const { amount, confirmations } = await this.verified(txHash, asset);
    const pendingStatus = await this.awaitingStatus(asset, amount);

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (performedByAdminId) {
        const admin = await tx.user.findUnique({ where: { id: performedByAdminId }, select: { role: true } });
        if (admin?.role !== 'ADMIN') throw new DepositVerificationError('Admin access required');
      }
      // The no-op UPDATE locks an existing row; the unique key arbitrates first
      // insertion. Concurrent approves/claims then observe CREDITED and return.
      const deposit = await tx.deposit.upsert({ where, update: { txHash }, create: {
        userId, asset, chain: this.chainConfig.chain, txHash, amount: amount.toString(), confirmations, status: 'PENDING',
      } });
      checkOwner(deposit);
      if (deposit.status === 'CREDITED') return this.result(deposit);
      if (!amount.eq(deposit.amount.toString())) throw new DepositVerificationError('Verified amount differs from recorded transfer');
      const status: DepositStatus = performedByAdminId && confirmations >= this.chainConfig.minConfirmations
        ? 'CREDITED' : pendingStatus;
      const updated = await tx.deposit.update({ where: { id: deposit.id }, data: { userId, status, confirmations } });
      if (status === 'CREDITED') {
        // Atomic increments also preserve two distinct deposits credited concurrently.
        await tx.balance.upsert({ where: { userId_asset: { userId, asset } },
          create: { userId, asset, available: amount.toString(), locked: '0' },
          update: { available: { increment: amount.toString() } } });
        await tx.auditLog.create({ data: { userId, action: 'DEPOSIT_CREDITED', metadata: {
          depositId: deposit.id, txHash, asset, amount: amount.toString(),
          ...(performedByAdminId ? { performedByAdminId, manual: true } : {}),
        } } });
        const depositor = await tx.user.findUnique({ where: { id: userId }, select: { referredById: true } });
        if (depositor?.referredById) {
          const reward = amount.times(REFERRAL_REWARD_PERCENT).dividedBy(100).toString();
          await tx.balance.upsert({ where: { userId_asset: { userId: depositor.referredById, asset } },
            create: { userId: depositor.referredById, asset, available: reward, locked: '0' },
            update: { available: { increment: reward } } });
          await tx.referralReward.create({ data: { referrerId: depositor.referredById, referredUserId: userId,
            depositId: deposit.id, asset, amount: reward } });
          await tx.auditLog.create({ data: { userId: depositor.referredById, action: 'REFERRAL_REWARD_CREDITED',
            metadata: { referredUserId: userId, depositId: deposit.id, asset, amount: reward } } });
        }
      } else if (status === 'BELOW_MINIMUM' && deposit.status !== status) {
        await tx.auditLog.create({ data: { userId, action: 'DEPOSIT_BELOW_MINIMUM', metadata: { txHash, asset, amount: amount.toString() } } });
      }
      return this.result(updated);
    });
  }

  private async usdValueOf(asset: string, amount: BigNumber): Promise<BigNumber | null> {
    if ((DEPOSIT_USD_PEGGED_ASSETS as readonly string[]).includes(asset)) return amount;
    try {
      const ticker = await this.priceSource.getTicker(`${asset}/USDT`);
      const price = new BigNumber(ticker?.lastPrice ?? 'NaN');
      return price.isFinite() && price.isGreaterThan(0) ? amount.times(price) : null;
    } catch { return null; }
  }
}
