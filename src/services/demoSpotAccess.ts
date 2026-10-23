import type { Prisma, PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { isTestAssetPairOrSymbol } from './testMarkets/testAssetConfig';

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

/**
 * The demo-funds withdrawal guard. A Cross trading account (the pinned owner,
 * PRIVATE_TRADING_TEST_USER_IDS) is valued from the native demo ledger, and on
 * main it may file an unheld withdrawal request (`balanceHeld: false`) that an
 * admin then approves and pays by hand. With the guard on, such an account
 * files nothing (`/withdrawals/options` lists nothing, `POST /withdrawals` is
 * 403), and no unheld request — including PENDING/APPROVED ones filed before —
 * can be approved or marked sent; it can still be rejected. Nothing is
 * cancelled or rewritten automatically.
 *
 * Off by default: with every demo feature off, withdrawals behave exactly as on
 * main. Its own switch is `DEMO_WITHDRAWAL_GUARD_ENABLED=true`, and it is
 * forced on — it cannot be switched off — while `DEMO_SPOT_ENABLED` is on,
 * because Demo Spot lets demo funds change by trading: demo funds traded here
 * never become a payable claim. Requests that hold `Balance` are never
 * affected.
 */
export const demoWithdrawalGuardEnabled = (env: NodeJS.ProcessEnv = process.env) =>
  env.DEMO_WITHDRAWAL_GUARD_ENABLED === 'true' || demoSpotEnabled(env);

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

/**
 * Which ledger the ordinary Spot terminal uses for this account.
 *
 * - 'spot': the ordinary Spot ledger, exactly as before. Always with the flag
 *   off; with it on, for every account that holds ordinary `Balance` funds
 *   (any non-test asset, available or reserved) — so an account an admin
 *   funded through a Balance adjustment keeps trading as it did. Nothing is
 *   moved or migrated between ledgers.
 * - 'demo': no ordinary funds, and admitted to demo Spot (see demoSpotRole).
 * - 'none': neither — the terminal sends nothing (silent no-op).
 */
export type DemoSpotLedger = 'spot' | 'demo' | 'none';

export async function demoSpotLedger(
  db: PrismaClient | Prisma.TransactionClient, userId: string, enabled = demoSpotEnabled(),
): Promise<DemoSpotLedger> {
  if (!enabled) return 'spot';
  const funded = await db.balance.findMany({ where: { userId, OR: [{ available: { gt: 0 } }, { locked: { gt: 0 } }] }, select: { asset: true, available: true, locked: true } });
  if (funded.some(b => !isTestAssetPairOrSymbol(b.asset) && new BigNumber(b.available.toString()).plus(b.locked.toString()).gt(0))) return 'spot';
  return (await demoSpotRole(db, userId, true)) ? 'demo' : 'none';
}
