import { PrismaClient } from '@prisma/client';
import BigNumber from 'bignumber.js';
import type { PublishedListing } from './listingConfig';

/** One allocation per listing, ever. The receipt id is the idempotency key. */
export const allocationReceiptId = (listingId: string) => `listing-owner-allocation:${listingId}`;

/**
 * Credit a PUBLISHED managed listing's owner allocation to a verified ADMIN,
 * once. Explicit maintenance step: NEVER called by startup, HTTP, Create,
 * Preview or Publish, and never run against production without the owner's
 * separate approval (see scripts/allocate-listing-owner.cjs).
 *
 * - The listing must come from the published catalogue (a draft cannot be allocated).
 * - The owner must be an existing ADMIN (verified id; no email guessing).
 * - No USDT is created or debited; the initial valuation is recorded only as information.
 * - A repeat (or a concurrent second call) credits nothing; unexplained prior inventory fails closed.
 */
export async function allocateListingOwner(db: PrismaClient, listing: PublishedListing, ownerId: string) {
  if (!ownerId.trim()) throw new Error('Explicit verified owner ID required');
  const asset = listing.config.symbol;
  const quantity = new BigNumber(listing.config.ownerAllocation);
  if (!quantity.isFinite() || quantity.lte(0)) throw new Error('This listing has no owner allocation to credit');
  const receipt = allocationReceiptId(listing.id);
  return db.$transaction(async (tx) => {
    // Serialise every allocation of this listing (hash of the receipt id).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${receipt}))`;
    const owner = await tx.user.findUnique({ where: { id: ownerId }, select: { id: true, role: true } });
    if (!owner || owner.role !== 'ADMIN') throw new Error('Verified owner must be an existing ADMIN');
    const prior = await tx.auditLog.findUnique({ where: { id: receipt } });
    if (prior) {
      if (prior.userId !== ownerId) throw new Error('Allocation belongs to another owner; manual review required');
      const metadata = prior.metadata && typeof prior.metadata === 'object' && !Array.isArray(prior.metadata) ? prior.metadata : null;
      const recordedQuantity = typeof metadata?.quantity === 'string' && /^(0|[1-9]\d*)(\.\d+)?$/.test(metadata.quantity)
        ? new BigNumber(metadata.quantity) : null;
      // A later published version may change display fields, but it cannot
      // reinterpret a receipt as a different asset or quantity. Compare exact
      // decimals: Number would erase small differences in large allocations.
      if (prior.action !== 'LISTING_OWNER_ALLOCATION' || metadata?.listingId !== listing.id || metadata?.asset !== asset
        || !recordedQuantity?.isFinite() || !recordedQuantity.gt(0) || !recordedQuantity.eq(quantity)) {
        throw new Error('Allocation receipt conflicts with the published listing; manual review required');
      }
      return { applied: false, userId: prior.userId, asset: metadata.asset, quantity: recordedQuantity.toFixed() };
    }
    const balance = await tx.balance.findUnique({ where: { userId_asset: { userId: ownerId, asset } } });
    if (balance && (!balance.available.isZero() || !balance.locked.isZero())) {
      throw new Error(`Existing ${asset} inventory requires manual review`);
    }
    await tx.balance.upsert({
      where: { userId_asset: { userId: ownerId, asset } },
      create: { userId: ownerId, asset, available: quantity.toFixed() },
      update: { available: quantity.toFixed() },
    });
    await tx.auditLog.create({ data: {
      id: receipt, userId: ownerId, action: 'LISTING_OWNER_ALLOCATION',
      metadata: {
        listingId: listing.id, version: listing.version, asset, quantity: quantity.toFixed(),
        initialPriceUsdt: listing.config.initialPrice,
        initialValueUsdt: quantity.times(listing.config.initialPrice).toFixed(),
        usdtDebit: '0', usdtCredit: '0',
      },
    } });
    return { applied: true, userId: ownerId, asset, quantity: quantity.toFixed() };
  });
}
