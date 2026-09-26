import { PrismaClient, Prisma, Deposit } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { ChainConfig } from '../../config/chains';
import { DEPOSIT_PROOF_MAX_AGE_MS, MIN_DEPOSIT_USD, REFERRAL_REWARD_PERCENT } from '../../config/limits';
import { DepositVerificationError, ProviderUnavailableError } from '../deposit-verifiers';
import { TransferProof } from '../deposit-verifiers/proof';
import { buildPackage, DepositPackageView, minConfirmationsFor } from './DepositQueueService';
import { isPackageEligible, meetsMinimum, packageToken, PriceSourceWithMeta, sumAmounts, valueInUsd } from './depositPolicy';
import { assertSaneProof, proveTransfer, recipientFor } from './transferProof';

export class DepositBatchError extends Error {
  constructor(readonly code:
    | 'PACKAGE_CHANGED' | 'BELOW_MINIMUM' | 'EMPTY_PACKAGE' | 'PRICE_UNAVAILABLE' | 'ALREADY_CREDITED'
    | 'PROOF_FAILED' | 'PROVIDER_UNAVAILABLE' | 'PROOF_STALE' | 'NOT_ADMIN' | 'IDEMPOTENCY_MISMATCH' | 'CHAIN_UNAVAILABLE',
  message: string, readonly details?: unknown) { super(message); }
}

export interface PackagePreview extends DepositPackageView {
  balanceAvailable: string;
  balanceAfter: string;
}

export interface ConfirmResult {
  status: 'CREDITED';
  batchId: string;
  userId: string;
  chain: string;
  asset: string;
  totalAmount: string;
  depositIds: string[];
  replayed: boolean;
}

type ProveFn = (config: ChainConfig, txHash: string, asset: string, options: { recipient?: string }) => Promise<TransferProof>;

/**
 * THE ONLY WAY A DEPOSIT BECOMES A BALANCE.
 *
 * preview(): read-only view of one user's package (one asset, one network):
 * the exact transfers, their sum, the minimum check, the current balance and
 * the balance after. Its `token` fingerprints exactly that.
 *
 * confirm(): an authenticated admin approves exactly the previewed package.
 *   1. Recompute the package from the database; any change in composition,
 *      owner, amount or proof since the preview → PACKAGE_CHANGED.
 *   2. Minimum (server-side, exact) → else BELOW_MINIMUM. No override exists.
 *   3. Re-prove EVERY transfer on chain (outside any DB transaction):
 *      allowlisted contract, recorded treasury recipient, exact amount,
 *      success, finality, confirmations.
 *   4. One DB transaction: lock the rows in id order, re-check revision and
 *      state, reject stale proofs, insert the batch (unique idempotency key),
 *      mark every row CREDITED, one balance increment of the exact total,
 *      one audit per transfer + one per batch, referral per transfer.
 * All or nothing. Replaying the same idempotency key returns the first result.
 * Amount, status and admin identity from the browser are never used.
 */
export class DepositBatchService {
  constructor(
    private prisma: PrismaClient,
    private prices: PriceSourceWithMeta,
    private resolveChain: (chain: string) => Promise<ChainConfig>,
    private prove: ProveFn = (config, txHash, asset, options) => proveTransfer(config, txHash, asset, options),
  ) {}

  private async packageRows(userId: string, chain: string, asset: string) {
    return this.prisma.deposit.findMany({
      where: { userId, chain, asset: asset.toUpperCase(), status: { not: 'CREDITED' }, batchId: null },
      orderBy: { id: 'asc' }, include: { user: { select: { email: true } } },
    });
  }

  async preview(params: { userId: string; chain: string; asset: string }): Promise<PackagePreview> {
    const asset = params.asset.toUpperCase();
    const [rows, user, balance] = await Promise.all([
      this.packageRows(params.userId, params.chain, asset),
      this.prisma.user.findUnique({ where: { id: params.userId }, select: { email: true } }),
      this.prisma.balance.findUnique({ where: { userId_asset: { userId: params.userId, asset } } }),
    ]);
    const pkg = await buildPackage(params.userId, user?.email ?? null, params.chain, asset, rows, this.prices);
    const available = new BigNumber(balance?.available.toString() ?? '0');
    return { ...pkg, balanceAvailable: available.toFixed(), balanceAfter: available.plus(pkg.total).toFixed() };
  }

  async confirm(params: {
    adminId: string; userId: string; chain: string; asset: string;
    depositIds: string[]; token: string; idempotencyKey: string;
  }): Promise<ConfirmResult> {
    const asset = params.asset.toUpperCase();
    const replay = await this.replay(params);
    if (replay) return replay;

    // 1. The package as it is now must be exactly what was reviewed.
    const rows = await this.packageRows(params.userId, params.chain, asset);
    const min = minConfirmationsFor(params.chain);
    const eligible = rows.filter((r) => isPackageEligible(r, min));
    const ids = [...params.depositIds].sort();
    if (eligible.length === 0) throw new DepositBatchError('EMPTY_PACKAGE', 'Нет подтверждённых переводов для зачисления.');
    if (packageToken(params.userId, params.chain, asset, eligible) !== params.token
      || eligible.map((r) => r.id).sort().join() !== ids.join()) {
      throw new DepositBatchError('PACKAGE_CHANGED', 'Состав пакета изменился. Проверьте его заново.');
    }

    // 2. Minimum, exactly, from stored amounts (fast refusal before any network call).
    const total = sumAmounts(eligible);
    const valuation = await valueInUsd(asset, total, this.prices);
    if (valuation.usd === null) throw new DepositBatchError('PRICE_UNAVAILABLE', 'Нет актуальной цены актива — минимум не может быть проверен.');
    if (!meetsMinimum(valuation.usd)) {
      throw new DepositBatchError('BELOW_MINIMUM', `Сумма пакета ниже минимума ${MIN_DEPOSIT_USD} USD. Зачисление недоступно.`);
    }

    // 3. Re-prove every transfer on chain. No DB transaction is open here.
    let config: ChainConfig;
    try { config = await this.resolveChain(params.chain); }
    catch { throw new DepositBatchError('CHAIN_UNAVAILABLE', 'Сеть не настроена.'); }
    const proofs = new Map<string, { proof: TransferProof; at: number }>();
    for (const row of eligible) {
      let proof: TransferProof;
      try {
        const recipient = await recipientFor(this.prisma, config, row.recipientAddress);
        proof = await this.prove(config, row.txHash, asset, { recipient });
        assertSaneProof(proof);
      } catch (error) {
        if (error instanceof ProviderUnavailableError || !(error instanceof DepositVerificationError)) {
          throw new DepositBatchError('PROVIDER_UNAVAILABLE', 'Проверка сети сейчас недоступна. Ничего не зачислено — повторите позже.', { txHash: row.txHash });
        }
        throw new DepositBatchError('PROOF_FAILED', `Перевод ${row.txHash} не подтверждён сетью: ${error.message}`, { txHash: row.txHash });
      }
      const problems = [
        !proof.amount.isEqualTo(row.amount.toString()) && 'сумма в сети отличается от записанной',
        proof.confirmations < min && `подтверждений ${proof.confirmations} из ${min}`,
        !proof.finalized && 'блок ещё не окончательный',
      ].filter(Boolean);
      if (problems.length) {
        throw new DepositBatchError('PROOF_FAILED', `Перевод ${row.txHash}: ${problems.join(', ')}.`, { txHash: row.txHash });
      }
      proofs.set(row.id, { proof, at: Date.now() });
    }

    // 4. Atomic credit.
    try {
      return await this.prisma.$transaction(async (tx) => this.credit(tx, params, asset, eligible, proofs, total, valuation), {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 20_000,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const again = await this.replay(params);
        if (again) return again;
      }
      throw error;
    }
  }

  private async credit(
    tx: Prisma.TransactionClient, params: Parameters<DepositBatchService['confirm']>[0], asset: string,
    eligible: Deposit[], proofs: Map<string, { proof: TransferProof; at: number }>, total: BigNumber,
    valuation: Awaited<ReturnType<typeof valueInUsd>>,
  ): Promise<ConfirmResult> {
    const admin = await tx.user.findUnique({ where: { id: params.adminId }, select: { role: true } });
    if (admin?.role !== 'ADMIN') throw new DepositBatchError('NOT_ADMIN', 'Admin access required');

    // Stable lock order: every competing confirm/attribution queues here.
    const ids = eligible.map((r) => r.id).sort();
    await tx.$queryRaw`SELECT id FROM "Deposit" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
    // A same-key request that committed while we waited for the locks.
    const replayed = await this.replay(params, tx);
    if (replayed) return replayed;

    const locked = await tx.deposit.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
    const byId = new Map(eligible.map((r) => [r.id, r]));
    for (const row of locked) {
      const seen = byId.get(row.id)!;
      if (row.status === 'CREDITED' || row.batchId) throw new DepositBatchError('ALREADY_CREDITED', 'Этот пакет уже зачислен.');
      if (row.revision !== seen.revision || row.userId !== params.userId || row.verifyError) {
        throw new DepositBatchError('PACKAGE_CHANGED', 'Состав пакета изменился. Проверьте его заново.');
      }
      const proof = proofs.get(row.id);
      if (!proof || Date.now() - proof.at > DEPOSIT_PROOF_MAX_AGE_MS) throw new DepositBatchError('PROOF_STALE', 'Проверка сети устарела. Повторите.');
    }
    if (locked.length !== ids.length) throw new DepositBatchError('PACKAGE_CHANGED', 'Состав пакета изменился. Проверьте его заново.');
    // The package must still be exactly this set: nothing new slipped in.
    const current = await tx.deposit.findMany({
      where: { userId: params.userId, chain: params.chain, asset, status: { not: 'CREDITED' }, batchId: null },
      select: { id: true, revision: true, amount: true, status: true, verifiedAt: true, finalized: true, verifyError: true, confirmations: true, userId: true, batchId: true, chain: true, asset: true },
    });
    const min = minConfirmationsFor(params.chain);
    const stillEligible = current.filter((r) => isPackageEligible(r as Deposit, min));
    if (packageToken(params.userId, params.chain, asset, stillEligible) !== params.token) {
      throw new DepositBatchError('PACKAGE_CHANGED', 'Состав пакета изменился. Проверьте его заново.');
    }

    const now = new Date();
    const amount = total.toFixed();
    const batch = await tx.depositBatch.create({ data: {
      userId: params.userId, chain: params.chain, asset, totalAmount: amount, depositCount: ids.length,
      usdValue: valuation.usd!.toFixed(), usdPolicy: valuation.policy!, priceUsd: valuation.priceUsd?.toFixed() ?? null,
      pricedAt: valuation.pricedAt, approvedByAdminId: params.adminId, idempotencyKey: params.idempotencyKey,
    } });
    for (const row of locked) {
      const { proof } = proofs.get(row.id)!;
      const updated = await tx.deposit.updateMany({
        where: { id: row.id, status: { not: 'CREDITED' }, batchId: null, revision: row.revision },
        data: { status: 'CREDITED', batchId: batch.id, creditedAt: now, confirmations: proof.confirmations,
          finalized: proof.finalized, verifiedAt: new Date(proofs.get(row.id)!.at), revision: { increment: 1 } },
      });
      if (updated.count !== 1) throw new DepositBatchError('PACKAGE_CHANGED', 'Состав пакета изменился. Проверьте его заново.');
    }
    await tx.balance.upsert({
      where: { userId_asset: { userId: params.userId, asset } },
      create: { userId: params.userId, asset, available: amount, locked: '0' },
      update: { available: { increment: amount } },
    });
    for (const row of locked) {
      await tx.auditLog.create({ data: { userId: params.userId, action: 'DEPOSIT_CREDITED', metadata: {
        depositId: row.id, txHash: row.txHash, chain: row.chain, asset, amount: new BigNumber(row.amount.toString()).toFixed(),
        batchId: batch.id, performedByAdminId: params.adminId, manual: true,
      } } });
    }
    await tx.auditLog.create({ data: { userId: params.userId, action: 'DEPOSIT_BATCH_CREDITED', metadata: {
      batchId: batch.id, chain: params.chain, asset, totalAmount: amount, depositIds: ids,
      usdValue: valuation.usd!.toFixed(), usdPolicy: valuation.policy, priceUsd: valuation.priceUsd?.toFixed() ?? null,
      pricedAt: valuation.pricedAt?.toISOString() ?? null, performedByAdminId: params.adminId,
    } } });

    // Existing referral policy, per credited transfer (ReferralReward.depositId is unique).
    const depositor = await tx.user.findUnique({ where: { id: params.userId }, select: { referredById: true } });
    if (depositor?.referredById) {
      let rewardTotal = new BigNumber(0);
      for (const row of locked) {
        const reward = new BigNumber(row.amount.toString()).times(REFERRAL_REWARD_PERCENT).dividedBy(100);
        rewardTotal = rewardTotal.plus(reward);
        await tx.referralReward.create({ data: { referrerId: depositor.referredById, referredUserId: params.userId,
          depositId: row.id, asset, amount: reward.toFixed() } });
        await tx.auditLog.create({ data: { userId: depositor.referredById, action: 'REFERRAL_REWARD_CREDITED',
          metadata: { referredUserId: params.userId, depositId: row.id, batchId: batch.id, asset, amount: reward.toFixed() } } });
      }
      await tx.balance.upsert({
        where: { userId_asset: { userId: depositor.referredById, asset } },
        create: { userId: depositor.referredById, asset, available: rewardTotal.toFixed(), locked: '0' },
        update: { available: { increment: rewardTotal.toFixed() } },
      });
    }
    return { status: 'CREDITED', batchId: batch.id, userId: params.userId, chain: params.chain, asset,
      totalAmount: amount, depositIds: ids, replayed: false };
  }

  /** Same idempotency key again (double click, retry after timeout): the
   * first result, with no second effect. A key reused for another package
   * is refused. */
  private async replay(params: { idempotencyKey: string; userId: string; chain: string; asset: string },
    db: PrismaClient | Prisma.TransactionClient = this.prisma): Promise<ConfirmResult | null> {
    const batch = await db.depositBatch.findUnique({ where: { idempotencyKey: params.idempotencyKey }, include: { deposits: { select: { id: true } } } });
    if (!batch) return null;
    if (batch.userId !== params.userId || batch.chain !== params.chain || batch.asset !== params.asset.toUpperCase()) {
      throw new DepositBatchError('IDEMPOTENCY_MISMATCH', 'Ключ подтверждения уже использован для другого пакета.');
    }
    return { status: 'CREDITED', batchId: batch.id, userId: batch.userId, chain: batch.chain, asset: batch.asset,
      totalAmount: new BigNumber(batch.totalAmount.toString()).toFixed(), depositIds: batch.deposits.map((d) => d.id).sort(), replayed: true };
  }
}
