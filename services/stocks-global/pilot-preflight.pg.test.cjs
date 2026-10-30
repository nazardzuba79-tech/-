'use strict';
// Disposable synthetic PostgreSQL only. Never reads DATABASE_URL or real IDs.
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {disposableUrl}=require('./testing/disposable-postgres.cjs'),{inspectReadOnly}=require('./pilot-preflight.cjs');
const target=disposableUrl();
test('real PG read-only preflight rejects unresolved attempts and preserves account rows',{timeout:15000,skip:target?false:'NOT_RUN: confirmed disposable loopback PostgreSQL required'},async()=>{
 const {PrismaClient}=require('@prisma/client'),admin=new PrismaClient({datasources:{db:{url:target.raw}}});
 const schema='stocks_preflight_'+randomUUID().replaceAll('-','');assert.match(schema,/^stocks_preflight_[a-f0-9]{32}$/);
 const scoped=new URL(target.raw);scoped.searchParams.set('schema',schema);let db;
 try{
  await admin.$executeRawUnsafe('CREATE SCHEMA "'+schema+'"');db=new PrismaClient({datasources:{db:{url:scoped.toString()}}});
  // Fixture DDL only, no migration runner. Columns match actual SELECT projections.
  for(const sql of ['CREATE TABLE "User" ("id" TEXT PRIMARY KEY,"blockedAt" TIMESTAMP)','CREATE TABLE "DemoBalance" ("id" TEXT PRIMARY KEY,"userId" TEXT,"asset" TEXT,"available" NUMERIC(36,18))','CREATE TABLE "Session" ("id" TEXT PRIMARY KEY,"userId" TEXT,"revokedAt" TIMESTAMP)','CREATE TABLE "_prisma_migrations" ("migration_name" TEXT,"finished_at" TIMESTAMP,"rolled_back_at" TIMESTAMP)'])await db.$executeRawUnsafe(sql);
  const subjects=[randomUUID(),randomUUID()];for(const subject of subjects){await db.$executeRawUnsafe('INSERT INTO "User" VALUES($1,NULL)',subject);await db.$executeRawUnsafe('INSERT INTO "DemoBalance" VALUES($1,$1,\'USDT\',1)',subject);await db.$executeRawUnsafe('INSERT INTO "Session" VALUES($1,$1,NULL)',subject);}
  const env={STOCKS_PILOT_READONLY_ACK:'READ_ONLY',STOCKS_IDENTITY_ISSUER:'synthetic-pg-only',STOCKS_TRADE_PRINCIPALS:JSON.stringify(subjects.map(subject=>({issuer:'synthetic-pg-only',subject})))};
  const names=['20261016000000_stocks_test_cash_authority','20261016170000_native_funding_model'],completed=name=>[name,new Date('2026-01-01T00:00:00Z'),null];
  const snapshot=async()=>(await db.$queryRawUnsafe('SELECT jsonb_build_object(\'users\',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t."id") FROM "User" t),\'cash\',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t."userId") FROM "DemoBalance" t),\'sessions\',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t."userId") FROM "Session" t))::text AS value'))[0].value,before=await snapshot();let inspected=0;
  const checked={$transaction:(fn,options)=>db.$transaction(async tx=>{const result=await fn(tx);const[mode]=await tx.$queryRawUnsafe('SHOW transaction_read_only');assert.equal(mode.transaction_read_only,'on');inspected++;return result;},options)};
  for(const name of names){const other=names.find(n=>n!==name);const scenarios=[{rows:[completed(name)],pass:true},{rows:[completed(name),[name,null,null]],pass:false},{rows:[[name,null,new Date('2026-01-01T00:00:00Z')]],pass:false},{rows:[],pass:false},{rows:[completed(name),completed(name)],pass:false},{rows:[[name,null,new Date('2026-01-01T00:00:00Z')],completed(name)],pass:true}];
   for(const scenario of scenarios){await db.$executeRawUnsafe('TRUNCATE "_prisma_migrations"');for(const row of[completed(other),...scenario.rows])await db.$executeRawUnsafe('INSERT INTO "_prisma_migrations" VALUES($1,$2,$3)',...row);const result=await inspectReadOnly(checked,env);assert.equal(result.status,scenario.pass?'DB_PREFLIGHT_PASS_NOT_AUTHORIZATION':'BLOCKED');assert.equal(result.productionAuthorized,false);assert.equal(result[name===names[0]?'stocksMigrationApplied':'fundingMigrationApplied'],scenario.pass);assert.equal(await snapshot(),before,'Fixture account rows must stay byte-equal');}
  }assert.equal(inspected,12);
 }finally{await db?.$disconnect();await admin.$executeRawUnsafe('DROP SCHEMA "'+schema+'" CASCADE');await admin.$disconnect();}
});
