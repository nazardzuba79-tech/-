/**
 * HISTORY20 PRIVATE SPOT TEST (owner decision 2026-10-19 on PR #544; SIMUSDT
 * settlement approved on PR #551). Default off. Wired into the Spot gate and
 * OrderService (admission before and inside every financial transaction),
 * the private listing channel (Worker DO → Render registry only), the
 * one-time funding (privateTestFunding.ts) and the authenticated private
 * reads (api/routes/privateTestMarkets.ts):
 *
 * - the private market is `<SYMBOL>/SIMUSDT`: every fill and the owner's
 *   simulation sale settle in the restricted `SIMUSDT` row of the ordinary
 *   Spot `Balance` table (no new wallet, no schema change), which every
 *   withdrawal, deposit, adjustment, transfer, purchase, collateral and
 *   valuation path already refuses, and the window asset trades on no other
 *   pair (testAssetConfig.isSimulationSettled);
 * - a reserved ticker (VHX01…VHX99): those guards hold without the listing
 *   registry, while the listing is cold, stale, withheld or unpublished;
 * - exact admission: the verified owner and the allowlisted testers only;
 * - default off (HISTORY20_PRIVATE_TEST=enabled), and a window is never
 *   published (HISTORICAL_RIGHTS_UNVERIFIED stays in checkPublishable).
 *
 * The owner approved SIMUSDT as the settlement design (2026-10-19, PR #551),
 * not its activation. Wiring it (a private channel in the listings store,
 * the per-user Spot gate, the terminal, test funding) is a separate step.
 */
import type { PrismaClient } from '@prisma/client';
import { isNativeTestAccount } from '../../private-trading/native/testAccounts';
import { privateTradingConfig, type PrivateTradingConfig } from '../../private-trading/access';
import { listingSimulationConfig, ListingValidationError, PRIVATE_TEST_SYMBOL_MESSAGE, type ListingConfig } from './listingConfig';
import { SIMULATION_QUOTE, type TestAssetConfig } from '../testMarkets/testAssetConfig';
import { isHistory20PrivateSymbol } from '../../shared/history20PrivateSymbol';

export { SIMULATION_QUOTE };

/** Off unless exactly `enabled` (Render; the Worker has its own switch of the same name). */
export function privateTestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HISTORY20_PRIVATE_TEST === 'enabled';
}

export const privateTestPair = (symbol: string) => `${symbol.toUpperCase()}/${SIMULATION_QUOTE}`;

/**
 * The private market's simulation input: the listing's own model (same prices
 * and candles), quoted in SIMUSDT. Only for a reserved ticker (VHX01…VHX99),
 * which the guards recognise even when the registry does not know the listing.
 */
export function privateTestSimulationConfig(config: ListingConfig): TestAssetConfig {
  if (!isHistory20PrivateSymbol(config.symbol)) throw new ListingValidationError('PRIVATE_TEST_SYMBOL', PRIVATE_TEST_SYMBOL_MESSAGE);
  return { ...listingSimulationConfig(config), quote: SIMULATION_QUOTE, pair: privateTestPair(config.symbol), isTradable: false, privateTest: true };
}

/**
 * Who would be admitted: the verified owner (the configured
 * PRIVATE_TRADING_OWNER_ID while private trading is enabled, an ADMIN) or an
 * allowlisted tester (PRIVATE_TRADING_TEST_USER_IDS) — never another ADMIN,
 * an ordinary user or a blocked account, and never a client claim.
 */
export async function isPrivateTestParticipant(
  db: Pick<PrismaClient, 'user'>,
  userId: string | null | undefined,
  config: () => PrivateTradingConfig = privateTradingConfig,
): Promise<boolean> {
  if (!userId) return false;
  const current = config();
  const owner = current.enabled && !!current.ownerId && userId === current.ownerId;
  if (!owner && !isNativeTestAccount(userId)) return false;
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, blockedAt: true } });
  if (!user || user.blockedAt) return false;
  return owner ? user.role === 'ADMIN' : true;
}

/**
 * Whether this account may trade, be funded or read a private test market now:
 * the mode is on and it is a verified participant (database-checked). Callers
 * check it before and again inside any financial transaction.
 */
export async function privateTestAdmitted(db: Pick<PrismaClient, 'user'>, userId: string | null | undefined): Promise<boolean> {
  return privateTestEnabled() && await isPrivateTestParticipant(db, userId);
}
