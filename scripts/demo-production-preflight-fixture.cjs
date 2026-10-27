'use strict';
/** CI fixture ONLY. Hard refuses every database except the disposable local one. */
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { audit } = require('./demo-production-preflight-readonly.cjs');

async function main() {
  const url = process.env.DEMO_PREFLIGHT_DATABASE_URL || '';
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Fixture database is not configured'); }
  if (!['127.0.0.1','localhost'].includes(parsed.hostname)
    || parsed.pathname !== '/demo_preflight_fixture'
    || parsed.protocol !== 'postgresql:') {
    throw new Error('Refusing non-loopback or non-fixture database');
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const schema = [
      'CREATE TABLE "User" (id text PRIMARY KEY, "blockedAt" timestamptz)',
      'CREATE TABLE "DemoOrder" (id text PRIMARY KEY, pair text, type text, price numeric, "originalQuantity" numeric, "remainingQuantity" numeric, status text)',
      'CREATE TABLE "DemoTrade" (id text PRIMARY KEY, pair text, "makerOrderId" text, "takerOrderId" text, quantity numeric)',
      'CREATE TABLE "AuditLog" ("userId" text, action text)',
      'CREATE TABLE "Balance" ("userId" text, available numeric, locked numeric)',
      'CREATE TABLE "Withdrawal" ("balanceHeld" boolean, status text)',
    ];
    for (const sql of schema) await prisma.$executeRawUnsafe(sql);
    const fixtureRows = [
      `INSERT INTO "User" (id) VALUES ('both'),('ordinary'),('demo'),('blocked')`,
      `UPDATE "User" SET "blockedAt"=now() WHERE id='blocked'`,
      `INSERT INTO "AuditLog" ("userId",action) VALUES ('both','DEMO_BALANCE_ADJUSTED'),('demo','DEMO_BALANCE_ADJUSTED'),('blocked','DEMO_BALANCE_ADJUSTED')`,
      `INSERT INTO "Balance" ("userId",available,locked) VALUES ('both',10,0),('ordinary',3,1),('blocked',5,0)`,
      `INSERT INTO "DemoOrder" (id,pair,type,price,"originalQuantity","remainingQuantity",status) VALUES
          ('valid','BTC/USDT','LIMIT',100,5,5,'OPEN'),
          ('bad-market','BTC/USDT','MARKET',NULL,2,2,'OPEN'),
          ('bad-remainder','ETH/USDT','LIMIT',10,1,1,'PARTIALLY_FILLED')`,
      `INSERT INTO "DemoTrade" (id,pair,"makerOrderId","takerOrderId",quantity)
          VALUES ('trade','ETH/USDT','bad-remainder','another-order',0.5)`,
      `INSERT INTO "Withdrawal" ("balanceHeld",status) VALUES
          (false,'PENDING'),(false,'APPROVED'),(true,'PENDING'),(false,'SENT')`,
    ];
    for (const sql of fixtureRows) await prisma.$executeRawUnsafe(sql);
    const before = await prisma.$queryRawUnsafe('SELECT (SELECT COUNT(*) FROM "DemoOrder")::text AS orders, (SELECT COUNT(*) FROM "Balance")::text AS balances');
    const result = await audit(prisma);
    const after = await prisma.$queryRawUnsafe('SELECT (SELECT COUNT(*) FROM "DemoOrder")::text AS orders, (SELECT COUNT(*) FROM "Balance")::text AS balances');
    assert.deepEqual(after,before,'read-only audit cannot mutate fixture data');
    assert.deepEqual(result.legacyActiveDemoOrders,{count:'2',pairs:'2'});
    assert.deepEqual(result.dualLedgerAccounts,{count:'1'});
    assert.deepEqual(result.legacyOrdinaryFundedAccounts,{count:'1'});
    assert.deepEqual(result.unheldCrossWithdrawals,{PENDING:'1',APPROVED:'1'});
    assert.equal(result.blockers.inconsistentDemoOrders,true);
    assert.equal(result.decision,'MANUAL_REVIEW_REQUIRED');
    console.log('PASS disposable PostgreSQL: 4 aggregate queries, correct blockers, no writes, no identities');
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(() => { console.error('FAIL disposable PostgreSQL preflight fixture'); process.exitCode = 1; });
