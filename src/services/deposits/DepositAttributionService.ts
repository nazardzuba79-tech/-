import { PrismaClient, Prisma } from '@prisma/client';

export class DepositAttributionError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'CREDITED' | 'ALREADY_ATTRIBUTED' | 'USER_NOT_FOUND' | 'NOT_ADMIN', message: string) { super(message); }
}

/**
 * «Привязать к пользователю»: an admin states who owns a transfer.
 * Never credits, never touches a balance. Every change is audited with the
 * previous owner. A credited (or batched) transfer can never be re-assigned,
 * and moving an already attributed transfer requires an explicit `reassign`.
 * The row lock serializes this against a concurrent package confirmation;
 * the revision bump invalidates any preview that included the transfer.
 */
export class DepositAttributionService {
  constructor(private prisma: PrismaClient) {}

  async attribute(params: { adminId: string; depositId: string; userId: string | null; reassign?: boolean }) {
    return this.prisma.$transaction(async (tx) => {
      const admin = await tx.user.findUnique({ where: { id: params.adminId }, select: { role: true } });
      if (admin?.role !== 'ADMIN') throw new DepositAttributionError('NOT_ADMIN', 'Admin access required');
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Deposit" WHERE id = ${params.depositId} FOR UPDATE`;
      if (locked.length === 0) throw new DepositAttributionError('NOT_FOUND', 'Перевод не найден.');
      const row = await tx.deposit.findUniqueOrThrow({ where: { id: params.depositId } });
      if (row.status === 'CREDITED' || row.batchId) throw new DepositAttributionError('CREDITED', 'Зачисленный перевод нельзя перепривязать.');
      if (row.userId === params.userId) return { depositId: row.id, userId: row.userId, changed: false };
      if (row.userId && !params.reassign) {
        throw new DepositAttributionError('ALREADY_ATTRIBUTED', 'Перевод уже привязан к другому пользователю. Подтвердите перепривязку.');
      }
      if (params.userId) {
        const target = await tx.user.findUnique({ where: { id: params.userId }, select: { id: true } });
        if (!target) throw new DepositAttributionError('USER_NOT_FOUND', 'Пользователь не найден.');
      }
      await tx.deposit.update({ where: { id: row.id }, data: { userId: params.userId, revision: { increment: 1 } } });
      await tx.auditLog.create({ data: { userId: params.userId ?? row.userId, action: 'DEPOSIT_ATTRIBUTED', metadata: {
        depositId: row.id, chain: row.chain, txHash: row.txHash, asset: row.asset,
        fromUserId: row.userId, toUserId: params.userId, performedByAdminId: params.adminId,
      } as Prisma.InputJsonObject } });
      return { depositId: row.id, userId: params.userId, changed: true };
    });
  }
}
