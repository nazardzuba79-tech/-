import { Prisma, type PrismaClient } from '@prisma/client';

/** Immutable processing receipts in the existing audit log. The deterministic
 * primary key makes Ignore/retries/concurrent admins exactly-once without a
 * new table, migration, timer or mutable financial flag. Copy rows remain the
 * original historical facts. These receipts NEVER attribute or credit money. */
export const COPY_RESOLUTION_PREFIX = 'deposit-copy-resolution:';
export const COPY_RESOLUTION_ACTION = 'DEPOSIT_COPY_RESOLVED';
export const unresolvedCopy = Prisma.sql`NOT EXISTS (
  SELECT 1 FROM "AuditLog" resolution
  WHERE resolution."id" = 'deposit-copy-resolution:' || e."id"
)`;
export type CopyReadDb = Pick<PrismaClient, '$queryRaw'>;
export interface CopyCreditCandidate { id: string; addressSnapshot: string }

/** Snapshot before the asynchronous blockchain checks. A copy arriving while
 * an approval is in flight is NOT in this set and cannot disappear with it.
 * No copy is required for credit; zero candidates changes no money rule. */
export async function pendingCopiesForCredit(db: CopyReadDb, userId: string, chain: string, asset: string): Promise<CopyCreditCandidate[]> {
  return db.$queryRaw<CopyCreditCandidate[]>(Prisma.sql`
    SELECT e."id", e."addressSnapshot"
    FROM "DepositAddressCopyEvent" e
    WHERE e."userId" = ${userId} AND e."asset" = ${asset.toUpperCase()}
      AND e."network" = ${chain.toLowerCase()} AND ${unresolvedCopy}
    ORDER BY e."id"
  `);
}

/** Called inside the successful credit transaction, AFTER all proof/amount/
 * owner/revision checks. Only the captured IDs for this user's credited rail
 * are processed. Original deposits, copy events and other users are untouched.
 * A replay returns before here, so an old confirmation cannot hide a new copy. */
export async function resolveCopiesAfterCredit(tx: Prisma.TransactionClient, params: {
  ids: string[]; userId: string; chain: string; asset: string; adminId: string; batchId: string;
}): Promise<void> {
  const ids = [...new Set(params.ids)].sort();
  if (!ids.length) return;
  await tx.$queryRaw(Prisma.sql`
    INSERT INTO "AuditLog" ("id", "userId", "action", "metadata", "createdAt")
    SELECT 'deposit-copy-resolution:' || e."id", e."userId", 'DEPOSIT_COPY_RESOLVED',
      jsonb_build_object('eventId', e."id", 'outcome', 'CREDITED', 'batchId', ${params.batchId}::text,
        'asset', e."asset", 'network', e."network", 'performedByAdminId', ${params.adminId}::text),
      now() AT TIME ZONE 'UTC'
    FROM "DepositAddressCopyEvent" e
    WHERE e."id" IN (${Prisma.join(ids)}) AND e."userId" = ${params.userId}
      AND e."asset" = ${params.asset.toUpperCase()} AND e."network" = ${params.chain.toLowerCase()}
    ORDER BY e."id"
    ON CONFLICT ("id") DO NOTHING
    RETURNING "id"
  `);
}

export class CopyReviewNotFound extends Error {}

/** Explicit Ignore, limited to the selected signal and its older duplicates
 * for the SAME user/coin/network/address/memo. Newer signals and other rails
 * stay pending. The latest (receivedAt,id) shown to the admin is the cutoff,
 * not a client-supplied time or user identity. Retrying cannot move the cutoff.
 * Only audit receipts are inserted; no balance/deposit/claim is edited. */
export async function ignoreDepositCopy(prisma: PrismaClient, eventId: string, adminId: string): Promise<{ userId: string }> {
  return prisma.$transaction(async tx => {
    const selected = await tx.$queryRaw<{ userId: string }[]>(Prisma.sql`
      SELECT "userId" FROM "DepositAddressCopyEvent" WHERE "id" = ${eventId}
    `);
    if (!selected.length) throw new CopyReviewNotFound('Сигнал больше недоступен. Обновите список.');
    await tx.$queryRaw(Prisma.sql`
      INSERT INTO "AuditLog" ("id", "userId", "action", "metadata", "createdAt")
      SELECT 'deposit-copy-resolution:' || e."id", e."userId", 'DEPOSIT_COPY_RESOLVED',
        jsonb_build_object('eventId', e."id", 'outcome', 'IGNORED', 'throughEventId', ${eventId}::text,
          'asset', e."asset", 'network', e."network", 'performedByAdminId', ${adminId}::text),
        now() AT TIME ZONE 'UTC'
      FROM "DepositAddressCopyEvent" e
      JOIN "DepositAddressCopyEvent" target ON target."id" = ${eventId}
        AND e."userId" = target."userId" AND e."asset" = target."asset" AND e."network" = target."network"
        AND e."addressSnapshot" = target."addressSnapshot"
        AND e."memoSnapshot" IS NOT DISTINCT FROM target."memoSnapshot"
        AND (e."receivedAt", e."id") <= (target."receivedAt", target."id")
      ORDER BY e."id"
      ON CONFLICT ("id") DO NOTHING
      RETURNING "id"
    `);
    return { userId: selected[0].userId };
  });
}
