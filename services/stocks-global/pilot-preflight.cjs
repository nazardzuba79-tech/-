'use strict';
// Read-only operator preflight. No password vault, account creation, binding,
// balance edits, transaction retry, provider calls, migration or deployment.
const MIGRATION = '20261016000000_stocks_test_cash_authority';

function validatePrincipals(env) {
  if (env.STOCKS_PILOT_READONLY_ACK !== 'READ_ONLY') throw Error('READ_ONLY_ACK_REQUIRED');
  const issuer = env.STOCKS_IDENTITY_ISSUER;
  if (typeof issuer !== 'string' || !issuer.trim() || issuer.length > 512) throw Error('PREFLIGHT_CONFIGURATION_INVALID');
  let parsed;
  try { parsed = JSON.parse(env.STOCKS_TRADE_PRINCIPALS); } catch { throw Error('PREFLIGHT_CONFIGURATION_INVALID'); }
  if (!Array.isArray(parsed) || parsed.length !== 2) throw Error('PREFLIGHT_CONFIGURATION_INVALID');
  const ids = parsed.map(row => {
    if (!row || row.issuer !== issuer || typeof row.subject !== 'string' ||
        row.subject.length < 1 || row.subject.length > 128 ||
        !/^[A-Za-z0-9_.:@-]+$/.test(row.subject)) throw Error('PREFLIGHT_CONFIGURATION_INVALID');
    return row.subject;
  });
  if (new Set(ids).size !== 2) throw Error('PREFLIGHT_CONFIGURATION_INVALID');
  return ids;
}

async function inspectReadOnly(prisma, env) {
  const ids = validatePrincipals(env);
  const result = await prisma.$transaction(async tx => {
    // PostgreSQL itself rejects mutations for the remainder of this
    // transaction; the code below contains only finite, bounded SELECTs.
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const [users, cash, sessions, migrations] = await Promise.all([
      tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, blockedAt: true } }),
      tx.demoBalance.findMany({ where: { userId: { in: ids }, asset: 'USDT' }, select: { userId: true, available: true } }),
      tx.session.findMany({ where: { userId: { in: ids }, revokedAt: null }, select: { userId: true } }),
      tx.$queryRawUnsafe('SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations" WHERE migration_name = $1', MIGRATION),
    ]);
    const found = new Set(users.map(row => row.id));
    const unblocked = new Set(users.filter(row => row.blockedAt === null).map(row => row.id));
    const hasBalance = new Set(cash.map(row => row.userId));
    const funded = new Set(cash.filter(row => Number(row.available.toString()) > 0).map(row => row.userId));
    const hasSession = new Set(sessions.map(row => row.userId));
    const migrationApplied = migrations.length === 1 && migrations[0].finished_at !== null && migrations[0].rolled_back_at === null;
    return {
      configuredPrincipals: 2,
      accountsFound: ids.filter(id => found.has(id)).length,
      accountsNotBlocked: ids.filter(id => unblocked.has(id)).length,
      existingDemoUSDT: ids.filter(id => hasBalance.has(id)).length,
      currentlyAvailableDemoUSDT: ids.filter(id => funded.has(id)).length,
      unrevokedSessionPresent: ids.filter(id => hasSession.has(id)).length,
      stocksMigrationApplied: migrationApplied,
    };
  }, { timeout: 3000, maxWait: 1000 });
  const passed = result.accountsFound === 2 &&
    result.accountsNotBlocked === 2 &&
    result.existingDemoUSDT === 2 &&
    result.currentlyAvailableDemoUSDT === 2 &&
    result.unrevokedSessionPresent === 2 &&
    result.stocksMigrationApplied === true;
  // Counts only. Never print IDs, names, emails, cash figures, credentials,
  // connection strings, JWTs or database/driver error messages.
  return { status: passed ? 'DB_PREFLIGHT_PASS_NOT_AUTHORIZATION' : 'BLOCKED',
    ...result, productionAuthorized: false, liveQuoteRightsVerified: false,
    targetCapacityVerified: false };
}

if (require.main === module) {
  (async () => {
    try {
      validatePrincipals(process.env); // Fail before opening a DB connection.
      const { PrismaClient } = require('@prisma/client');
      const prisma = new PrismaClient();
      try {
        const result = await inspectReadOnly(prisma, process.env);
        process.stdout.write(JSON.stringify(result) + '\n');
        if (result.status === 'BLOCKED') process.exitCode = 2;
      } finally { await prisma.$disconnect(); }
    } catch {
      process.stderr.write(JSON.stringify({ status: 'BLOCKED', error: 'PREFLIGHT_UNAVAILABLE_OR_MISCONFIGURED' }) + '\n');
      process.exitCode = 2;
    }
  })();
}

module.exports = { validatePrincipals, inspectReadOnly };
