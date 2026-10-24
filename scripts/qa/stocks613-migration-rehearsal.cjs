'use strict';
// Isolated additive-DDL rehearsal. NOT a production migration/restore runner.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { disposableUrl } = require('../../services/stocks-global/testing/disposable-postgres.cjs');
const { PENDING } = require('./stocks-build-only-prepare.cjs');
const ROOT = path.resolve(__dirname, '../..');
const BASE = '58540f49aed5d47a4458ab11270e0cb3aa7d26ce';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const quote = value => '"' + value.replaceAll('"', '""') + '"';
function command(file, args, options = {}) {
  const result = cp.spawnSync(file, args, { cwd: ROOT, encoding: 'utf8', timeout: 120000, ...options });
  if (result.error || result.status !== 0) throw Error('REHEARSAL_COMMAND_FAILED: ' + file + '\n' + String(result.stderr || result.error?.message));
  return result.stdout;
}
function target() {
  const value = disposableUrl();
  if (!value) throw Error('EXPLICIT_DISPOSABLE_PG_REQUIRED');
  return value;
}
function originalSql(name) {
  const item = PENDING.find(row => row.name === name);
  if (!item) throw Error('UNAPPROVED_MIGRATION');
  const bytes = cp.execFileSync('git', ['show', `HEAD:prisma/migrations/${name}/migration.sql`], { cwd: ROOT });
  if (hash(bytes) !== item.sha256) throw Error('ORIGINAL_SQL_HASH_MISMATCH');
  return bytes;
}
async function snapshot(db, tables) {
  const result = {};
  for (const table of tables) {
    // Full row bytes only in this synthetic disposable DB; never export rows.
    const rows = await db.$queryRawUnsafe(`SELECT row_to_json(t)::text AS row FROM ${quote(table)} t ORDER BY row_to_json(t)::text`);
    result[table] = { count: rows.length, sha256: hash(JSON.stringify(rows)) };
  }
  return result;
}
async function run() {
  const destination = target(); // No DATABASE_URL or .env fallback.
  const { PrismaClient } = require('@prisma/client');
  let db = new PrismaClient({ datasources: { db: { url: destination.raw } } });
  const out = path.resolve(process.env.STOCKS_REHEARSAL_OUTPUT || path.join(ROOT, 'output/stocks613-rehearsal'));
  fs.mkdirSync(out, { recursive: true });
  try {
    assert.equal((await db.$queryRawUnsafe('SELECT current_database() AS name'))[0].name, destination.name);
    assert.equal((await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public'")).length, 0, 'EMPTY_DISPOSABLE_DATABASE_REQUIRED');
    await db.$disconnect();
    const schema = path.join(out, 'synthetic-baseline.prisma');
    fs.writeFileSync(schema, cp.execFileSync('git', ['show', `${BASE}:prisma/schema.prisma`], { cwd: ROOT }));
    command(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate', '--schema', schema], {
      env: { ...process.env, DATABASE_URL: destination.raw, DIRECT_URL: destination.raw },
    });
    db = new PrismaClient({ datasources: { db: { url: destination.raw } } });
    const user = await db.user.create({ data: { email: 'migration-sentinel@example.invalid', passwordHash: 'not-a-login', referralCode: 'stocks613sentinel' } });
    await db.session.create({ data: { userId: user.id } });
    await db.demoBalance.create({ data: { userId: user.id, asset: 'USDT', available: '1234.567', locked: '89' } });
    await db.balance.create({ data: { userId: user.id, asset: 'USDT', available: '5.25', locked: '1' } });
    await db.demoOrder.create({ data: { userId: user.id, pair: 'BTC/USDT', side: 'BUY', type: 'LIMIT', originalQuantity: '0.01', remainingQuantity: '0.01', price: '30000', status: 'OPEN' } });
    await db.withdrawal.create({ data: { userId: user.id, asset: 'USDT', network: 'fixture', toAddress: 'not-an-address', amount: '1', status: 'PENDING' } });
    await db.demoTrade.create({ data: { pair: 'BTC/USDT', takerOrderId: 'fixture-taker', makerOrderId: 'fixture-maker', takerUserId: user.id, makerUserId: user.id, price: '30000', quantity: '0.001', side: 'BUY' } });
    const tables = (await db.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map(row => row.tablename);
    const before = await snapshot(db, tables);
    const pgEnv = { ...process.env, PGHOST: destination.host, PGPORT: destination.port,
      PGDATABASE: destination.name, PGUSER: decodeURIComponent(new URL(destination.raw).username),
      PGPASSWORD: decodeURIComponent(new URL(destination.raw).password), PGOPTIONS: '-c lock_timeout=2000 -c statement_timeout=10000' };
    // psql understands function bodies. Never split SQL on semicolons.
    for (const item of PENDING) {
      const sql = originalSql(item.name);
      command('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '--file=-'], { env: pgEnv, input: sql });
    }
    const after = await snapshot(db, tables);
    assert.deepEqual(after, before, 'PREEXISTING_SYNTHETIC_ROWS_CHANGED');
    const constraints = await db.$queryRawUnsafe(`SELECT c.conrelid::regclass::text AS relation, c.contype AS type, pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c WHERE c.conrelid IN ('"StocksTestAccount"'::regclass,'"StocksTestReceipt"'::regclass,'"StocksTestAudit"'::regclass) ORDER BY 1,2,3`);
    assert.equal(constraints.filter(c => c.type === 'p').length, 3);
    assert.equal(constraints.filter(c => c.type === 'u').length, 2);
    assert.equal(constraints.filter(c => c.type === 'f').length, 4);
    assert.equal(constraints.filter(c => c.type === 'c').length, 2);
    assert.ok(constraints.filter(c => c.type === 'f').every(c => c.definition.endsWith('ON DELETE RESTRICT')));
    assert.ok(constraints.some(c => c.type === 'u' && c.definition === 'UNIQUE (issuer, subject)'));
    assert.equal(constraints.filter(c => c.type === 'p' && c.definition === 'PRIMARY KEY ("principalHash", "intentId")').length, 2);
    const columns = await db.$queryRawUnsafe(`SELECT table_name,column_name,column_default,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'StocksTest%'`);
    assert.ok(columns.every(c => c.is_nullable === 'NO'));
    assert.equal(columns.find(c => c.table_name === 'StocksTestAccount' && c.column_name === 'revision').column_default, '0');
    const indexes = await db.$queryRawUnsafe(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE tablename LIKE 'StocksTest%' ORDER BY indexname`);
    assert.equal(indexes.length, 5);
    const rejected = async (sql, code) => assert.rejects(db.$transaction(async tx => {
      await tx.$executeRawUnsafe(sql);
    }), error => error.meta?.code === code);
    await rejected(`INSERT INTO "StocksTestAccount" ("principalHash",issuer,subject,"userId",ledger) VALUES ('bad','i','s','nonexistent','{}')`, '23503');
    await rejected(`INSERT INTO "StocksTestAccount" ("principalHash",issuer,subject,"userId",ledger,revision) VALUES ('bad','i','s','${user.id}','{}',-1)`, '23514');
    await rejected(`INSERT INTO "StocksTestAccount" ("principalHash",issuer,subject,"userId",ledger) VALUES ('bad','i','s','${user.id}','{"wallets":{"USDT":{"cash":"1"}}}')`, '23514');
    await rejected(`INSERT INTO "StocksTestReceipt" ("principalHash","intentId","payloadHash",revision,receipt) VALUES ('missing','i','h',0,'{}')`, '23503');
    await rejected(`INSERT INTO "StocksTestAudit" ("principalHash","intentId","userId","sessionId",kind,revision,"payloadHash") VALUES ('missing','i','${user.id}','fixture','BUY',0,'h')`, '23503');
    // Prove PostgreSQL DDL rollback on error, using only a disposable canary.
    await assert.rejects(db.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE TABLE "StocksRehearsalRollbackCanary" (id integer)');
      await tx.$executeRawUnsafe('SELECT 1 / 0');
    }));
    assert.equal((await db.$queryRawUnsafe(`SELECT to_regclass('public."StocksRehearsalRollbackCanary"')::text AS name`))[0].name, null);
    await db.$executeRawUnsafe(`INSERT INTO "NativeFundingModel" (version,"longCashflow","shortCashflow","effectiveFrom") VALUES ('fixture','0','0',CURRENT_TIMESTAMP)`);
    await rejected(`UPDATE "NativeFundingModel" SET "longCashflow"='1' WHERE version='fixture'`, 'P0001');
    await rejected(`DELETE FROM "NativeFundingModel" WHERE version='fixture'`, 'P0001');
    assert.deepEqual(await snapshot(db, tables), before);
    const report = { status: 'PASS_SYNTHETIC_ADDITIVE_DDL_ONLY', node: process.versions.node,
      postgres: (await db.$queryRawUnsafe('SELECT version() AS version'))[0].version,
      baseline: BASE, originalMigrations: PENDING, preexistingTables: tables.length,
      preexistingRowsUnchanged: true, constraints, indexes, rejectedInvalidWrites: 7,
      ddlRollback: true, productionRestore: 'NOT_RUN', historical44Replay: 'NOT_CLAIMED' };
    fs.writeFileSync(path.join(out, 'migration-rehearsal.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ ...report, constraints: constraints.length, indexes: indexes.length }));
  } finally { await db.$disconnect(); }
}
module.exports = { target, originalSql, snapshot };
if (require.main === module) run().catch(error => {
  const raw = process.env.STOCKS_DISPOSABLE_PG_URL;
  console.error(String(error.stack).split(raw || '\0').join('[disposable-pg]'));
  process.exitCode = 1;
});
