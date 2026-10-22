import { Prisma, PrismaClient } from '@prisma/client';
import { OtcError } from './policy';

/** No automatic retry after an ambiguous COMMIT. The caller resolves the
 * original persisted idempotency key, never assumes no reservation occurred. */
export async function confirmedTransaction<T>(db: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  let id: string | undefined, result: T | undefined, failure: unknown;
  try {
    await db.$transaction(async tx => {
      result = await work(tx);
      const [identity] = await tx.$queryRaw<{ id: string }[]>`SELECT pg_current_xact_id()::text AS id`;
      id = identity.id;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 15000 });
  } catch (error) {
    if (!id) throw error;
    failure = error;
  }
  let status: string | null;
  try {
    const [outcome] = await db.$queryRaw<{ status: string | null }[]>`SELECT pg_xact_status(${id}::xid8) AS status`;
    status = outcome?.status;
  } catch { throw new OtcError('RESULT_UNKNOWN_CHECK_ORIGINAL_KEY', 503); }
  if (status === 'aborted') throw failure ?? new OtcError('TRANSACTION_ABORTED', 409);
  if (status !== 'committed') throw new OtcError('RESULT_UNKNOWN_CHECK_ORIGINAL_KEY', 503);
  return result!;
}
