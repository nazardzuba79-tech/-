import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Who may trade Spot on the demo ledger (DemoBalance / DemoOrder / DemoTrade).
 *
 * - ADMIN: as before this module existed, independent of the flag.
 * - USER: only with `DEMO_SPOT_ENABLED=true` on the server AND an admin demo
 *   credit on record (`DEMO_BALANCE_ADJUSTED`, written only by the admin
 *   `demo-topup` route through DemoTradingService.topUp). Registration, a page
 *   view or a client flag never admits anyone, and nothing here grants funds:
 *   the amount an admitted account can spend is its DemoBalance.
 * - A blocked account (`User.blockedAt`) is refused, also with a live session.
 *
 * DemoBalance has no path to Balance, a withdrawal or a transfer, so what is
 * traded here can never become a real cash-out claim.
 */
export type DemoSpotRole = 'admin' | 'trader';

export const demoSpotEnabled = (env: NodeJS.ProcessEnv = process.env) => env.DEMO_SPOT_ENABLED === 'true';

export async function demoSpotRole(
  db: PrismaClient | Prisma.TransactionClient, userId: string, enabled = demoSpotEnabled(),
): Promise<DemoSpotRole | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, blockedAt: true } });
  if (!user || user.blockedAt) return null;
  if (user.role === 'ADMIN') return 'admin';
  if (!enabled || user.role !== 'USER') return null;
  const credit = await db.auditLog.findFirst({ where: { userId, action: 'DEMO_BALANCE_ADJUSTED' }, select: { id: true } });
  return credit ? 'trader' : null;
}
