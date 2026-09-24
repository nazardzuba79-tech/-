import type { PrismaClient, Prisma } from '@prisma/client';
import type { OwnerSession } from './serviceTypes';
import { PrivateTradingError } from './serviceTypes';
import { isNativeTestAccount } from './native/testAccounts';

/** One MVCC read for the two facts needed by native command authorization. */
export async function nativeAccessRow(db: PrismaClient | Prisma.TransactionClient, userId: string, sessionId: string) {
  const rows = await db.$queryRaw<Array<{role: string; blockedAt: Date | null; sessionUserId: string | null; revokedAt: Date | null}>>`
    SELECT u."role", u."blockedAt", s."userId" AS "sessionUserId", s."revokedAt"
    FROM "User" u LEFT JOIN "Session" s ON s."id" = ${sessionId}
    WHERE u."id" = ${userId}`;
  return rows[0] ?? null;
}

export interface PrivateTradingConfig { enabled: boolean; ownerId: string }
export const privateTradingConfig = (): PrivateTradingConfig => ({
  enabled: process.env.PRIVATE_TRADING_ENABLED === 'true',
  ownerId: process.env.PRIVATE_TRADING_OWNER_ID?.trim() ?? '',
});
/** Owner ID is pinned through deployment configuration, never supplied by the client. */
export async function assertOwner(
  db: PrismaClient | Prisma.TransactionClient, actor: OwnerSession,
  config: () => PrivateTradingConfig = privateTradingConfig, now = Date.now(), nativeCommand = false,
): Promise<void> {
  const current = config();
  if (!current.enabled || !current.ownerId || actor.userId !== current.ownerId) {
    throw new PrivateTradingError('private_access_denied', 'Режим недоступен', 403);
  }
  if (!actor.sessionId || !Number.isFinite(actor.expiresAt) || actor.expiresAt <= now) {
    throw new PrivateTradingError('session_expired', 'Войдите в аккаунт повторно', 401);
  }
  const authorized = nativeCommand
    ? await nativeAccessRow(db, actor.userId, actor.sessionId).then(row => !!row && row.role === 'ADMIN' && !row.blockedAt && !row.revokedAt && row.sessionUserId === actor.userId)
    : await Promise.all([
      db.user.findUnique({ where: { id: actor.userId }, select: { role: true, blockedAt: true } }),
      db.session.findUnique({ where: { id: actor.sessionId }, select: { userId: true, revokedAt: true } }),
    ]).then(([user, session]) => !!user && user.role === 'ADMIN' && !user.blockedAt && !!session && !session.revokedAt && session.userId === actor.userId);
  if (!authorized) {
    throw new PrivateTradingError('private_access_denied', 'Режим недоступен', 403);
  }
  // Configuration/session lifetime can change while the database reads wait.
  const finalConfig = config();
  if (!finalConfig.enabled || finalConfig.ownerId !== actor.userId) {
    throw new PrivateTradingError('private_access_denied', 'Режим недоступен', 403);
  }
  if (actor.expiresAt <= Math.max(now, Date.now())) {
    throw new PrivateTradingError('session_expired', 'Войдите в аккаунт повторно', 401);
  }
}

/**
 * SERVER policy: the primary owner and explicitly configured native testers
 * cannot enter the real Futures engine. A tester stays fenced when the
 * native feature is temporarily disabled; disabling testing is not consent
 * to route their next order into the real ledger. No client flag or role
 * claim can opt an account into or out of this policy.
 *
 * The original primary-owner policy is preserved. Every unlisted ordinary
 * user is unaffected. Native tester access itself is separately authenticated
 * by assertNativeTrader and never grants ADMIN or legacy-owner permissions.
 */
export function isSimulationOnlyUser(
  userId: string | undefined | null,
  config: () => PrivateTradingConfig = privateTradingConfig,
): boolean {
  const current = config();
  return isNativeTestAccount(userId) || Boolean(current.enabled && current.ownerId && userId && userId === current.ownerId);
}
