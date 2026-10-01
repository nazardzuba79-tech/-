import { Prisma, type PrismaClient } from '@prisma/client';

export interface LatestDepositCopy {
  id: string;
  asset: string;
  network: string;
  receivedAt: string;
  clientCopiedAt: string | null;
}

/** Read-only decoration of the existing admin users response. One bounded
 * result per requested account, in one SQL round trip. The lateral lookup
 * uses the existing (userId, receivedAt) index instead of loading the journal
 * or doing an HTTP/SQL query for each row. No clock, polling, writes or credit.
 */
export async function latestDepositCopiesForUsers(prisma: PrismaClient, userIds: string[]): Promise<{
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
        WHERE e."userId" = u."id"
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
    // A journal-read outage must neither remove the users/balances nor be
    // represented as "nobody copied". The UI gets an explicit unknown state.
    return { byUser: new Map(), failed: true };
  }
}
