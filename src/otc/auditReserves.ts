import { Prisma, PrismaClient } from '@prisma/client';
import { assertReserveCoverage } from './reserveCoverage';
import { OtcError } from './policy';

/** Operator-invoked, never scheduled. Requires the additive OTC migration.
 * One consistent SQL-enforced READ ONLY snapshot; no repair/cancel/write. */
export async function auditSpotReserves(db: PrismaClient) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [mode] = await tx.$queryRaw<{ readOnly: string }[]>`SELECT current_setting('transaction_read_only') AS "readOnly"`;
    if (mode.readOnly !== 'on') throw new Error('READ_ONLY_REQUIRED');
    const keys = await tx.$queryRaw<{ userId: string; asset: string }[]>`
      SELECT "userId", asset FROM "Balance"
      UNION SELECT "userId", CASE WHEN side='BUY' THEN split_part(pair,'/',2) ELSE split_part(pair,'/',1) END
        FROM "Order" WHERE status IN ('OPEN','PARTIALLY_FILLED','PENDING_TRIGGER')
      UNION SELECT "userId", asset FROM "Withdrawal" WHERE "userId" IS NOT NULL AND "balanceHeld" AND status IN ('PENDING','APPROVED')
      UNION SELECT r."userId", s.asset FROM "OtcCashReservation" s JOIN "OtcCashRequest" r ON r.id=s."requestId" WHERE s.status='HELD'`;
    const issues: { userId: string; asset: string; category: string; activeOrderIds: string[] }[] = [];
    for (const key of keys) {
      try { await assertReserveCoverage(tx, key.userId, key.asset, false); }
      catch (error) {
        if (!(error instanceof OtcError)) throw error;
        const orders = await tx.order.findMany({ where: { userId: key.userId, status: { in:['OPEN','PARTIALLY_FILLED','PENDING_TRIGGER'] } }, select:{id:true} });
        issues.push({ ...key, category:error.code, activeOrderIds:orders.map(o=>o.id) });
      }
    }
    return { result:issues.length?'ISSUES_FOUND':'CLEAN', walletsExamined:keys.length, issues, readOnly:true, rowsChanged:0 };
  }, { isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead, timeout:120000, maxWait:10000 });
}

async function main() {
  const url = process.env.OTC_AUDIT_DATABASE_URL;
  if (!url) { console.error('OTC_AUDIT_DATABASE_URL_REQUIRED'); process.exitCode=1; return; }
  // Explicit override only. DATABASE_URL is never a fallback; no dotenv import.
  const db = new PrismaClient({ datasources:{db:{url}}, log:[] });
  try { const result=await auditSpotReserves(db); console.log(JSON.stringify(result,null,2)); process.exitCode=result.issues.length?2:0; }
  catch { console.error('OTC_READ_ONLY_AUDIT_FAILED'); process.exitCode=1; }
  finally { await db.$disconnect(); }
}
if (require.main === module) void main();
