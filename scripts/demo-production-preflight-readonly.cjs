'use strict';
/**
 * One-command pre-merge Demo Spot / Demo Liquidity production audit.
 *
 * NEVER resolves DATABASE_URL by default; an operator must intentionally
 * select the target DB through DEMO_PREFLIGHT_DATABASE_URL and pass
 * --read-only-preflight. No migrations, balances, writes, identities or secrets
 * are exposed. Every query runs inside one PostgreSQL READ ONLY transaction.
 */
const QUERIES = Object.freeze([
  {
    name: 'legacyActiveDemoOrders',
    sql: `WITH invalid AS (
      SELECT o.id, o.pair FROM "DemoOrder" o
      LEFT JOIN "DemoTrade" t
        ON t.pair = o.pair AND (t."makerOrderId" = o.id OR t."takerOrderId" = o.id)
      WHERE o.status IN ('OPEN', 'PARTIALLY_FILLED')
      GROUP BY o.id
      HAVING o.type <> 'LIMIT' OR o.price IS NULL
        OR o."originalQuantity" - COALESCE(SUM(t.quantity), 0) <> o."remainingQuantity"
    )
    SELECT COUNT(*)::text AS count, COUNT(DISTINCT pair)::text AS pairs FROM invalid`,
  },
  {
    name: 'dualLedgerAccounts',
    sql: `SELECT COUNT(*)::text AS count
    FROM "User" u
    WHERE u."blockedAt" IS NULL
      AND EXISTS (
        SELECT 1 FROM "AuditLog" a
        WHERE a."userId" = u.id AND a.action = 'DEMO_BALANCE_ADJUSTED'
      )
      AND EXISTS (
        SELECT 1 FROM "Balance" b
        WHERE b."userId" = u.id AND (b.available > 0 OR b.locked > 0)
      )`,
  },
  {
    name: 'legacyOrdinaryFundedAccounts',
    sql: `SELECT COUNT(DISTINCT u.id)::text AS count
    FROM "User" u
    JOIN "Balance" b ON b."userId" = u.id
    WHERE u."blockedAt" IS NULL AND (b.available > 0 OR b.locked > 0)
      AND NOT EXISTS (
        SELECT 1 FROM "AuditLog" a
        WHERE a."userId" = u.id AND a.action = 'DEMO_BALANCE_ADJUSTED'
      )`,
  },
  {
    name: 'unheldCrossWithdrawals',
    sql: `SELECT status, COUNT(*)::text AS count
      FROM "Withdrawal"
      WHERE "balanceHeld" = false AND status IN ('PENDING', 'APPROVED')
      GROUP BY status ORDER BY status`,
  },
]);

const natural = (value) => {
  const text = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new Error('Invalid aggregate count');
  return text;
};

/** Accept ONLY counts/statuses; never copy full DB rows to logs. */
function sanitize(rows, key) {
  if (!Array.isArray(rows)) throw new Error('Unexpected aggregate result');
  if (key === 'unheldCrossWithdrawals') {
    const summary = { PENDING: '0', APPROVED: '0' };
    for (const r of rows) {
      if (!Object.hasOwn(summary, r.status)) throw new Error('Unexpected withdrawal status');
      summary[r.status] = natural(r.count);
    }
    return summary;
  }
  if (rows.length !== 1) throw new Error('Expected one aggregate row');
  const result = { count: natural(rows[0].count) };
  if (key === 'legacyActiveDemoOrders') result.pairs = natural(rows[0].pairs);
  return result;
}

async function audit(prisma) {
  // One connection and one snapshot; database rejects any DML in this transaction.
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '10000ms'");
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '2000ms'");
    const counts = {};
    for (const q of QUERIES) counts[q.name] = sanitize(await tx.$queryRawUnsafe(q.sql), q.name);
    return Object.freeze({
      scope: 'production-preflight-aggregates-only',
      ...counts,
      blockers: {
        inconsistentDemoOrders: counts.legacyActiveDemoOrders.count !== '0',
        dualLedgerOwnerReview: counts.dualLedgerAccounts.count !== '0',
        unheldCrossRequestsOwnerReview:
          counts.unheldCrossWithdrawals.PENDING !== '0' || counts.unheldCrossWithdrawals.APPROVED !== '0',
      },
      decision: 'MANUAL_REVIEW_REQUIRED',
      note: 'Counts are not account identity or proof of deposit provenance. No merge/withdrawal/activation approved.',
    });
  }, { maxWait: 5000, timeout: 46000 });
}

async function cli() {
  if (!process.argv.includes('--read-only-preflight') || !process.env.DEMO_PREFLIGHT_DATABASE_URL) {
    console.error('NO_RUN: operator must explicitly set DEMO_PREFLIGHT_DATABASE_URL and --read-only-preflight');
    process.exitCode = 2;
    return;
  }
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DEMO_PREFLIGHT_DATABASE_URL } } });
  try {
    const result = await audit(prisma);
    console.log('VOLTEX_DEMO_READONLY_PREFLIGHT ' + JSON.stringify(result));
    process.exitCode = result.blockers.inconsistentDemoOrders ? 1 : 0;
  } catch {
    // Prisma errors may contain hostnames, DSNs or SQL: never dump a raw stack here.
    console.error('NO_GO: read-only query failed; inspect private operator logs, do not proceed with release.');
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

module.exports = { audit, sanitize, QUERIES };
if (require.main === module) void cli();
