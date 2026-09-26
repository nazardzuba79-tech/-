import { PrismaClient, Prisma } from '@prisma/client';
import { isPackageEligible } from './depositPolicy';
import { minConfirmationsFor } from './DepositQueueService';

export const IGNORE_REASONS = ['HISTORICAL_WALLET_OPERATION', 'OWN_TRANSFER', 'NOT_CLIENT_DEPOSIT', 'OTHER'] as const;
export type IgnoreReason = (typeof IGNORE_REASONS)[number];

export class DepositIgnoreError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'NOT_ADMIN' | 'CREDITED' | 'IN_PACKAGE' | 'CONFIRM_ASSIGNED' | 'NOTE_REQUIRED' | 'NOT_IGNORED' | 'ALREADY_IGNORED' | 'DELETED_ACCOUNT',
    message: string) { super(message); }
}

/**
 * «Игнорировать» / «Вернуть в очередь». The transfer row is never deleted and
 * its amount, hash, asset, chain, owner and timestamps are never changed;
 * only the ignore fields (who, why, when) and the revision are written, plus
 * an audit entry. An ignored transfer leaves the working queue and can never
 * join a package, become ready or be credited. No balance is touched.
 *
 * Safety:
 *   - a CREDITED (or batched) transfer cannot be ignored;
 *   - an attributed transfer that is part of its owner's active package
 *     cannot be ignored: detach it first («Привязать» → none), audited;
 *   - any other attributed transfer needs an explicit `confirmAssigned`.
 * The row lock serializes against attribution and package confirmation; the
 * revision bump invalidates any preview that saw the transfer.
 */
export class DepositIgnoreService {
  constructor(private prisma: PrismaClient) {}

  async ignore(params: { adminId: string; depositId: string; reason: IgnoreReason; note?: string | null; confirmAssigned?: boolean }) {
    const note = params.note?.trim().slice(0, 300) || null;
    if (params.reason === 'OTHER' && !note) throw new DepositIgnoreError('NOTE_REQUIRED', 'Укажите причину.');
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, params.adminId, params.depositId);
      if (row.status === 'CREDITED' || row.batchId) throw new DepositIgnoreError('CREDITED', 'Зачисленный перевод нельзя игнорировать.');
      if (row.ignoredAt) throw new DepositIgnoreError('ALREADY_IGNORED', 'Перевод уже в «Игнорированные».');
      if (row.userId) {
        if (isPackageEligible(row, minConfirmationsFor(row.chain))) {
          throw new DepositIgnoreError('IN_PACKAGE', 'Перевод входит в пакет пользователя. Сначала отвяжите его от пользователя.');
        }
        if (!params.confirmAssigned) {
          throw new DepositIgnoreError('CONFIRM_ASSIGNED', 'Перевод привязан к пользователю. Подтвердите игнорирование.');
        }
      }
      const now = new Date();
      await tx.deposit.update({ where: { id: row.id }, data: {
        ignoredAt: now, ignoredReason: params.reason, ignoredNote: note, ignoredByAdminId: params.adminId, revision: { increment: 1 },
      } });
      // Keep the legacy incoming-feed filter in step.
      await tx.ignoredIncomingTransfer.upsert({ where: { chain_txHash: { chain: row.chain, txHash: row.txHash } },
        create: { chain: row.chain, txHash: row.txHash }, update: {} });
      await tx.auditLog.create({ data: { userId: row.userId, action: 'DEPOSIT_IGNORED', metadata: {
        depositId: row.id, chain: row.chain, txHash: row.txHash, asset: row.asset, amount: row.amount.toString(),
        reason: params.reason, note, ownerUserId: row.userId, performedByAdminId: params.adminId,
      } as Prisma.InputJsonObject } });
      return { depositId: row.id, ignoredAt: now.toISOString(), reason: params.reason };
    });
  }

  async restore(params: { adminId: string; depositId: string }) {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.lock(tx, params.adminId, params.depositId);
      if (!row.ignoredAt) throw new DepositIgnoreError('NOT_IGNORED', 'Перевод не в «Игнорированные».');
      await tx.deposit.update({ where: { id: row.id }, data: {
        ignoredAt: null, ignoredReason: null, ignoredNote: null, ignoredByAdminId: null, revision: { increment: 1 },
      } });
      await tx.ignoredIncomingTransfer.deleteMany({ where: { chain: row.chain, txHash: row.txHash } });
      await tx.auditLog.create({ data: { userId: row.userId, action: 'DEPOSIT_IGNORE_RESTORED', metadata: {
        depositId: row.id, chain: row.chain, txHash: row.txHash, asset: row.asset, amount: row.amount.toString(),
        previousReason: row.ignoredReason, previousNote: row.ignoredNote, ignoredAt: row.ignoredAt.toISOString(),
        ignoredByAdminId: row.ignoredByAdminId, performedByAdminId: params.adminId,
      } as Prisma.InputJsonObject } });
      return { depositId: row.id, restored: true };
    });
  }

  private async lock(tx: Prisma.TransactionClient, adminId: string, depositId: string) {
    const admin = await tx.user.findUnique({ where: { id: adminId }, select: { role: true } });
    if (admin?.role !== 'ADMIN') throw new DepositIgnoreError('NOT_ADMIN', 'Admin access required');
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Deposit" WHERE id = ${depositId} FOR UPDATE`;
    if (locked.length === 0) throw new DepositIgnoreError('NOT_FOUND', 'Перевод не найден.');
    const row = await tx.deposit.findUniqueOrThrow({ where: { id: depositId } });
    if (row.deletedUserId) throw new DepositIgnoreError('DELETED_ACCOUNT', 'Перевод удалённого аккаунта сохранён только для истории.');
    return row;
  }
}
