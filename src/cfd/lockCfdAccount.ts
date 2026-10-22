import { Prisma } from '@prisma/client';

/** Serialize open/increase/close/liquidation ownership before reading a CFD
 * position. Wallet deltas still use atomic updates against Futures writers. */
export async function lockCfdAccount(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`cfd-position:${userId}`}, 0))::text`;
}
