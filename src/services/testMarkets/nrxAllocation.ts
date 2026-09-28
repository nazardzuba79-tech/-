import { PrismaClient } from '@prisma/client';
import { NRX_OWNER_ALLOCATION } from './neurix';

const ALLOCATION_ID = 'nrx-owner-allocation-v1';

/** Explicit maintenance operation, NEVER called by startup, registration, HTTP or a migration.
 * Caller must supply the verified owner ID. No email guesses and no public airdrop.
 * Production execution requires separate owner approval after PR review.
 */
export async function allocateNrxOwner(db: PrismaClient, ownerId: string) {
  if (!ownerId.trim()) throw new Error('Explicit verified owner ID required');
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(782031250)`;
    const owner = await tx.user.findUnique({ where: { id: ownerId }, select: { id: true, role: true } });
    if (!owner || owner.role !== 'ADMIN') throw new Error('Verified owner must be an existing ADMIN');
    const prior = await tx.auditLog.findUnique({ where: { id: ALLOCATION_ID } });
    if (prior) {
      if (prior.userId !== ownerId) throw new Error('Allocation belongs to another owner; manual review required');
      return { applied: false, userId: ownerId, asset: 'NRX', quantity: NRX_OWNER_ALLOCATION };
    }
    const balance = await tx.balance.findUnique({ where: { userId_asset: { userId: ownerId, asset: 'NRX' } } });
    if (balance && (!balance.available.isZero() || !balance.locked.isZero())) {
      throw new Error('Existing NRX inventory requires manual review');
    }
    await tx.balance.upsert({
      where: { userId_asset: { userId: ownerId, asset: 'NRX' } },
      create: { userId: ownerId, asset: 'NRX', available: NRX_OWNER_ALLOCATION },
      update: { available: NRX_OWNER_ALLOCATION },
    });
    await tx.auditLog.create({ data: {
      id: ALLOCATION_ID, userId: ownerId, action: 'NRX_OWNER_ALLOCATION',
      metadata: { asset: 'NRX', quantity: NRX_OWNER_ALLOCATION, initialPriceUsdt: '0.80', initialValueUsdt: '25000', usdtDebit: '0' },
    } });
    return { applied: true, userId: ownerId, asset: 'NRX', quantity: NRX_OWNER_ALLOCATION };
  });
}
