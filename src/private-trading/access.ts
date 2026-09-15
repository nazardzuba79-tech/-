import type { PrismaClient, Prisma } from '@prisma/client';
import type { OwnerSession } from './serviceTypes';
import { PrivateTradingError } from './serviceTypes';

export interface PrivateTradingConfig { enabled: boolean; ownerId: string }
export const privateTradingConfig = (): PrivateTradingConfig => ({
  enabled: process.env.PRIVATE_TRADING_ENABLED === 'true',
  ownerId: process.env.PRIVATE_TRADING_OWNER_ID?.trim() ?? '',
});
/** Owner ID is pinned through deployment configuration, never supplied by the client. */
export async function assertOwner(
  db: PrismaClient | Prisma.TransactionClient, actor: OwnerSession,
  config: () => PrivateTradingConfig = privateTradingConfig, now = Date.now(),
): Promise<void> {
  const current = config();
  if (!current.enabled || !current.ownerId || actor.userId !== current.ownerId) {
    throw new PrivateTradingError('private_access_denied', 'Режим недоступен', 403);
  }
  if (!actor.sessionId || !Number.isFinite(actor.expiresAt) || actor.expiresAt <= now) {
    throw new PrivateTradingError('session_expired', 'Войдите в аккаунт повторно', 401);
  }
  const [user, session] = await Promise.all([
    db.user.findUnique({ where: { id: actor.userId }, select: { role: true, blockedAt: true } }),
    db.session.findUnique({ where: { id: actor.sessionId }, select: { userId: true, revokedAt: true } }),
  ]);
  if (!user || user.role !== 'ADMIN' || user.blockedAt || !session || session.revokedAt || session.userId !== actor.userId) {
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
 * SIMULATION-ONLY ACCOUNTS.
 *
 * The pinned owner trades against the NativeDemo engine and nothing else.
 * That is a SERVER policy, not a UI mode: the account has no Real/Demo
 * switch to flip and no query parameter to drop, so the only place the
 * distinction can live is here. Editing the frontend or hand-crafting a
 * request must not let this account reach the real matching engine, touch
 * a real wallet or futures balance, or rest an order in the public book.
 *
 * It reads the SAME pinned configuration `assertOwner` does — one source,
 * so the account that is allowed into the simulation is exactly the
 * account refused by the real trading routes. Deliberately synchronous and
 * database-free: it is a policy lookup, so it can guard a route before any
 * work happens, and it cannot fail open on a database error.
 *
 * Every other user is unaffected; this returns false for them.
 */
export function isSimulationOnlyUser(
  userId: string | undefined | null,
  config: () => PrivateTradingConfig = privateTradingConfig,
): boolean {
  const current = config();
  return Boolean(current.enabled && current.ownerId && userId && userId === current.ownerId);
}
