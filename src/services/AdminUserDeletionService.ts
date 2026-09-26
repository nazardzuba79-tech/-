import { Prisma, PrismaClient } from '@prisma/client';
import { MatchingEngine } from '../matching-engine/MatchingEngine';
import { AccountDeletionGate } from './AccountDeletionGate';

export class UserDeletionError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type Books = { spot: MatchingEngine; futures: MatchingEngine; demo: MatchingEngine };

export class AdminUserDeletionService {
  constructor(private prisma: PrismaClient, private gate: AccountDeletionGate, private books: Books) {}

  async delete(adminId: string, userId: string) {
    return this.gate.run(true, async () => {
      let transactionId: string | undefined;
      let prepared: { spot: { id: string; pair: string }[]; futures: { id: string; symbol: string }[]; demo: { id: string; pair: string }[] } | undefined;
      let commitError: unknown;
      try {
        await this.prisma.$transaction(async tx => {
          // Same lock as FuturesBookTransaction, before user/balance locks.
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('futures-book', 0))::text`;
          const users = await tx.$queryRaw<{ id: string; email: string; role: string }[]>`
            SELECT id, email, role FROM "User" WHERE id IN (${adminId}, ${userId}) ORDER BY id FOR UPDATE`;
          const admin = users.find(u => u.id === adminId);
          if (admin?.role !== 'ADMIN') throw new UserDeletionError(403, 'Admin access required');
          const target = users.find(u => u.id === userId);
          if (!target) throw new UserDeletionError(404, 'Пользователь не найден.');
          if (target.role !== 'USER' || target.id === adminId || target.email.trim().toLowerCase() === 'voltex.crypto@gmail.com') {
            throw new UserDeletionError(403, 'Удаление защищённого аккаунта запрещено.');
          }
          const audit = await tx.auditLog.create({ data: { userId: null, action: 'USER_DELETED', metadata: {
            deletedUserId: userId, deletedUserEmail: target.email, performedByAdminId: adminId, timestamp: new Date().toISOString(),
          } } });
          await tx.$queryRaw`SELECT set_config('voltex.delete_user', ${userId}, true), set_config('voltex.delete_audit', ${audit.id}, true)`;

          const spot = await tx.order.findMany({ where: { userId }, select: { id: true, pair: true } });
          const futures = await tx.futuresOrder.findMany({ where: { userId }, select: { id: true, symbol: true } });
          const demo = await tx.demoOrder.findMany({ where: { userId }, select: { id: true, pair: true } });

          // Conservatively retain every deposit; do not guess that a hash is fake.
          const deposits = await tx.deposit.findMany({ where: { userId }, select: { id: true, chain: true, txHash: true, status: true } });
          for (const deposit of deposits) {
            const credited = deposit.status === 'CREDITED';
            await tx.deposit.update({ where: { id: deposit.id }, data: {
              userId: null, deletedUserId: userId,
              ...(!credited ? { status: 'IGNORED', ignoredReason: 'DELETED_TEST_ACCOUNT', ignoredAt: new Date(), ignoredByAdminId: adminId,
                verifyError: 'DELETED_TEST_ACCOUNT', revision: { increment: 1 } } : {}),
            } });
            if (!credited) await tx.ignoredIncomingTransfer.upsert({
              where: { chain_txHash: { chain: deposit.chain, txHash: deposit.txHash } },
              create: { chain: deposit.chain, txHash: deposit.txHash }, update: {},
            });
          }
          // Lock before classifying so a concurrently recorded real txHash is retained.
          await tx.$queryRaw`SELECT id FROM "Withdrawal" WHERE "userId" = ${userId} FOR UPDATE`;
          await tx.withdrawal.deleteMany({ where: { userId, OR: [{ txHash: null }, { txHash: '' }] } });
          await tx.withdrawal.updateMany({ where: { userId }, data: { userId: null, deletedUserId: userId } });

          for (const table of ['ReferralReward', 'BankingReferralReward']) {
            await tx.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw('"' + table + '"')} SET "deletedReferrerId" = "referrerId", "referrerId" = NULL WHERE "referrerId" = ${userId}`);
            await tx.$executeRaw(Prisma.sql`UPDATE ${Prisma.raw('"' + table + '"')} SET "deletedReferredUserId" = "referredUserId", "referredUserId" = NULL WHERE "referredUserId" = ${userId}`);
          }
          await tx.user.updateMany({ where: { referredById: userId }, data: { referredById: null } });
          await tx.supportConversation.updateMany({ where: { userId }, data: { userId: null } });
          await tx.copyStrategyOwner.updateMany({ where: { ownerUserId: userId }, data: { ownerUserId: null } });

          // Fixed allowlist, child-before-parent order. Native and Banking tables
          // have SQL FKs/triggers outside the Prisma relation graph.
          const tables = ['Session', 'ApiKey', 'EmailVerificationChallenge', 'DepositClaim', 'CardApplication',
            'KycSubmission', 'Purchase', 'PortfolioSnapshot', 'FuturesPositionProtection', 'FundingPayment',
            'FuturesOrder', 'FuturesPosition', 'FuturesBalance', 'CfdPosition', 'Order', 'Balance', 'Wallet',
            'DemoOrder', 'DemoBalance', 'PrivateTradingPreview', 'PrivateTradingCommand', 'PrivateTradingLedger',
            'PrivateTradingCard', 'PrivateTradingAccount', 'NativeDemoLiveProjection', 'NativeDemoRevision', 'NativeDemoAccount'];
          for (const table of tables) await tx.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw('"' + table + '"')} WHERE "userId" = ${userId}`);
          for (const table of ['banking_commands', 'banking_ledger_entries', 'banking_placements']) {
            await tx.$executeRaw(Prisma.sql`DELETE FROM ${Prisma.raw(table)} WHERE user_id = ${userId}`);
          }
          // Shared executions belong to the surviving counterparty too. Their
          // plain historical IDs, like AuditLog/DepositBatch, are not live FKs.
          await tx.trade.deleteMany({ where: { takerUserId: userId, makerUserId: userId } });
          await tx.demoTrade.deleteMany({ where: { takerUserId: userId, makerUserId: userId } });
          await tx.user.delete({ where: { id: userId } });
          const [identity] = await tx.$queryRaw<{ id: string }[]>`SELECT pg_current_xact_id()::text AS id`;
          transactionId = identity.id;
          prepared = { spot, futures, demo };
        }, { maxWait: 10000, timeout: 30000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!transactionId) throw error;
        commitError = error;
      }
      // Do not mutate memory on a deferred-constraint rollback or uncertain COMMIT.
      let outcome: { status: string | null };
      try {
        [outcome] = await this.prisma.$queryRaw<{ status: string | null }[]>`SELECT pg_xact_status(${transactionId}::xid8) AS status`;
        if (!['committed', 'aborted'].includes(outcome?.status ?? '')) throw new Error('Unknown transaction outcome');
      } catch {
        this.gate.haltUntilRestart();
        console.error('ADMIN_DELETE_COMMIT_UNKNOWN: matching paused; restart after database recovery');
        throw new UserDeletionError(503, 'Результат удаления требует проверки администратором. Торговый сервис приостановлен до восстановления.');
      }
      if (outcome.status !== 'committed') throw commitError ?? new UserDeletionError(409, 'Удаление не завершено. Повторите попытку.');
      for (const order of prepared!.spot) this.books.spot.cancelOrder(order.pair, order.id);
      for (const order of prepared!.futures) this.books.futures.cancelOrder(order.symbol, order.id);
      for (const order of prepared!.demo) this.books.demo.cancelOrder(order.pair, order.id);
      return { ok: true };
    });
  }
}
