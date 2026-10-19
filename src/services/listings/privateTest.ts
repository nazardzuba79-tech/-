/**
 * HISTORY20 PRIVATE TEST (owner decision, 2026-10-19, PR #544).
 *
 * The first History20 listings are traded privately: by the verified owner
 * and the server's allowlisted testers only, on the EXISTING Spot path
 * (orders, matching, conditional triggers, the owner's simulation sale), at
 * the listing's own model price. Nothing here is a second engine or wallet.
 *
 * The isolation is the quote. A private market is `<SYMBOL>/SIMUSDT`, never
 * `<SYMBOL>/USDT`: every fill, every simulation sale and every conditional
 * fill settles in the `SIMUSDT` row of the ordinary Spot `Balance` table.
 * SIMUSDT is a restricted test asset (testAssetConfig): it cannot be
 * withdrawn, deposited, adjusted, transferred, used as collateral, priced in
 * USD or traded on any other pair. So profit made at a model price can never
 * become withdrawable USDT, and no USDT row moves. Legacy NRX/AITH keep
 * their `/USDT` pairs and every existing rule.
 *
 * Default off: Render loads, serves and trades private tests only with
 * HISTORY20_PRIVATE_TEST=enabled. The rights gate is untouched — a window is
 * never published (HISTORICAL_RIGHTS_UNVERIFIED), and its private market is
 * never served by the public catalogue or the public edge.
 */
import type { PrismaClient } from '@prisma/client';
import { isNativeTestAccount } from '../../private-trading/native/testAccounts';
import { privateTradingConfig, type PrivateTradingConfig } from '../../private-trading/access';
import { listingSimulationConfig, type ListingConfig } from './listingConfig';
import type { TestAssetConfig } from '../testMarkets/testAssetConfig';

/** The quote of every private History20 market: a demo unit, never USD money. */
export const SIMULATION_QUOTE = 'SIMUSDT' as const;

/** Render serves and trades private tests only when this is exactly `enabled`. */
export function privateTestEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HISTORY20_PRIVATE_TEST === 'enabled';
}

export const privateTestPair = (symbol: string) => `${symbol.toUpperCase()}/${SIMULATION_QUOTE}`;
export const privateTestSlug = (symbol: string) => `${symbol.toUpperCase()}-${SIMULATION_QUOTE}`;

/** The private market's simulation input: the listing's own model, quoted in SIMUSDT. */
export function privateTestSimulationConfig(config: ListingConfig): TestAssetConfig {
  return { ...listingSimulationConfig(config), quote: SIMULATION_QUOTE, pair: privateTestPair(config.symbol), isTradable: false, privateTest: true };
}

/**
 * Who may see and trade a private test: the verified owner (the configured
 * PRIVATE_TRADING_OWNER_ID while private trading is enabled, and an ADMIN) or
 * an allowlisted tester (PRIVATE_TRADING_TEST_USER_IDS) — the same server
 * identities the existing simulation sale admits — and never a blocked
 * account. Not every ADMIN, never a client claim.
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
