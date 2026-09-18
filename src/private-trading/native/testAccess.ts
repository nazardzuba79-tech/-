import type { PrismaClient, Prisma } from '@prisma/client';
import { assertOwner, privateTradingConfig, type PrivateTradingConfig } from '../access';
import { PrivateTradingError, type OwnerSession } from '../serviceTypes';
import { isNativeTestAccount } from './testAccounts';

/** Native-only permission for an explicitly configured USER. It is NOT an
 * admin role and does not broaden the legacy private-trading owner gate. */
export async function assertNativeTrader(
  db: PrismaClient | Prisma.TransactionClient,
  actor: OwnerSession,
  config: () => PrivateTradingConfig = privateTradingConfig,
  now = Date.now(),
): Promise<void> {
  const initial = config();
  // The primary owner must STILL satisfy the existing ADMIN policy, even
  // if someone accidentally duplicates that ID in the tester list.
  if (actor.userId === initial.ownerId || !isNativeTestAccount(actor.userId)) {
    return assertOwner(db, actor, config, now);
  }
  const denied = () => new PrivateTradingError('private_access_denied', 'Режим недоступен', 403);
  if (!initial.enabled || !initial.ownerId) throw denied();
  if (!actor.sessionId || !Number.isFinite(actor.expiresAt) || actor.expiresAt <= now) {
    throw new PrivateTradingError('session_expired', 'Войдите в аккаунт повторно', 401);
  }
  const [user, session] = await Promise.all([
    db.user.findUnique({ where: { id: actor.userId }, select: { role: true, blockedAt: true } }),
    db.session.findUnique({ where: { id: actor.sessionId }, select: { userId: true, revokedAt: true } }),
  ]);
  if (!user || user.role !== 'USER' || user.blockedAt || !session || session.revokedAt || session.userId !== actor.userId) throw denied();
  const final = config();
  if (!final.enabled || final.ownerId !== initial.ownerId || !isNativeTestAccount(actor.userId)) throw denied();
  if (actor.expiresAt <= Math.max(now, Date.now())) {
    throw new PrivateTradingError('session_expired', 'Войдите в аккаунт повторно', 401);
  }
}
