import { Prisma, type PrismaClient } from '@prisma/client';
import { unresolvedCopy } from './depositCopyResolution';

export interface LatestDepositCopy {
  id: string;
  asset: string;
  network: string;
  receivedAt: string;
  clientCopiedAt: string | null;
}

/** Latest UNRESOLVED copy per returned customer, in the existing users read.
 * Resolution is an immutable, primary-key-indexed audit receipt. No expiry:
 * the signal remains until explicit Ignore or successful manual credit.
 * The original journal still contains the complete copy history.
 */
export async function latestDepositCopiesForUsers(prisma: Pick<PrismaClient, '$queryRaw'>, userIds: string[]): Promise<{
  byUser: Map<string, LatestDepositCopy>; failed: boolean;
}> {
  const byUser = new Map<string, LatestDepositCopy>();
  const ids = [...new Set(userIds)];
  if (!ids.length) return { byUser, failed: false };
  try {
    const rows = await prisma.$queryRaw<{
      userId: string; id: string; asset: string; network: string;
      receivedAt: Date; clientCopiedAt: Date | null;
    }[]>(Prisma.sql`
      SELECT u."id" AS "userId", c."id", c."asset", c."network", c."receivedAt", c."clientCopiedAt"
      FROM "User" u
      CROSS JOIN LATERAL (
        SELECT e."id", e."asset", e."network", e."receivedAt", e."clientCopiedAt"
        FROM "DepositAddressCopyEvent" e
        WHERE e."userId" = u."id" AND ${unresolvedCopy}
        ORDER BY e."receivedAt" DESC, e."id" DESC
        LIMIT 1
      ) c
      WHERE u."id" IN (${Prisma.join(ids)})
    `);
    const allowed = new Set(ids);
    for (const row of rows) {
      if (!allowed.has(row.userId)) continue;
      byUser.set(row.userId, {
        id: row.id, asset: row.asset, network: row.network,
        receivedAt: row.receivedAt.toISOString(),
        clientCopiedAt: row.clientCopiedAt?.toISOString() ?? null,
      });
    }
    return { byUser, failed: false };
  } catch {
    return { byUser: new Map(), failed: true };
  }
}
