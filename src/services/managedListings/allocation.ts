import { PrismaClient, Prisma } from '@prisma/client';
import { ListingError, type ManagedListing } from './schema';

/** Explicit separate accounting command. No callers in create/preview/publish,
 * startup or migrations. No USDT compensation, trading or repricing. */
export async function allocateManagedListing(db: PrismaClient, row: ManagedListing, ownerId: string, key: string) {
  const receiptId = `managed-listing:${row.id}:allocation:v1`;
  if (row.status !== 'published' || !ownerId || key !== receiptId) throw new ListingError('allocation_confirmation_required');
  if (ownerId !== row.createdBy) throw new ListingError('allocation_owner_required',403);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${receiptId}, 0))`;
    const owner = await tx.user.findUnique({where:{id:ownerId},select:{role:true}});
    if (owner?.role !== 'ADMIN') throw new ListingError('admin_required',403);
    const previous = await tx.auditLog.findUnique({where:{id:receiptId}});
    const receipt = { listingId:row.id, revision:row.revision, asset:row.ticker, quantity:row.ownerAllocation, userId:ownerId, idempotencyKey:key };
    if (previous) {
      const metadata = previous.metadata as Record<string,unknown> | null;
      if (previous.userId !== ownerId || !metadata || metadata.listingId !== row.id || metadata.quantity !== row.ownerAllocation
        || metadata.asset !== row.ticker || metadata.revision !== row.revision) throw new ListingError('allocation_conflict',409);
      return {applied:false,receipt:previous.metadata};
    }
    const quantity = new Prisma.Decimal(row.ownerAllocation);
    if (quantity.isNegative()) throw new ListingError('invalid_allocation');
    await tx.balance.upsert({where:{userId_asset:{userId:ownerId,asset:row.ticker}},
      create:{userId:ownerId,asset:row.ticker,available:quantity},update:{available:{increment:quantity}}});
    await tx.auditLog.create({data:{id:receiptId,userId:ownerId,action:'MANAGED_LISTING_ALLOCATION',metadata:receipt}});
    return {applied:true,receipt};
  });
}
