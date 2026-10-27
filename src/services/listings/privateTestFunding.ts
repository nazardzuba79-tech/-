import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import { checkPrivateTestable, parseListingConfig, type PublishedListing } from './listingConfig';
import { privateTestAdmitted, SIMULATION_QUOTE } from './privateTest';
import { isHistory20PrivateSymbol } from '../../shared/history20PrivateSymbol';

/** One funding per (listing, account), ever. The receipt id is the idempotency key. */
export const privateTestFundingReceiptId = (listingId: string, userId: string) => `history20-funding:${listingId}:${userId}`;

export const PRIVATE_TEST_FUNDING_ACTION = 'HISTORY20_PRIVATE_TEST_FUNDING';

/** A reserved ticker, a History20 window, no owner allocation, funding within bounds, no replay after the window. */
function assertFundablePrivateListing(listing: PublishedListing): void {
  const config = parseListingConfig(listing.config);
  if (!config.privateTest) throw new Error('Only a History20 private test listing has test funding');
  // Checked against itself: nothing to lock, only the private-test rules (window, ticker, rights gate).
  checkPrivateTestable(config, config, Date.now());
}

/**
 * Fund one account for a PUBLISHED History20 private test listing, once.
 * Explicit maintenance step: NEVER called by startup, HTTP, Create, Preview
 * or Publish, and never run against production without the owner's separate
 * approval (see scripts/fund-history20-private.cjs).
 *
 * - The listing must come from the published catalogue and carry `privateTest`.
 * - The account must be one the private test admits right now
 *   (privateTest.privateTestAdmitted: the mode is on and the database verifies
 *   the owner or an allowlisted tester, not blocked), checked again inside the
 *   transaction. An ADMIN role alone is not enough.
 * - It credits exactly the listing's base asset and SIMUSDT, in the bounded
 *   amounts the published configuration fixes. It never creates, debits or
 *   reads USDT or any other asset, and never touches another account.
 * - A repeat (or a concurrent second call) credits nothing; a receipt that
 *   disagrees with the listing, or unexplained prior base inventory, fails closed.
 * - Every private-listing rule is re-checked here from the raw configuration
 *   (assertFundablePrivateListing). The Worker enforces the same rules when it
 *   publishes, but this is the authoritative financial write, and Render's
 *   registry parses the store's answer by shape only: a forged or stale store
 *   entry must fail here, before any balance changes.
 */
export async function fundPrivateTestAccount(db: PrismaClient, listing: PublishedListing, userId: string) {
  if (!userId.trim()) throw new Error('Explicit tester account ID required');
  assertFundablePrivateListing(listing);
  const privateTest = listing.config.privateTest!;
  if (!(await privateTestAdmitted(db, userId))) throw new Error('This account is not admitted to the private test');
  const base = listing.config.symbol;
  // Only a reserved ticker is funded: every guard refuses it outside the private pair, registry or not.
  if (!isHistory20PrivateSymbol(base)) throw new Error('Only a reserved History20 private ticker has test funding');
  const quote = SIMULATION_QUOTE;
  const baseQuantity = new BigNumber(privateTest.funding.base);
  const quoteQuantity = new BigNumber(privateTest.funding.quote);
  if (!baseQuantity.isFinite() || !quoteQuantity.isFinite() || baseQuantity.lt(0) || quoteQuantity.lt(0)
    || (baseQuantity.isZero() && quoteQuantity.isZero())) throw new Error('This listing has no test funding to credit');
  const receipt = privateTestFundingReceiptId(listing.id, userId);
  return db.$transaction(async (tx) => {
    // Serialise every funding of this (listing, account) pair. The base asset
    // belongs to this listing alone; SIMUSDT is an atomic increment.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${receipt}, 0))`;
    if (!(await privateTestAdmitted(tx, userId))) throw new Error('This account is not admitted to the private test');
    const prior = await tx.auditLog.findUnique({ where: { id: receipt } });
    if (prior) {
      const metadata = prior.metadata && typeof prior.metadata === 'object' && !Array.isArray(prior.metadata) ? prior.metadata as Record<string, unknown> : null;
      const same = (value: unknown, expected: BigNumber) => typeof value === 'string' && new BigNumber(value).eq(expected);
      if (prior.action !== PRIVATE_TEST_FUNDING_ACTION || prior.userId !== userId || metadata?.listingId !== listing.id
        || metadata?.base !== base || metadata?.quote !== quote
        || !same(metadata?.baseQuantity, baseQuantity) || !same(metadata?.quoteQuantity, quoteQuantity)) {
        throw new Error('Funding receipt conflicts with the published listing; manual review required');
      }
      return { applied: false, userId, base, quote, baseQuantity: baseQuantity.toFixed(), quoteQuantity: quoteQuantity.toFixed() };
    }
    // The base is a new private asset: anything already there is unexplained.
    const balance = await tx.balance.findUnique({ where: { userId_asset: { userId, asset: base } } });
    if (balance && (!balance.available.isZero() || !balance.locked.isZero())) {
      throw new Error(`Existing ${base} inventory requires manual review`);
    }
    if (baseQuantity.gt(0)) {
      await tx.balance.upsert({
        where: { userId_asset: { userId, asset: base } },
        create: { userId, asset: base, available: baseQuantity.toFixed() },
        update: { available: baseQuantity.toFixed() },
      });
    }
    // SIMUSDT is shared by the account's private listings; each funding adds its own bounded amount.
    if (quoteQuantity.gt(0)) {
      await tx.balance.upsert({
        where: { userId_asset: { userId, asset: quote } },
        create: { userId, asset: quote, available: quoteQuantity.toFixed() },
        update: { available: { increment: quoteQuantity.toFixed() } },
      });
    }
    await tx.auditLog.create({ data: {
      id: receipt, userId, action: PRIVATE_TEST_FUNDING_ACTION,
      metadata: {
        listingId: listing.id, version: listing.version, pair: `${base}/${quote}`,
        base, quote, baseQuantity: baseQuantity.toFixed(), quoteQuantity: quoteQuantity.toFixed(),
        withdrawable: false, usdtDebit: '0', usdtCredit: '0',
        provenance: 'History20 private test model; HISTORICAL_RIGHTS_UNVERIFIED for any public use',
      },
    } });
    return { applied: true, userId, base, quote, baseQuantity: baseQuantity.toFixed(), quoteQuantity: quoteQuantity.toFixed() };
  });
}
